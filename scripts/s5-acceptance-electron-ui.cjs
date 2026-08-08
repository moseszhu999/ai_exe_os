'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { _electron: electron } = require('playwright');
const electronExecutable = require('electron');

const PRODUCT_SHA = process.env.S5_PRODUCT_SHA || '5b1933a284c00b86bf438a53af6beb94c8d6eda9';
const OUTPUT = process.env.S5_ACCEPTANCE_OUTPUT || join(process.cwd(), 'runtime', 's5-acceptance');
const VERCEL_TARGET = process.env.S5_VERCEL_TARGET || 'https://chaintrace-app.vercel.app/';
const NETLIFY_TARGET = process.env.S5_NETLIFY_TARGET || 'https://gleaming-cajeta-c158d9.netlify.app/';
const S0_METHODS = ['confirmLocalTask','createTask','createWorker','focusWorker','getState','observePullRequest','pauseWorker','resumeWorker','startWorker','stopWorker'];
const S1_METHODS = ['approveHumanGate','createTask','grantCapability','installCapability','queryState','rejectHumanGate'];
const S2_METHODS = ['cancelMission','createMission','createRevision','pauseMission','queryState','recordCheckpoint','resumeMission','retryStepAfterReview','startMission'];
const S3_METHODS = ['bindPullRequest','claimPaths','createRepairProposal','observeDelivery','queryState','registerRepository','reserveBranch'];
const S4_METHODS = ['focusWorker','pauseWorker','query','resumeWorker','stopWorker'];
const S5_METHODS = ['bindTarget','observe','queryState'];

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
  await page.waitForFunction(() => !!window.aiExecutionOS?.s5?.provider);
  await page.waitForSelector('#s5-provider-panel');
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
  }));
}

async function queryProvider(page) {
  return page.evaluate(() => window.aiExecutionOS.s5.provider.queryState('workspace-a'));
}

async function waitForUiReady(page, bindingId) {
  await page.waitForFunction((expectedBindingId) => {
    const select = document.getElementById('s5-binding-select');
    const button = document.getElementById('s5-observe');
    return select?.value === expectedBindingId && button && button.disabled === false;
  }, bindingId);
}

async function rejected(page, operation, payload) {
  return page.evaluate(async ({ operation, payload }) => {
    try {
      if (operation === 'observe') await window.aiExecutionOS.s5.provider.observe(payload);
      else if (operation === 'bind') await window.aiExecutionOS.s5.provider.bindTarget(payload);
      else throw new Error('unknown acceptance operation');
      return { rejected: false, message: null };
    } catch (error) {
      return { rejected: true, message: String(error?.message || error) };
    }
  }, { operation, payload });
}

function assertAudit(audit, method = 'GET') {
  assert.ok(audit.length >= 2, 'expected provider method audit for both live targets');
  const allowedOrigins = new Set([new URL(VERCEL_TARGET).origin, new URL(NETLIFY_TARGET).origin]);
  const seen = new Set();
  for (const row of audit) {
    assert.equal(row.method, method);
    const origin = new URL(row.target).origin;
    assert.ok(allowedOrigins.has(origin), `provider request escaped approved origins: ${row.target}`);
    seen.add(origin);
  }
  assert.ok(seen.has(new URL(VERCEL_TARGET).origin));
  assert.ok(seen.has(new URL(NETLIFY_TARGET).origin));
}

async function main() {
  mkdirSync(OUTPUT, { recursive: true });
  assert.equal(process.arch, 'arm64');
  const userData = mkdtempSync(join(tmpdir(), 'ai-exe-os-s5-electron-'));
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

    await page.evaluate(async ({ vercelTarget, netlifyTarget }) => {
      await window.aiExecutionOS.s5.provider.bindTarget({
        id: 's5-electron-vercel-binding', workspaceId: 'workspace-a', provider: 'vercel', adapterId: 'vercel.public-deployment',
        providerContractId: 'provider-vercel-public', action: 'observe_public_deployment', exactTarget: vercelTarget,
      });
      await window.aiExecutionOS.s5.provider.bindTarget({
        id: 's5-electron-netlify-binding', workspaceId: 'workspace-a', provider: 'netlify', adapterId: 'netlify.public-deployment',
        providerContractId: 'provider-netlify-public', action: 'observe_public_deployment', exactTarget: netlifyTarget,
      });
    }, { vercelTarget: VERCEL_TARGET, netlifyTarget: NETLIFY_TARGET });
    await page.click('#refresh');
    await page.waitForFunction(() => document.querySelectorAll('#s5-binding-select option').length >= 3);
    const before = await queryProvider(page);
    assert.equal(before.bindings.length, 2);
    assert.deepEqual(before.methodAudit, []);
    await page.screenshot({ path: join(OUTPUT, 's5-provider-before.png'), fullPage: true });

    const auditCount = before.methodAudit.length;
    const wrongWorkspace = await rejected(page, 'observe', { workspaceId: 'workspace-b', bindingId: 's5-electron-vercel-binding' });
    assert.equal(wrongWorkspace.rejected, true);
    assert.match(wrongWorkspace.message, /Cross-Workspace|not found/i);
    const writeMethod = await rejected(page, 'observe', { workspaceId: 'workspace-a', bindingId: 's5-electron-vercel-binding', method: 'POST' });
    assert.equal(writeMethod.rejected, true);
    assert.match(writeMethod.message, /GET or HEAD|not permitted|method/i);
    const wrongTarget = await rejected(page, 'bind', {
      id: 's5-electron-bad-target', workspaceId: 'workspace-a', provider: 'vercel', adapterId: 'vercel.public-deployment',
      providerContractId: 'provider-vercel-public', action: 'observe_public_deployment', exactTarget: NETLIFY_TARGET,
    });
    assert.equal(wrongTarget.rejected, true);
    assert.match(wrongTarget.message, /Vercel|hostname|mismatch/i);
    const privateTarget = await rejected(page, 'bind', {
      id: 's5-electron-private-target', workspaceId: 'workspace-a', provider: 'vercel', adapterId: 'vercel.public-deployment',
      providerContractId: 'provider-vercel-public', action: 'observe_public_deployment', exactTarget: 'https://127.0.0.1/',
    });
    assert.equal(privateTarget.rejected, true);
    const afterBlocked = await queryProvider(page);
    assert.equal(afterBlocked.methodAudit.length, auditCount, 'blocked Electron commands reached provider transport');

    await page.selectOption('#s5-binding-select', 's5-electron-vercel-binding');
    await waitForUiReady(page, 's5-electron-vercel-binding');
    await page.click('#s5-observe');
    await page.waitForFunction(async () => {
      const state = await window.aiExecutionOS.s5.provider.queryState('workspace-a');
      return state.observations.some((item) => item.bindingId === 's5-electron-vercel-binding');
    });
    await waitForUiReady(page, 's5-electron-vercel-binding');

    await page.selectOption('#s5-binding-select', 's5-electron-netlify-binding');
    await waitForUiReady(page, 's5-electron-netlify-binding');
    await page.click('#s5-observe');
    await page.waitForFunction(async () => {
      const state = await window.aiExecutionOS.s5.provider.queryState('workspace-a');
      return state.observations.length === 2
        && state.observations.some((item) => item.bindingId === 's5-electron-netlify-binding');
    });
    await waitForUiReady(page, 's5-electron-netlify-binding');

    const liveState = await queryProvider(page);
    assert.equal(liveState.observations.length, 2);
    const vercelObservation = liveState.observations.find((item) => item.bindingId === 's5-electron-vercel-binding');
    const netlifyObservation = liveState.observations.find((item) => item.bindingId === 's5-electron-netlify-binding');
    assert.equal(vercelObservation.state, 'succeeded', `Electron Vercel observation failed: ${vercelObservation.failureCode || vercelObservation.statusCode}`);
    assert.equal(netlifyObservation.state, 'succeeded', `Electron Netlify observation failed: ${netlifyObservation.failureCode || netlifyObservation.statusCode}`);
    assert.equal(vercelObservation.exactTarget, VERCEL_TARGET);
    assert.equal(netlifyObservation.exactTarget, NETLIFY_TARGET);
    assertAudit(liveState.methodAudit, 'GET');
    await page.click('#refresh');
    await page.waitForFunction(() => document.getElementById('s5-observation')?.textContent.includes('evidenceDigest'));
    const bodyText = await page.locator('body').innerText();
    for (const label of ['Approved Provider Adapters', 'Approved Targets', 'Provider Observations & Evidence', 'Observe selected approved target']) {
      assert.ok(bodyText.includes(label), `missing S5 UI label: ${label}`);
    }
    assert.ok(bodyText.includes(NETLIFY_TARGET));
    await page.screenshot({ path: join(OUTPUT, 's5-provider-after-live.png'), fullPage: true });

    const firstProcess = {
      bindings: liveState.bindings,
      observations: liveState.observations,
      methodAudit: liveState.methodAudit,
      safety: { wrongWorkspace, writeMethod, wrongTarget, privateTarget },
    };
    await app.close();
    app = null;
    page = null;

    ({ app, page } = await launch(userData, port, audit));
    const restartState = await queryProvider(page);
    assert.equal(restartState.bindings.length, 2);
    assert.equal(restartState.observations.length, 2);
    assert.deepEqual(restartState.methodAudit, [], 'Electron restart replayed provider requests');
    const replayResults = await page.evaluate(async ({ observations }) => {
      const results = [];
      for (const item of observations) {
        results.push(await window.aiExecutionOS.s5.provider.observe({
          id: item.id, workspaceId: item.workspaceId, bindingId: item.bindingId, method: item.method,
        }));
      }
      return results;
    }, { observations: firstProcess.observations });
    assert.ok(replayResults.every((item) => item.replayed === true && item.networkRequested === false));
    const afterReplayState = await queryProvider(page);
    assert.deepEqual(afterReplayState.methodAudit, [], 'canonical observation replay issued provider request');
    await page.click('#refresh');
    await page.waitForFunction(() => document.querySelectorAll('#s5-binding-select option').length >= 3);
    await page.selectOption('#s5-binding-select', 's5-electron-netlify-binding');
    await waitForUiReady(page, 's5-electron-netlify-binding');
    await page.waitForFunction(() => document.getElementById('s5-observation')?.textContent.includes('evidenceDigest'));
    await page.screenshot({ path: join(OUTPUT, 's5-provider-after-restart.png'), fullPage: true });

    assert.deepEqual(audit.pageErrors, []);
    assert.deepEqual(audit.consoleErrors, []);
    writeJson('electron-ui-audit.json', {
      status: 'PASS', productSha: PRODUCT_SHA, evidenceClass: 'github-hosted-native-apple-silicon', bridge,
      approvedTargets: { vercel: VERCEL_TARGET, netlify: NETLIFY_TARGET },
      firstProcess,
      restart: {
        bindings: restartState.bindings,
        observations: restartState.observations,
        methodAudit: restartState.methodAudit,
        replayResults: replayResults.map((item) => ({ replayed: item.replayed, networkRequested: item.networkRequested, observationId: item.observation.id })),
      },
      pageErrors: audit.pageErrors,
      consoleErrors: audit.consoleErrors,
      screenshots: ['s5-provider-before.png', 's5-provider-after-live.png', 's5-provider-after-restart.png'],
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
      try { await page.screenshot({ path: join(OUTPUT, 's5-electron-failure.png'), fullPage: true }); } catch {}
      try {
        const failure = await page.evaluate(() => ({
          href: location.href,
          hasS5Bridge: !!window.aiExecutionOS?.s5?.provider,
          panel: document.getElementById('s5-provider-panel')?.innerText?.slice(0, 10000) || '',
          workspaceOptions: [...document.querySelectorAll('#s1-workspace option')].map((option) => option.value),
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
