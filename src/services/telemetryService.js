'use strict';
/**
 * Loads the GPS files once at start-up and answers queries from memory.
 *
 * No HTTP code in here. Replace the file loading with a database later and keep the public
 * methods as they are.
 */
const fs = require('node:fs');
const path = require('node:path');
const { NotFoundError } = require('../core/errors');
const { parseVehicleFile, lastKnownOf, positionOf, tripWithPoints } = require('../models/telemetry');

/** First index whose value is >= x (like Python's bisect_left). */
function lowerBound(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose value is > x (like Python's bisect_right). */
function upperBound(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Keep every `stride`-th point and always the last one. */
function thin(points, stride) {
  if (stride <= 1 || points.length <= 2) return points;
  const out = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]);
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

const strideFor = (total, maxPoints) => (maxPoints && total > maxPoints ? Math.ceil(total / maxPoints) : 1);

class TelemetryService {
  constructor(dataDir) {
    this.vehicles = new Map();
    let files;
    try {
      files = fs.readdirSync(dataDir).filter((f) => f.endsWith('_trips.json')).sort();
    } catch (err) {
      throw new Error(`Cannot read the data folder "${dataDir}": ${err.message}`);
    }
    if (files.length === 0) throw new Error(`No *_trips.json files found in ${dataDir}`);
    for (const file of files) {
      let raw;
      try {
        raw = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
      } catch (err) {
        throw new Error(`${file}: not valid JSON (${err.message})`);
      }
      const record = parseVehicleFile(raw, file);
      if (this.vehicles.has(record.vehicleId)) throw new Error(`${file}: duplicate vehicleId "${record.vehicleId}"`);
      this.vehicles.set(record.vehicleId, record);
    }
  }

  #vehicle(vehicleId) {
    const v = this.vehicles.get(vehicleId);
    if (!v) throw new NotFoundError('vehicle_not_found', `Unknown vehicle '${vehicleId}'.`);
    return v;
  }

  get vehicleCount() {
    return this.vehicles.size;
  }

  listVehicles() {
    return [...this.vehicles.values()]
      .sort((a, b) => (a.vehicleId < b.vehicleId ? -1 : a.vehicleId > b.vehicleId ? 1 : 0))
      .map((v) => {
        const last = v.trips[v.trips.length - 1].points.at(-1);
        return {
          vehicleId: v.vehicleId,
          dataStart: v.trips[0].summary.startTime,
          dataEnd: last.timestamp,
          tripCount: v.trips.length,
          pointCount: v.trips.reduce((n, t) => n + t.points.length, 0),
          lastKnown: lastKnownOf(last),
        };
      });
  }

  getPosition(vehicleId) {
    const v = this.#vehicle(vehicleId);
    return positionOf(vehicleId, v.trips[v.trips.length - 1].points.at(-1));
  }

  /** Trips that overlap [startMs, endMs]. With points, they are clipped to that window. */
  getTrips(vehicleId, startMs, endMs, includePoints, maxPoints) {
    const v = this.#vehicle(vehicleId);
    const hits = v.trips.filter((r) => r.start <= endMs && r.end >= startMs);

    if (!includePoints) {
      return {
        vehicleId,
        meta: { dataSource: v.dataSource, samplingIntervalSeconds: v.intervalS, tripCount: hits.length },
        trips: hits.map((r) => r.summary),
      };
    }

    const clipped = [];
    for (const r of hits) {
      const pts = r.points.slice(lowerBound(r.epochs, startMs), upperBound(r.epochs, endMs));
      if (pts.length > 0) clipped.push([r, pts]); // a trip with no samples in the window is skipped
    }
    const total = clipped.reduce((n, [, pts]) => n + pts.length, 0);
    const stride = strideFor(total, maxPoints);

    let pointCount = 0;
    const trips = clipped.map(([r, pts]) => {
      const thinned = thin(pts, stride);
      pointCount += thinned.length;
      return tripWithPoints(r.summary, thinned);
    });
    return {
      vehicleId,
      meta: {
        dataSource: v.dataSource,
        samplingIntervalSeconds: v.intervalS,
        tripCount: trips.length,
        pointCount,
        effectiveIntervalSeconds: v.intervalS * stride,
      },
      trips,
    };
  }

  getTrip(vehicleId, tripId, maxPoints) {
    const v = this.#vehicle(vehicleId);
    const r = v.trips.find((t) => t.summary.tripId === tripId);
    if (!r) throw new NotFoundError('trip_not_found', `Vehicle '${vehicleId}' has no trip '${tripId}'.`);
    return tripWithPoints(r.summary, thin(r.points, strideFor(r.points.length, maxPoints)));
  }
}

module.exports = { TelemetryService };
