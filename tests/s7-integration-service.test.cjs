'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { S7ApplicationService, LOCAL_OPERATOR_SUBJECT } = require('../src/application/s7-index.cjs');
const { ProjectOwnedSyncMirror } = require('../src/sync/transport/mirror.cjs');

class FakeWorkerManager {
  constructor(workers = []) {
    this.workers = workers;
    this.startCalls = 0;
    this.submitCalls = 0;
  }
  list() { return this.workers.map((item) => ({ ...item })); }
  async start() { this.startCalls += 1; throw new Error('S7 must not start Worker'); }
  async focus() { throw new Error('unused'); }
  async stop() { throw new Error('unused'); }
  pause() { throw new Error('unused'); }
  resume() { throw new Error('unused'); }
  async submitAuthorizedLocalTask() { this.submitCalls += 1; throw new Error('S7 must not submit runtime task'); }
}

class MirrorTransport {
  constructor(mirror) {
    this.mirror = mirror;
    this.appendCalls = 0;
    this.readCalls = 0;
  }
  async appendEnvelopes(input) { this.appendCalls += 1; return this.mirror.appendEnvelopes(input); }
  async readMirror(input) { this.readCalls += 1; return this.mirror.readMirror(input); }
  async readCursor(input) { return this.mirror.readCursor(input); }
}

class UnavailableTransport {
  constructor() { this.appendCalls = 0; this.readCalls = 0; }
  async appendEnvelopes() { this.appendCalls += 1; throw new Error('offline'); }
  async readMirror() { this.readCalls += 1; throw new Error('offline'); }
}

function worker(id, browserChannel = 'chrome') {
  return { id, projectId: 's1-local-project', role: 'implementation', status: 'idle', browserChannel, profilePath: `/private/${id}`, processId: 999 };
}

function endpoint() { return Object.freeze({ id: 'endpoint-test', status: 'active' }); }

function createService({ databasePath = ':memory:', transport = null, clock = () => '2026-08-08T12:00:00.000Z', workers = [] } = {}) {
  const workerManager = new FakeWorkerManager(workers);
  const service = new S7ApplicationService({
    databasePath,
    workerManager,
    clock,
    syncEndpoint: transport ? endpoint() : null,
    syncTransport: transport,
  });
  return { service, workerManager };
}

function localMembership(service, workspaceId = 'workspace-a', role = 'owner-view') {
  return service.recordMembership({
    id: `membership-${workspaceId}`,
    workspaceId,
    subjectId: LOCAL_OPERATOR_SUBJECT,
    teamRoleId: role,
    status: 'active',
    createdAt: '2026-08-08T12:00:00.000Z',
  });
}

function canonicalExecutionShape(service, workspaceId = 'workspace-a') {
  const mission = service.queryMissionState(workspaceId);
  return JSON.stringify({
    workspace: service.workspace.get(workspaceId),
    tasks: mission.s1?.tasks || [],
    locks: mission.s1?.locks || [],
    humanGates: mission.humanGates || [],
    missions: mission.missions || [],
    runs: mission.missionRuns || [],
    attempts: mission.stepAttempts || [],
  });
}

test('S7 remains optional and renderer-shaped configuration cannot supply URL/header/method authority', () => {
  const { service } = createService();
  const initial = service.querySyncState('workspace-a');
  assert.equal(initial.found, true);
  assert.equal(initial.configuration, null);
  assert.match(initial.sourceInstance.instancePublicId, /^sync-source-/);
  assert.equal(initial.cursor.lastProducedCursor, 0);
  assert.throws(() => service.configureSync({ workspaceId: 'workspace-a', status: 'enabled' }), /sync_endpoint_unavailable/);
  assert.throws(() => service.configureSync({ workspaceId: 'workspace-a', status: 'disabled', url: 'https:\/\/example.com' }), /unsupported field: url/);
  assert.throws(() => service.configureSync({ workspaceId: 'workspace-a', status: 'disabled', headers: { authorization: 'x' } }), /unsupported field: headers/);
  assert.equal(service.queryMissionState('workspace-a').found, undefined);
  service.close();
});

test('explicit push produces privacy-safe envelopes once and acknowledged records do not replay', async () => {
  const mirror = new ProjectOwnedSyncMirror();
  const transport = new MirrorTransport(mirror);
  const { service, workerManager } = createService({ transport });
  const source = service.querySyncState('workspace-a').sourceInstance;
  mirror.registerSource({ workspaceId: 'workspace-a', sourceInstanceId: source.id });
  service.configureSync({ workspaceId: 'workspace-a', status: 'enabled' });
  localMembership(service);

  const first = await service.pushPendingSync({ workspaceId: 'workspace-a' });
  assert.equal(first.networkRequested, true);
  assert.ok(first.accepted >= 1);
  assert.equal(first.cursor.lastProducedCursor, first.cursor.lastAcknowledgedCursor);
  assert.equal(transport.appendCalls, 1);
  const afterFirst = service.querySyncState('workspace-a');
  assert.deepEqual(afterFirst.pendingEnvelopes, []);
  assert.doesNotMatch(JSON.stringify(mirror.readMirror({ workspaceId: 'workspace-a' })), /profilePath|processId|\/private\/|authorization|cookie|token/i);

  const second = await service.pushPendingSync({ workspaceId: 'workspace-a' });
  assert.equal(second.networkRequested, false);
  assert.equal(transport.appendCalls, 1);
  assert.equal(workerManager.startCalls, 0);
  assert.equal(workerManager.submitCalls, 0);
  service.close();
});

test('two independent source identities exchange safe mirror state without mutating local execution truth', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ai-exe-s7-two-instance-'));
  const mirror = new ProjectOwnedSyncMirror();
  const transportA = new MirrorTransport(mirror);
  const transportB = new MirrorTransport(mirror);
  try {
    const a = createService({ databasePath: join(root, 'a.sqlite'), transport: transportA, workers: [worker('worker-a')] });
    const b = createService({ databasePath: join(root, 'b.sqlite'), transport: transportB, workers: [worker('worker-b', 'chromium')] });
    const sourceA = a.service.querySyncState('workspace-a').sourceInstance;
    const sourceB = b.service.querySyncState('workspace-a').sourceInstance;
    assert.notEqual(sourceA.id, sourceB.id);
    mirror.registerSource({ workspaceId: 'workspace-a', sourceInstanceId: sourceA.id });
    mirror.registerSource({ workspaceId: 'workspace-a', sourceInstanceId: sourceB.id });
    a.service.configureSync({ workspaceId: 'workspace-a', status: 'enabled' });
    b.service.configureSync({ workspaceId: 'workspace-a', status: 'enabled' });
    localMembership(a.service);
    localMembership(b.service);

    const aCanonicalBefore = canonicalExecutionShape(a.service);
    const bCanonicalBefore = canonicalExecutionShape(b.service);
    await a.service.pushPendingSync({ workspaceId: 'workspace-a' });
    await b.service.pullSharedMirror({ workspaceId: 'workspace-a' });
    const bState = b.service.querySyncState('workspace-a');
    assert.ok(bState.remoteSources.some((item) => item.sourceInstanceId === sourceA.id));
    const bShared = bState.sharedWorkspaces.find((item) => item.remoteSourceInstanceId === sourceA.id);
    assert.ok(bShared);
    assert.ok(bShared.records.some((item) => item.recordClass === 'workspace.summary'));
    assert.equal(canonicalExecutionShape(b.service), bCanonicalBefore);

    await b.service.pushPendingSync({ workspaceId: 'workspace-a' });
    await a.service.pullSharedMirror({ workspaceId: 'workspace-a' });
    const aState = a.service.querySyncState('workspace-a');
    assert.ok(aState.sharedWorkspaces.some((item) => item.remoteSourceInstanceId === sourceB.id));
    assert.equal(canonicalExecutionShape(a.service), aCanonicalBefore);
    assert.equal(a.workerManager.startCalls + b.workerManager.startCalls, 0);
    assert.equal(a.workerManager.submitCalls + b.workerManager.submitCalls, 0);
    assert.doesNotMatch(JSON.stringify(aState.sharedWorkspaces), /profilePath|processId|\/private\/|controlHandle/i);

    a.service.close();
    b.service.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('membership gates mirrored record visibility and revoked membership hides payloads', async () => {
  const mirror = new ProjectOwnedSyncMirror();
  const transportA = new MirrorTransport(mirror);
  const transportB = new MirrorTransport(mirror);
  const a = createService({ transport: transportA });
  const b = createService({ transport: transportB, clock: () => '2026-08-08T12:01:00.000Z' });
  const sourceA = a.service.querySyncState('workspace-a').sourceInstance;
  const sourceB = b.service.querySyncState('workspace-a').sourceInstance;
  mirror.registerSource({ workspaceId: 'workspace-a', sourceInstanceId: sourceA.id });
  mirror.registerSource({ workspaceId: 'workspace-a', sourceInstanceId: sourceB.id });
  a.service.configureSync({ workspaceId: 'workspace-a', status: 'enabled' });
  b.service.configureSync({ workspaceId: 'workspace-a', status: 'enabled' });
  await a.service.pushPendingSync({ workspaceId: 'workspace-a' });
  await b.service.pullSharedMirror({ workspaceId: 'workspace-a' });
  assert.deepEqual(b.service.querySyncState('workspace-a').sharedWorkspaces, []);
  localMembership(b.service, 'workspace-a', 'observer-view');
  const visible = b.service.querySyncState('workspace-a').sharedWorkspaces;
  assert.equal(visible.length, 1);
  assert.ok(visible[0].records.every((item) => ['workspace.summary', 'mission.summary', 'scheduling.summary'].includes(item.recordClass)));
  b.service.recordMembership({ id: 'membership-workspace-a', workspaceId: 'workspace-a', subjectId: LOCAL_OPERATOR_SUBJECT, teamRoleId: 'observer-view', status: 'revoked', createdAt: '2026-08-08T12:00:00.000Z' });
  assert.deepEqual(b.service.querySyncState('workspace-a').sharedWorkspaces, []);
  a.service.close();
  b.service.close();
});

test('transport outage marks sync unavailable while local S0-S6 state remains usable', async () => {
  const transport = new UnavailableTransport();
  const { service, workerManager } = createService({ transport });
  service.configureSync({ workspaceId: 'workspace-a', status: 'enabled' });
  await assert.rejects(() => service.pushPendingSync({ workspaceId: 'workspace-a' }), /offline/);
  assert.equal(service.querySyncState('workspace-a').cursor.status, 'unavailable');
  assert.ok(service.workspace.get('workspace-a'));
  assert.ok(service.queryMissionState('workspace-a'));
  assert.equal(workerManager.startCalls, 0);
  assert.equal(workerManager.submitCalls, 0);
  service.close();
});

test('SQLite restart preserves source identity, cursor, acknowledgement and performs zero sync replay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ai-exe-s7-restart-'));
  const databasePath = join(root, 'state.sqlite');
  const mirror = new ProjectOwnedSyncMirror();
  const transport = new MirrorTransport(mirror);
  try {
    const first = createService({ databasePath, transport });
    const sourceBefore = first.service.querySyncState('workspace-a').sourceInstance;
    mirror.registerSource({ workspaceId: 'workspace-a', sourceInstanceId: sourceBefore.id });
    first.service.configureSync({ workspaceId: 'workspace-a', status: 'enabled' });
    localMembership(first.service);
    const pushed = await first.service.pushPendingSync({ workspaceId: 'workspace-a' });
    const cursorBefore = pushed.cursor;
    const appendCallsBefore = transport.appendCalls;
    first.service.close();

    const second = createService({ databasePath, transport, clock: () => '2026-08-08T12:05:00.000Z' });
    const state = second.service.querySyncState('workspace-a');
    assert.equal(state.sourceInstance.id, sourceBefore.id);
    assert.equal(state.cursor.lastProducedCursor, cursorBefore.lastProducedCursor);
    assert.equal(state.cursor.lastAcknowledgedCursor, cursorBefore.lastAcknowledgedCursor);
    assert.deepEqual(state.pendingEnvelopes, []);
    const replay = await second.service.pushPendingSync({ workspaceId: 'workspace-a' });
    assert.equal(replay.networkRequested, false);
    assert.equal(transport.appendCalls, appendCallsBefore);
    assert.equal(second.workerManager.startCalls, 0);
    assert.equal(second.workerManager.submitCalls, 0);
    second.service.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('S4 cockpit composition includes S7 collaboration state without changing S6 authority', () => {
  const { service } = createService();
  const cockpit = service.queryOperatorCockpit('workspace-a');
  assert.equal(cockpit.collaborationSync.found, true);
  assert.match(cockpit.collaborationSync.sourceInstance.id, /^sync-source-/);
  assert.equal(cockpit.scheduling.found, true);
  assert.equal(Object.prototype.hasOwnProperty.call(cockpit.collaborationSync, 'startWorker'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cockpit.collaborationSync, 'approveHumanGate'), false);
  service.close();
});
