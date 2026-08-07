'use strict';

// Acceptance-only loopback server. It mirrors the product LocalTestServer surface and adds only
// /favicon.ico -> 204 so browser console auditing remains strict without changing product code.
const http = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const localServerModule = require('../src/main/local-test-server.cjs');
const ProductLocalTestServer = localServerModule.LocalTestServer;

class AcceptanceLocalTestServer extends ProductLocalTestServer {
  async start() {
    if (this.server) return this.baseUrl();
    this.server = http.createServer((request, response) => {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (path === '/favicon.ico') {
        response.writeHead(204, { 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      if (path === '/' || path === '/task-form.html') {
        const body = readFileSync(join(this.rootDirectory, 'task-form.html'));
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
          'Cache-Control': 'no-store',
        });
        response.end(body);
        return;
      }
      if (path === '/health') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ ok: true, scope: 'local-project-owned-test-surface' }));
        return;
      }
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    });

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.requestedPort, this.host, resolve);
    });
    this.port = this.server.address().port;
    return this.baseUrl();
  }
}

localServerModule.LocalTestServer = AcceptanceLocalTestServer;
require('./s2-acceptance-native-mac.cjs');
