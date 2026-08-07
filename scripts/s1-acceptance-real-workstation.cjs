'use strict';

const { createHash } = require('node:crypto');
const { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { execFileSync } = require('node:child_process');

const TARGET_SHA = 'b378389929c8fce91d219f8179ea175995b19e2d';
const targetRoot = resolve(process.argv[2] || process.env.AI_EXE_OS_S1_TARGET || process.cwd());
const outputRoot = resolve(process.env.AI_EXE_OS_S1_ACCEPTANCE_OUTPUT || join(process.cwd(), 's1-acceptance-evidence'));
const userData = join(outputRoot, 'user-data');
const testPort = String(process.env.AI_EXE_OS_S1_TEST_PORT || '43129');
const localTarget = `http://127.0.0.1:${testPort}/task-form.html`;
mkdirSync(outputRoot, { recursive: true });
mkdirSync(userData, { recursive: true });

const { _electron: electron } = require(join(targetRoot, 'node_modules', 'playwright'));
const electronPath = require(join(targetRoot, 'node_modules', 'electron'));
const { S1SqliteEventStore } = require(join(targetRoot, 'src', 'storage', 'index.cjs'));

const pageErrors = [];
const consoleErrors = [];
const processLogs = [];
const result = {
  status: 'RUNNING',
  targetSha: TARGET_SHA,
  targetRoot,
  outputRoot,
  userData,
  testPort,
  localTarget,
  phases: {},
  pageErrors,
  consoleErrors,
};

function writeJson(name, value) {
  writeFileSync(join(outputRoot, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assert(condition, message, detail = null) {
  if (!condition) {
    const error = new Error(message);
    error.detail = detail;
    throw error;
  }
}

function countSubmissionStarted(state) {
  return (state.events || []).filter((event) => event.type === 'task.submission_started').length;
}

function attachDiagnostics(electronApp, page, label) {
  page.on('pageerror', (error) => pageErrors.push({ label, message: error.message, stack: error.stack || null }));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push({ label, text: message.text() });
  });
  const child = electronApp.process();
  child.stdout?.on('data', (chunk) => processLogs.push({ label, stream: 'stdout', text: chunk.toString() }));
  child.stderr?.on('data', (chunk) => processLogs.push({ label, stream: 'stderr', text: chunk.toString() }));
}

async function launch(label) {
  const electronApp = await electron.launch({
    executablePath: electronPath,
    args: ['.'],
    cwd: targetRoot,
    env: {
      ...process.env,
      AI_EXE_OS_USER_DATA_DIR: userData,
      AI_EXE_OS_TEST_PORT: testPort,
      ELECTRON_ENABLE_LOGGING: '1',
    },
    timeout: 120000,
  });
  const page = await electronApp.firstWindow();
  attachDiagnostics(electronApp, page, label);
  await page.waitForFunction(() => Boolean(window.aiExecutionOS?.s1?.queryState), null, { timeout: 60000 });
  return { electronApp, page };
}

async function s0State(page) {
  return page.evaluate(() => window.aiExecutionOS.getState());
}

async function s1State(page, workspaceId) {
  return page.evaluate((id) => window.aiExecutionOS.s1.queryState(id), workspaceId);
}

async function provisionAndStart(page, worker) {
  await page.evaluate(async (input) => {
    const api = window.aiExecutionOS;
    const state = await api.getState();
    if (!state.workers.some((candidate) => candidate.id === input.id)) {
      await api.createWorker(input);
    }
    const refreshed = await api.getState();
    const current = refreshed.workers.find((candidate) => candidate.id === input.id);
    if (!current || ['created', 'stopped', 'failed'].includes(current.status)) {
      await api.startWorker(input.id);
    }
  }, worker);
  await page.waitForFunction(async (id) => {
    const state = await window.aiExecutionOS.getState();
    return state.workers.find((worker) => worker.id === id)?.status === 'idle';
  }, worker.id, { timeout: 120000 });
}

async function closeGracefully(session) {
  if (!session?.electronApp) return;
  try { await session.electronApp.close(); } catch {}
}

function projectionRebuildEvidence() {
  const databasePath = join(userData, 's1-runtime', 'state.sqlite');
  const migrationsDirectory = join(targetRoot, 'migrations');
  const store = new S1SqliteEventStore({ databasePath, migrationsDirectory });
  const projectionTypes = [
    'project', 'workspace', 'capabilityPackage', 'capabilityVersion', 'installation', 'agent',
    'grant', 'graph', 'task', 'executionRun', 'humanGate', 'evidence', 'workerBinding', 'providerSnapshot',
  ];
  const before = store.projectionDigest();
  const counts = {};
  for (const projectionType of projectionTypes) {
    const rebuilt = store.rebuildProjection({
      projectionType,
      reducer(state, event) {
        if (event.aggregateType !== projectionType || event.eventType !== `${projectionType}.snapshot`) return;
        const record = event.payload?.record;
        if (!record?.id) return;
        state.set(record.id, {
          projectionType,
          projectionId: record.id,
          workspaceId: record.workspaceId || 'system',
          version: Number(record._revision || 1),
          data: record,
        });
      },
    });
    counts[projectionType] = rebuilt.count;
  }
  const after = store.projectionDigest();
  const exportedEvents = store.exportEventsJsonl(join(outputRoot, 'sqlite-canonical-events.jsonl'));
  const health = store.health();
  store.close();
  copyFileSync(databasePath, join(outputRoot, 'state.sqlite'));
  for (const suffix of ['-wal', '-shm']) {
    const source = `${databasePath}${suffix}`;
    if (existsSync(source)) copyFileSync(source, join(outputRoot, `state.sqlite${suffix}`));
  }
  assert(before === after, 'Projection rebuild digest mismatch', { before, after, counts });
  return { databasePath, before, after, counts, health, exportedEvents };
}

function scopedProcesses() {
  const text = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' });
  return text.split('\n').filter(Boolean).map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    return match ? { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] } : null;
  }).filter(Boolean).filter((item) => item.command.includes(userData)
    && /(Electron|Google Chrome|Chromium|chrome-headless-shell)/.test(item.command));
}

async function cleanupProcesses() {
  const before = scopedProcesses();
  for (const item of before) {
    try { process.kill(item.pid, 'SIGTERM'); } catch {}
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 2000));
  for (const item of scopedProcesses()) {
    try { process.kill(item.pid, 'SIGKILL'); } catch {}
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  const after = scopedProcesses();
  writeJson('scoped-processes.json', { before, after });
  assert(after.length === 0, 'Scoped browser/Electron processes remain after cleanup', after);
}

async function main() {
  const targetHead = execFileSync('git', ['-C', targetRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert(targetHead === TARGET_SHA, 'Acceptance target SHA mismatch', { expected: TARGET_SHA, actual: targetHead });

  let first;
  let second;
  let crashSession;
  let recoverySession;
  try {
    first = await launch('initial');
    const { page } = first;
    const initialA = await s1State(page, 'workspace-a');
    const initialB = await s1State(page, 'workspace-b');
    assert(initialA.agents.length === 1 && initialA.agents[0].id === 'agent-a', 'Workspace A Agent isolation failed', initialA.agents);
    assert(initialB.agents.length === 1 && initialB.agents[0].id === 'agent-b', 'Workspace B Agent isolation failed', initialB.agents);
    assert(initialA.agents.every((agent) => agent.workspaceId === 'workspace-a'), 'Workspace A leaked Agent data');
    assert(initialB.agents.every((agent) => agent.workspaceId === 'workspace-b'), 'Workspace B leaked Agent data');
    assert(initialA.localTarget === localTarget, 'Dynamic local target mismatch', initialA.localTarget);

    const blocked = await page.evaluate((target) => window.aiExecutionOS.s1.createTask({
      id: 's1-accept-blocked', workspaceId: 'workspace-b', agentId: 'agent-b', installationId: 'install-missing',
      workerId: 's1-worker-chromium', payload: 'blocked workspace', target,
    }), localTarget);
    assert(blocked.run.state === 'blocked' && blocked.gate === null, 'Workspace B was not blocked before gate', blocked);
    assert(blocked.run.blockers.some((item) => item.code === 'installation_missing_or_disabled'), 'Missing installation blocker absent');
    assert(blocked.run.blockers.some((item) => item.code === 'grant_missing_or_revoked'), 'Missing grant blocker absent');

    const installation = await page.evaluate(() => window.aiExecutionOS.s1.installCapability({ workspaceId: 'workspace-a' }));
    const grant = await page.evaluate((installationId) => window.aiExecutionOS.s1.grantCapability({
      workspaceId: 'workspace-a', agentId: 'agent-a', installationId,
    }), installation.id);
    assert(grant.status === 'active', 'Agent grant was not active', grant);

    await provisionAndStart(page, {
      id: 's1-worker-chrome', projectId: 's1-local-project', role: 'implementation', browserChannel: 'chrome',
    });
    await provisionAndStart(page, {
      id: 's1-worker-chromium', projectId: 's1-local-project', role: 'implementation', browserChannel: 'chromium',
    });

    const beforeReject = countSubmissionStarted(await s0State(page));
    const rejectTask = await page.evaluate(({ installationId, target }) => window.aiExecutionOS.s1.createTask({
      id: 's1-accept-reject', workspaceId: 'workspace-a', agentId: 'agent-a', installationId,
      workerId: 's1-worker-chromium', payload: 'reject payload', target,
    }), { installationId: installation.id, target: localTarget });
    assert(rejectTask.gate?.state === 'requested', 'Reject scenario did not produce a Human Gate', rejectTask);
    await page.evaluate((gateId) => window.aiExecutionOS.s1.rejectHumanGate({ workspaceId: 'workspace-a', gateId }), rejectTask.gate.id);
    const afterReject = countSubmissionStarted(await s0State(page));
    assert(beforeReject === afterReject, 'Rejected Human Gate changed submission count', { beforeReject, afterReject });

    const approveTask = await page.evaluate(({ installationId, target }) => window.aiExecutionOS.s1.createTask({
      id: 's1-accept-approve', workspaceId: 'workspace-a', agentId: 'agent-a', installationId,
      workerId: 's1-worker-chromium', payload: 'approved payload', target,
    }), { installationId: installation.id, target: localTarget });
    const beforeApprove = countSubmissionStarted(await s0State(page));
    const approved = await page.evaluate((gateId) => window.aiExecutionOS.s1.approveHumanGate({ workspaceId: 'workspace-a', gateId }), approveTask.gate.id);
    const afterApprove = countSubmissionStarted(await s0State(page));
    assert(approved.run.state === 'result_observed', 'Approved execution did not observe a result', approved);
    assert(afterApprove === beforeApprove + 1, 'Approved execution did not add exactly one submission', { beforeApprove, afterApprove });
    const repeated = await page.evaluate((gateId) => window.aiExecutionOS.s1.approveHumanGate({ workspaceId: 'workspace-a', gateId }), approveTask.gate.id);
    const afterRepeat = countSubmissionStarted(await s0State(page));
    assert(repeated.changed === false && afterRepeat === afterApprove, 'Repeated approval replayed execution', { repeated, afterApprove, afterRepeat });

    const approvedState = await s1State(page, 'workspace-a');
    const workers = await s0State(page);
    assert(approvedState.evidence.some((item) => item.taskId === 's1-accept-approve'), 'Approved evidence missing', approvedState.evidence);
    assert(workers.workers.find((worker) => worker.id === 's1-worker-chrome')?.status === 'idle', 'Chrome worker isolation failed', workers.workers);
    assert(workers.workers.find((worker) => worker.id === 's1-worker-chromium')?.status === 'waiting_human', 'Chromium result state mismatch', workers.workers);
    writeJson('phase-initial-approved.json', { initialA, initialB, blocked, rejectTask, approved, approvedState, s0: workers });

    await page.evaluate(() => document.getElementById('refresh').click());
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(outputRoot, 's1-integrated-approved.png'), fullPage: true });
    const evidenceText = await page.locator('#s1-evidence').textContent();
    assert(evidenceText.includes('s1-accept-approve'), 'Integrated UI did not render accepted evidence', evidenceText);
    await closeGracefully(first);
    first = null;

    second = await launch('restart');
    const restartState = await s1State(second.page, 'workspace-a');
    assert(restartState.installations.length === 1, 'Installation did not rehydrate', restartState.installations);
    assert(restartState.grants.length === 1, 'Grant did not rehydrate', restartState.grants);
    assert(restartState.evidence.some((item) => item.taskId === 's1-accept-approve'), 'Evidence did not rehydrate');
    const restartBefore = countSubmissionStarted(await s0State(second.page));
    const restartRepeat = await second.page.evaluate((gateId) => window.aiExecutionOS.s1.approveHumanGate({ workspaceId: 'workspace-a', gateId }), approveTask.gate.id);
    const restartAfter = countSubmissionStarted(await s0State(second.page));
    assert(restartRepeat.changed === false && restartBefore === restartAfter, 'Restart replayed approved execution', { restartBefore, restartAfter, restartRepeat });
    writeJson('phase-restart.json', { restartState, restartBefore, restartAfter, restartRepeat });
    await closeGracefully(second);
    second = null;

    result.phases.projectionRebuild = projectionRebuildEvidence();

    crashSession = await launch('forced-crash');
    await provisionAndStart(crashSession.page, {
      id: 's1-worker-chrome', projectId: 's1-local-project', role: 'implementation', browserChannel: 'chrome',
    });
    const crashTask = await crashSession.page.evaluate(({ installationId, target }) => window.aiExecutionOS.s1.createTask({
      id: 's1-accept-crash', workspaceId: 'workspace-a', agentId: 'agent-a', installationId,
      workerId: 's1-worker-chrome', payload: 'S0_DELAY_MS=10000\ncrash payload', target,
    }), { installationId: installation.id, target: localTarget });
    const crashBefore = countSubmissionStarted(await s0State(crashSession.page));
    await crashSession.page.evaluate((gateId) => {
      window.__s1CrashApproval = window.aiExecutionOS.s1.approveHumanGate({ workspaceId: 'workspace-a', gateId })
        .then((value) => { window.__s1CrashResult = value; })
        .catch((error) => { window.__s1CrashError = error.message; });
      return true;
    }, crashTask.gate.id);
    await crashSession.page.waitForFunction(async (before) => {
      const state = await window.aiExecutionOS.getState();
      return state.events.filter((event) => event.type === 'task.submission_started').length === before + 1;
    }, crashBefore, { timeout: 60000 });
    const crashStarted = await s1State(crashSession.page, 'workspace-a');
    writeJson('phase-before-forced-crash.json', { crashTask, crashBefore, crashStarted, s0: await s0State(crashSession.page) });
    const crashProcess = crashSession.electronApp.process();
    process.kill(crashProcess.pid, 'SIGKILL');
    await new Promise((resolveExit) => crashProcess.once('exit', resolveExit));
    crashSession = null;

    recoverySession = await launch('recovery');
    const recovered = await s1State(recoverySession.page, 'workspace-a');
    const recoveredRun = recovered.executionRuns.find((item) => item.taskId === 's1-accept-crash');
    const recoveredTask = recovered.tasks.find((item) => item.id === 's1-accept-crash');
    assert(recoveredRun?.state === 'waiting_human' && recoveredRun.recoveryReason === 'application_recovery_requires_review', 'Forced crash run did not recover to waiting_human', recoveredRun);
    assert(recoveredTask?.state === 'waiting_human', 'Forced crash task did not recover to waiting_human', recoveredTask);
    const recoveryBefore = countSubmissionStarted(await s0State(recoverySession.page));
    const replayError = await recoverySession.page.evaluate(async (gateId) => {
      try {
        await window.aiExecutionOS.s1.approveHumanGate({ workspaceId: 'workspace-a', gateId });
        return null;
      } catch (error) {
        return error.message;
      }
    }, crashTask.gate.id);
    const recoveryAfter = countSubmissionStarted(await s0State(recoverySession.page));
    assert(replayError?.includes('cannot be replayed'), 'Recovery approval was not explicitly blocked', replayError);
    assert(recoveryBefore === recoveryAfter, 'Recovery approval caused a duplicate submission', { recoveryBefore, recoveryAfter });
    await recoverySession.page.evaluate(() => document.getElementById('refresh').click());
    await recoverySession.page.waitForTimeout(1000);
    await recoverySession.page.screenshot({ path: join(outputRoot, 's1-integrated-recovery.png'), fullPage: true });
    writeJson('phase-recovery.json', { recovered, recoveredRun, recoveredTask, recoveryBefore, recoveryAfter, replayError });
    await closeGracefully(recoverySession);
    recoverySession = null;

    assert(pageErrors.length === 0, 'Renderer page errors were recorded', pageErrors);
    assert(consoleErrors.length === 0, 'Renderer console errors were recorded', consoleErrors);
    result.status = 'PASS';
    result.phases.workspaceIsolation = 'PASS';
    result.phases.rejectNoSubmission = { before: beforeReject, after: afterReject };
    result.phases.approveExactlyOnce = { before: beforeApprove, after: afterApprove, repeated: afterRepeat };
    result.phases.restartNoReplay = { before: restartBefore, after: restartAfter };
    result.phases.crashNoReplay = { before: recoveryBefore, after: recoveryAfter };
  } finally {
    await closeGracefully(first);
    await closeGracefully(second);
    await closeGracefully(recoverySession);
    if (crashSession?.electronApp) {
      try { process.kill(crashSession.electronApp.process().pid, 'SIGKILL'); } catch {}
    }
    await cleanupProcesses();
    writeJson('process-logs.json', processLogs);
  }
}

main().then(() => {
  result.completedAt = new Date().toISOString();
  writeJson('s1-result.json', result);
  writeFileSync(join(outputRoot, 'ASSESSMENT.md'), `# S1 exact-head real-workstation assessment\n\n- target: ${TARGET_SHA}\n- status: PASS\n- Workspace isolation: PASS\n- rejected Human Gate submission count: ${result.phases.rejectNoSubmission.before} -> ${result.phases.rejectNoSubmission.after}\n- approved execution submission count: ${result.phases.approveExactlyOnce.before} -> ${result.phases.approveExactlyOnce.after}\n- repeated approval: no replay\n- restart: no replay\n- forced crash: waiting_human / no replay\n- SQLite projection rebuild digest: ${result.phases.projectionRebuild.before} == ${result.phases.projectionRebuild.after}\n- page errors: 0\n- console errors: 0\n`, 'utf8');
  console.log(JSON.stringify({ status: result.status, outputRoot, targetSha: TARGET_SHA }, null, 2));
}).catch(async (error) => {
  result.status = 'FAIL';
  result.completedAt = new Date().toISOString();
  result.error = { message: error.message, stack: error.stack, detail: error.detail || null };
  try { writeJson('s1-result.json', result); } catch {}
  console.error(error);
  process.exitCode = 1;
});
