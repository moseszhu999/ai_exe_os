const http = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

function validatePort(port) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RangeError('Local test server port must be an integer from 0 to 65535');
  }
  return port;
}

class LocalTestServer {
  constructor({ rootDirectory, host = '127.0.0.1', port = 0 }) {
    this.rootDirectory = rootDirectory;
    this.host = host;
    this.requestedPort = validatePort(port);
    this.server = null;
    this.port = null;
  }

  async start() {
    if (this.server) return this.baseUrl();
    this.server = http.createServer((request, response) => {
      const path = new URL(request.url, 'http://localhost').pathname;
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

  baseUrl() {
    if (!this.port) throw new Error('Local test server is not started');
    return `http://${this.host}:${this.port}`;
  }

  async stop() {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    this.port = null;
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      // Node's http.Server.close() waits for active requests/connections. During
      // application shutdown a browser may leave an in-flight localhost socket
      // behind even after its context exits. Stop accepting new connections first,
      // then force-close remaining HTTP connections so Electron quit cannot hang.
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    });
  }
}

module.exports = { LocalTestServer, validatePort };
