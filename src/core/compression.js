'use strict';
/** gzip for large JSON bodies (a week of GPS points shrinks about 10x). */
const zlib = require('node:zlib');
const { promisify } = require('node:util');

const gzip = promisify(zlib.gzip);

/** True when Accept-Encoding allows gzip (and does not say gzip;q=0). */
function acceptsGzip(header) {
  for (const part of String(header || '').toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';').map((s) => s.trim());
    if (name !== 'gzip') continue;
    const q = params.find((p) => p.startsWith('q='));
    return !q || Number.parseFloat(q.slice(2)) > 0;
  }
  return false;
}

async function maybeGzip(req, response, settings) {
  if (response.status !== 200 || response.headers['Content-Encoding']) return response;
  if (!acceptsGzip(req.headers['accept-encoding'])) return response;
  if (response.body.length < settings.gzipMinBytes) return response;
  const body = await gzip(response.body, { level: 5 });
  return {
    ...response,
    body,
    headers: {
      ...response.headers,
      'Content-Encoding': 'gzip',
      'Content-Length': body.length,
      Vary: 'Accept-Encoding',
    },
  };
}

module.exports = { maybeGzip, acceptsGzip };
