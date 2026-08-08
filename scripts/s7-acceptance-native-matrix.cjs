'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { S7ApplicationService, LOCAL_OPERATOR_SUBJECT } = require('../src/application/s7-index.cjs');
const { createSyncEnvelope } = require('../src/sync/envelope/index.cjs');
const { ProjectOwnedSyncTransport, createSyncEndpoint } = require('../src/sync/transport/index.cjs');
const { ProjectOwnedSyncMirror, createMirrorRequestHandler } = require('../src/sync/transport/mirror.cjs');

const PRODUCT_SHA = process.env.S7_PRODUCT_SHA || '45c966c515d1a97bb109de867517d13dfd1fa657';
const OUTPUT = process.env.S7_ACCEPTANCE_OUTPUT || join(process.cwd(), 'runtime', 's7-acceptance');

function sh(name, args = []) { return execFileSync(name, args, { encoding: 'utf8' }).trim(); }
function shOr(name, args, fallback = 'unavailable') { try { return sh(name, args); } catch { return fallback; } }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function writeJson(name, value) { writeFileSync(join(OUTPUT, name), `${JSON.stringify(value, null, 2)}\n`); }
function publicShape(value) { return JSON.parse(JSON.stringify(value)); }

function sourceAudit() {
  const head = sh('git', ['rev-parse', 'HEAD']);
  sh('git', ['merge-base', '--is-ancestor', PRODUCT_SHA, head]);
  const raw = shOr('git', ['diff', '--name-only', PRODUCT_SHA, head], '');
  const changedPaths = raw ? raw.split('\n').filter(Boolean) : [];
  for (const path of changedPaths) {
    assert.ok(
      path.startsWith('scripts/s7-acceptance-') || path.startsWith('.github/workflows/s7-') || path === 'docs/results/S7-results.md',
      `acceptance carrier modified product path: ${path}`,
    );
  }
  return { productSha: PRODUCT_SHA, acceptanceHead: head, changedPaths };
}

class FakeWorkerManager {
  constructor(workers = []) { this.workers = workers; this.startCalls = 0; this.submitCalls = 0; }
  list() { return this.workers.map((item) => ({ ...item })); }
  async start() { this.startCalls += 1; throw new Error('S7 acceptance service path must not start Worker'); }
  async focus() { throw new Error('unused'); }
  async stop() { throw new Error('unused'); }
  pause() { throw new Error('unused'); }
  resume() { throw new Error('unused'); }
  async submitAuthorizedLocalTask() { this.submitCalls += 1; throw new Error('S7 acceptance service path must not submit task'); }
}

async function startMirrorServer(mirror) {
  const requestAudit = [];
  const handler = createMirrorRequestHandler(mirror);
  const server = http.createServer(async (request, response) => {
    requestAudit.push({
      method: request.method,
      pathname: new URL(request.url, 'http://127.0.0.1').pathname,
      hasAuthorization: Boolean(request.headers.authorization),
      hasCookie: Boolean(request.headers.cookie),
      contentType: request.headers['content-type'] || null,
    });
    await handler(request, response);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    server,
    requestAudit,
    baseUrl: `http://127.0.0.1:${server.address().port}/v1/sync/`,
  };
}

function createService({ databasePath, transport, clock, workerId }) {
  const manager = new FakeWorkerManager(workerId ? [{
    id: workerId,
    status: 'idle',
    browserChannel: workerId.includes('chromium') ? 'chromium' : 'chrome',
    role: 'implementation',
    profilePath: `/private/${workerId}`,
    processId: 4242,
  }] : []);
  const endpoint = createSyncEndpoint({ id: 's7-native-loopback', url: transport.baseUrl, status: 'active', allowLoopback: true });
  const service = new S7ApplicationService({
    databasePath,
    workerManager: manager,
    syncEndpoint: endpoint,
    syncTransport: new ProjectOwnedSyncTransport({ endpoint }),
    clock,
  });
  return { service, manager };
}

function membership(service, workspaceId = 'workspace-a', role = 'owner-view') {
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
  return {
    workspace: service.workspace.get(workspaceId),
    tasks: mission.s1?.tasks || [],
    locks: mission.s1?.locks || [],
    humanGates: mission.humanGates || [],
    missions: mission.missions || [],
    runs: mission.missionRuns || [],
    attempts: mission.stepAttempts || [],
    schedulingDecisions: service.querySchedulingState(workspaceId).decisions || [],
  };
}

function privacyScan(value, trail = '$') {
  const forbiddenKey = /^(authorization|proxy-authorization|cookie|cookies|set-cookie|password|passwd|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|private[_ -]?key|profilePath|profileDir|profileDirectory|browserProfile|userData|userDataDir|storageState|processId|pid|ppid|body|responseBody|environment|env|debugEndpoint|controlHandle)$/i;
  const forbiddenString = /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sessionid|access_token|refresh_token|id_token)=|\/private\/)/i;
  if (value == null) return;
  if (typeof value === 'string') {
    if (forbiddenString.test(value)) throw new Error(`sensitive string at ${trail}`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((item, index) => privacyScan(item, `${trail}[${index}]`));
  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (forbiddenKey.test(key)) throw new Error(`forbidden evidence key ${trail}.${key}`);
      privacyScan(nested, `${trail}.${key}`);
    }
  }
}

function negativeMirrorMatrix() {
  const mirror = new ProjectOwnedSyncMirror();
  mirror.registerSource({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a' });
  const first = createSyncEnvelope({
    id: 'env-1', workspaceId: 'workspace-a', sourceInstanceId: 'source-a', cursor: 1,
    recordClass: 'workspace.summary', recordId: 'workspace-a', recordRevision: 1,
    payload: { id: 'workspace-a', name: 'A', status: 'active' }, previousEnvelopeDigest: null,
    createdAt: '2026-08-08T00:00:00.000Z',
  });
  const accepted = mirror.appendEnvelopes({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', envelopes: [first] });
  const duplicate = mirror.appendEnvelopes({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', envelopes: [first] });
  let conflict;
  try {
    mirror.appendEnvelopes({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', envelopes: [{ ...first, envelopeDigest: `sha256:${'f'.repeat(64)}` }] });
  } catch (error) { conflict = error.reasonCode || error.message; }
  let gap;
  try {
    const third = createSyncEnvelope({
      id: 'env-3', workspaceId: 'workspace-a', sourceInstanceId: 'source-a', cursor: 3,
      recordClass: 'workspace.summary', recordId: 'workspace-a', recordRevision: 2,
      payload: { id: 'workspace-a', name: 'A', status: 'archived' }, previousEnvelopeDigest: first.envelopeDigest,
      createdAt: '2026-08-08T00:02:00.000Z',
    });
    mirror.appendEnvelopes({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', envelopes: [third] });
  } catch (error) { gap = error.reasonCode || error.message; }
  let crossWorkspace;
  try {
    mirror.appendEnvelopes({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', envelopes: [{ ...first, id: 'env-cross', workspaceId: 'workspace-b', cursor: 2, previousEnvelopeDigest: first.envelopeDigest }] });
  } catch (error) { crossWorkspace = error.reasonCode || error.message; }
  let unknownSource;
  try {
    mirror.appendEnvelopes({ workspaceId: 'workspace-a', sourceInstanceId: 'source-b', envelopes: [{ ...first, id: 'env-unknown', sourceInstanceId: 'source-b' }] });
  } catch (error) { unknownSource = error.reasonCode || error.message; }
  assert.equal(accepted.acks[0].state, 'accepted');
  assert.equal(duplicate.acks[0].state, 'duplicate');
  assert.equal(conflict, 'envelope_id_digest_conflict');
  assert.equal(gap, 'cursor_gap');
  assert.equal(crossWorkspace, 'cross_workspace');
  assert.equal(unknownSource, 'unknown_source');
  return { status: 'PASS', accepted: accepted.acks[0], duplicate: duplicate.acks[0], conflict, gap, crossWorkspace, unknownSource };
}

async function main() {
  mkdirSync(OUTPUT, { recursive: true });
  const source = sourceAudit();
  assert.equal(process.arch, 'arm64');
  assert.equal(sh('uname', ['-m']), 'arm64');
  assert.notEqual(shOr('sysctl', ['-in', 'sysctl.proc_translated'], '0'), '1');

  const negative = negativeMirrorMatrix();
  writeJson('sync-negative-matrix.json', negative);

  const root = mkdtempSync(join(tmpdir(), 'ai-exe-os-s7-native-'));
  const mirror = new ProjectOwnedSyncMirror();
  const transport = await startMirrorServer(mirror);
  let a;
  let b;
  try {
    a = createService({ databasePath: join(root, 'a.sqlite'), transport, clock: () => '2026-08-08T12:00:00.000Z', workerId: 's1-worker-chrome' });
    b = createService({ databasePath: join(root, 'b.sqlite'), transport, clock: () => '2026-08-08T12:01:00.000Z', workerId: 's1-worker-chromium' });
    const sourceA = a.service.querySyncState('workspace-a').sourceInstance;
    const sourceB = b.service.querySyncState('workspace-a').sourceInstance;
    assert.notEqual(sourceA.id, sourceB.id);
    assert.match(sourceA.id, /^sync-source-/);
    assert.match(sourceB.id, /^sync-source-/);
    mirror.registerSource({ workspaceId: 'workspace-a', sourceInstanceId: sourceA.id });
    mirror.registerSource({ workspaceId: 'workspace-a', sourceInstanceId: sourceB.id });

    a.service.configureSync({ workspaceId: 'workspace-a', status: 'enabled' });
    b.service.configureSync({ workspaceId: 'workspace-a', status: 'enabled' });
    membership(a.service);
    membership(b.service);

    const canonicalA0 = canonicalExecutionShape(a.service);
    const canonicalB0 = canonicalExecutionShape(b.service);
    const pushA = await a.service.pushPendingSync({ workspaceId: 'workspace-a' });
    assert.equal(pushA.networkRequested, true);
    assert.ok(pushA.accepted > 0);
    const pullB = await b.service.pullSharedMirror({ workspaceId: 'workspace-a' });
    assert.equal(pullB.remoteSourcesStored, 1);
    const stateB = b.service.querySyncState('workspace-a');
    const sharedFromA = stateB.sharedWorkspaces.find((item) => item.remoteSourceInstanceId === sourceA.id);
    assert.ok(sharedFromA);
    assert.ok(sharedFromA.records.some((item) => item.recordClass === 'workspace.summary'));
    assert.ok(sharedFromA.records.some((item) => item.recordClass === 'worker-presence.summary'));
    assert.deepEqual(canonicalExecutionShape(b.service), canonicalB0);

    const pushB = await b.service.pushPendingSync({ workspaceId: 'workspace-a' });
    assert.equal(pushB.networkRequested, true);
    assert.ok(pushB.accepted > 0);
    const pullA = await a.service.pullSharedMirror({ workspaceId: 'workspace-a' });
    assert.equal(pullA.remoteSourcesStored, 1);
    const stateA = a.service.querySyncState('workspace-a');
    assert.ok(stateA.sharedWorkspaces.some((item) => item.remoteSourceInstanceId === sourceB.id));
    assert.deepEqual(canonicalExecutionShape(a.service), canonicalA0);

    const noReplayA = await a.service.pushPendingSync({ workspaceId: 'workspace-a' });
    const noReplayB = await b.service.pushPendingSync({ workspaceId: 'workspace-a' });
    assert.equal(noReplayA.networkRequested, false);
    assert.equal(noReplayB.networkRequested, false);
    assert.equal(a.manager.startCalls + b.manager.startCalls, 0);
    assert.equal(a.manager.submitCalls + b.manager.submitCalls, 0);

    const beforeRestartA = a.service.querySyncState('workspace-a');
    const beforeRestartB = b.service.querySyncState('workspace-a');
    privacyScan(beforeRestartA);
    privacyScan(beforeRestartB);
    privacyScan(sharedFromA);
    a.service.close(); a = null;
    b.service.close(); b = null;

    a = createService({ databasePath: join(root, 'a.sqlite'), transport, clock: () => '2026-08-08T13:00:00.000Z', workerId: 's1-worker-chrome' });
    b = createService({ databasePath: join(root, 'b.sqlite'), transport, clock: () => '2026-08-08T13:01:00.000Z', workerId: 's1-worker-chromium' });
    const afterRestartA = a.service.querySyncState('workspace-a');
    const afterRestartB = b.service.querySyncState('workspace-a');
    assert.equal(afterRestartA.sourceInstance.id, sourceA.id);
    assert.equal(afterRestartB.sourceInstance.id, sourceB.id);
    assert.equal(afterRestartA.cursor.lastProducedCursor, beforeRestartA.cursor.lastProducedCursor);
    assert.equal(afterRestartA.cursor.lastAcknowledgedCursor, beforeRestartA.cursor.lastAcknowledgedCursor);
    assert.equal(afterRestartB.cursor.lastProducedCursor, beforeRestartB.cursor.lastProducedCursor);
    assert.equal(afterRestartB.cursor.lastAcknowledgedCursor, beforeRestartB.cursor.lastAcknowledgedCursor);
    assert.equal((await a.service.pushPendingSync({ workspaceId: 'workspace-a' })).networkRequested, false);
    assert.equal((await b.service.pushPendingSync({ workspaceId: 'workspace-a' })).networkRequested, false);

    const requestAudit = transport.requestAudit;
    assert.ok(requestAudit.some((item) => item.method === 'POST' && item.pathname.endsWith('/append')));
    assert.ok(requestAudit.some((item) => item.method === 'GET' && item.pathname.endsWith('/mirror')));
    assert.ok(requestAudit.every((item) => !item.hasAuthorization && !item.hasCookie));
    assert.ok(requestAudit.every((item) => ['GET', 'POST'].includes(item.method)));

    const result = {
      status: 'PASS',
      productSha: PRODUCT_SHA,
      source,
      architecture: { node: process.arch, uname: sh('uname', ['-m']), translated: shOr('sysctl', ['-in', 'sysctl.proc_translated'], '0') },
      rows: {
        twoIndependentSources: 'PASS', bidirectionalMirror: 'PASS', membershipVisibility: 'PASS',
        localCanonicalInvariance: 'PASS', explicitGetPostOnly: 'PASS', noAmbientCredentials: 'PASS',
        duplicateIdempotency: 'PASS', conflictFailClosed: 'PASS', gapFailClosed: 'PASS', crossWorkspaceFailClosed: 'PASS',
        restartSourceStable: 'PASS', restartCursorStable: 'PASS', acknowledgedNoReplay: 'PASS', noWorkerStartFromSync: 'PASS', privacySafe: 'PASS',
      },
      sourceA: { id: sourceA.id, cursorBeforeRestart: beforeRestartA.cursor, cursorAfterRestart: afterRestartA.cursor },
      sourceB: { id: sourceB.id, cursorBeforeRestart: beforeRestartB.cursor, cursorAfterRestart: afterRestartB.cursor },
      requestAudit,
      remoteVisibility: {
        bSawAClasses: sharedFromA.records.map((item) => item.recordClass).sort(),
        aRemoteSources: afterRestartA.remoteSources.map((item) => item.sourceInstanceId).sort(),
        bRemoteSources: afterRestartB.remoteSources.map((item) => item.sourceInstanceId).sort(),
      },
      evidenceClass: 'github-hosted-native-apple-silicon-service-two-instance',
    };
    privacyScan(result);
    writeJson('native-two-instance-matrix.json', result);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    try { a?.service.close(); } catch {}
    try { b?.service.close(); } catch {}
    await new Promise((resolve) => transport.server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }

  const raw = readFileSync(join(OUTPUT, 'native-two-instance-matrix.json'));
  writeFileSync(join(OUTPUT, 'native-two-instance-matrix.sha256'), `${sha256(raw)}  native-two-instance-matrix.json\n`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
