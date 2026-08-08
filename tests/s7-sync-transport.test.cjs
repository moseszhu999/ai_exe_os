'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  ProjectOwnedSyncTransport,
  assertSyncEndpointUrl,
  createSyncEndpoint,
  operationUrl,
} = require('../src/sync/transport/index.cjs');
const {
  ProjectOwnedSyncMirror,
  createMirrorRequestHandler,
} = require('../src/sync/transport/mirror.cjs');

function envelope(cursor, overrides = {}) {
  const digest = `sha256:${String(cursor).padStart(64, 'a').slice(-64)}`;
  return {
    id: `env-${cursor}`,
    workspaceId: 'workspace-a',
    sourceInstanceId: 'source-a',
    cursor,
    schemaVersion: '1',
    recordClass: 'mission.summary',
    recordId: 'mission-a',
    recordRevision: cursor,
    payload: { id: 'mission-a', status: cursor === 1 ? 'running' : 'completed' },
    payloadDigest: `sha256:${String(cursor).padStart(64, 'b').slice(-64)}`,
    previousEnvelopeDigest: cursor === 1 ? null : overrides.previousEnvelopeDigest,
    envelopeDigest: digest,
    createdAt: `2026-08-08T00:0${cursor}:00.000Z`,
    ...overrides,
  };
}

function jsonResponse(body, { status = 200, url = 'https://sync.example.test/v1/sync/append', headers = {} } = {}) {
  const encoded = Buffer.from(JSON.stringify(body));
  return {
    status,
    ok: status >= 200 && status < 300,
    url,
    headers: { get(name) { if (String(name).toLowerCase() === 'content-length') return String(encoded.length); return headers[name] || null; } },
    async arrayBuffer() { return encoded; },
  };
}

async function startMirrorServer(mirror) {
  const server = http.createServer(createMirrorRequestHandler(mirror));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  return { server, baseUrl: `http://127.0.0.1:${port}/v1/sync/` };
}

test('sync endpoint requires HTTPS externally and explicit opt-in for loopback', () => {
  assert.equal(assertSyncEndpointUrl('https://sync.example.test/v1/sync').protocol, 'https:');
  assert.throws(() => assertSyncEndpointUrl('http://sync.example.test/v1/sync'), /must use HTTPS/);
  assert.throws(() => assertSyncEndpointUrl('http://127.0.0.1:3210/v1/sync'), /must use HTTPS/);
  assert.equal(assertSyncEndpointUrl('http://127.0.0.1:3210/v1/sync', { allowLoopback: true }).hostname, '127.0.0.1');
  assert.throws(() => assertSyncEndpointUrl('https://user:pass@sync.example.test/v1/sync'), /must not contain URL credentials/);
});

test('operation URL is fixed to the configured endpoint and supported operation names', () => {
  const endpoint = createSyncEndpoint({ id: 'endpoint-a', url: 'https://sync.example.test/v1/sync/', status: 'active' });
  assert.equal(operationUrl(endpoint, 'append').toString(), 'https://sync.example.test/v1/sync/append');
  assert.equal(operationUrl(endpoint, 'mirror', { workspaceId: 'workspace-a' }).searchParams.get('workspaceId'), 'workspace-a');
  assert.throws(() => operationUrl(endpoint, 'execute'), /unsupported sync transport operation/);
});

test('transport uses fixed GET/POST, omits credentials and rejects redirects', async () => {
  const calls = [];
  const endpoint = createSyncEndpoint({ id: 'endpoint-a', url: 'https://sync.example.test/v1/sync/', status: 'active' });
  const transport = new ProjectOwnedSyncTransport({ endpoint, fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options });
    return jsonResponse({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', lastCursor: 1, lastEnvelopeDigest: 'sha256:x' }, { url: String(url) });
  } });
  await transport.readCursor({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a' });
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal('authorization' in calls[0].options.headers, false);

  const redirectTransport = new ProjectOwnedSyncTransport({ endpoint, fetchImpl: async (url) => jsonResponse({}, { status: 302, url: String(url) }) });
  await assert.rejects(() => redirectTransport.readMirror({ workspaceId: 'workspace-a' }), /redirect rejected/);
  await assert.rejects(() => transport.request({ operation: 'append', method: 'PUT' }), /only allows GET\/POST/);
});

test('project-owned mirror requires registered exact Workspace/source', () => {
  const mirror = new ProjectOwnedSyncMirror();
  mirror.registerSource({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a' });
  assert.throws(() => mirror.appendEnvelopes({ workspaceId: 'workspace-a', sourceInstanceId: 'source-b', envelopes: [envelope(1, { sourceInstanceId: 'source-b' })] }), /unknown_source/);
  assert.throws(() => mirror.appendEnvelopes({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', envelopes: [envelope(1, { workspaceId: 'workspace-b' })] }), /cross_workspace/);
});

test('mirror append is monotonic and exact duplicate is idempotent', () => {
  const mirror = new ProjectOwnedSyncMirror();
  mirror.registerSource({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a' });
  const first = envelope(1);
  const accepted = mirror.appendEnvelopes({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', envelopes: [first] });
  assert.equal(accepted.acks[0].state, 'accepted');
  assert.equal(accepted.lastCursor, 1);
  const duplicate = mirror.appendEnvelopes({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', envelopes: [first] });
  assert.equal(duplicate.acks[0].state, 'duplicate');
  assert.equal(duplicate.lastCursor, 1);
  const second = envelope(2, { previousEnvelopeDigest: first.envelopeDigest });
  assert.equal(mirror.appendEnvelopes({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', envelopes: [second] }).lastCursor, 2);
});

test('mirror detects envelope conflict, gap and previous digest mismatch', () => {
  const mirror = new ProjectOwnedSyncMirror();
  mirror.registerSource({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a' });
  const first = envelope(1);
  mirror.appendEnvelopes({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', envelopes: [first] });
  assert.throws(() => mirror.appendEnvelopes({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', envelopes: [envelope(1, { envelopeDigest: `sha256:${'c'.repeat(64)}` })] }), /envelope_id_digest_conflict/);
  assert.throws(() => mirror.appendEnvelopes({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', envelopes: [envelope(3, { previousEnvelopeDigest: first.envelopeDigest })] }), /cursor_gap/);
  assert.throws(() => mirror.appendEnvelopes({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', envelopes: [envelope(2, { previousEnvelopeDigest: `sha256:${'d'.repeat(64)}` })] }), /previous_digest_mismatch/);
});

test('mirror materializes latest per-source collaboration records only', () => {
  const mirror = new ProjectOwnedSyncMirror();
  mirror.registerSource({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a' });
  const first = envelope(1);
  const second = envelope(2, { previousEnvelopeDigest: first.envelopeDigest });
  mirror.appendEnvelopes({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', envelopes: [first, second] });
  const view = mirror.readMirror({ workspaceId: 'workspace-a', sinceCursor: 0 });
  assert.equal(view.sources.length, 1);
  assert.equal(view.sources[0].records.length, 1);
  assert.equal(view.sources[0].records[0].recordRevision, 2);
  assert.equal(mirror.readCursor({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a' }).lastCursor, 2);
});

test('real loopback transport interoperates with project-owned mirror and sends no ambient auth/cookie', async () => {
  const mirror = new ProjectOwnedSyncMirror();
  mirror.registerSource({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a' });
  const { server, baseUrl } = await startMirrorServer(mirror);
  try {
    const endpoint = createSyncEndpoint({ id: 'endpoint-loopback', url: baseUrl, status: 'active', allowLoopback: true });
    const transport = new ProjectOwnedSyncTransport({ endpoint });
    const first = envelope(1);
    const appended = await transport.appendEnvelopes({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', envelopes: [first] });
    assert.equal(appended.acks[0].state, 'accepted');
    const cursor = await transport.readCursor({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a' });
    assert.equal(cursor.lastCursor, 1);
    const view = await transport.readMirror({ workspaceId: 'workspace-a' });
    assert.equal(view.sources[0].records[0].recordId, 'mission-a');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('transport request body is bounded before network access', async () => {
  let called = false;
  const endpoint = createSyncEndpoint({ id: 'endpoint-a', url: 'https://sync.example.test/v1/sync/', status: 'active' });
  const transport = new ProjectOwnedSyncTransport({ endpoint, maxRequestBytes: 100, fetchImpl: async () => { called = true; return jsonResponse({}); } });
  await assert.rejects(() => transport.appendEnvelopes({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', envelopes: [{ id: 'x', payload: 'x'.repeat(500) }] }), /request exceeds/);
  assert.equal(called, false);
});
