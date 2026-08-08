'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { _electron: electron } = require('playwright');
const electronExecutable = require('electron');

const PRODUCT_SHA = process.env.S6_PRODUCT_SHA || 'b9cce3a331b33c273e5eecd11fa3269fd5c9b135';
const OUTPUT = process.env.S6_ACCEPTANCE_OUTPUT || join(process.cwd(), 'runtime', 's6-acceptance');
const S0_METHODS = ['confirmLocalTask','createTask','createWorker','focusWorker','getState','observePullRequest','pauseWorker','resumeWorker','startWorker','stopWorker'];
const S1_METHODS = ['approveHumanGate','createTask','grantCapability','installCapability','queryState','rejectHumanGate'];
const S2_METHODS = ['cancelMission','createMission','createRevision','pauseMission','queryState','recordCheckpoint','resumeMission','retryStepAfterReview','startMission'];
const S3_METHODS = ['bindPullRequest','claimPaths','createRepairProposal','observeDelivery','queryState','registerRepository','reserveBranch'];
const S4_METHODS = ['focusWorker','pauseWorker','query','resumeWorker','stopWorker'];
const S5_METHODS = ['bindTarget','observe','queryState'];
const S6_METHODS = ['computeDecision','queryState','recordPolicy','revalidateProposal'];
const S6_SURFACES = ['Policy','Capacity','Eligible Queue','Selected Assignment','Deferred Reasons','Worker Compatibility','Provider Capacity','Decision Evidence'];

function sh(name, args = []) { return execFileSync(name, args, { encoding: 'utf8' }).trim(); }
function writeJson(name, value) { writeFileSync(join(OUTPUT, name), `${JSON.stringify(value, null, 2)}\n`); }

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function launch(userData, port, audit) {
  const app = await electron.launch({
    executablePath: electronExecutable,
    args: ['.'],
    cwd: process.cwd(),
    env: { ...process.env, AI_EXE_OS_USER_DATA_DIR: userData, AI_EXE_OS_TEST_PORT: String(port) },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => audit.pageErrors.push(error.message));
  page.on('console', (message) => {
    audit.allConsole.push({ type: message.type(), text: message.text() });
    if (message.type() === 'error') audit.consoleErrors.push(message.text());
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!window.aiExecutionOS?.s6?.scheduling);
  await page.waitForSelector('#s6-scheduling-panel');
  return { app, page };
}

async function bridgeAudit(page) {
  return page.evaluate(() => ({
    s0: ['getState','createWorker','startWorker','stopWorker','focusWorker','pauseWorker','resumeWorker','createTask','confirmLocalTask','observePullRequest'].filter((name) => typeof window.aiExecutionOS?.[name] === 'function').sort(),
    s1: Object.keys(window.aiExecutionOS?.s1 || {}).sort(),
    s2: Object.keys(window.aiExecutionOS?.s2?.mission || {}).sort(),
    s3: Object.keys(window.aiExecutionOS?.s3?.github || {}).sort(),
    s4: Object.keys(window.aiExecutionOS?.s4?.console || {}).sort(),
    s5: Object.keys(window.aiExecutionOS?.s5?.provider || {}).sort(),
    s6: Object.keys(window.aiExecutionOS?.s6?.scheduling || {}).sort(),
  }));
}

async function setupSchedulingScenario(page, port) {
  return page.evaluate(async ({ port }) => {
    const base = `http://127.0.0.1:${port}/task-form.html`;
    const targets = {
      high: `${base}?s6-ui=high`,
      normal: `${base}?s6-ui=normal`,
      low: `${base}?s6-ui=low`,
    };
    await window.aiExecutionOS.createWorker({ id: 's1-worker-chrome', projectId: 's1-local-project', role: 'implementation', browserChannel: 'chrome' });
    await window.aiExecutionOS.createWorker({ id: 's1-worker-chromium', projectId: 's1-local-project', role: 'review', browserChannel: 'chromium' });
    await window.aiExecutionOS.startWorker('s1-worker-chrome');
    await window.aiExecutionOS.startWorker('s1-worker-chromium');

    await window.aiExecutionOS.s6.scheduling.recordPolicy({
      id: 's6-electron-policy-v1', workspaceId: 'workspace-a', version: '1.0.0', status: 'active',
      globalMaxActive: 2, workspaceMaxActive: 2,
      priorityOrder: ['critical','high','normal','low'],
      fairness: { mode: 'bounded-aging', agingIntervalSeconds: 60, maxPriorityBoostSteps: 2 },
      sessionReuse: 'compatible-only', createdAt: '2026-08-08T00:00:00.000Z',
    });
    const install = await window.aiExecutionOS.s1.installCapability({ workspaceId: 'workspace-a', packageId: 'local.form-submit', version: '1.0.0' });
    await window.aiExecutionOS.s1.grantCapability({
      workspaceId: 'workspace-a', agentId: 'agent-a', installationId: install.id,
      allowedActions: ['submit_payload'], allowedTargets: Object.values(targets),
    });
    await window.aiExecutionOS.s2.mission.createMission({
      id: 's6-electron-mission', workspaceId: 'workspace-a', title: 'S6 Electron scheduling mission',
      objective: 'three ready candidates over two real Worker sessions',
    });
    const revision = await window.aiExecutionOS.s2.mission.createRevision({
      id: 's6-electron-revision', workspaceId: 'workspace-a', missionId: 's6-electron-mission', revision: 1,
      objective: 'exercise S6 selection through real Electron IPC',
      terminalStepIds: ['step-high','step-normal','step-low'],
      steps: [
        {
          id: 'step-low', name: 'Low Chrome', agentId: 'agent-a', installationId: install.id,
          capabilityVersionId: 'local.form-submit@1.0.0', action: 'submit_payload', target: targets.low,
          workerId: 's1-worker-chrome', dependsOn: [], declaredInputs: [], declaredOutputs: ['low-result'],
          evidenceRequirements: ['local result text'], humanGatePolicy: 'action', resourceRequirements: [], priority: 'low', payload: 'low',
        },
        {
          id: 'step-normal', name: 'Normal Chromium', agentId: 'agent-a', installationId: install.id,
          capabilityVersionId: 'local.form-submit@1.0.0', action: 'submit_payload', target: targets.normal,
          workerId: 's1-worker-chromium', dependsOn: [], declaredInputs: [], declaredOutputs: ['normal-result'],
          evidenceRequirements: ['local result text'], humanGatePolicy: 'action', resourceRequirements: [], priority: 'normal', payload: 'normal',
        },
        {
          id: 'step-high', name: 'High Chrome', agentId: 'agent-a', installationId: install.id,
          capabilityVersionId: 'local.form-submit@1.0.0', action: 'submit_payload', target: targets.high,
          workerId: 's1-worker-chrome', dependsOn: [], declaredInputs: [], declaredOutputs: ['high-result'],
          evidenceRequirements: ['local result text'], humanGatePolicy: 'action', resourceRequirements: [], priority: 'high', payload: 'high',
        },
      ],
    });
    const started = await window.aiExecutionOS.s2.mission.startMission({
      workspaceId: 'workspace-a', missionId: 's6-electron-mission', revisionId: revision.revision.id, runId: 's6-electron-run',
    });
    return { targets, revisionId: revision.revision.id, runState: started.run.state };
  }, { port });
}

async function captureState(page) {
  return page.evaluate(async () => {
    const [s0, s1, s2, s4, s6] = await Promise.all([
      window.aiExecutionOS.getState(),
      window.aiExecutionOS.s1.queryState('workspace-a'),
      window.aiExecutionOS.s2.mission.queryState('workspace-a'),
      window.aiExecutionOS.s4.console.query('workspace-a'),
      window.aiExecutionOS.s6.scheduling.queryState('workspace-a'),
    ]);
    return {
      s0EventCount: (s0.events || []).length,
      s0SubmissionEvents: (s0.events || []).filter((item) => item.type === 'task.submission_started').length,
      s1EventCount: (s1.events || []).length,
      mission: {
        run: (s2.missionRuns || []).find((item) => item.id === 's6-electron-run') || null,
        attempts: (s2.stepAttempts || []).filter((item) => item.missionRunId === 's6-electron-run').map((item) => ({ id: item.id, stepId: item.stepId, state: item.state, workerId: item.workerId })),
        gates: (s2.humanGates || []).map((item) => ({ id: item.id, state: item.state })),
        readySteps: ((s2.plans || []).find((item) => item.id === ((s2.missionRuns || []).find((run) => run.id === 's6-electron-run') || {}).planId)?.steps || [])
          .filter((item) => item.state === 'ready').map((item) => item.id),
      },
      scheduling: {
        policy: s6.policy,
        capacity: s6.capacity,
        eligibleQueue: s6.eligibleQueue,
        deferred: s6.deferred,
        decisions: s6.decisions,
        proposals: s6.proposals,
      },
      cockpitScheduling: s4.scheduling,
    };
  });
}

async function main() {
  mkdirSync(OUTPUT, { recursive: true });
  assert.equal(process.arch, 'arm64');
  const userData = mkdtempSync(join(tmpdir(), 'ai-exe-os-s6-electron-'));
  const port = await freePort();
  const audit = { pageErrors: [], consoleErrors: [], allConsole: [] };
  let app;
  let page;
  try {
    ({ app, page } = await launch(userData, port, audit));
    const bridge = await bridgeAudit(page);
    assert.deepEqual(bridge.s0, [...S0_METHODS].sort());
    assert.deepEqual(bridge.s1, [...S1_METHODS].sort());
    assert.deepEqual(bridge.s2, [...S2_METHODS].sort());
    assert.deepEqual(bridge.s3, [...S3_METHODS].sort());
    assert.deepEqual(bridge.s4, [...S4_METHODS].sort());
    assert.deepEqual(bridge.s5, [...S5_METHODS].sort());
    assert.deepEqual(bridge.s6, [...S6_METHODS].sort());

    const scenario = await setupSchedulingScenario(page, port);
    assert.equal(scenario.runState, 'running');
    const before = await captureState(page);
    assert.equal(before.mission.attempts.length, 2);
    assert.deepEqual(before.mission.attempts.map((item) => item.stepId).sort(), ['step-high','step-normal']);
    assert.ok(before.mission.attempts.every((item) => item.state === 'waiting_human'));
    assert.equal(before.mission.gates.filter((item) => item.state === 'requested').length, 2);
    assert.deepEqual(before.mission.readySteps, ['step-low']);
    assert.equal(before.scheduling.capacity.workspaceActive, 2);
    assert.equal(before.scheduling.capacity.workspaceMaxActive, 2);
    assert.equal(before.scheduling.eligibleQueue.length, 1);
    assert.equal(before.scheduling.eligibleQueue[0].priority, 'low');
    assert.equal(before.scheduling.proposals.filter((item) => item.state === 'accepted').length, 2);
    assert.equal(before.s0SubmissionEvents, 0);
    assert.equal(before.cockpitScheduling.policy.id, 's6-electron-policy-v1');

    await page.click('#refresh');
    await page.waitForFunction(() => document.querySelector('#s6-summary')?.textContent?.includes('eligible'));
    const uiText = await page.locator('#s6-scheduling-panel').innerText();
    for (const surface of S6_SURFACES) assert.ok(uiText.includes(surface), `missing S6 surface ${surface}`);
    assert.ok(uiText.includes('s6-electron-policy-v1'));
    assert.ok(uiText.includes('step-low') || uiText.includes('schedcand'));
    await page.screenshot({ path: join(OUTPUT, 's6-cockpit-after-scheduling.png'), fullPage: true });
    writeJson('electron-scheduling-before-restart.json', { status: 'PASS', productSha: PRODUCT_SHA, bridge, state: before });

    await app.close();
    app = null;
    page = null;
    await new Promise((resolve) => setTimeout(resolve, 800));

    ({ app, page } = await launch(userData, port, audit));
    const after = await captureState(page);
    assert.equal(after.mission.attempts.length, before.mission.attempts.length);
    assert.deepEqual(after.mission.attempts, before.mission.attempts);
    assert.equal(after.scheduling.decisions.length, before.scheduling.decisions.length);
    assert.equal(after.scheduling.proposals.length, before.scheduling.proposals.length);
    assert.equal(after.s0SubmissionEvents, before.s0SubmissionEvents);
    assert.equal(after.s1EventCount, before.s1EventCount);
    assert.equal(after.cockpitScheduling.policy.id, 's6-electron-policy-v1');
    await page.click('#refresh');
    await page.waitForSelector('#s6-scheduling-panel');
    await page.screenshot({ path: join(OUTPUT, 's6-cockpit-after-restart.png'), fullPage: true });
    writeJson('electron-scheduling-after-restart.json', { status: 'PASS', productSha: PRODUCT_SHA, state: after });

    assert.deepEqual(audit.pageErrors, []);
    assert.deepEqual(audit.consoleErrors, []);
    const result = {
      status: 'PASS', productSha: PRODUCT_SHA, architecture: { node: process.arch, uname: sh('uname', ['-m']) },
      rows: {
        exactS6Bridge: 'PASS', realElectron: 'PASS', twoConcurrentWorkerSessions: 'PASS', candidatesGreaterThanCapacity: 'PASS',
        prioritySelection: 'PASS', humanGateNoSubmission: 'PASS', cockpitExplanation: 'PASS', restartNoReplay: 'PASS',
        decisionProposalPersistence: 'PASS', pageErrorsZero: 'PASS', consoleErrorsZero: 'PASS',
      },
      pageErrors: audit.pageErrors, consoleErrors: audit.consoleErrors,
      before: {
        attemptCount: before.mission.attempts.length, readySteps: before.mission.readySteps,
        decisionCount: before.scheduling.decisions.length, proposalCount: before.scheduling.proposals.length,
        submissionEvents: before.s0SubmissionEvents,
      },
      afterRestart: {
        attemptCount: after.mission.attempts.length, readySteps: after.mission.readySteps,
        decisionCount: after.scheduling.decisions.length, proposalCount: after.scheduling.proposals.length,
        submissionEvents: after.s0SubmissionEvents,
      },
      evidenceClass: 'github-hosted-native-apple-silicon-real-electron',
    };
    writeJson('electron-ui-audit.json', result);
    console.log(JSON.stringify(result, null, 2));

    await app.close();
    app = null;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const residual = sh('ps', ['-axo', 'command']).split('\n').filter((line) => line.includes(userData));
    assert.deepEqual(residual, []);
    writeJson('electron-cleanup-audit.json', { status: 'PASS', productSha: PRODUCT_SHA, residualScopedProcesses: residual });
  } finally {
    try { await app?.close(); } catch {}
    rmSync(userData, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
