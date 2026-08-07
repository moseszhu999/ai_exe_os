'use strict';

const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const net = require('node:net');
const { _electron: electron } = require('playwright');
const electronExecutable = require('electron');

const outputRoot = process.env.S2_ACCEPTANCE_OUTPUT || join(process.cwd(), 'runtime', 's2-acceptance');
const SURFACES = [
  'Missions', 'Mission Builder', 'Execution Plan', 'Step Details', 'Agent Handoffs',
  'Human Gates', 'Checkpoints', 'Run Timeline', 'Evidence / Recovery',
];
const S1_METHODS = ['approveHumanGate', 'createTask', 'grantCapability', 'installCapability', 'queryState', 'rejectHumanGate'];
const S2_METHODS = ['cancelMission', 'createMission', 'createRevision', 'pauseMission', 'queryState', 'recordCheckpoint', 'resumeMission', 'retryStepAfterReview', 'startMission'];
const S0_METHODS = ['confirmLocalTask', 'createTask', 'createWorker', 'focusWorker', 'getState', 'observePullRequest', 'pauseWorker', 'resumeWorker', 'startWorker', 'stopWorker'];

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

async function main() {
  mkdirSync(outputRoot, { recursive: true });
  const userData = mkdtempSync(join(tmpdir(), 'ai-exe-os-s2-ui-'));
  const port = await freePort();
  const pageErrors = [];
  const consoleErrors = [];
  const allConsole = [];
  let app;
  let page;

  try {
    app = await electron.launch({
      executablePath: electronExecutable,
      args: ['.'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        AI_EXE_OS_USER_DATA_DIR: userData,
        AI_EXE_OS_TEST_PORT: String(port),
      },
    });
    page = await app.firstWindow();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      allConsole.push({ type: message.type(), text: message.text() });
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('#s2-navigation');
    await page.waitForFunction(() => !!window.aiExecutionOS?.s1 && !!window.aiExecutionOS?.s2?.mission);

    const bridge = await page.evaluate(() => ({
      s0: ['getState','createWorker','startWorker','stopWorker','focusWorker','pauseWorker','resumeWorker','createTask','confirmLocalTask','observePullRequest'].filter((name) => typeof window.aiExecutionOS?.[name] === 'function').sort(),
      s1: Object.keys(window.aiExecutionOS?.s1 || {}).sort(),
      s2: Object.keys(window.aiExecutionOS?.s2?.mission || {}).sort(),
      href: location.href,
    }));
    assert.deepEqual(bridge.s0, [...S0_METHODS].sort());
    assert.deepEqual(bridge.s1, [...S1_METHODS].sort());
    assert.deepEqual(bridge.s2, [...S2_METHODS].sort());

    const directQueries = await page.evaluate(async () => {
      const capture = async (name, fn) => {
        try {
          const value = await fn();
          return { name, ok: true, summary: {
            workers: value?.workers?.length ?? null,
            workspaces: value?.workspaces?.map((item) => item.id) ?? null,
            missions: value?.missions?.map((item) => item.id) ?? null,
          } };
        } catch (error) {
          return { name, ok: false, error: error?.message || String(error) };
        }
      };
      return Promise.all([
        capture('s0', () => window.aiExecutionOS.getState()),
        capture('s1', () => window.aiExecutionOS.s1.queryState('workspace-a')),
        capture('s2', () => window.aiExecutionOS.s2.mission.queryState('workspace-a')),
      ]);
    });
    const diagnostic = { bridge, directQueries, pageErrors: [...pageErrors], consoleErrors: [...consoleErrors], allConsole: [...allConsole] };
    writeFileSync(join(outputRoot, 'electron-ui-diagnostic.json'), `${JSON.stringify(diagnostic, null, 2)}\n`);
    await page.screenshot({ path: join(outputRoot, 's2-electron-startup.png'), fullPage: true });
    for (const query of directQueries) assert.equal(query.ok, true, `${query.name} direct IPC query failed: ${query.error || 'unknown'}`);
    const s1Query = directQueries.find((item) => item.name === 's1');
    assert.deepEqual(s1Query.summary.workspaces, ['workspace-a', 'workspace-b']);

    // The renderer's automatic refresh may begin before the harness attaches. If it has not
    // populated the selector yet, invoke the same public renderer refresh function once.
    if (await page.locator('#s1-workspace option').count() < 2) {
      const refreshAvailable = await page.evaluate(() => typeof window.refresh === 'function');
      assert.equal(refreshAvailable, true, 'renderer refresh function is unavailable');
      await page.evaluate(() => window.refresh());
    }
    await page.waitForFunction(() => document.querySelectorAll('#s1-workspace option').length >= 2, null, { timeout: 10000 });

    const initialText = await page.locator('body').innerText();
    for (const surface of SURFACES) assert.match(initialText, new RegExp(surface.replace('/', '\\/')));
    await page.screenshot({ path: join(outputRoot, 's2-mission-ui-overview.png'), fullPage: true });

    await page.click('#s2-prepare');
    await page.waitForFunction(() => document.getElementById('s1-marketplace')?.textContent.includes('local.mission-transform'));
    await page.click('#s2-create');
    await page.waitForFunction(() => document.getElementById('s2-missions')?.textContent.includes('mission-ui-001'));
    await page.click('#s2-start');
    await page.waitForFunction(() => document.getElementById('s2-run-summary')?.textContent.includes('mission-ui-001-run-1'));

    const stateText = await page.locator('body').innerText();
    assert.match(stateText, /mission-ui-001/);
    assert.match(stateText, /step-a/);
    assert.match(stateText, /step-b/);
    assert.match(stateText, /worker_unavailable|Bound Worker is unavailable|blocked/i);
    assert.doesNotMatch(stateText, /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|-----BEGIN .*PRIVATE KEY-----|\/profiles\/|\\profiles\\/i);
    await page.screenshot({ path: join(outputRoot, 's2-mission-ui-state.png'), fullPage: true });

    assert.deepEqual(pageErrors, []);
    assert.deepEqual(consoleErrors, []);
    writeFileSync(join(outputRoot, 'electron-ui-audit.json'), `${JSON.stringify({
      status: 'PASS',
      surfaces: SURFACES,
      bridge,
      directQueries,
      activeWorkspace: 'workspace-a',
      missionId: 'mission-ui-001',
      pageErrors,
      consoleErrors,
      screenshots: ['s2-electron-startup.png', 's2-mission-ui-overview.png', 's2-mission-ui-state.png'],
    }, null, 2)}\n`);
  } catch (error) {
    if (page) {
      try { await page.screenshot({ path: join(outputRoot, 's2-electron-failure.png'), fullPage: true }); } catch {}
      try {
        const failureState = await page.evaluate(() => ({
          href: location.href,
          hasBridge: !!window.aiExecutionOS,
          statusText: document.getElementById('status')?.textContent || '',
          workspaceOptions: [...document.querySelectorAll('#s1-workspace option')].map((option) => option.value),
          bodyText: document.body?.innerText?.slice(0, 6000) || '',
        }));
        writeFileSync(join(outputRoot, 'electron-ui-failure.json'), `${JSON.stringify({ failureState, pageErrors, consoleErrors, allConsole, error: error.message }, null, 2)}\n`);
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
