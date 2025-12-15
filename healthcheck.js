// healthcheck.js
const http = require('http');
const options = {
  host: 'localhost',
  port: process.env.PORT || 3001,
  path: '/health',
  timeout: 2000
};

const req = http.get(options, (res) => {
  process.exit(res.statusCode === 200 ? 0 : 1);
});

req.on('error', () => process.exit(1));
req.setTimeout(2000, () => {
  req.abort();
  process.exit(1);
});