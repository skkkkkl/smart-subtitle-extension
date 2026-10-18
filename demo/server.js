'use strict';

/*
 * Zero-dependency local demo server. It serves only the demo/ directory so a
 * page at http://127.0.0.1:8787/ can host a normal HTML5 video element without
 * needing host permissions for arbitrary websites.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 8787;
const ROOT = __dirname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.srt': 'application/x-subrip; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function send(response, status, body, contentType) {
  response.writeHead(status, {
    'Content-Type': contentType || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(body);
}

const server = http.createServer(function (request, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch (error) {
    send(response, 400, 'Bad request');
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(ROOT, '.' + pathname);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    send(response, 403, 'Forbidden');
    return;
  }

  fs.readFile(filePath, function (error, data) {
    if (error) {
      send(response, 404, 'Not found');
      return;
    }
    const type = TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    send(response, 200, data, type);
  });
});

server.on('error', function (error) {
  if (error.code === 'EADDRINUSE') {
    console.error(
      'Port ' + PORT + ' is already in use.\n' +
      'Try another port, for example:\n' +
      '  $env:PORT=8788; npm run demo'
    );
    process.exitCode = 1;
    return;
  }
  throw error;
});

server.listen(PORT, HOST, function () {
  console.log('Demo server: http://' + HOST + ':' + PORT + '/');
  console.log('Press Ctrl+C to stop.');
});

process.on('SIGINT', function () {
  server.close(function () {
    process.exit(0);
  });
});
