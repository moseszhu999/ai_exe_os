'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { _electron: electron, chromium } = require('playwright');
const electronExecutable = require('electron');
const { ProjectOwnedSyncMirror, createMirrorRequestHandler } = require('../src/sync/transport/mirror.cjs');

const PRODUCT_SHA = process.env.S7_PRODUCT_SHA || '004bfc9f6972b0bfc0295256dcdb7aada308b70b';
const OUTPUT = process.env.S7_ACCEPTANCE_OUTPUT || join(process.cwd(), 'runtime', 's7-acceptance');
const CHROME = process.env.S7_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TRACE = join(OUTPUT, 'electron-trace.jsonl');
const S7_METHODS = ['configureSync', 'pullMirror', 'pushPending', 'queryState', 'recordMembership'];
const S7_SURFACES = ['Sync Status','Source Instance','Endpoint / Mode','Outbound Cursor','Acknowledged Cursor','Pending Envelopes','Remote Sources','Gap / Divergence','Members / Roles','Shared Workspace','Remote Worker Presence'];

function sh(name, args = []) { return execFileSync(name, args, { encoding: 'utf8' }).trim(); }
function shOr(name, args, fallback = 'unavailable') { try { return sh(name, args); } catch { return fallback; } }
function writeJson(name, value) { writeFileSync(join(OUTPUT, name), `${JSON.stringify(value, null, 2)}\n`); }
function trace(stage, detail = {}) {
  const row = { at: new Date().toISOString(), stage, ...detail };
  appendFileSync(TRACE, `${JSON.stringify(row)}\n`);
  console.log(`[S7-F] ${stage}`, JSON.stringify(detail));
}

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

function architecture(path, label) {
  const file = sh('file', ['-b', path]);
  const lipo = shOr('lipo', ['-archs', path]);
  assert.match(`${file} ${lipo}`, /arm64/, `${label} is not arm64-capable`);
  return { file, lipo };
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

async function startMirrorServer() {
  const mirror = new ProjectOwnedSyncMirror();
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
  return { mirror, requestAudit, server, endpoint: `http://127.0.0.1:${server.address().port}/v1/sync/` };
}

function createAudit() { return { pageErrors: [], consoleErrors: [], allConsole: [] }; }

async function launchInstance({ label, userData, testPort, endpoint, audit }) {
  trace('launch.begin', { label, testPort });
  const app = await electron.launch({
    executablePath: electronExecutable,
    args: ['.'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      AI_EXE_OS_USER_DATA_DIR: userData,
      AI_EXE_OS_TEST_PORT: String(testPort),
      AI_EXE_OS_SYNC_ENDPOINT: endpoint,
      AI_EXE_OS_SYNC_ALLOW_LOOPBACK: '1',
    },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => audit.pageErrors.push({ label, message: error.message }));
  page.on('console', (message) => {
    const row = { label, type: message.type(), text: message.text() };
    audit.allConsole.push(row);
    if (message.type() === 'error') audit.consoleErrors.push(row);
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!window.aiExecutionOS?.s7?.sync);
  await page.waitForSelector('#s7-sync-panel', { timeout: 20000 });
  const bridge = await page.evaluate(() => ({
    s7: Object.keys(window.aiExecutionOS?.s7?.sync || {}).sort(),
    s6: Object.keys(window.aiExecutionOS?.s6?.scheduling || {}).sort(),
    s5: Object.keys(window.aiExecutionOS?.s5?.provider || {}).sort(),
    s4: Object.keys(window.aiExecutionOS?.s4?.console || {}).sort(),
  }));
  assert.deepEqual(bridge.s7, [...S7_METHODS].sort());
  trace('launch.ready', { label, s7Methods: bridge.s7 });
  return { app, page, bridge, label };
}

const querySync = (instance) => instance.page.evaluate(() => window.aiExecutionOS.s7.sync.queryState('workspace-a'));
const queryS0 = (instance) => instance.page.evaluate(() => window.aiExecutionOS.getState());
const push = (instance) => instance.page.evaluate(() => window.aiExecutionOS.s7.sync.pushPending({ workspaceId: 'workspace-a' }));
const pull = (instance) => instance.page.evaluate(() => window.aiExecutionOS.s7.sync.pullMirror({ workspaceId: 'workspace-a' }));
const stopWorker = (instance, workerId) => instance.page.evaluate((id) => window.aiExecutionOS.stopWorker(id), workerId);

async function setupMembershipAndSync(instance) {
  const result = await instance.page.evaluate(async () => {
    const membership = await window.aiExecutionOS.s7.sync.recordMembership({
      workspaceId: 'workspace-a', subjectId: 'local-operator', teamRoleId: 'owner-view', status: 'active',
    });
    const configuration = await window.aiExecutionOS.s7.sync.configureSync({ workspaceId: 'workspace-a', status: 'enabled' });
    return { membership, configuration };
  });
  trace('sync.configured', { label: instance.label, membershipId: result.membership.id, status: result.configuration.status });
  return result;
}

async function createAndStartWorker(instance, input) {
  const result = await instance.page.evaluate(async (worker) => {
    await window.aiExecutionOS.createWorker(worker);
    return window.aiExecutionOS.startWorker(worker.id);
  }, input);
  trace('worker.started', { label: instance.label, workerId: input.id, browserChannel: input.browserChannel });
  return result;
}

function presence(shared, workerPublicId) {
  return (shared?.records || []).find((item) => item.recordClass === 'worker-presence.summary' && item.payload?.workerPublicId === workerPublicId) || null;
}

function presenceSummary(shared) {
  return (shared?.records || [])
    .filter((item) => item.recordClass === 'worker-presence.summary')
    .map((item) => ({
      workerPublicId: item.payload?.workerPublicId,
      statusClass: item.payload?.statusClass,
      browserChannelClass: item.payload?.browserChannelClass,
    }))
    .sort((a, b) => String(a.workerPublicId).localeCompare(String(b.workerPublicId)));
}

async function refreshAndScreenshot(instance, filename) {
  await instance.page.click('#refresh');
  await instance.page.waitForFunction(() => document.querySelector('#s7-summary')?.textContent?.length > 0);
  await instance.page.screenshot({ path: join(OUTPUT, filename), fullPage: true });
  const panel = await instance.page.locator('#s7-sync-panel').innerText();
  for (const surface of S7_SURFACES) assert.ok(panel.includes(surface), `missing S7 UI surface ${surface}`);
  const buttons = await instance.page.locator('#s7-sync-panel button').allTextContents();
  assert.deepEqual(buttons.sort(), [
    'Pull collaboration mirror',
    'Push pending safe envelopes',
    'Record local operator visibility',
    'Record sync mode',
  ].sort());
  trace('ui.screenshot', { label: instance.label, filename });
  return { panelText: panel, buttons };
}

async function closeInstance(instance) {
  if (!instance?.app) return;
  trace('close.begin', { label: instance.label });
  await instance.app.close();
  trace('close.complete', { label: instance.label });
  await new Promise((resolve) => setTimeout(resolve, 900));
}

async function main() {
  mkdirSync(OUTPUT, { recursive: true });
  writeFileSync(TRACE, '');
  trace('matrix.begin', { productSha: PRODUCT_SHA });
  assert.equal(process.arch, 'arm64');
  assert.equal(sh('uname', ['-m']), 'arm64');
  assert.notEqual(shOr('sysctl', ['-in', 'sysctl.proc_translated'], '0'), '1');
  const arch = {
    node: process.arch,
    uname: sh('uname', ['-m']),
    chrome: architecture(CHROME, 'Google Chrome'),
    chromium: architecture(chromium.executablePath(), 'Playwright Chromium'),
  };

  const root = mkdtempSync(join(tmpdir(), 'ai-exe-os-s7-electron-'));
  const userDataA = join(root, 'instance-a');
  const userDataB = join(root, 'instance-b');
  const mirror = await startMirrorServer();
  const audit = createAudit();
  const testPortA = await freePort();
  const testPortB = await freePort();
  assert.notEqual(testPortA, testPortB);
  let a;
  let b;
  try {
    a = await launchInstance({ label: 'A', userData: userDataA, testPort: testPortA, endpoint: mirror.endpoint, audit });
    b = await launchInstance({ label: 'B', userData: userDataB, testPort: testPortB, endpoint: mirror.endpoint, audit });
    const initialA = await querySync(a);
    const initialB = await querySync(b);
    assert.notEqual(initialA.sourceInstance.id, initialB.sourceInstance.id);
    assert.match(initialA.sourceInstance.id, /^sync-source-/);
    assert.match(initialB.sourceInstance.id, /^sync-source-/);
    trace('sources.ready', { sourceA: initialA.sourceInstance.id, sourceB: initialB.sourceInstance.id });
    mirror.mirror.registerSource({ workspaceId: 'workspace-a', sourceInstanceId: initialA.sourceInstance.id });
    mirror.mirror.registerSource({ workspaceId: 'workspace-a', sourceInstanceId: initialB.sourceInstance.id });
    await setupMembershipAndSync(a);
    await setupMembershipAndSync(b);

    await createAndStartWorker(a, { id: 's1-worker-chrome', projectId: 's1-local-project', role: 'implementation', browserChannel: 'chrome' });
    await createAndStartWorker(b, { id: 's1-worker-chromium', projectId: 's1-local-project', role: 'review', browserChannel: 'chromium' });
    const s0AActive = await queryS0(a);
    const s0BActive = await queryS0(b);
    assert.ok(s0AActive.workers.some((item) => item.id === 's1-worker-chrome' && item.status === 'idle'));
    assert.ok(s0BActive.workers.some((item) => item.id === 's1-worker-chromium' && item.status === 'idle'));

    const pushA = await push(a);
    assert.equal(pushA.networkRequested, true);
    assert.ok(pushA.accepted > 0);
    const pullB = await pull(b);
    assert.equal(pullB.remoteSourcesStored, 1);
    const stateB = await querySync(b);
    const sharedA = stateB.sharedWorkspaces.find((item) => item.remoteSourceInstanceId === initialA.sourceInstance.id);
    assert.ok(sharedA);
    const aPresence = presence(sharedA, 's1-worker-chrome');
    const aOtherBinding = presence(sharedA, 's1-worker-chromium');
    assert.ok(aPresence);
    assert.ok(aOtherBinding);
    assert.equal(aPresence.payload.statusClass, 'available');
    assert.notEqual(aOtherBinding.payload.statusClass, 'available');
    trace('mirror.b-sees-a', { workerPresence: presenceSummary(sharedA) });

    const pushB = await push(b);
    assert.equal(pushB.networkRequested, true);
    assert.ok(pushB.accepted > 0);
    const pullA = await pull(a);
    assert.equal(pullA.remoteSourcesStored, 1);
    const stateA = await querySync(a);
    const sharedB = stateA.sharedWorkspaces.find((item) => item.remoteSourceInstanceId === initialB.sourceInstance.id);
    assert.ok(sharedB);
    const bPresence = presence(sharedB, 's1-worker-chromium');
    const bOtherBinding = presence(sharedB, 's1-worker-chrome');
    assert.ok(bPresence);
    assert.ok(bOtherBinding);
    assert.equal(bPresence.payload.statusClass, 'available');
    assert.notEqual(bOtherBinding.payload.statusClass, 'available');
    trace('mirror.a-sees-b', { workerPresence: presenceSummary(sharedB) });

    privacyScan(stateA);
    privacyScan(stateB);
    privacyScan(sharedA);
    privacyScan(sharedB);

    const uiA = await refreshAndScreenshot(a, 's7-instance-a-after-sync.png');
    const uiB = await refreshAndScreenshot(b, 's7-instance-b-after-sync.png');
    assert.ok(uiA.panelText.includes(initialB.sourceInstance.id));
    assert.ok(uiB.panelText.includes(initialA.sourceInstance.id));

    const beforeStopB = await queryS0(b);
    await stopWorker(a, 's1-worker-chrome');
    trace('worker.stopped', { label: 'A', workerId: 's1-worker-chrome' });
    const afterStopB = await queryS0(b);
    assert.equal(
      afterStopB.workers.find((item) => item.id === 's1-worker-chromium').status,
      beforeStopB.workers.find((item) => item.id === 's1-worker-chromium').status,
      'local Worker control in A must not affect B',
    );
    await stopWorker(b, 's1-worker-chromium');
    trace('worker.stopped', { label: 'B', workerId: 's1-worker-chromium' });

    const finalPushA = await push(a);
    const finalPushB = await push(b);
    assert.equal(finalPushA.networkRequested, true);
    assert.equal(finalPushB.networkRequested, true);
    assert.ok(finalPushA.accepted >= 1);
    assert.ok(finalPushB.accepted >= 1);
    assert.equal((await queryS0(a)).events.filter((item) => item.type === 'task.submission_started').length, 0);
    assert.equal((await queryS0(b)).events.filter((item) => item.type === 'task.submission_started').length, 0);
    trace('final-push.complete', { acceptedA: finalPushA.accepted, acceptedB: finalPushB.accepted });

    const beforeRestartA = await querySync(a);
    const beforeRestartB = await querySync(b);
    writeJson('electron-before-restart.json', {
      status: 'PASS', productSha: PRODUCT_SHA,
      sourceA: initialA.sourceInstance.id, sourceB: initialB.sourceInstance.id,
      cursorA: beforeRestartA.cursor, cursorB: beforeRestartB.cursor,
      remoteA: beforeRestartA.remoteSources, remoteB: beforeRestartB.remoteSources,
    });
    trace('restart.snapshot-written');

    await closeInstance(a); a = null;
    await closeInstance(b); b = null;
    trace('initial-instances.closed');

    a = await launchInstance({ label: 'A-restart', userData: userDataA, testPort: testPortA, endpoint: mirror.endpoint, audit });
    b = await launchInstance({ label: 'B-restart', userData: userDataB, testPort: testPortB, endpoint: mirror.endpoint, audit });
    const afterRestartA = await querySync(a);
    const afterRestartB = await querySync(b);
    assert.equal(afterRestartA.sourceInstance.id, initialA.sourceInstance.id);
    assert.equal(afterRestartB.sourceInstance.id, initialB.sourceInstance.id);
    assert.equal(afterRestartA.cursor.lastProducedCursor, beforeRestartA.cursor.lastProducedCursor);
    assert.equal(afterRestartA.cursor.lastAcknowledgedCursor, beforeRestartA.cursor.lastAcknowledgedCursor);
    assert.equal(afterRestartB.cursor.lastProducedCursor, beforeRestartB.cursor.lastProducedCursor);
    assert.equal(afterRestartB.cursor.lastAcknowledgedCursor, beforeRestartB.cursor.lastAcknowledgedCursor);
    trace('restart.identity-cursor-stable');

    const replayA = await push(a);
    const replayB = await push(b);
    assert.equal(replayA.networkRequested, false);
    assert.equal(replayB.networkRequested, false);
    assert.equal((await queryS0(a)).events.filter((item) => item.type === 'task.submission_started').length, 0);
    assert.equal((await queryS0(b)).events.filter((item) => item.type === 'task.submission_started').length, 0);
    trace('restart.no-replay');

    const restartUiA = await refreshAndScreenshot(a, 's7-instance-a-after-restart.png');
    const restartUiB = await refreshAndScreenshot(b, 's7-instance-b-after-restart.png');
    assert.ok(restartUiA.panelText.includes(initialB.sourceInstance.id));
    assert.ok(restartUiB.panelText.includes(initialA.sourceInstance.id));

    assert.deepEqual(audit.pageErrors, []);
    assert.deepEqual(audit.consoleErrors, []);
    assert.ok(mirror.requestAudit.every((item) => ['GET', 'POST'].includes(item.method)));
    assert.ok(mirror.requestAudit.every((item) => !item.hasAuthorization && !item.hasCookie));

    const result = {
      status: 'PASS', productSha: PRODUCT_SHA, architecture: arch,
      rows: {
        realElectronA: 'PASS', realElectronB: 'PASS', separateUserDataRoots: 'PASS', differentSourceIds: 'PASS',
        realChromeWorkerA: 'PASS', realChromiumWorkerB: 'PASS', canonicalWorkerBindingsExplained: 'PASS',
        bidirectionalSync: 'PASS', membershipVisibility: 'PASS', remoteWorkerPresenceReadOnly: 'PASS',
        crossInstanceLocalControlIsolation: 'PASS', noBrowserSubmission: 'PASS', gracefulShutdown: 'PASS',
        restartSourceStable: 'PASS', restartCursorStable: 'PASS', acknowledgedNoReplay: 'PASS',
        exactFiveS7BridgeMethods: 'PASS', noRemoteControlButtons: 'PASS', pageErrorsZero: 'PASS', consoleErrorsZero: 'PASS', privacySafe: 'PASS',
      },
      sourceA: initialA.sourceInstance.id,
      sourceB: initialB.sourceInstance.id,
      workerPresenceFromA: presenceSummary(sharedA),
      workerPresenceFromB: presenceSummary(sharedB),
      cursorBeforeRestartA: beforeRestartA.cursor,
      cursorAfterRestartA: afterRestartA.cursor,
      cursorBeforeRestartB: beforeRestartB.cursor,
      cursorAfterRestartB: afterRestartB.cursor,
      mirrorRequestAudit: mirror.requestAudit,
      pageErrors: audit.pageErrors,
      consoleErrors: audit.consoleErrors,
      evidenceClass: 'github-hosted-native-apple-silicon-real-electron-two-instance',
    };
    privacyScan(result);
    writeJson('electron-two-instance-audit.json', result);
    writeJson('electron-after-restart.json', {
      status: 'PASS', productSha: PRODUCT_SHA,
      sourceA: afterRestartA.sourceInstance.id, sourceB: afterRestartB.sourceInstance.id,
      cursorA: afterRestartA.cursor, cursorB: afterRestartB.cursor,
      replayA, replayB,
    });
    trace('matrix.evidence-written');
    console.log(JSON.stringify(result, null, 2));

    await closeInstance(a); a = null;
    await closeInstance(b); b = null;
    const residual = sh('ps', ['-axo', 'command']).split('\n').filter((line) => line.includes(userDataA) || line.includes(userDataB));
    assert.deepEqual(residual, []);
    writeJson('electron-cleanup-audit.json', { status: 'PASS', productSha: PRODUCT_SHA, residualScopedProcesses: residual });
    trace('matrix.complete');
  } finally {
    try { await closeInstance(a); } catch (error) { trace('cleanup.close-a-error', { message: error.message }); }
    try { await closeInstance(b); } catch (error) { trace('cleanup.close-b-error', { message: error.message }); }
    await new Promise((resolve) => mirror.server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  try { trace('matrix.failure', { name: error.name, message: error.message, stack: error.stack }); } catch {}
  console.error(error.stack || error);
  process.exitCode = 1;
});
