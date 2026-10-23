'use strict';
const { jsonResponse } = require('../core/http');

module.exports = [
  {
    method: 'GET',
    path: '/api/v1/health',
    handler: ({ service }) => jsonResponse({ status: 'ok', vehicles: service.vehicleCount }),
  },
];
