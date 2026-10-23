'use strict';
/** Parsing and validating query parameters. */
const { ApiError } = require('./errors');
const { parseIso } = require('./time');

const bad = (message) => new ApiError(400, 'invalid_request', message);

/**
 * ISO 8601 instant WITH a UTC offset, e.g. 2026-10-14T00:00:00+05:30 (or ...Z). Returns epoch ms.
 *
 * A '+' that was not percent-encoded in the URL arrives as a space; that is repaired here so
 * clients that forget to send %2B still work.
 */
function parseInstant(raw, name) {
  if (raw === null || raw === undefined || raw.trim() === '') {
    throw bad(`Query parameter '${name}' is required.`);
  }
  let value = raw.trim();
  if (/ \d{2}:\d{2}$/.test(value)) value = `${value.slice(0, -6)}+${value.slice(-5)}`;
  const parsed = parseIso(value);
  if (parsed.status === 'invalid') {
    throw bad(`'${name}' must be an ISO 8601 date-time, e.g. 2026-10-14T00:00:00+05:30.`);
  }
  if (parsed.status === 'no_offset') {
    throw bad(`'${name}' must include a UTC offset, e.g. +05:30 or Z.`);
  }
  return parsed.ms;
}

function parseBool(raw, name, fallback = false) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(value)) return true;
  if (['false', '0', 'no'].includes(value)) return false;
  throw bad(`'${name}' must be true or false.`);
}

function parseMaxPoints(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (!/^\s*[+-]?\d+\s*$/.test(raw)) throw bad("'maxPoints' must be an integer.");
  const value = Number.parseInt(raw, 10);
  if (value < 50 || value > 50000) throw bad("'maxPoints' must be between 50 and 50000.");
  return value;
}

module.exports = { parseInstant, parseBool, parseMaxPoints };
