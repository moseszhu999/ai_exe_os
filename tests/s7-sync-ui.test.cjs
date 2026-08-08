'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { METHODS, S7SyncController, assertSyncBridge } = require('../src/renderer/s7/controller.cjs');
const { SURFACES, createS7SyncViewModel, sanitize } = require('../src/renderer/s7/view-model.cjs');

function snapshot() {
  return {
    workspaceId: 'workspace-a',
    found: true,
    configuration: { id: 'sync-config-a', workspaceId: 'workspace-a', status: 'enabled', endpointId: 'endpoint-a' },
    sourceInstance: { id: 'source-a', instancePublicId: 'public-a', profilePath: '/forbidden' },
    cursor: { lastProducedCursor: 3, lastAcknowledgedCursor: 2, status: 'current' },
    pendingEnvelopes: [{ id: 'env-3', cursor: 3, recordClass: 'mission.summary', recordId: 'mission-a', envelopeDigest: 'sha256:env3' }],
    remoteSources: [{ sourceInstanceId: 'source-b', lastCursor: 4, status: 'current' }],
    divergences: [{ sourceInstanceId: 'source-c', cursor: 2, reasonCode: 'previous_digest_mismatch' }],
    memberships: [{ id: 'membership-a', subjectId: 'subject-a', teamRoleId: 'operator-view', status: 'active' }],
    sharedWorkspaces: [{
      remoteSourceInstanceId: 'source-b', syncCursor: 4, syncStatus: 'current',
      records: [{ recordClass: 'worker-presence.summary', recordId: 'worker-b', payload: { workerPublicId: 'worker-b', statusClass: 'available', browserChannelClass: 'chrome', role: 'review' } }],
    }],
  };
}

test('S7 view model exposes all required collaboration explanation surfaces', () => {
  assert.deepEqual(SURFACES, [
    'Sync Status', 'Source Instance', 'Endpoint / Mode', 'Outbound Cursor', 'Acknowledged Cursor',
    'Pending Envelopes', 'Remote Sources', 'Gap / Divergence', 'Members / Roles', 'Shared Workspace', 'Remote Worker Presence',
  ]);
  const value = createS7SyncViewModel(snapshot(), 'workspace-a');
  assert.equal(value.found, true);
  assert.equal(value.selectedRemoteSource.sourceInstanceId, 'source-b');
  assert.equal(value.selectedMembership.id, 'membership-a');
  assert.equal(value.remoteWorkerPresence[0].workerPublicId, 'worker-b');
});

test('Workspace mismatch fails closed and exposes no remote mirror', () => {
  const value = createS7SyncViewModel(snapshot(), 'workspace-b');
  assert.equal(value.found, false);
  assert.equal(value.configuration, null);
  assert.deepEqual(value.remoteSources, []);
  assert.deepEqual(value.sharedWorkspaces, []);
  assert.deepEqual(value.remoteWorkerPresence, []);
});

test('view model recursively redacts credential/profile/process fields and sensitive strings', () => {
  const safe = sanitize({
    token: 'secret',
    nested: { cookie: 'session=abc', profilePath: '/private/profile', pid: 1234 },
    header: 'Bearer abcdefghijklmnopqrstuvwxyz',
    normal: 'visible',
  });
  assert.equal(safe.token, '[redacted]');
  assert.equal(safe.nested.cookie, '[redacted]');
  assert.equal(safe.nested.profilePath, '[redacted]');
  assert.equal(safe.nested.pid, '[redacted]');
  assert.equal(safe.header, '[redacted]');
  assert.equal(safe.normal, 'visible');
  assert.equal(createS7SyncViewModel(snapshot(), 'workspace-a').sourceInstance.profilePath, '[redacted]');
});

test('S7 bridge contains bounded sync/membership methods and no execution controls', () => {
  assert.deepEqual(METHODS, ['queryState', 'configureSync', 'pushPending', 'pullMirror', 'recordMembership']);
  assert.throws(() => assertSyncBridge({ queryState() {}, configureSync() {}, pushPending() {}, pullMirror() {} }), /recordMembership/);
  const bridge = Object.fromEntries(METHODS.map((method) => [method, () => Promise.resolve({})]));
  assert.equal(assertSyncBridge(bridge), bridge);
  for (const forbidden of ['startWorker', 'stopWorker', 'approveHumanGate', 'rejectHumanGate', 'retry', 'execute', 'providerWrite']) {
    assert.equal(Object.prototype.hasOwnProperty.call(bridge, forbidden), false);
  }
});

test('controller scopes commands to selected Workspace and deduplicates pending sync action', async () => {
  const calls = [];
  let resolvePush;
  const bridge = {
    queryState(workspaceId) { calls.push(['queryState', workspaceId]); return Promise.resolve(snapshot()); },
    configureSync(input) { calls.push(['configureSync', input]); return Promise.resolve(input); },
    pushPending(input) { calls.push(['pushPending', input]); return new Promise((resolve) => { resolvePush = resolve; }); },
    pullMirror(input) { calls.push(['pullMirror', input]); return Promise.resolve(input); },
    recordMembership(input) { calls.push(['recordMembership', input]); return Promise.resolve(input); },
  };
  const controller = new S7SyncController({ bridge });
  await controller.refresh('workspace-a');
  await controller.configureSync({ id: 'config-a', workspaceId: 'workspace-other', status: 'enabled' });
  assert.equal(calls.find(([name]) => name === 'configureSync')[1].workspaceId, 'workspace-a');
  const first = controller.pushPending();
  const second = controller.pushPending();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(typeof resolvePush, 'function');
  resolvePush({ accepted: 1 });
  await first;
  assert.equal(calls.filter(([name]) => name === 'pushPending').length, 1);
  await controller.pullMirror();
  assert.deepEqual(calls.find(([name]) => name === 'pullMirror')[1], { workspaceId: 'workspace-a' });
  await controller.recordMembership({ id: 'membership-a', workspaceId: 'workspace-other', subjectId: 'subject-a', teamRoleId: 'observer-view' });
  assert.equal(calls.find(([name]) => name === 'recordMembership')[1].workspaceId, 'workspace-a');
});

test('renderer is DOM-safe and contains no remote execution authority controls', () => {
  const source = readFileSync(join(__dirname, '..', 'src', 'renderer', 's7', 'render.cjs'), 'utf8');
  assert.doesNotMatch(source, /innerHTML\s*=|outerHTML\s*=|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(source, /startWorker|stopWorker|approveHumanGate|rejectHumanGate|retryFailed|providerWrite/);
  assert.match(source, /push-pending-sync/);
  assert.match(source, /pull-shared-mirror/);
  assert.match(source, /Presence is read-only/);
});
