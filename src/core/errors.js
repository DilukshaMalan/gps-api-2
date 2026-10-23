'use strict';
/** One error shape for the whole API:  {"error": {"code": "...", "message": "..."}} */

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

class NotFoundError extends ApiError {
  constructor(code, message) {
    super(404, code, message);
  }
}

function errorResponse(status, code, message, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify({ error: { code, message } }));
  return {
    status,
    headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, ...extraHeaders },
    body,
  };
}

const NO_ROUTE = [
  'not_found',
  'The requested URL was not found on the server. If you entered the URL manually please check your spelling and try again.',
];
const BAD_METHOD = ['method_not_allowed', 'The method is not allowed for the requested URL.'];

module.exports = { ApiError, NotFoundError, errorResponse, NO_ROUTE, BAD_METHOD };
