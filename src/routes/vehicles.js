'use strict';
/**
 * The GPS endpoints.
 *
 *   GET /api/v1/vehicles                                     (optional) list vehicles + data range
 *   GET /api/v1/vehicles/{vehicleId}/position                1. latest position
 *   GET /api/v1/vehicles/{vehicleId}/trips?from=&to=         2. trip summaries in a window
 *       ...&includePoints=true[&maxPoints=5000]              3. same, with GPS points
 *   GET /api/v1/vehicles/{vehicleId}/trips/{tripId}          4. one trip with its points
 *
 * Handlers only validate the query string and call the service. Order matters: the query is
 * validated BEFORE the vehicle is looked up, so bad parameters give 400 even for an unknown id.
 */
const { ApiError } = require('../core/errors');
const { jsonResponse } = require('../core/http');
const { parseInstant, parseBool, parseMaxPoints } = require('../core/query');

const DAY_MS = 86_400_000;

function listVehicles({ service }) {
  return jsonResponse({ vehicles: service.listVehicles() });
}

function position({ service, params }) {
  return jsonResponse(service.getPosition(params.vehicleId));
}

function trips({ service, params, query, settings }) {
  const start = parseInstant(query.get('from'), 'from');
  const end = parseInstant(query.get('to'), 'to');
  if (end < start) throw new ApiError(400, 'invalid_range', "'to' must not be earlier than 'from'.");
  if (end - start > settings.maxRangeDays * DAY_MS) {
    throw new ApiError(400, 'range_too_large', `The requested window is longer than ${settings.maxRangeDays} days.`);
  }
  const includePoints = parseBool(query.get('includePoints'), 'includePoints');
  const maxPoints = parseMaxPoints(query.get('maxPoints'));
  return jsonResponse(service.getTrips(params.vehicleId, start, end, includePoints, maxPoints), { cacheable: true });
}

function tripDetail({ service, params, query }) {
  const maxPoints = parseMaxPoints(query.get('maxPoints'));
  return jsonResponse(service.getTrip(params.vehicleId, params.tripId, maxPoints), { cacheable: true });
}

module.exports = [
  { method: 'GET', path: '/api/v1/vehicles', handler: listVehicles },
  { method: 'GET', path: '/api/v1/vehicles/:vehicleId/position', handler: position },
  { method: 'GET', path: '/api/v1/vehicles/:vehicleId/trips', handler: trips },
  { method: 'GET', path: '/api/v1/vehicles/:vehicleId/trips/:tripId', handler: tripDetail },
];
