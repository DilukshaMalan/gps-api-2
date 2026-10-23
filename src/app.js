'use strict';
/**
 * Wires everything together. Built on Node's own `http` module (no dependencies to install).
 * The service and models know nothing about HTTP, so moving to Express or Fastify later only
 * means re-registering the handlers in src/routes.
 */
const http = require('node:http');
const { loadSettings } = require('./config');
const { ApiError, errorResponse, NO_ROUTE, BAD_METHOD } = require('./core/errors');
const { checkApiKey } = require('./core/security');
const { maybeGzip } = require('./core/compression');
const { etagMatches } = require('./core/http');
const { TelemetryService } = require('./services/telemetryService');

const ALLOW = 'GET, HEAD, OPTIONS';
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Turns '/api/v1/vehicles/:vehicleId/trips' into a matcher that returns the :params. */
function compileRoute(route) {
  const keys = [];
  const source = route.path
    .split('/')
    .map((seg) => {
      if (!seg.startsWith(':')) return escapeRegex(seg);
      keys.push(seg.slice(1));
      return '([^/]+)';
    })
    .join('/');
  return { ...route, keys, re: new RegExp(`^${source}$`) };
}

function createApp(settings = loadSettings()) {
  const service = new TelemetryService(settings.dataDir); // loads the JSON files once
  const routes = [...require('./routes/health'), ...require('./routes/vehicles')].map(compileRoute);

  /** Runs the request through key check -> routing -> handler. Always returns a response object. */
  async function dispatch(req) {
    try {
      if (typeof req.url !== 'string' || !req.url.startsWith('/')) return errorResponse(404, ...NO_ROUTE);
      const q = req.url.indexOf('?');
      const pathname = q === -1 ? req.url : req.url.slice(0, q);
      const query = new URLSearchParams(q === -1 ? '' : req.url.slice(q + 1));

      checkApiKey(settings, req, pathname); // runs before routing, so an unknown URL without a key is a 401

      const matches = routes.map((r) => ({ r, m: r.re.exec(pathname) })).filter((x) => x.m);
      if (matches.length === 0) return errorResponse(404, ...NO_ROUTE);

      const method = req.method === 'HEAD' ? 'GET' : req.method;
      const hit = matches.find((x) => x.r.method === method);
      if (!hit) {
        if (req.method === 'OPTIONS') return { status: 200, headers: { Allow: ALLOW, 'Content-Length': 0 }, body: Buffer.alloc(0) };
        return errorResponse(405, ...BAD_METHOD, { Allow: ALLOW });
      }

      let params;
      try {
        params = Object.fromEntries(hit.r.keys.map((k, i) => [k, decodeURIComponent(hit.m[i + 1])]));
      } catch {
        return errorResponse(404, ...NO_ROUTE); // malformed %-encoding in the path
      }
      return await hit.r.handler({ req, params, query, settings, service });
    } catch (err) {
      if (err instanceof ApiError) return errorResponse(err.status, err.code, err.message);
      console.error('Unhandled error:', err);
      return errorResponse(500, 'internal_error', 'Unexpected server error.');
    }
  }

  /** dispatch() plus ETag/304 handling and gzip. This is what the server writes to the socket. */
  async function respond(req) {
    let response = await dispatch(req);
    const readOnly = req.method === 'GET' || req.method === 'HEAD';
    if (readOnly && response.status === 200 && etagMatches(req.headers['if-none-match'], response.headers.ETag)) {
      return { status: 304, headers: { ETag: response.headers.ETag }, body: Buffer.alloc(0) };
    }
    try {
      response = await maybeGzip(req, response, settings);
    } catch (err) {
      console.error('gzip failed, sending uncompressed:', err);
    }
    return response;
  }

  async function handle(req, res) {
    const started = process.hrtime.bigint();
    const response = await respond(req);
    res.writeHead(response.status, response.headers);
    res.end(response.body); // Node drops the body itself for HEAD and 304
    if (settings.accessLog) {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      console.log(`${req.method} ${req.url} ${response.status} ${ms.toFixed(1)}ms`);
    }
  }

  function createServer() {
    const server = http.createServer((req, res) => {
      handle(req, res).catch((err) => {
        console.error('Fatal error while writing response:', err);
        res.destroy();
      });
    });
    // Longer than the 60 s idle timeout of Railway / Render load balancers, otherwise they
    // occasionally reuse a connection Node has just closed and the client sees a 502.
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 66_000;
    return server;
  }

  return { settings, service, dispatch, respond, handle, createServer };
}

module.exports = { createApp };
