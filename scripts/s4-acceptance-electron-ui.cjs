'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { _electron: electron } = require('playwright');
const electronExecutable = require('electron');

const PRODUCT_SHA = process.env.S4_PRODUCT_SHA || '9d4b6d85dffd22481196fafca64ae8526750f9e1';
const OUTPUT = process.env.S4_ACCEPTANCE_OUTPUT || join(process.cwd(), 'runtime', 's4-acceptance');
const S0_METHODS = ['confirmLocalTask','createTask','createWorker','focusWorker','getState','observePullRequest','pauseWorker','resumeWorker','startWorker','stopWorker'];
const S1_METHODS = ['approveHumanGate','createTask','grantCapability','installCapability','queryState','rejectHumanGate'];
const S2_METHODS = ['cancelMission','createMission','createRevision','pauseMission','queryState','recordCheckpoint','resumeMission','retryStepAfterReview','startMission'];
const S3_METHODS = ['bindPullRequest','claimPaths','createRepairProposal','observeDelivery','queryState','registerRepository','reserveBranch'];
const S4_METHODS = ['focusWorker','pauseWorker','query','resumeWorker','stopWorker'];
const S4_SURFACES = ['Cockpit / Overview','Projects & Workspaces','Missions / Execution Graph','Workers & Sessions','Agents / Capabilities / Provider Use','Human Gate Inbox','Blockers & Recovery','GitHub Delivery','Evidence & Event Lineage'];

function sh(name, args = []) { return execFileSync(name, args, { encoding: 'utf8' }).trim(); }

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

function writeJson(name, value) {
  writeFileSync(join(OUTPUT, name), `${JSON.stringify(value, null, 2)}\n`);
}

function missionDigest(state) {
  return JSON.stringify({
    missions: (state.missions || []).map((item) => ({ id: item.id, currentRevisionId: item.currentRevisionId })),
    missionRuns: (state.missionRuns || []).map((item) => ({ id: item.id, missionId: item.missionId, state: item.state })),
    stepAttempts: (state.stepAttempts || []).map((item) => ({ id: item.id, missionRunId: item.missionRunId, stepId: item.stepId, state: item.state, attemptNumber: item.attemptNumber })),
    humanGates: (state.humanGates || []).map((item) => ({ id: item.id, runId: item.runId, state: item.state })),
  });
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
  await page.waitForFunction(() => !!window.aiExecutionOS?.s4?.console);
  await page.waitForSelector('#s4-cockpit');
  return { app, page };
}

async function bridgeAudit(page) {
  return page.evaluate(() => ({
    s0: ['getState','createWorker','startWorker','stopWorker','focusWorker','pauseWorker','resumeWorker','createTask','confirmLocalTask','observePullRequest'].filter((name) => typeof window.aiExecutionOS?.[name] === 'function').sort(),
    s1: Object.keys(window.aiExecutionOS?.s1 || {}).sort(),
    s2: Object.keys(window.aiExecutionOS?.s2?.mission || {}).sort(),
    s3: Object.keys(window.aiExecutionOS?.s3?.github || {}).sort(),
    s4: Object.keys(window.aiExecutionOS?.s4?.console || {}).sort(),
  }));
}

async function main() {
  mkdirSync(OUTPUT, { recursive: true });
  assert.equal(process.arch, 'arm64');
  const userData = mkdtempSync(join(tmpdir(), 'ai-exe-os-s4-electron-'));
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

    await page.evaluate(async () => {
      await window.aiExecutionOS.createWorker({ id: 's1-worker-chrome', projectId: 's1-local-project', role: 'implementation', browserChannel: 'chrome' });
      await window.aiExecutionOS.createWorker({ id: 's1-worker-chromium', projectId: 's1-local-project', role: 'review', browserChannel: 'chromium' });
      await window.aiExecutionOS.startWorker('s1-worker-chrome');
      await window.aiExecutionOS.startWorker('s1-worker-chromium');
    });
    let cockpit = await page.evaluate(() => window.aiExecutionOS.s4.console.query('workspace-a'));
    assert.deepEqual(cockpit.workers.map((item) => item.workerId).sort(), ['s1-worker-chrome', 's1-worker-chromium']);
    assert.ok(cockpit.workers.every((item) => item.status === 'idle'));
    const missing = await page.evaluate(() => window.aiExecutionOS.s4.console.query('workspace-missing'));
    assert.equal(missing.found, false);
    assert.deepEqual(missing.workers, []);

    await page.click('#s2-prepare');
    await page.waitForFunction(() => document.getElementById('s1-marketplace')?.textContent.includes('local.mission-transform'));
    await page.click('#s2-create');
    await page.waitForFunction(() => document.getElementById('s2-missions')?.textContent.includes('mission-ui-001'));
    await page.click('#s2-start');
    await page.waitForFunction(() => document.getElementById('s2-run-summary')?.textContent.includes('mission-ui-001-run-1'));
    await page.click('#refresh');
    await page.waitForFunction(() => document.getElementById('s4-missions')?.textContent.includes('mission-ui-001'));

    const bodyText = await page.locator('body').innerText();
    for (const surface of S4_SURFACES) assert.ok(bodyText.includes(surface), `missing S4 surface ${surface}`);
    assert.match(bodyText, /GitHub Delivery · Read-Only/);
    await page.screenshot({ path: join(OUTPUT, 's4-cockpit-before.png'), fullPage: true });

    cockpit = await page.evaluate(() => window.aiExecutionOS.s4.console.query('workspace-a'));
    const missionBefore = await page.evaluate(() => window.aiExecutionOS.s2.mission.queryState('workspace-a'));
    const missionBeforeDigest = missionDigest(missionBefore);
    const attention = cockpit.attention.find((item) => item.code === 'human_gate_required' || item.code === 'waiting_human');
    assert.ok(attention, 'expected Human Gate/waiting-human attention');
    assert.ok(cockpit.lineage[attention.id]?.available, 'expected evidence lineage for attention');
    const workerBBefore = cockpit.workers.find((item) => item.workerId === 's1-worker-chromium');
    const submissionsBefore = (await page.evaluate(() => window.aiExecutionOS.getState())).events.filter((event) => event.type === 'task.submission_started').length;

    await page.evaluate(() => window.aiExecutionOS.s4.console.focusWorker({ workspaceId: 'workspace-a', workerId: 's1-worker-chrome' }));
    const afterFocus = await page.evaluate(() => window.aiExecutionOS.s4.console.query('workspace-a'));
    assert.deepEqual(afterFocus.workers.find((item) => item.workerId === 's1-worker-chromium'), workerBBefore);
    await page.evaluate(() => window.aiExecutionOS.s4.console.pauseWorker({ workspaceId: 'workspace-a', workerId: 's1-worker-chrome' }));
    const afterPause = await page.evaluate(() => window.aiExecutionOS.s4.console.query('workspace-a'));
    assert.equal(afterPause.workers.find((item) => item.workerId === 's1-worker-chrome').status, 'paused');
    assert.equal(afterPause.workers.find((item) => item.workerId === 's1-worker-chromium').status, 'idle');
    await page.evaluate(() => window.aiExecutionOS.s4.console.resumeWorker({ workspaceId: 'workspace-a', workerId: 's1-worker-chrome' }));
    await page.evaluate(() => window.aiExecutionOS.s4.console.stopWorker({ workspaceId: 'workspace-a', workerId: 's1-worker-chrome' }));
    const afterStop = await page.evaluate(() => window.aiExecutionOS.s4.console.query('workspace-a'));
    assert.equal(afterStop.workers.find((item) => item.workerId === 's1-worker-chrome').status, 'stopped');
    assert.equal(afterStop.workers.find((item) => item.workerId === 's1-worker-chromium').status, 'idle');
    assert.equal(missionDigest(await page.evaluate(() => window.aiExecutionOS.s2.mission.queryState('workspace-a'))), missionBeforeDigest);
    const submissionsAfterControl = (await page.evaluate(() => window.aiExecutionOS.getState())).events.filter((event) => event.type === 'task.submission_started').length;
    assert.equal(submissionsAfterControl, submissionsBefore);
    await page.click('#refresh');
    await page.screenshot({ path: join(OUTPUT, 's4-cockpit-after-control.png'), fullPage: true });

    writeJson('electron-control-matrix.json', {
      status: 'PASS', productSha: PRODUCT_SHA, bridge,
      workerBBefore, afterFocus: afterFocus.workers, afterPause: afterPause.workers, afterStop: afterStop.workers,
      missionBeforeDigest, missionAfterControlDigest: missionDigest(await page.evaluate(() => window.aiExecutionOS.s2.mission.queryState('workspace-a'))),
      submissionsBefore, submissionsAfterControl,
      attention, lineage: cockpit.lineage[attention.id],
    });

    await app.close();
    app = null;
    page = null;

    ({ app, page } = await launch(userData, port, audit));
    const restartCockpit = await page.evaluate(() => window.aiExecutionOS.s4.console.query('workspace-a'));
    const restartMission = await page.evaluate(() => window.aiExecutionOS.s2.mission.queryState('workspace-a'));
    const restartS0 = await page.evaluate(() => window.aiExecutionOS.getState());
    const submissionsAfterRestart = restartS0.events.filter((event) => event.type === 'task.submission_started').length;
    assert.equal(submissionsAfterRestart, submissionsBefore);
    assert.equal(missionDigest(restartMission), missionBeforeDigest);
    assert.deepEqual(restartCockpit.workers.map((item) => item.workerId).sort(), ['s1-worker-chrome', 's1-worker-chromium']);
    assert.ok(restartCockpit.workers.every((item) => item.status === 'stopped'));
    assert.ok(restartCockpit.attention.some((item) => item.code === 'human_gate_required' || item.code === 'waiting_human'));
    await page.click('#refresh');
    await page.screenshot({ path: join(OUTPUT, 's4-cockpit-after-restart.png'), fullPage: true });

    assert.deepEqual(audit.pageErrors, []);
    assert.deepEqual(audit.consoleErrors, []);
    writeJson('electron-ui-audit.json', {
      status: 'PASS', productSha: PRODUCT_SHA, bridge,
      restart: { workers: restartCockpit.workers, submissionsAfterRestart, missionDigest: missionDigest(restartMission) },
      pageErrors: audit.pageErrors, consoleErrors: audit.consoleErrors,
      screenshots: ['s4-cockpit-before.png', 's4-cockpit-after-control.png', 's4-cockpit-after-restart.png'],
    });

    await app.close();
    app = null;
    page = null;
    await new Promise((resolve) => setTimeout(resolve, 750));
    const residual = sh('ps', ['-axo', 'command']).split('\n').filter((line) => line.includes(userData));
    assert.deepEqual(residual, []);
    writeJson('electron-cleanup-audit.json', { status: 'PASS', residualScopedProcesses: residual });
  } catch (error) {
    if (page) {
      try { await page.screenshot({ path: join(OUTPUT, 's4-electron-failure.png'), fullPage: true }); } catch {}
      try {
        const failure = await page.evaluate(() => ({
          href: location.href,
          hasBridge: !!window.aiExecutionOS?.s4?.console,
          summary: document.getElementById('s4-summary')?.textContent || '',
          workspaceOptions: [...document.querySelectorAll('#s1-workspace option')].map((option) => option.value),
          bodyText: document.body?.innerText?.slice(0, 10000) || '',
        }));
        writeJson('electron-ui-failure.json', { error: error.message, failure, audit });
      } catch {}
    }
    throw error;
  } finally {
    try { await app?.close(); } catch {}
    rmSync(userData, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
