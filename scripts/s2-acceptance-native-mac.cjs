'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { BrowserWorkerManager } = require('../src/main/browser-worker-manager.cjs');
const { JsonlEventStore } = require('../src/main/event-store.cjs');
const { LocalTestServer } = require('../src/main/local-test-server.cjs');
const { ProfileLeaseManager } = require('../src/main/profile-lease-manager.cjs');
const {
  S2ApplicationService,
  LOCAL_JOIN_TARGET,
  LOCAL_TRANSFORM_PACKAGE_ID,
  LOCAL_TRANSFORM_TARGET,
  LOCAL_TRANSFORM_VERSION,
} = require('../src/application/s2-index.cjs');

const PRODUCT_SHA = process.env.S2_PRODUCT_SHA || '5981b0ba3bbc3d730d5c345d5f164826e647e7c7';
const FORM_VERSION = 'local.form-submit@1.0.0';
const TRANSFORM_VERSION = `${LOCAL_TRANSFORM_PACKAGE_ID}@${LOCAL_TRANSFORM_VERSION}`;
const CHROME = process.env.S2_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function sh(name, args = []) { return execFileSync(name, args, { encoding: 'utf8' }).trim(); }
function shOr(name, args, fallback = 'unavailable') { try { return sh(name, args); } catch { return fallback; } }
function submissions(events) { return events.readAll().filter((e) => e.type === 'task.submission_started').length; }
function digest(buf) { return createHash('sha256').update(buf).digest('hex'); }
function requestedGate(service) {
  const gates = service.queryMissionState('workspace-a').humanGates.filter((g) => g.state === 'requested');
  assert.equal(gates.length, 1, `expected exactly one requested gate, found ${gates.length}`);
  return gates[0];
}
function arch(path, label) {
  assert.ok(existsSync(path), `${label} missing: ${path}`);
  const file = sh('file', ['-b', path]);
  const lipo = shOr('lipo', ['-archs', path]);
  assert.match(`${file} ${lipo}`, /arm64/, `${label} is not arm64-capable`);
  return { path, file, lipo };
}
function sourceAudit() {
  const head = sh('git', ['rev-parse', 'HEAD']);
  sh('git', ['merge-base', '--is-ancestor', PRODUCT_SHA, head]);
  const raw = shOr('git', ['diff', '--name-only', PRODUCT_SHA, head], '');
  const changedPaths = raw ? raw.split('\n').filter(Boolean) : [];
  for (const path of changedPaths) {
    assert.ok(
      path.startsWith('scripts/s2-acceptance-') || path.startsWith('.github/workflows/s2-') || path === 'docs/results/S2-results.md',
      `acceptance branch modified product path: ${path}`,
    );
  }
  return { productSha: PRODUCT_SHA, acceptanceHead: head, changedPaths };
}
function attachAudit(manager, workerId, audit) {
  const session = manager.contexts.get(workerId);
  assert.ok(session, `missing context for ${workerId}`);
  session.page.on('pageerror', (error) => audit.pageErrors.push({ workerId, message: error.message }));
  session.page.on('console', (msg) => { if (msg.type() === 'error') audit.consoleErrors.push({ workerId, text: msg.text() }); });
  return session.page;
}
async function resetWorker(manager, workerId, audit) {
  if (manager.contexts.has(workerId)) await manager.stop(workerId);
  await manager.start(workerId);
  const page = attachAudit(manager, workerId, audit);
  await page.reload();
  assert.equal(manager.requireWorker(workerId).status, 'idle');
}
function prepare(service) {
  const external = service.installCapability({ workspaceId: 'workspace-a', packageId: 'local.form-submit', version: '1.0.0' });
  const transform = service.installCapability({ workspaceId: 'workspace-a', packageId: LOCAL_TRANSFORM_PACKAGE_ID, version: LOCAL_TRANSFORM_VERSION });
  service.grantCapability({ workspaceId: 'workspace-a', agentId: 'agent-a', installationId: external.id, allowedActions: ['submit_payload'], allowedTargets: [service.localTarget] });
  service.grantCapability({ workspaceId: 'workspace-a', agentId: 'agent-a2', installationId: transform.id, allowedActions: ['transform_payload', 'join_payload'], allowedTargets: [LOCAL_TRANSFORM_TARGET, LOCAL_JOIN_TARGET] });
  return { external, transform };
}
function mission(service, installs, prefix) {
  const ids = { mission: `${prefix}-mission`, revision: `${prefix}-rev`, run: `${prefix}-run`, a: `${prefix}-a`, b: `${prefix}-b`, c: `${prefix}-c` };
  const created = service.createMission({ id: ids.mission, workspaceId: 'workspace-a', title: `${prefix} mission`, objective: 'bounded fork join acceptance' });
  const revision = service.createRevision({
    workspaceId: 'workspace-a', missionId: ids.mission, id: ids.revision, revision: 1, objective: created.mission.objective, terminalStepIds: [ids.c],
    steps: [
      { id: ids.a, name: 'Browser evidence', agentId: 'agent-a', installationId: installs.external.id, capabilityVersionId: FORM_VERSION, action: 'submit_payload', target: service.localTarget, workerId: 's1-worker-chromium', dependsOn: [], declaredInputs: [], declaredOutputs: ['result_a'], evidenceRequirements: ['local result text'], humanGatePolicy: 'action', payload: `${prefix} browser payload` },
      { id: ids.b, name: 'Local transform', agentId: 'agent-a2', installationId: installs.transform.id, capabilityVersionId: TRANSFORM_VERSION, action: 'transform_payload', target: LOCAL_TRANSFORM_TARGET, dependsOn: [], declaredInputs: [], declaredOutputs: ['result_b'], evidenceRequirements: ['local-transform-evidence'], humanGatePolicy: 'never', payload: `${prefix} local payload` },
      { id: ids.c, name: 'Join', agentId: 'agent-a2', installationId: installs.transform.id, capabilityVersionId: TRANSFORM_VERSION, action: 'join_payload', target: LOCAL_JOIN_TARGET, dependsOn: [ids.a, ids.b], declaredInputs: [{ name: 'input_a', fromStepId: ids.a, outputName: 'result_a' }, { name: 'input_b', fromStepId: ids.b, outputName: 'result_b' }], declaredOutputs: ['final_result'], evidenceRequirements: ['final-evidence'], humanGatePolicy: 'never' },
    ],
  });
  return { ...ids, revision: revision.revision.id };
}
async function happy(service, installs, events) {
  const m = mission(service, installs, 'happy');
  const started = service.startMission({ workspaceId: 'workspace-a', missionId: m.mission, revisionId: m.revision, runId: m.run }).state;
  assert.equal(started.stepAttempts.find((x) => x.stepId === m.a).state, 'waiting_human');
  assert.equal(started.stepAttempts.find((x) => x.stepId === m.b).state, 'completed');
  assert.equal(started.stepAttempts.some((x) => x.stepId === m.c), false);
  const gate = requestedGate(service);
  const before = submissions(events);
  await service.approveHumanGate({ gateId: gate.id });
  const after = submissions(events);
  await service.approveHumanGate({ gateId: gate.id });
  assert.equal(after, before + 1);
  assert.equal(submissions(events), after);
  const state = service.queryMissionState('workspace-a');
  assert.equal(state.stepAttempts.find((x) => x.stepId === m.c).state, 'completed');
  assert.equal(state.agentHandoffs.filter((x) => x.toStepId === m.c).length, 2);
  assert.equal(state.missionRuns.find((x) => x.id === m.run).state, 'completed');
  assert.equal(state.evidence.some((x) => x.type === 'final-evidence'), true);
  const checkpoint = service.recordCheckpoint({ id: 'happy-checkpoint', workspaceId: 'workspace-a', runId: m.run });
  return { m, before, after, checkpoint };
}
async function pauseResume(service, installs, events) {
  const m = mission(service, installs, 'pause');
  service.startMission({ workspaceId: 'workspace-a', missionId: m.mission, revisionId: m.revision, runId: m.run });
  const gate = requestedGate(service);
  const before = submissions(events);
  service.pauseMission({ workspaceId: 'workspace-a', runId: m.run });
  await assert.rejects(() => service.approveHumanGate({ gateId: gate.id }), /paused/i);
  assert.equal(submissions(events), before);
  service.resumeMission({ workspaceId: 'workspace-a', runId: m.run });
  await service.approveHumanGate({ gateId: gate.id });
  assert.equal(submissions(events), before + 1);
}
function cancel(service, installs, events) {
  const m = mission(service, installs, 'cancel');
  service.startMission({ workspaceId: 'workspace-a', missionId: m.mission, revisionId: m.revision, runId: m.run });
  const before = submissions(events);
  service.cancelMission({ workspaceId: 'workspace-a', runId: m.run, reason: 'acceptance cancel' });
  assert.equal(submissions(events), before);
  const state = service.queryMissionState('workspace-a');
  assert.equal(state.missionRuns.find((x) => x.id === m.run).state, 'cancelled');
  assert.equal(state.stepAttempts.find((x) => x.stepId === m.b).state, 'completed');
}
async function crashRetry(service, installs, events, manager, audit) {
  const m = mission(service, installs, 'crash');
  service.startMission({ workspaceId: 'workspace-a', missionId: m.mission, revisionId: m.revision, runId: m.run });
  const gate = requestedGate(service);
  const previous = service.queryMissionState('workspace-a').stepAttempts.find((x) => x.stepId === m.a);
  const before = submissions(events);
  await manager.contexts.get('s1-worker-chromium').context.close();
  await assert.rejects(() => service.approveHumanGate({ gateId: gate.id }), /not running|worker/i);
  const contained = service.queryMissionState('workspace-a');
  assert.equal(contained.stepAttempts.find((x) => x.id === previous.id).state, 'recovery_required');
  assert.equal(contained.missionRuns.find((x) => x.id === m.run).state, 'recovery_required');
  assert.equal(submissions(events), before);
  assert.equal(manager.requireWorker('s1-worker-chrome').status, 'idle');
  await resetWorker(manager, 's1-worker-chromium', audit);
  const retry = service.retryStepAfterReview({ workspaceId: 'workspace-a', runId: m.run, previousAttemptId: previous.id, reviewed: true });
  assert.notEqual(retry.id, previous.id);
  assert.equal(retry.attemptNumber, 2);
  assert.equal(submissions(events), before);
  await service.approveHumanGate({ gateId: requestedGate(service).id });
  assert.equal(submissions(events), before + 1);
  return { previousAttemptId: previous.id, retryAttemptId: retry.id };
}

async function main() {
  const source = sourceAudit();
  assert.equal(process.arch, 'arm64');
  assert.equal(sh('uname', ['-m']), 'arm64');
  assert.notEqual(shOr('sysctl', ['-in', 'sysctl.proc_translated'], '0'), '1');
  const architecture = { node: process.arch, uname: sh('uname', ['-m']), chrome: arch(CHROME, 'Chrome'), chromium: arch(chromium.executablePath(), 'Chromium') };
  const runtimeRoot = mkdtempSync(join(tmpdir(), 'ai-exe-os-s2-'));
  const outputRoot = process.env.S2_ACCEPTANCE_OUTPUT || join(process.cwd(), 'runtime', 's2-acceptance');
  mkdirSync(outputRoot, { recursive: true });
  const audit = { pageErrors: [], consoleErrors: [] };
  const events = new JsonlEventStore(join(runtimeRoot, 'events.jsonl'));
  const server = new LocalTestServer({ rootDirectory: join(process.cwd(), 'test-pages'), port: 0 });
  let manager;
  let service;
  try {
    const baseUrl = await server.start();
    manager = new BrowserWorkerManager({ profilesRoot: join(runtimeRoot, 'profiles'), leaseManager: new ProfileLeaseManager(), eventStore: events, testBaseUrl: baseUrl });
    manager.create({ id: 's1-worker-chrome', projectId: 's2-acceptance', role: 'isolation', browserChannel: 'chrome' });
    manager.create({ id: 's1-worker-chromium', projectId: 's2-acceptance', role: 'mission', browserChannel: 'chromium' });
    await manager.start('s1-worker-chrome');
    await manager.start('s1-worker-chromium');
    await attachAudit(manager, 's1-worker-chrome', audit).reload();
    await attachAudit(manager, 's1-worker-chromium', audit).reload();
    assert.equal(manager.requireWorker('s1-worker-chrome').status, 'idle');
    assert.equal(manager.requireWorker('s1-worker-chromium').status, 'idle');

    const databasePath = join(runtimeRoot, 'state.sqlite');
    service = new S2ApplicationService({ databasePath, workerManager: manager, localTarget: `${baseUrl}/task-form.html` });
    const installs = prepare(service);
    const h = await happy(service, installs, events);
    await resetWorker(manager, 's1-worker-chromium', audit);
    await pauseResume(service, installs, events);
    await resetWorker(manager, 's1-worker-chromium', audit);
    cancel(service, installs, events);
    const crash = await crashRetry(service, installs, events, manager, audit);

    service.createMission({ id: 'workspace-b-mission', workspaceId: 'workspace-b', title: 'Workspace B', objective: 'isolation' });
    assert.equal(service.queryMissionState('workspace-a').missions.some((x) => x.id === 'workspace-b-mission'), false);
    assert.deepEqual(service.queryMissionState('workspace-b').missions.map((x) => x.id), ['workspace-b-mission']);

    const beforeRestart = submissions(events);
    const checkpointDigest = h.checkpoint.projectionDigest;
    service.close();
    service = new S2ApplicationService({ databasePath, workerManager: manager, localTarget: `${baseUrl}/task-form.html` });
    assert.equal(submissions(events), beforeRestart);
    assert.equal(service.queryMissionState('workspace-a').missionRuns.find((x) => x.id === h.m.run).state, 'completed');
    assert.equal(service.recordCheckpoint({ id: 'happy-checkpoint', workspaceId: 'workspace-a', runId: h.m.run }).projectionDigest, checkpointDigest);
    assert.deepEqual(audit.pageErrors, []);
    assert.deepEqual(audit.consoleErrors, []);

    await manager.stopAll();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const residual = sh('ps', ['-axo', 'command']).split('\n').filter((line) => line.includes(runtimeRoot));
    assert.deepEqual(residual, []);

    const rows = {
      exactSourceScope: 'PASS', nativeArm64: 'PASS', dualChromeChromium: 'PASS', forkJoinReadySet: 'PASS',
      workspaceIsolation: 'PASS', typedHandoffs: 'PASS', humanGateZeroAndExactOnce: 'PASS', pauseResume: 'PASS',
      cancelNoFutureStart: 'PASS', crashContainmentNoReplay: 'PASS', reviewedRetryNewAttempt: crash.previousAttemptId !== crash.retryAttemptId ? 'PASS' : 'FAIL',
      sqliteRestartNoReplay: 'PASS', checkpointDigestEquality: 'PASS', terminalEvidence: 'PASS', pageConsoleErrorsZero: 'PASS', residualProcessesZero: 'PASS',
    };
    for (const [name, value] of Object.entries(rows)) assert.equal(value, 'PASS', name);
    const result = { status: 'PASS', productSha: PRODUCT_SHA, source, architecture, rows, counters: { submissions: submissions(events), pageErrors: audit.pageErrors.length, consoleErrors: audit.consoleErrors.length }, evidenceClass: 'github-hosted-native-apple-silicon' };
    const json = `${JSON.stringify(result, null, 2)}\n`;
    const resultPath = join(outputRoot, 'matrix-result.json');
    writeFileSync(resultPath, json);
    writeFileSync(join(outputRoot, 'matrix-result.sha256'), `${digest(readFileSync(resultPath))}  matrix-result.json\n`);
    console.log(json);
  } finally {
    try { service?.close(); } catch {}
    try { await manager?.stopAll(); } catch {}
    try { await server.stop(); } catch {}
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
