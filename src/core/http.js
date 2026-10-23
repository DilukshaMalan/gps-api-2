'use strict';
/** Response helpers shared by the route handlers and the app. */
const crypto = require('node:crypto');

/**
 * 200 JSON response. With `cacheable`, adds an ETag (hash of the body) so a repeat request that
 * sends If-None-Match gets a tiny 304 instead of the whole body.
 */
function jsonResponse(payload, { cacheable = false } = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  const headers = { 'Content-Type': 'application/json', 'Content-Length': body.length };
  if (cacheable) headers.ETag = `"${crypto.createHash('sha1').update(body).digest('hex')}"`;
  return { status: 200, headers, body };
}

/** True when the request's If-None-Match header matches `etag` (weak comparison, "*" matches all). */
function etagMatches(ifNoneMatch, etag) {
  if (!ifNoneMatch) return false;
  return String(ifNoneMatch)
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === '*' || t === etag);
}

module.exports = { jsonResponse, etagMatches };
