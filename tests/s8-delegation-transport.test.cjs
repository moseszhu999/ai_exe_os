'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ProjectOwnedDelegationTransport,
  createDelegationEndpoint,
  operationUrl,
} = require('../src/delegation/transport/index.cjs');
const { DelegationExchangeMirror } = require('../src/delegation/transport/mirror.cjs');

function jsonResponse(payload, { status = 200, url = 'http://127.0.0.1:4567/delegations/requests' } = {}) {
  const encoded = Buffer.from(JSON.stringify(payload));
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Headers({ 'content-length': String(encoded.byteLength), 'content-type': 'application/json' }),
    arrayBuffer: async () => encoded,
  };
}

function endpoint() {
  return createDelegationEndpoint({ id: 'delegation-local', url: 'http://127.0.0.1:4567/api/', allowLoopback: true });
}

test('S8 delegation endpoint is exact, credential-free and fixed-origin', () => {
  const ep = endpoint();
  assert.equal(ep.origin, 'http://127.0.0.1:4567');
  assert.match(operationUrl(ep, 'request').pathname, /\/api\/delegations\/requests$/);
  assert.match(operationUrl(ep, 'receipt').pathname, /\/api\/delegations\/receipts$/);
  assert.match(operationUrl(ep, 'cancellationInbox').pathname, /\/api\/delegations\/cancellations$/);
  assert.throws(() => createDelegationEndpoint({ id: 'bad', url: 'http://user:pass@127.0.0.1:4567/', allowLoopback: true }), /URL credentials/);
  assert.throws(() => createDelegationEndpoint({ id: 'bad', url: 'http://example.com/' }), /external delegation endpoint must use HTTPS/);
  assert.throws(() => operationUrl(ep, 'worker-control'), /unsupported/);
});

test('S8 transport uses only schema-defined GET/POST and omits ambient credentials', async () => {
  const calls = [];
  const transport = new ProjectOwnedDelegationTransport({
    endpoint: endpoint(),
    fetchImpl: async (url, options) => {
      calls.push({ url: url.toString(), options });
      return jsonResponse({ ok: true }, { url: url.toString() });
    },
  });
  await transport.submitRequest({ id: 'request-1', requestDigest: 'sha256:a' });
  await transport.readInbox({ destinationInstanceId: 'sync-source-b', destinationWorkspaceId: 'workspace-b', sinceSequence: 0 });
  await transport.acknowledgeRequest({ requestId: 'request-1', requestDigest: 'sha256:a', state: 'accepted' });
  await transport.submitReceipt({ id: 'receipt-1', delegationRequestId: 'request-1', receiptDigest: 'sha256:r' });
  await transport.readReceipts({ sourceInstanceId: 'sync-source-a', sourceWorkspaceId: 'workspace-a', sinceRevision: 0 });
  await transport.submitCancellation({ id: 'cancel-1', delegationRequestId: 'request-1' });
  await transport.readCancellations({ destinationInstanceId: 'sync-source-b', destinationWorkspaceId: 'workspace-b', sinceSequence: 0 });
  assert.deepEqual(calls.map((call) => call.options.method), ['POST', 'GET', 'POST', 'POST', 'GET', 'POST', 'GET']);
  for (const call of calls) {
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.redirect, 'manual');
    const headerText = JSON.stringify(call.options.headers).toLowerCase();
    assert.equal(headerText.includes('authorization'), false);
    assert.equal(headerText.includes('cookie'), false);
  }
});

test('S8 renderer cannot choose arbitrary method through bounded transport methods', async () => {
  const transport = new ProjectOwnedDelegationTransport({ endpoint: endpoint(), fetchImpl: async (url) => jsonResponse({ ok: true }, { url: url.toString() }) });
  assert.equal(typeof transport.request, 'function');
  await assert.rejects(() => transport.request({ operation: 'delete-worker' }), /unsupported delegation transport operation/);
});

test('S8 bounded transport rejects oversized request before network', async () => {
  let calls = 0;
  const transport = new ProjectOwnedDelegationTransport({
    endpoint: endpoint(), maxRequestBytes: 64,
    fetchImpl: async () => { calls += 1; return jsonResponse({ ok: true }); },
  });
  await assert.rejects(() => transport.submitRequest({ id: 'request-1', payload: 'x'.repeat(1024) }), /size limit/);
  assert.equal(calls, 0);
});

test('S8 exchange mirror makes exact request duplicates idempotent and conflicts explicit', () => {
  const mirror = new DelegationExchangeMirror();
  const request = {
    id: 'request-1', requestDigest: 'sha256:a', requestSequence: 1, sourceInstanceId: 'sync-source-a',
    sourceWorkspaceId: 'workspace-a', destinationInstanceId: 'sync-source-b', destinationWorkspaceId: 'workspace-b', peerBindingId: 'peer-a-to-b',
  };
  assert.equal(mirror.appendRequest(request).state, 'accepted');
  assert.equal(mirror.appendRequest(request).state, 'duplicate');
  assert.equal(mirror.appendRequest({ ...request, requestDigest: 'sha256:b' }).reasonCode, 'request_digest_conflict');
  assert.equal(mirror.readInbox({ destinationInstanceId: 'sync-source-b', destinationWorkspaceId: 'workspace-b' }).length, 1);
});

test('S8 exchange mirror does not mix destination workspaces', () => {
  const mirror = new DelegationExchangeMirror();
  mirror.appendRequest({
    id: 'request-b', requestDigest: 'sha256:b', requestSequence: 1, sourceInstanceId: 'sync-source-a', sourceWorkspaceId: 'workspace-a',
    destinationInstanceId: 'sync-source-b', destinationWorkspaceId: 'workspace-b', peerBindingId: 'peer-ab',
  });
  mirror.appendRequest({
    id: 'request-c', requestDigest: 'sha256:c', requestSequence: 1, sourceInstanceId: 'sync-source-a', sourceWorkspaceId: 'workspace-a',
    destinationInstanceId: 'sync-source-c', destinationWorkspaceId: 'workspace-c', peerBindingId: 'peer-ac',
  });
  assert.deepEqual(mirror.readInbox({ destinationInstanceId: 'sync-source-b', destinationWorkspaceId: 'workspace-b' }).map((item) => item.id), ['request-b']);
});

test('S8 receipts are append-only, exact duplicate safe, and readable by source scope', () => {
  const mirror = new DelegationExchangeMirror();
  const receipt = {
    id: 'receipt-1', delegationRequestId: 'request-1', sourceInstanceId: 'sync-source-a', sourceWorkspaceId: 'workspace-a',
    receiptRevision: 1, receiptDigest: 'sha256:r1', state: 'completed',
  };
  assert.equal(mirror.appendReceipt(receipt).state, 'accepted');
  assert.equal(mirror.appendReceipt(receipt).state, 'duplicate');
  assert.equal(mirror.appendReceipt({ ...receipt, receiptDigest: 'sha256:other' }).reasonCode, 'receipt_digest_conflict');
  assert.deepEqual(mirror.readReceipts({ sourceInstanceId: 'sync-source-a', sourceWorkspaceId: 'workspace-a' }).map((item) => item.id), ['receipt-1']);
});

test('S8 cancellation is stored as proposal data, destination-scoped, and not process control', () => {
  const mirror = new DelegationExchangeMirror();
  mirror.appendRequest({
    id: 'request-1', requestDigest: 'sha256:a', requestSequence: 1, sourceInstanceId: 'sync-source-a', sourceWorkspaceId: 'workspace-a',
    destinationInstanceId: 'sync-source-b', destinationWorkspaceId: 'workspace-b', peerBindingId: 'peer-ab',
  });
  const result = mirror.appendCancellation({ id: 'cancel-1', delegationRequestId: 'request-1', reasonClass: 'source_withdrawal' });
  assert.equal(result.state, 'accepted');
  assert.equal('workerId' in result.cancellationProposal, false);
  assert.equal('processId' in result.cancellationProposal, false);
  assert.deepEqual(mirror.readCancellations({ destinationInstanceId: 'sync-source-b', destinationWorkspaceId: 'workspace-b' }).map((item) => item.id), ['cancel-1']);
  assert.deepEqual(mirror.readCancellations({ destinationInstanceId: 'sync-source-c', destinationWorkspaceId: 'workspace-c' }), []);
});
