'use strict';
/** Runtime settings, read from environment variables (see .env.example). */
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function intFromEnv(env, name, fallback, min) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${name} must be a whole number (got "${raw}")`);
  const value = Number.parseInt(raw, 10);
  if (value < min) throw new Error(`${name} must be at least ${min} (got ${value})`);
  return value;
}

/**
 * @param {object} [overrides]  Used by the tests; any key given here wins over the environment.
 */
function loadSettings(overrides = {}, env = process.env) {
  const settings = {
    // Folder that holds the QR-00X_trips.json files.
    dataDir: env.GPS_DATA_DIR ? path.resolve(env.GPS_DATA_DIR) : path.join(ROOT, 'data'),
    // When set, every /api/v1 request except /health must send  X-API-Key: <value>.
    apiKey: env.GPS_API_KEY || null,
    // Largest allowed (to - from) window for the trips endpoint.
    maxRangeDays: intFromEnv(env, 'GPS_MAX_RANGE_DAYS', 31, 1),
    // Responses smaller than this are not gzip-compressed.
    gzipMinBytes: intFromEnv(env, 'GPS_GZIP_MIN_BYTES', 1000, 0),
    // One log line per request (method, path, status, ms) when GPS_ACCESS_LOG=1.
    accessLog: env.GPS_ACCESS_LOG === '1',
  };
  return { ...settings, ...overrides };
}

module.exports = { loadSettings, ROOT };
