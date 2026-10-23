module.exports = {
  apps: [{
    name: 'gps-api',
    script: 'index.js',
    instances: 1,
    autorestart: true,
    max_memory_restart: '300M',
    env: {
      PORT: 8000,
      GPS_API_KEY: process.env.GPS_API_KEY,
    },
  }],
};