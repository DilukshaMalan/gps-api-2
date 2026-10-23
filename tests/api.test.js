'use strict';
/** Run:  npm test      (from the gps-api-node folder) */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { createApp } = require('../src/app');
const { loadSettings } = require('../src/config');
const { parseIso } = require('../src/core/time');
const { acceptsGzip } = require('../src/core/compression');
const { TelemetryService } = require('../src/services/telemetryService');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DAY = 'from=2026-10-16T00:00:00%2B05:30&to=2026-10-16T23:59:59%2B05:30';
const WEEK = 'from=2026-10-12T00:00:00%2B05:30&to=2026-10-18T23:59:59%2B05:30';

const raw = (id) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${id}_trips.json`), 'utf8'));
const overlapping = (id, start, end) =>
  raw(id).trips.filter((t) => Date.parse(t.startTime) <= Date.parse(end) && Date.parse(t.endTime) >= Date.parse(start));

async function startServer(overrides = {}) {
  const app = createApp(loadSettings({ apiKey: null, dataDir: DATA_DIR, accessLog: false, ...overrides }));
  const server = app.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

const stopServer = (server) =>
  new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  });

/** Raw HTTP request: no automatic decompression, no keep-alive, so the tests see exactly what is sent. */
function request(server, urlPath, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: server.address().port, path: urlPath, method, headers, agent: false },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}
const json = (r) => JSON.parse(r.body.toString('utf8'));
const text = (r) => r.body.toString('utf8');

describe('API', () => {
  let server;
  before(async () => {
    server = await startServer();
  });
  after(() => stopServer(server));
  const get = (p, opts) => request(server, p, opts);

  // ── health / list ──
  it('health', async () => {
    const r = await get('/api/v1/health');
    assert.equal(r.status, 200);
    assert.deepEqual(json(r), { status: 'ok', vehicles: 3 });
  });

  it('list vehicles', async () => {
    const body = json(await get('/api/v1/vehicles'));
    assert.deepEqual(body.vehicles.map((v) => v.vehicleId), ['QR-001', 'QR-002', 'QR-003']);
    assert.equal(body.vehicles[0].tripCount, 40);
    assert.equal(body.vehicles[0].lastKnown.engineOn, false);
  });

  // ── 1. position ──
  it('position: parked vehicle', async () => {
    const body = json(await get('/api/v1/vehicles/QR-001/position'));
    assert.deepEqual(Object.keys(body), ['vehicleId', 'timestamp', 'latitude', 'longitude', 'speedKmh', 'engineOn']);
    assert.equal(body.engineOn, false);
    assert.equal(body.speedKmh, 0);
  });

  it('position: moving vehicle', async () => {
    const body = json(await get('/api/v1/vehicles/QR-002/position'));
    assert.equal(body.engineOn, true);
    assert.ok(body.speedKmh > 0);
  });

  it('position: unknown vehicle', async () => {
    const r = await get('/api/v1/vehicles/NOPE/position');
    assert.equal(r.status, 404);
    assert.equal(json(r).error.code, 'vehicle_not_found');
  });

  // ── 2. trip summaries ──
  it('trip summaries for one day', async () => {
    const body = json(await get(`/api/v1/vehicles/QR-003/trips?${DAY}`));
    const expected = overlapping('QR-003', '2026-10-16T00:00:00+05:30', '2026-10-16T23:59:59+05:30');
    assert.deepEqual(body.trips.map((t) => t.tripId), expected.map((t) => t.tripId));
    assert.equal(body.meta.tripCount, expected.length);
    assert.ok(expected.length > 0);
    for (const t of body.trips) {
      assert.ok(!('points' in t));
      assert.deepEqual(Object.keys(t), [
        'tripId', 'startTime', 'endTime', 'startReason', 'endReason', 'distanceKm', 'maxSpeedKmh', 'averageSpeedKmh',
      ]);
    }
  });

  it('an in-progress trip keeps endReason: null', async () => {
    const r = await get('/api/v1/vehicles/QR-002/trips?from=2026-10-23T00:00:00%2B05:30&to=2026-10-23T23:59:59%2B05:30');
    const last = json(r).trips.at(-1);
    assert.ok('endReason' in last);
    assert.equal(last.endReason, null);
  });

  // ── 3. trips with points ──
  it('points are clipped to the window', async () => {
    const url = '/api/v1/vehicles/QR-001/trips?from=2026-10-16T00:00:00%2B05:30&to=2026-10-16T12:00:00%2B05:30&includePoints=true';
    const body = json(await get(url));
    const limit = Date.parse('2026-10-16T12:00:00+05:30');
    assert.ok(body.trips.length > 0);
    for (const t of body.trips) for (const p of t.points) assert.ok(Date.parse(p.timestamp) <= limit);
    assert.equal(body.meta.pointCount, body.trips.reduce((n, t) => n + t.points.length, 0));
    assert.equal(body.meta.effectiveIntervalSeconds, 5);
  });

  it('a full week of points matches the source files', async () => {
    const body = json(await get(`/api/v1/vehicles/QR-001/trips?${WEEK}&includePoints=true`));
    const expected = overlapping('QR-001', '2026-10-12T00:00:00+05:30', '2026-10-18T23:59:59+05:30');
    assert.equal(body.trips.length, expected.length);
    body.trips.forEach((t, i) => assert.deepEqual(t.points, expected[i].points));
  });

  it('window edges are inclusive and cut exactly', async () => {
    const trip = raw('QR-003').trips.find((t) => t.points.length >= 300);
    assert.ok(trip, 'test data needs a trip with at least 300 points');
    const [a, b] = [trip.points[100].timestamp, trip.points[200].timestamp];
    const url = `/api/v1/vehicles/QR-003/trips?from=${encodeURIComponent(a)}&to=${encodeURIComponent(b)}&includePoints=true`;
    const body = json(await get(url));
    const mine = body.trips.find((t) => t.tripId === trip.tripId);
    assert.deepEqual(mine.points, trip.points.slice(100, 201));
  });

  it('maxPoints thins the points and keeps first and last of each trip', async () => {
    const full = json(await get(`/api/v1/vehicles/QR-003/trips?${WEEK}&includePoints=true`));
    const thin = json(await get(`/api/v1/vehicles/QR-003/trips?${WEEK}&includePoints=true&maxPoints=2000`));
    const nFull = full.trips.reduce((n, t) => n + t.points.length, 0);
    const nThin = thin.trips.reduce((n, t) => n + t.points.length, 0);
    assert.ok(nFull > 2000);
    assert.ok(nThin < nFull);
    assert.ok(nThin <= 2000 + thin.trips.length); // +1 kept last point per trip
    assert.ok(thin.meta.effectiveIntervalSeconds > 5);
    full.trips.forEach((tf, i) => {
      assert.deepEqual(tf.points.at(-1), thin.trips[i].points.at(-1));
      assert.deepEqual(tf.points[0], thin.trips[i].points[0]);
    });
  });

  // ── 4. trip detail ──
  it('trip detail', async () => {
    const src = raw('QR-002').trips[3];
    const body = json(await get(`/api/v1/vehicles/QR-002/trips/${src.tripId}`));
    assert.equal(body.tripId, src.tripId);
    assert.deepEqual(body.points, src.points);
  });

  it('trip detail with maxPoints', async () => {
    const src = raw('QR-002').trips[3];
    const body = json(await get(`/api/v1/vehicles/QR-002/trips/${src.tripId}?maxPoints=100`));
    assert.ok(body.points.length < src.points.length);
    assert.deepEqual(body.points.at(-1), src.points.at(-1));
  });

  it('trip not found', async () => {
    const r = await get('/api/v1/vehicles/QR-001/trips/QR001-TRIP-999');
    assert.equal(r.status, 404);
    assert.equal(json(r).error.code, 'trip_not_found');
  });

  // ── validation ──
  it('rejects bad query parameters with 400', async () => {
    const cases = {
      '/api/v1/vehicles/QR-001/trips': 'invalid_request', // missing from/to
      '/api/v1/vehicles/QR-001/trips?from=2026-10-16T00:00:00%2B05:30': 'invalid_request', // missing to
      '/api/v1/vehicles/QR-001/trips?from=2026-10-16T00:00:00&to=2026-10-17T00:00:00': 'invalid_request', // no offset
      '/api/v1/vehicles/QR-001/trips?from=2026-10-16&to=2026-10-17': 'invalid_request', // date only
      '/api/v1/vehicles/QR-001/trips?from=2026-02-30T00:00:00Z&to=2026-03-01T00:00:00Z': 'invalid_request', // no such day
      '/api/v1/vehicles/QR-001/trips?from=yesterday&to=today': 'invalid_request',
      '/api/v1/vehicles/QR-001/trips?from=2026-10-17T00:00:00%2B05:30&to=2026-10-16T00:00:00%2B05:30': 'invalid_range',
      '/api/v1/vehicles/QR-001/trips?from=2026-08-01T00:00:00%2B05:30&to=2026-10-01T00:00:00%2B05:30': 'range_too_large',
      [`/api/v1/vehicles/QR-001/trips?${DAY}&maxPoints=5`]: 'invalid_request',
      [`/api/v1/vehicles/QR-001/trips?${DAY}&maxPoints=abc`]: 'invalid_request',
      [`/api/v1/vehicles/QR-001/trips?${DAY}&includePoints=maybe`]: 'invalid_request',
      [`/api/v1/vehicles/NOPE/trips?from=bad&to=bad`]: 'invalid_request', // validation runs before the vehicle lookup
    };
    for (const [url, code] of Object.entries(cases)) {
      const r = await get(url);
      assert.equal(r.status, 400, url);
      assert.equal(json(r).error.code, code, url);
    }
  });

  it('accepts Z offsets, fractional seconds and an unencoded +', async () => {
    const expected = overlapping('QR-001', '2026-10-16T00:00:00+05:30', '2026-10-16T23:59:59+05:30').length;
    const urls = [
      '/api/v1/vehicles/QR-001/trips?from=2026-10-16T00:00:00+05:30&to=2026-10-16T23:59:59+05:30', // raw '+'
      '/api/v1/vehicles/QR-001/trips?from=2026-10-15T18:30:00Z&to=2026-10-16T18:29:59Z',
      '/api/v1/vehicles/QR-001/trips?from=2026-10-16T00:00:00.000%2B05:30&to=2026-10-16T23:59:59.500%2B05:30',
    ];
    for (const url of urls) {
      const r = await get(url);
      assert.equal(r.status, 200, url);
      assert.equal(json(r).trips.length, expected, url);
    }
  });

  it('unknown routes use the error shape', async () => {
    for (const p of ['/api/v1/nothing', '/api/v1/vehicles/', '/']) {
      const r = await get(p);
      assert.equal(r.status, 404, p);
      assert.equal(json(r).error.code, 'not_found', p);
    }
  });

  it('wrong method gives 405; OPTIONS and HEAD work', async () => {
    const post = await get('/api/v1/vehicles', { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(json(post).error.code, 'method_not_allowed');
    assert.equal(post.headers.allow, 'GET, HEAD, OPTIONS');
    const options = await get('/api/v1/vehicles', { method: 'OPTIONS' });
    assert.equal(options.status, 200);
    const head = await get('/api/v1/health', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.ok(Number(head.headers['content-length']) > 0);
  });

  // ── formatting / transport ──
  it('timestamps match the iOS .iso8601 strategy (offset, no fractional seconds)', async () => {
    const body = text(await get(`/api/v1/vehicles/QR-001/trips?${DAY}&includePoints=true`));
    const stamps = [...body.matchAll(/"(?:timestamp|startTime|endTime)":"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(stamps.length > 0);
    const bad = stamps.filter((s) => !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+05:30$/.test(s));
    assert.deepEqual(bad.slice(0, 3), []);
  });

  it('gzip and ETag', async () => {
    const url = `/api/v1/vehicles/QR-003/trips?${WEEK}&includePoints=true`;
    const plain = await get(url);
    const zipped = await get(url, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(zipped.headers['content-encoding'], 'gzip');
    assert.equal(zipped.headers.vary, 'Accept-Encoding');
    assert.ok(zipped.body.length < plain.body.length / 5);
    assert.deepEqual(JSON.parse(zlib.gunzipSync(zipped.body).toString()), json(plain));
    assert.equal(plain.headers['content-encoding'], undefined);

    const etag = plain.headers.etag;
    assert.ok(etag);
    const again = await get(url, { headers: { 'If-None-Match': etag } });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);
    const stale = await get(url, { headers: { 'If-None-Match': '"something-else"' } });
    assert.equal(stale.status, 200);
  });

  it('small responses are not compressed', async () => {
    const r = await get('/api/v1/health', { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(r.headers['content-encoding'], undefined);
  });
});

describe('API key', () => {
  let server;
  before(async () => {
    server = await startServer({ apiKey: 'secret' });
  });
  after(() => stopServer(server));

  it('is required everywhere except /health', async () => {
    assert.equal((await request(server, '/api/v1/health')).status, 200);
    const missing = await request(server, '/api/v1/vehicles/QR-001/position');
    assert.equal(missing.status, 401);
    assert.equal(json(missing).error.code, 'unauthorized');
    assert.equal((await request(server, '/api/v1/vehicles/QR-001/position', { headers: { 'X-API-Key': 'wrong' } })).status, 401);
    assert.equal((await request(server, '/api/v1/vehicles/QR-001/position', { headers: { 'X-API-Key': 'secrets' } })).status, 401);
    assert.equal((await request(server, '/api/v1/vehicles/QR-001/position', { headers: { 'X-API-Key': 'secret' } })).status, 200);
  });

  it('is checked before routing (an unknown URL without a key is a 401)', async () => {
    assert.equal((await request(server, '/api/v1/nothing')).status, 401);
  });
});

describe('units', () => {
  it('parseIso', () => {
    assert.deepEqual(parseIso('2026-10-14T00:00:00+05:30'), { status: 'ok', ms: Date.UTC(2026, 9, 13, 18, 30) });
    assert.deepEqual(parseIso('2026-10-14T00:00:00Z'), { status: 'ok', ms: Date.UTC(2026, 9, 14) });
    assert.deepEqual(parseIso('2026-10-14T00:00:00-08:00'), { status: 'ok', ms: Date.UTC(2026, 9, 14, 8) });
    assert.equal(parseIso('2026-10-14T00:00:00.123Z').ms, Date.UTC(2026, 9, 14) + 123);
    assert.equal(parseIso('2024-02-29T12:00:00Z').status, 'ok'); // leap day
    assert.equal(parseIso('2026-02-29T12:00:00Z').status, 'invalid');
    assert.equal(parseIso('2026-10-14T24:00:00Z').status, 'invalid');
    assert.equal(parseIso('2026-10-14T00:00:00').status, 'no_offset');
    assert.equal(parseIso('2026-10-14').status, 'no_offset');
    assert.equal(parseIso('2026-10-14+05:30').status, 'invalid');
    assert.equal(parseIso('tomorrow').status, 'invalid');
    assert.equal(parseIso('0000-01-01T00:00:00Z').status, 'invalid');
  });

  it('acceptsGzip', () => {
    assert.equal(acceptsGzip('gzip'), true);
    assert.equal(acceptsGzip('gzip, deflate, br'), true);
    assert.equal(acceptsGzip('br;q=1.0, gzip;q=0.8'), true);
    assert.equal(acceptsGzip('gzip;q=0'), false);
    assert.equal(acceptsGzip('identity'), false);
    assert.equal(acceptsGzip(undefined), false);
  });

  it('refuses to start on bad data', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gps-bad-'));
    assert.throws(() => new TelemetryService(dir), /No \*_trips\.json files/);
    assert.throws(() => new TelemetryService(path.join(dir, 'missing')), /Cannot read the data folder/);

    fs.writeFileSync(path.join(dir, 'X_trips.json'), '{not json');
    assert.throws(() => new TelemetryService(dir), /not valid JSON/);

    const good = raw('QR-001');
    good.trips = good.trips.slice(0, 1);
    good.trips[0].points[3].timestamp = '2026-10-10T07:00:00'; // no UTC offset
    fs.writeFileSync(path.join(dir, 'X_trips.json'), JSON.stringify(good));
    assert.throws(() => new TelemetryService(dir), /invalid timestamp/);

    good.trips[0].points[3].timestamp = raw('QR-001').trips[0].points[3].timestamp;
    delete good.trips[0].endReason;
    fs.writeFileSync(path.join(dir, 'X_trips.json'), JSON.stringify(good));
    assert.throws(() => new TelemetryService(dir), /endReason/);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
