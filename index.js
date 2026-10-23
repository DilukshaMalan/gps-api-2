'use strict';
/**
 * Entry point:  npm start     (or: node index.js)
 * PORT and HOST come from the environment; Railway and Render set PORT for you.
 */
const { createApp } = require('./src/app');

const port = Number(process.env.PORT) || 8000;
// 0.0.0.0 so a real iPhone on the same Wi-Fi can reach it; the simulator can use localhost.
const host = process.env.HOST || '0.0.0.0';

let app;
try {
  app = createApp();
} catch (err) {
  console.error(`Could not start: ${err.message}`);
  process.exit(1);
}

const server = app.createServer();
server.listen(port, host, () => {
  console.log(`GPS API listening on http://${host}:${port}  (${app.service.vehicleCount} vehicles loaded)`);
  if (!app.settings.apiKey) console.log('No GPS_API_KEY set: the API is open. Set one before deploying.');
});

// Railway / Render send SIGTERM on every redeploy: finish in-flight requests, then exit.
function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
  server.closeIdleConnections?.();
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
