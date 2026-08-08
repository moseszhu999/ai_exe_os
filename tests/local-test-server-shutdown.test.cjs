'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { join } = require('node:path');
const { LocalTestServer } = require('../src/main/local-test-server.cjs');

function connect(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

test('LocalTestServer.stop force-closes an active incomplete localhost HTTP connection', async () => {
  const server = new LocalTestServer({ rootDirectory: join(__dirname, '..', 'test-pages'), port: 0 });
  const baseUrl = await server.start();
  const url = new URL(baseUrl);
  const socket = await connect(url.hostname, Number(url.port));
  socket.on('error', () => {});
  socket.write('GET /task-form.html HTTP/1.1\r\nHost: localhost\r\n');

  const closed = new Promise((resolve) => socket.once('close', resolve));
  await withTimeout(server.stop(), 1500, 'LocalTestServer.stop');
  await withTimeout(closed, 1500, 'active localhost socket close');
  assert.equal(server.server, null);
  assert.equal(server.port, null);
});

test('LocalTestServer.stop remains idempotent after forceful connection cleanup', async () => {
  const server = new LocalTestServer({ rootDirectory: join(__dirname, '..', 'test-pages'), port: 0 });
  await server.start();
  await server.stop();
  await server.stop();
  assert.equal(server.server, null);
  assert.equal(server.port, null);
});
