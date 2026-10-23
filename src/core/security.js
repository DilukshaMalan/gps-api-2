'use strict';
/** Optional API-key check. The key is shared between your own backend and this service. */
const crypto = require('node:crypto');
const { ApiError } = require('./errors');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest();

function checkApiKey(settings, req, pathname) {
  if (!settings.apiKey) return; // no key configured -> open (local development)
  if (pathname.replace(/\/+$/, '') === '/api/v1/health') return;
  const supplied = String(req.headers['x-api-key'] ?? '');
  // hash both sides first so the comparison is constant-time even when the lengths differ
  if (!crypto.timingSafeEqual(sha256(supplied), sha256(settings.apiKey))) {
    throw new ApiError(401, 'unauthorized', 'Missing or invalid API key.');
  }
}

module.exports = { checkApiKey };
