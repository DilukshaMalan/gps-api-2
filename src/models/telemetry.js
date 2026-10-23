'use strict';
/**
 * The JSON contract. Field names are camelCase on purpose: they are the exact keys the iOS app's
 * Codable models (TelemetryPoint, TelemetryTrip) already decode, and the key ORDER below is the
 * order they appear in every response.
 *
 *   Point   { timestamp, latitude, longitude, speedKmh, engineOn }
 *   Trip    { tripId, startTime, endTime, startReason, endReason, distanceKm, maxSpeedKmh,
 *             averageSpeedKmh, points? }          endReason is null while a trip is in progress
 *
 * The parse* functions validate the data files once, at start-up, and copy only the fields above
 * (anything else in a file is ignored). Timestamps are kept as the original strings so the
 * "+05:30" offset the iOS decoder expects is returned exactly as stored.
 */
const { parseIso } = require('../core/time');

function fail(where, message) {
  throw new Error(`${where}: ${message}`);
}

const isNumber = (x) => typeof x === 'number' && Number.isFinite(x);

function instant(value, where) {
  if (typeof value !== 'string') fail(where, 'expected an ISO 8601 string');
  const parsed = parseIso(value);
  if (parsed.status !== 'ok') fail(where, `invalid timestamp "${value}" (needs date, time and UTC offset)`);
  return parsed.ms;
}

function parsePoint(raw, where) {
  if (raw === null || typeof raw !== 'object') fail(where, 'point must be an object');
  const ms = instant(raw.timestamp, `${where}.timestamp`);
  if (!isNumber(raw.latitude)) fail(`${where}.latitude`, 'expected a number');
  if (!isNumber(raw.longitude)) fail(`${where}.longitude`, 'expected a number');
  if (!isNumber(raw.speedKmh)) fail(`${where}.speedKmh`, 'expected a number');
  if (typeof raw.engineOn !== 'boolean') fail(`${where}.engineOn`, 'expected true or false');
  return {
    ms,
    point: {
      timestamp: raw.timestamp,
      latitude: raw.latitude,
      longitude: raw.longitude,
      speedKmh: raw.speedKmh,
      engineOn: raw.engineOn,
    },
  };
}

/** @returns a trip record: summary (no points), points, their epoch ms (sorted), and start/end ms. */
function parseTrip(raw, where) {
  if (raw === null || typeof raw !== 'object') fail(where, 'trip must be an object');
  if (typeof raw.tripId !== 'string' || raw.tripId === '') fail(`${where}.tripId`, 'expected a non-empty string');
  const tripWhere = `${where} (${raw.tripId})`;
  const start = instant(raw.startTime, `${tripWhere}.startTime`);
  const end = instant(raw.endTime, `${tripWhere}.endTime`);
  if (typeof raw.startReason !== 'string') fail(`${tripWhere}.startReason`, 'expected a string');
  if (raw.endReason !== null && typeof raw.endReason !== 'string') {
    fail(`${tripWhere}.endReason`, 'expected a string, or null for a trip in progress');
  }
  for (const key of ['distanceKm', 'maxSpeedKmh', 'averageSpeedKmh']) {
    if (!isNumber(raw[key])) fail(`${tripWhere}.${key}`, 'expected a number');
  }
  if (!Array.isArray(raw.points) || raw.points.length === 0) fail(`${tripWhere}.points`, 'expected at least one point');

  const points = [];
  const epochs = [];
  raw.points.forEach((p, i) => {
    const { point, ms } = parsePoint(p, `${tripWhere}.points[${i}]`);
    if (i > 0 && ms < epochs[i - 1]) fail(`${tripWhere}.points[${i}]`, 'points must be in time order');
    points.push(point);
    epochs.push(ms);
  });

  return {
    summary: {
      tripId: raw.tripId,
      startTime: raw.startTime,
      endTime: raw.endTime,
      startReason: raw.startReason,
      endReason: raw.endReason,
      distanceKm: raw.distanceKm,
      maxSpeedKmh: raw.maxSpeedKmh,
      averageSpeedKmh: raw.averageSpeedKmh,
    },
    points,
    epochs,
    start,
    end,
  };
}

/** @returns {{vehicleId, dataSource, intervalS, trips}} with trips sorted oldest first. */
function parseVehicleFile(raw, label) {
  if (raw === null || typeof raw !== 'object') fail(label, 'file must contain a JSON object');
  if (typeof raw.vehicleId !== 'string' || raw.vehicleId === '') fail(`${label}.vehicleId`, 'expected a non-empty string');
  if (!Array.isArray(raw.trips) || raw.trips.length === 0) fail(`${label}.trips`, 'expected at least one trip');
  const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};
  const trips = raw.trips.map((t, i) => parseTrip(t, `${label}.trips[${i}]`));
  trips.sort((a, b) => a.start - b.start);
  return {
    vehicleId: raw.vehicleId,
    dataSource: typeof meta.dataSource === 'string' ? meta.dataSource : 'unknown',
    intervalS: Number.isInteger(meta.samplingIntervalSeconds) ? meta.samplingIntervalSeconds : 5,
    trips,
  };
}

// ───────────────────────── response builders ─────────────────────────

const lastKnownOf = (p) => ({
  timestamp: p.timestamp,
  latitude: p.latitude,
  longitude: p.longitude,
  speedKmh: p.speedKmh,
  engineOn: p.engineOn,
});

const positionOf = (vehicleId, p) => ({ vehicleId, ...lastKnownOf(p) });

const tripWithPoints = (summary, points) => ({ ...summary, points });

module.exports = { parseVehicleFile, lastKnownOf, positionOf, tripWithPoints };
