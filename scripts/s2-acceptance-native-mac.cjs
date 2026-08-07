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
const LOCAL_FORM_VERSION_ID = 'local.form-submit@1.0.0';
const LOCAL_TRANSFORM_VERSION_ID = `${LOCAL_TRANSFORM_PACKAGE_ID}@${LOCAL_TRANSFORM_VERSION}`;
const CHROME_PATH = process.env.S2_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function command(name, args = [], options = {}) {
  return execFileSync(name, args, { encoding: 'utf8', ...options }).trim();
}

function commandOr(name, args, fallback = 'unavailable') {
  try { return command(name, args); } catch { return fallback; }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function submissions(eventStore) {
  return eventStore.readAll().filter((event) => event.type === 'task.submission_started').length;
}

function attachPageAudit(workerManager, workerId, audit) {
  const session = workerManager.contexts.get(workerId);
  assert.ok(session, `missing live browser session for ${workerId}`);
  session.page.on('pageerror', (error) => audit.pageErrors.push({ workerId, message: error.message }));
  session.page.on('console', (message) => {
    if (message.type() === 'error') audit.consoleErrors.push({ workerId, text: message.text() });
  });
  return session.page;
}

function assertArchitecture(path, label) {
  assert.ok(existsSync(path), `${label} executable missing: ${path}`);
  const file = command('file', ['-b', path]);
  const lipo = commandOr('lipo', ['-archs', path]);
  assert.match(`${file} ${lipo}`, /arm64/, `${label} does not expose arm64 architecture`);
  return { path, file, lipo };
}

function auditSourceScope() {
  const head = command('git', ['rev-parse', 'HEAD']);
  command('git', ['merge-base', '--is-ancestor', PRODUCT_SHA, head]);
  const changed = commandOr('git', ['diff', '--name-only', PRODUCT_SHA, head], '')
    .split('\n').map((line) => line.trim()).filter(Boolean);
  const allowed = changed.every((path) =>
    path.startsWith('scripts/s2-acceptance-') ||
    path.startsWith('.github/workflows/s2-') ||
    path === 'docs/results/S2-results.md');
  assert.equal(allowed, true, `acceptance branch modified product paths: ${changed.join(', ')}`);
  return { productSha: PRODUCT_SHA, acceptanceHead: head, changedPaths: changed };
}

function prepareCapabilities(service) {
  const externalInstallation = service.installCapability({
    workspaceId: 'workspace-a', packageId: 'local.form-submit', version: '1.0.0',
  });
  const transformInstallation = service.installCapability({
    workspaceId: 'workspace-a', packageId: LOCAL_TRANSFORM_PACKAGE_ID, version: LOCAL_TRANSFORM_VERSION,
  });
  service.grantCapability({
    workspaceId: 'workspace-a', agentId: 'agent-a', installationId: externalInstallation.id,
    allowedActions: ['submit_payload'], allowedTargets: [service.localTarget],
  });
  service.grantCapability({
    workspaceId: 'workspace-a', agentId: 'agent-a2', installationId: transformInstallation.id,
    allowedActions: ['transform_payload', 'join_payload'], allowedTargets: [LOCAL_TRANSFORM_TARGET, LOCAL_JOIN_TARGET],
  });
  return { externalInstallation, transformInstallation };
}

function createForkJoin(service, installs, prefix, workerId = 's1-worker-chromium') {
  const missionId = `${prefix}-mission`;
  const revisionId = `${prefix}-rev-1`;
  const runId = `${prefix}-run-1`;
  const stepA = `${prefix}-step-a`;
  const stepB = `${prefix}-step-b`;
  const stepC = `${prefix}-step-c`;
  const { mission } = service.createMission({
    id: missionId, workspaceId: 'workspace-a', title: `${prefix} mission`,
    objective: 'Run a bounded project-owned browser effect and local transform, then join typed evidence',
  });
  const { revision } = service.createRevision({
    workspaceId: 'workspace-a', missionId, id: revisionId, revision: 1, objective: mission.objective,
    terminalStepIds: [stepC],
    steps: [
      {
        id: stepA, name: 'Browser evidence', agentId: 'agent-a', installationId: installs.externalInstallation.id,
        capabilityVersionId: LOCAL_FORM_VERSION_ID, action: 'submit_payload', target: service.localTarget,
        workerId, dependsOn: [], declaredInputs: [], declaredOutputs: ['result_a'],
        evidenceRequirements: ['local result text'], humanGatePolicy: 'action', payload: `S2 ${prefix} browser payload`,
      },
      {
        id: stepB, name: 'Local transform', agentId: 'agent-a2', installationId: installs.transformInstallation.id,
        capabilityVersionId: LOCAL_TRANSFORM_VERSION_ID, action: 'transform_payload', target: LOCAL_TRANSFORM_TARGET,
        dependsOn: [], declaredInputs: [], declaredOutputs: ['result_b'], evidenceRequirements: ['local-transform-evidence'],
        humanGatePolicy: 'never', payload: `S2 ${prefix} deterministic branch`,
      },
      {
        id: stepC, name: 'Join outputs', agentId: 'agent-a2', installationId: installs.transformInstallation.id,
        capabilityVersionId: LOCAL_TRANSFORM_VERSION_ID, action: 'join_payload', target: LOCAL_JOIN_TARGET,
        dependsOn: [stepA, stepB],
        declaredInputs: [
          { name: 'input_a', fromStepId: stepA, outputName: 'result_a' },
          { name: 'input_b', fromStepId: stepB, outputName: 'result_b' },
        ],
        declaredOutputs: ['final_result'], evidenceRequirements: ['final-evidence'], humanGatePolicy: 'never',
      },
    ],
  });
  return { missionId, revisionId: revision.id, runId, stepA, stepB, stepC };
}

async function resetWorker(workerManager, workerId, audit) {
  if (workerManager.contexts.has(workerId)) await workerManager.stop(workerId);
  await workerManager.start(workerId);
  const page = attachPageAudit(workerManager, workerId, audit);
  await page.reload();
  assert.equal(workerManager.requireWorker(workerId).status, 'idle');
}

async function runHappyStory(service, installs, eventStore) {
  const story = createForkJoin(service, installs, 'happy');
  const started = service.startMission({ workspaceId: 'workspace-a', missionId: story.missionId, revisionId: story.revisionId, runId: story.runId });
  const state0 = started.state;
  const a0 = state0.stepAttempts.find((item) => item.stepId === story.stepA);
  const b0 = state0.stepAttempts.find((item) => item.stepId === story.stepB);
  assert.equal(a0.state, 'waiting_human');
  assert.equal(b0.state, 'completed');
  assert.ok(state0.stepAttempts.filter((item) => [story.stepA, story.stepB].includes(item.stepId)).length >= 2);
  const gate = state0.humanGates.find((item) => item.state === 'requested');
  assert.ok(gate);
  const before = submissions(eventStore);
  await service.approveHumanGate({ gateId: gate.id });
  const after = submissions(eventStore);
  await service.approveHumanGate({ gateId: gate.id });
  const repeat = submissions(eventStore);
  assert.equal(after, before + 1);
  assert.equal(repeat, after);
  const final = service.queryMissionState('workspace-a');
  assert.equal(final.stepAttempts.find((item) => item.stepId === story.stepA).state, 'completed');
  assert.equal(final.stepAttempts.find((item) => item.stepId === story.stepB).state, 'completed');
  assert.equal(final.stepAttempts.find((item) => item.stepId === story.stepC).state, 'completed');
  assert.equal(final.agentHandoffs.filter((item) => item.toStepId === story.stepC).length, 2);
  assert.equal(final.stepOutputs.some((item) => item.outputName === 'final_result'), true);
  assert.equal(final.missionRuns.find((item) => item.id === story.runId).state, 'completed');
  assert.equal(final.evidence.some((item) => item.type === 'final-evidence'), true);
  const checkpoint = service.recordCheckpoint({ id: 'happy-checkpoint', workspaceId: 'workspace-a', runId: story.runId });
  return { story, before, after, repeat, checkpoint };
}

async function runPauseStory(service, installs, eventStore) {
  const story = createForkJoin(service, installs, 'pause');
  service.startMission({ workspaceId: 'workspace-a', missionId: story.missionId, revisionId: story.revisionId, runId: story.runId });
  const gate = service.queryMissionState('workspace-a').humanGates.find((item) => item.state === 'requested' && item.taskId?.includes('pause'));
  assert.ok(gate, 'pause gate not found');
  const before = submissions(eventStore);
  service.pauseMission({ workspaceId: 'workspace-a', runId: story.runId });
  await assert.rejects(() => service.approveHumanGate({ gateId: gate.id }), /paused/i);
  assert.equal(submissions(eventStore), before);
  service.resumeMission({ workspaceId: 'workspace-a', runId: story.runId });
  await service.approveHumanGate({ gateId: gate.id });
  assert.equal(submissions(eventStore), before + 1);
  return { before, after: submissions(eventStore) };
}

function runCancelStory(service, installs, eventStore) {
  const story = createForkJoin(service, installs, 'cancel');
  service.startMission({ workspaceId: 'workspace-a', missionId: story.missionId, revisionId: story.revisionId, runId: story.runId });
  const before = submissions(eventStore);
  service.cancelMission({ workspaceId: 'workspace-a', runId: story.runId, reason: 'acceptance cancel' });
  const after = submissions(eventStore);
  const state = service.queryMissionState('workspace-a');
  assert.equal(after, before);
  assert.equal(state.missionRuns.find((item) => item.id === story.runId).state, 'cancelled');
  assert.equal(state.stepAttempts.find((item) => item.stepId === story.stepB).state, 'completed');
  return { before, after };
}

async function runCrashStory(service, installs, eventStore, workerManager, audit) {
  const story = createForkJoin(service, installs, 'crash');
  service.startMission({ workspaceId: 'workspace-a', missionId: story.missionId, revisionId: story.revisionId, runId: story.runId });
  const state0 = service.queryMissionState('workspace-a');
  const gate = state0.humanGates.find((item) => item.state === 'requested' && item.taskId?.includes('crash'));
  assert.ok(gate, 'crash gate not found');
  const previous = state0.stepAttempts.find((item) => item.stepId === story.stepA);
  const before = submissions(eventStore);
  const session = workerManager.contexts.get('s1-worker-chromium');
  assert.ok(session, 'chromium context missing before forced close');
  await session.context.close();
  await assert.rejects(() => service.approveHumanGate({ gateId: gate.id }), /not running|Unknown|stopped|Worker/i);
  const contained = service.queryMissionState('workspace-a');
  const previousAfter = contained.stepAttempts.find((item) => item.id === previous.id);
  assert.equal(previousAfter.state, 'recovery_required');
  assert.equal(contained.missionRuns.find((item) => item.id === story.runId).state, 'recovery_required');
  assert.equal(submissions(eventStore), before);
  assert.equal(workerManager.requireWorker('s1-worker-chrome').status, 'idle');
  await resetWorker(workerManager, 's1-worker-chromium', audit);
  const retried = service.retryStepAfterReview({ workspaceId: 'workspace-a', runId: story.runId, previousAttemptId: previous.id, reviewed: true });
  assert.notEqual(retried.id, previous.id);
  assert.equal(retried.attemptNumber, 2);
  assert.equal(submissions(eventStore), before);
  const newGate = service.queryMissionState('workspace-a').humanGates.find((item) => item.state === 'requested' && item.id !== gate.id);
  assert.ok(newGate, 'reviewed retry did not create a new gate');
  await service.approveHumanGate({ gateId: newGate.id });
  assert.equal(submissions(eventStore), before + 1);
  return { before, after: submissions(eventStore), previousAttemptId: previous.id, retryAttemptId: retried.id };
}

async function main() {
  const startedAt = new Date().toISOString();
  const source = auditSourceScope();
  assert.equal(process.arch, 'arm64', `Node must run natively as arm64, got ${process.arch}`);
  assert.equal(command('uname', ['-m']), 'arm64');
  const translated = commandOr('sysctl', ['-in', 'sysctl.proc_translated'], '0');
  assert.notEqual(translated, '1', 'runner process is Rosetta translated');
  const architecture = {
    node: process.arch,
    uname: command('uname', ['-m']),
    translated,
    chrome: assertArchitecture(CHROME_PATH, 'Google Chrome'),
    chromium: assertArchitecture(chromium.executablePath(), 'Playwright Chromium'),
  };

  const runtimeRoot = mkdtempSync(join(tmpdir(), 'ai-exe-os-s2-acceptance-'));
  const outputRoot = process.env.S2_ACCEPTANCE_OUTPUT || join(process.cwd(), 'runtime', 's2-acceptance');
  mkdirSync(outputRoot, { recursive: true });
  const audit = { pageErrors: [], consoleErrors: [] };
  const eventStore = new JsonlEventStore(join(runtimeRoot, 'events.jsonl'));
  const server = new LocalTestServer({ rootDirectory: join(process.cwd(), 'test-pages'), port: 0 });
  let service = null;
  let workerManager = null;
  const rows = {};

  try {
    const testBaseUrl = await server.start();
    workerManager = new BrowserWorkerManager({
      profilesRoot: join(runtimeRoot, 'profiles'),
      leaseManager: new ProfileLeaseManager(),
      eventStore,
      testBaseUrl,
    });
    workerManager.create({ id: 's1-worker-chrome', projectId: 's2-acceptance', role: 'isolation', browserChannel: 'chrome' });
    workerManager.create({ id: 's1-worker-chromium', projectId: 's2-acceptance', role: 'mission', browserChannel: 'chromium' });
    await workerManager.start('s1-worker-chrome');
    await workerManager.start('s1-worker-chromium');
    const chromePage = attachPageAudit(workerManager, 's1-worker-chrome', audit);
    const chromiumPage = attachPageAudit(workerManager, 's1-worker-chromium', audit);
    await chromePage.reload();
    await chromiumPage.reload();
    assert.equal(workerManager.requireWorker('s1-worker-chrome').status, 'idle');
    assert.equal(workerManager.requireWorker('s1-worker-chromium').status, 'idle');
    rows.dualBrowserIsolation = 'PASS';

    const databasePath = join(runtimeRoot, 'state.sqlite');
    service = new S2ApplicationService({ databasePath, workerManager, localTarget: `${testBaseUrl}/task-form.html` });
    const installs = prepareCapabilities(service);

    const happy = await runHappyStory(service, installs, eventStore);
    rows.happyForkJoin = 'PASS';
    rows.humanGateExactOnce = 'PASS';
    rows.typedHandoffLineage = 'PASS';
    rows.terminalEvidence = 'PASS';

    await resetWorker(workerManager, 's1-worker-chromium', audit);
    const pause = await runPauseStory(service, installs, eventStore);
    rows.pauseResume = pause.after === pause.before + 1 ? 'PASS' : 'FAIL';

    await resetWorker(workerManager, 's1-worker-chromium', audit);
    const cancel = runCancelStory(service, installs, eventStore);
    rows.cancelNoEffect = cancel.after === cancel.before ? 'PASS' : 'FAIL';

    const crash = await runCrashStory(service, installs, eventStore, workerManager, audit);
    rows.crashContainmentNoReplay = crash.after === crash.before + 1 && crash.previousAttemptId !== crash.retryAttemptId ? 'PASS' : 'FAIL';

    service.createMission({ id: 'workspace-b-mission', workspaceId: 'workspace-b', title: 'Workspace B', objective: 'must remain isolated' });
    const aIds = service.queryMissionState('workspace-a').missions.map((item) => item.id);
    const bIds = service.queryMissionState('workspace-b').missions.map((item) => item.id);
    assert.equal(aIds.includes('workspace-b-mission'), false);
    assert.deepEqual(bIds, ['workspace-b-mission']);
    rows.workspaceIsolation = 'PASS';

    const beforeRestart = submissions(eventStore);
    const checkpointDigest = happy.checkpoint.projectionDigest;
    service.close();
    service = new S2ApplicationService({ databasePath, workerManager, localTarget: `${testBaseUrl}/task-form.html` });
    const afterRestart = submissions(eventStore);
    assert.equal(afterRestart, beforeRestart);
    const restored = service.queryMissionState('workspace-a');
    assert.equal(restored.missionRuns.find((item) => item.id === happy.story.runId).state, 'completed');
    const checkpointAgain = service.recordCheckpoint({ id: 'happy-checkpoint', workspaceId: 'workspace-a', runId: happy.story.runId });
    assert.equal(checkpointAgain.projectionDigest, checkpointDigest);
    rows.sqliteRestartNoReplay = 'PASS';
    rows.checkpointDigestEquality = 'PASS';

    assert.deepEqual(audit.pageErrors, []);
    assert.deepEqual(audit.consoleErrors, []);
    rows.pageConsoleErrorsZero = 'PASS';

    await workerManager.stopAll();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const residual = command('ps', ['-axo', 'command']).split('\n').filter((line) => line.includes(runtimeRoot));
    assert.deepEqual(residual, []);
    rows.residualProcessesZero = 'PASS';

    for (const [name, value] of Object.entries(rows)) assert.equal(value, 'PASS', `${name} failed`);
    const result = {
      status: 'PASS',
      startedAt,
      completedAt: new Date().toISOString(),
      source,
      architecture,
      testBaseUrl,
      rows,
      counters: {
        submissions: submissions(eventStore),
        pageErrors: audit.pageErrors.length,
        consoleErrors: audit.consoleErrors.length,
      },
      note: 'GitHub-hosted native Apple Silicon acceptance; no external provider surface used.',
    };
    const json = `${JSON.stringify(result, null, 2)}\n`;
    const resultPath = join(outputRoot, 'matrix-result.json');
    writeFileSync(resultPath, json);
    const digest = sha256(readFileSync(resultPath));
    writeFileSync(join(outputRoot, 'matrix-result.sha256'), `${digest}  matrix-result.json\n`);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    try { service?.close(); } catch {}
    try { await workerManager?.stopAll(); } catch {}
    try { await server.stop(); } catch {}
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
