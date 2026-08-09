'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { _electron: electron, chromium } = require('playwright');
const electronExecutable = require('electron');
const { DelegationExchangeMirror } = require('../src/delegation/transport/mirror.cjs');

const PRODUCT_SHA = process.env.S8_PRODUCT_SHA || 'ad69c480106f517970e9c851ee32255cf48e94e1';
const OUTPUT = process.env.S8_ACCEPTANCE_OUTPUT || join(process.cwd(), 'runtime', 's8-acceptance');
const CHROME = process.env.S8_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TRACE = join(OUTPUT, 'electron-trace.jsonl');
const WORKSPACE = 'workspace-a';

function sh(name, args = []) { return execFileSync(name, args, { encoding: 'utf8' }).trim(); }
function shOr(name, args, fallback = 'unavailable') { try { return sh(name, args); } catch { return fallback; } }
function writeJson(name, value) { writeFileSync(join(OUTPUT, name), `${JSON.stringify(value, null, 2)}\n`); }
function trace(stage, detail = {}) {
  const row = { at: new Date().toISOString(), stage, ...detail };
  appendFileSync(TRACE, `${JSON.stringify(row)}\n`);
  console.log(`[S8-F] ${stage}`, JSON.stringify(detail));
}
function digest(value) { return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
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
  if (typeof value === 'object') for (const [key, nested] of Object.entries(value)) {
    if (forbiddenKey.test(key)) throw new Error(`forbidden evidence key ${trail}.${key}`);
    privacyScan(nested, `${trail}.${key}`);
  }
}

function sourceAudit() {
  const head = sh('git', ['rev-parse', 'HEAD']);
  sh('git', ['merge-base', '--is-ancestor', PRODUCT_SHA, head]);
  const changed = shOr('git', ['diff', '--name-only', PRODUCT_SHA, head], '');
  const changedPaths = changed ? changed.split('\n').filter(Boolean) : [];
  for (const path of changedPaths) {
    assert.ok(path === 'scripts/s8-acceptance-electron-two-instance.cjs' || path === '.github/workflows/s8-native-two-instance-acceptance.yml' || path === 'docs/results/S8-results.md', `S8-F carrier modified product path: ${path}`);
  }
  return { productSha: PRODUCT_SHA, acceptanceHead: head, changedPaths };
}

async function readBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 256 * 1024) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response, status, value) {
  const encoded = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': encoded.length });
  response.end(encoded);
}

async function startExchangeServer() {
  const mirror = new DelegationExchangeMirror();
  const requestAudit = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    requestAudit.push({
      method: request.method,
      pathname: url.pathname,
      hasAuthorization: Boolean(request.headers.authorization),
      hasCookie: Boolean(request.headers.cookie),
      contentType: request.headers['content-type'] || null,
    });
    try {
      if (request.method === 'POST' && url.pathname.endsWith('/delegations/requests')) {
        const body = await readBody(request); return sendJson(response, 200, mirror.appendRequest(body.request));
      }
      if (request.method === 'GET' && url.pathname.endsWith('/delegations/inbox')) {
        return sendJson(response, 200, mirror.readInbox({
          destinationInstanceId: url.searchParams.get('destinationInstanceId'),
          destinationWorkspaceId: url.searchParams.get('destinationWorkspaceId'),
          sinceSequence: Number(url.searchParams.get('sinceSequence') || 0),
        }));
      }
      if (request.method === 'POST' && url.pathname.endsWith('/delegations/acks')) {
        const body = await readBody(request); return sendJson(response, 200, mirror.recordAck(body));
      }
      if (request.method === 'POST' && url.pathname.endsWith('/delegations/receipts')) {
        const body = await readBody(request); return sendJson(response, 200, mirror.appendReceipt(body.receipt));
      }
      if (request.method === 'GET' && url.pathname.endsWith('/delegations/receipts')) {
        return sendJson(response, 200, mirror.readReceipts({
          sourceInstanceId: url.searchParams.get('sourceInstanceId'),
          sourceWorkspaceId: url.searchParams.get('sourceWorkspaceId'),
          sinceRevision: Number(url.searchParams.get('sinceRevision') || 0),
        }));
      }
      if (request.method === 'POST' && url.pathname.endsWith('/delegations/cancellations')) {
        const body = await readBody(request); return sendJson(response, 200, mirror.appendCancellation(body.cancellationProposal));
      }
      if (request.method === 'GET' && url.pathname.endsWith('/delegations/cancellations')) {
        return sendJson(response, 200, mirror.readCancellations({
          destinationInstanceId: url.searchParams.get('destinationInstanceId'),
          destinationWorkspaceId: url.searchParams.get('destinationWorkspaceId'),
          sinceSequence: Number(url.searchParams.get('sinceSequence') || 0),
        }));
      }
      sendJson(response, 404, { error: 'not_found' });
    } catch (error) {
      sendJson(response, 400, { error: error.message, reasonCode: error.reasonCode || null });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { mirror, requestAudit, server, endpoint: `http://127.0.0.1:${server.address().port}/v1/` };
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
      AI_EXE_OS_DELEGATION_ENDPOINT: endpoint,
      AI_EXE_OS_DELEGATION_ALLOW_LOOPBACK: '1',
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
  await page.waitForFunction(() => !!window.aiExecutionOS?.s8?.delegation);
  await page.waitForSelector('#s8-delegation-panel', { timeout: 20000 });
  const methods = await page.evaluate(() => Object.keys(window.aiExecutionOS.s8.delegation).sort());
  assert.deepEqual(methods, [
    'approveDelegationProposal','consumeDelegationReceipt','createDelegationRequest','proposeDelegationCancellation',
    'pullDelegationInbox','pullDelegationReceipts','pushDelegationRequest','queryState','recordDelegationPolicy',
    'recordPeerBinding','rejectDelegationProposal','resolveDelegationCancellation',
  ].sort());
  trace('launch.ready', { label, methods });
  return { app, page, label, userData, testPort };
}

const queryDelegation = (instance) => instance.page.evaluate((workspaceId) => window.aiExecutionOS.s8.delegation.queryState(workspaceId), WORKSPACE);
const queryMission = (instance) => instance.page.evaluate((workspaceId) => window.aiExecutionOS.s2.mission.queryState(workspaceId), WORKSPACE);
const queryS1 = (instance) => instance.page.evaluate((workspaceId) => window.aiExecutionOS.s1.queryState(workspaceId), WORKSPACE);

async function createAndStartWorker(instance, input) {
  return instance.page.evaluate(async (worker) => {
    await window.aiExecutionOS.createWorker(worker);
    return window.aiExecutionOS.startWorker(worker.id);
  }, input);
}

async function setupBilateral(source, destination, destinationTarget) {
  const sourceState = await queryDelegation(source);
  const destinationState = await queryDelegation(destination);
  assert.notEqual(sourceState.localInstanceId, destinationState.localInstanceId);
  const peer = {
    id: 'peer-a-to-b',
    workspaceId: WORKSPACE,
    sourceInstanceId: sourceState.localInstanceId,
    sourceWorkspaceId: WORKSPACE,
    destinationInstanceId: destinationState.localInstanceId,
    destinationWorkspaceId: WORKSPACE,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await source.page.evaluate((value) => window.aiExecutionOS.s8.delegation.recordPeerBinding(value), peer);
  await destination.page.evaluate((value) => window.aiExecutionOS.s8.delegation.recordPeerBinding(value), peer);
  const install = await destination.page.evaluate(() => window.aiExecutionOS.s1.installCapability({ workspaceId: 'workspace-a', packageId: 'local.form-submit', version: '1.0.0' }));
  await destination.page.evaluate(({ installationId, target }) => window.aiExecutionOS.s1.grantCapability({
    workspaceId: 'workspace-a', agentId: 'agent-a', installationId, allowedActions: ['submit_payload'], allowedTargets: [target],
  }), { installationId: install.id, target: destinationTarget });
  const now = Date.now();
  await destination.page.evaluate((policy) => window.aiExecutionOS.s8.delegation.recordDelegationPolicy(policy), {
    id: 'policy-a-to-b-v1', version: '1.0.0', peerBindingId: peer.id, destinationWorkspaceId: WORKSPACE, workspaceId: WORKSPACE,
    status: 'active', allowedCapabilityVersionIds: ['local.form-submit@1.0.0'], allowedActions: ['submit_payload'],
    allowedTargets: [destinationTarget], maxPendingRequests: 8, maxAcceptedNotStarted: 2,
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 6 * 60 * 60 * 1000).toISOString(),
  });
  return { peer, sourceInstanceId: sourceState.localInstanceId, destinationInstanceId: destinationState.localInstanceId };
}

async function createRequest(source, target, message, policyId = 'policy-a-to-b-v1') {
  return source.page.evaluate(({ target, message, policyId }) => window.aiExecutionOS.s8.delegation.createDelegationRequest({
    workspaceId: 'workspace-a', peerBindingId: 'peer-a-to-b', policyId, policyVersion: '1.0.0',
    capabilityVersionId: 'local.form-submit@1.0.0', action: 'submit_payload', target,
    payloadClass: 'bounded-input', payload: { message },
  }), { target, message, policyId });
}

async function push(source, requestId) {
  return source.page.evaluate((id) => window.aiExecutionOS.s8.delegation.pushDelegationRequest({ workspaceId: 'workspace-a', requestId: id }), requestId);
}
async function pullInbox(destination) {
  return destination.page.evaluate(() => window.aiExecutionOS.s8.delegation.pullDelegationInbox({ workspaceId: 'workspace-a' }));
}

function findNested(value, predicate, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (!Array.isArray(value) && predicate(value)) return value;
  for (const nested of Array.isArray(value) ? value : Object.values(value)) {
    const found = findNested(nested, predicate, seen);
    if (found) return found;
  }
  return null;
}

async function screenshot(instance, filename) {
  await instance.page.click('#refresh');
  await instance.page.waitForSelector('#s8-delegation-panel');
  const panelText = await instance.page.locator('#s8-delegation-panel').innerText();
  for (const text of ['Controlled Remote Execution Delegation','Remote source cannot decide this gate','Post-start remote cancellation is non-authoritative','Local Execution Binding','Receipts / Evidence']) {
    assert.ok(panelText.includes(text), `missing S8 UI text: ${text}`);
  }
  await instance.page.screenshot({ path: join(OUTPUT, filename), fullPage: true });
  return panelText;
}

async function closeInstance(instance) {
  if (!instance?.app) return;
  await instance.app.close();
  await new Promise((resolve) => setTimeout(resolve, 900));
}

function scopedProcesses(root) {
  const output = shOr('ps', ['-axo', 'pid=,command='], '');
  return output.split('\n').map((line) => line.trim()).filter((line) => line && line.includes(root)).map((line) => ({ commandClass: line.includes('Google Chrome') ? 'chrome' : line.includes('Chromium') ? 'chromium' : line.includes('Electron') ? 'electron' : 'scoped-process' }));
}

async function main() {
  mkdirSync(OUTPUT, { recursive: true });
  writeFileSync(TRACE, '');
  const source = sourceAudit();
  assert.equal(process.arch, 'arm64');
  assert.equal(sh('uname', ['-m']), 'arm64');
  assert.notEqual(shOr('sysctl', ['-in', 'sysctl.proc_translated'], '0'), '1');
  const arch = { node: process.arch, uname: sh('uname', ['-m']), chrome: architecture(CHROME, 'Google Chrome'), chromium: architecture(chromium.executablePath(), 'Playwright Chromium') };

  const root = mkdtempSync(join(tmpdir(), 'ai-exe-os-s8-electron-'));
  const userDataA = join(root, 'instance-a');
  const userDataB = join(root, 'instance-b');
  const exchange = await startExchangeServer();
  const audit = createAudit();
  const testPortA = await freePort();
  const testPortB = await freePort();
  const targetB = `http://127.0.0.1:${testPortB}/task-form.html`;
  let a;
  let b;
  let beforeRestart;
  try {
    a = await launchInstance({ label: 'A', userData: userDataA, testPort: testPortA, endpoint: exchange.endpoint, audit });
    b = await launchInstance({ label: 'B', userData: userDataB, testPort: testPortB, endpoint: exchange.endpoint, audit });
    const bilateral = await setupBilateral(a, b, targetB);
    trace('bilateral.ready', bilateral);

    await createAndStartWorker(a, { id: 's1-worker-chrome', projectId: 's1-local-project', role: 'implementation', browserChannel: 'chrome' });
    await createAndStartWorker(b, { id: 's1-worker-chromium', projectId: 's1-local-project', role: 'review', browserChannel: 'chromium' });

    const first = await createRequest(a, targetB, 'reject-me');
    await push(a, first.id);
    await pullInbox(b);
    let stateB = await queryDelegation(b);
    const firstProposal = stateB.incomingProposals.find((item) => item.delegationRequestId === first.id);
    assert.equal(firstProposal.state, 'waiting_human');
    assert.equal(stateB.executionBindings.length, 0);
    const rejected = await b.page.evaluate((proposalId) => window.aiExecutionOS.s8.delegation.rejectDelegationProposal({ workspaceId: 'workspace-a', proposalId }), firstProposal.id);
    assert.equal(rejected.proposal.state, 'rejected');
    assert.equal((await queryDelegation(b)).executionBindings.length, 0);

    const missingPolicy = await createRequest(a, targetB, 'missing-policy', 'policy-missing-v1');
    await push(a, missingPolicy.id);
    await pullInbox(b);
    stateB = await queryDelegation(b);
    const missingProposal = stateB.incomingProposals.find((item) => item.delegationRequestId === missingPolicy.id);
    assert.ok(missingProposal);
    assert.notEqual(missingProposal.state, 'waiting_human');
    assert.match(String(missingProposal.reasonCode || ''), /policy/i);

    const second = await createRequest(a, targetB, 'execute exactly once');
    await push(a, second.id);
    await pullInbox(b);
    stateB = await queryDelegation(b);
    const secondProposal = stateB.incomingProposals.find((item) => item.delegationRequestId === second.id);
    assert.equal(secondProposal.state, 'waiting_human');
    const accepted = await b.page.evaluate((proposalId) => window.aiExecutionOS.s8.delegation.approveDelegationProposal({ workspaceId: 'workspace-a', proposalId }), secondProposal.id);
    assert.equal(accepted.proposal.state, 'bound');
    assert.ok(accepted.binding.localExecutionRunId);
    const repeatedAcceptance = await b.page.evaluate((proposalId) => window.aiExecutionOS.s8.delegation.approveDelegationProposal({ workspaceId: 'workspace-a', proposalId }), secondProposal.id);
    assert.equal(repeatedAcceptance.binding.id, accepted.binding.id);
    stateB = await queryDelegation(b);
    assert.equal(stateB.executionBindings.filter((item) => item.delegationRequestId === second.id).length, 1);

    const s1State = await queryS1(b);
    const actionGate = findNested(s1State, (item) => item.id && item.executionRunId === accepted.binding.localExecutionRunId && item.state === 'requested');
    assert.ok(actionGate, 'destination S1 action HumanGate not found');
    const executed = await b.page.evaluate((gateId) => window.aiExecutionOS.s1.approveHumanGate({ gateId }), actionGate.id);
    assert.equal(executed.delegationReceipt.state, 'completed');

    const sourceMissionBeforePull = JSON.stringify(await queryMission(a));
    const pullReceipts = await a.page.evaluate(() => window.aiExecutionOS.s8.delegation.pullDelegationReceipts({ workspaceId: 'workspace-a' }));
    assert.equal(pullReceipts.accepted, 1);
    assert.equal(JSON.stringify(await queryMission(a)), sourceMissionBeforePull, 'receipt pull mutated source canonical S2 truth');
    const stateAWithReceipt = await queryDelegation(a);
    const mirroredReceipt = stateAWithReceipt.receipts.find((item) => item.direction === 'inbound' && item.delegationRequestId === second.id);
    assert.ok(mirroredReceipt);
    const consumed = await a.page.evaluate((receiptMirrorId) => window.aiExecutionOS.s8.delegation.consumeDelegationReceipt({ workspaceId: 'workspace-a', receiptMirrorId }), mirroredReceipt.id);
    const repeatedConsumption = await a.page.evaluate((receiptMirrorId) => window.aiExecutionOS.s8.delegation.consumeDelegationReceipt({ workspaceId: 'workspace-a', receiptMirrorId }), mirroredReceipt.id);
    assert.equal(repeatedConsumption.id, consumed.id);
    assert.equal((await queryDelegation(a)).receiptConsumptions.length, 1);

    const third = await createRequest(a, targetB, 'cancel-before-start');
    await push(a, third.id);
    await pullInbox(b);
    await a.page.evaluate((requestId) => window.aiExecutionOS.s8.delegation.proposeDelegationCancellation({ workspaceId: 'workspace-a', requestId, reasonClass: 'source_withdrawal' }), third.id);
    await pullInbox(b);
    stateB = await queryDelegation(b);
    const preStartCancel = stateB.cancellationProposals.find((item) => item.direction === 'inbound' && item.delegationRequestId === third.id);
    assert.equal(preStartCancel.state, 'pending_local_decision');
    const preStartResolved = await b.page.evaluate((cancellationId) => window.aiExecutionOS.s8.delegation.resolveDelegationCancellation({ workspaceId: 'workspace-a', cancellationId, acceptedLocally: true }), preStartCancel.id);
    assert.equal(preStartResolved.state, 'accepted_locally');

    await a.page.evaluate((requestId) => window.aiExecutionOS.s8.delegation.proposeDelegationCancellation({ workspaceId: 'workspace-a', requestId, reasonClass: 'source_withdrawal' }), second.id);
    await pullInbox(b);
    stateB = await queryDelegation(b);
    const postStartCancel = stateB.cancellationProposals.find((item) => item.direction === 'inbound' && item.delegationRequestId === second.id);
    const postStartResolved = await b.page.evaluate((cancellationId) => window.aiExecutionOS.s8.delegation.resolveDelegationCancellation({ workspaceId: 'workspace-a', cancellationId, acceptedLocally: true }), postStartCancel.id);
    assert.equal(postStartResolved.state, 'non_authoritative_after_start');
    assert.equal(postStartResolved.reasonCode, 'post_start_remote_cancel_non_authoritative');

    await screenshot(a, 's8-instance-a-before-restart.png');
    await screenshot(b, 's8-instance-b-before-restart.png');
    const stateABefore = await queryDelegation(a);
    const stateBBefore = await queryDelegation(b);
    privacyScan(stateABefore);
    privacyScan(stateBBefore);
    beforeRestart = {
      status: 'PASS', productSha: PRODUCT_SHA,
      sourceA: stateABefore.localInstanceId, sourceB: stateBBefore.localInstanceId,
      sourceReceiptConsumptions: stateABefore.receiptConsumptions.length,
      destinationBindings: stateBBefore.executionBindings.map((item) => ({ id: item.id, delegationRequestId: item.delegationRequestId, state: item.state || null })),
      requestAuditCount: exchange.requestAudit.length,
    };
    writeJson('electron-before-restart.json', beforeRestart);
    const networkBeforeRestart = exchange.requestAudit.length;
    await closeInstance(a); a = null;
    await closeInstance(b); b = null;

    a = await launchInstance({ label: 'A-restart', userData: userDataA, testPort: testPortA, endpoint: exchange.endpoint, audit });
    b = await launchInstance({ label: 'B-restart', userData: userDataB, testPort: testPortB, endpoint: exchange.endpoint, audit });
    assert.equal(exchange.requestAudit.length, networkBeforeRestart, 'restart replayed delegation networking before explicit user action');
    const stateAAfter = await queryDelegation(a);
    const stateBAfter = await queryDelegation(b);
    assert.equal(stateAAfter.localInstanceId, beforeRestart.sourceA);
    assert.equal(stateBAfter.localInstanceId, beforeRestart.sourceB);
    assert.equal(stateAAfter.receiptConsumptions.length, 1);
    assert.equal(stateBAfter.executionBindings.filter((item) => item.delegationRequestId === second.id).length, 1);
    await screenshot(a, 's8-instance-a-after-restart.png');
    await screenshot(b, 's8-instance-b-after-restart.png');

    const afterRestart = {
      status: 'PASS', productSha: PRODUCT_SHA,
      sourceA: stateAAfter.localInstanceId, sourceB: stateBAfter.localInstanceId,
      receiptConsumptions: stateAAfter.receiptConsumptions.length,
      executionBindings: stateBAfter.executionBindings.length,
      networkAutomaticallyReplayed: false,
    };
    writeJson('electron-after-restart.json', afterRestart);

    assert.equal(audit.pageErrors.length, 0, `page errors: ${JSON.stringify(audit.pageErrors)}`);
    assert.equal(audit.consoleErrors.length, 0, `console errors: ${JSON.stringify(audit.consoleErrors)}`);
    assert.ok(exchange.requestAudit.some((item) => item.method === 'POST' && item.pathname.endsWith('/delegations/requests')));
    assert.ok(exchange.requestAudit.some((item) => item.method === 'POST' && item.pathname.endsWith('/delegations/receipts')));
    assert.ok(exchange.requestAudit.some((item) => item.method === 'POST' && item.pathname.endsWith('/delegations/cancellations')));
    assert.ok(exchange.requestAudit.every((item) => ['GET', 'POST'].includes(item.method) && !item.hasAuthorization && !item.hasCookie));

    const result = {
      status: 'PASS', productSha: PRODUCT_SHA, source, architecture: arch,
      sourceA: beforeRestart.sourceA, sourceB: beforeRestart.sourceB,
      bilateralPolicyRequired: true,
      missingPolicyFailedClosed: missingProposal.reasonCode,
      localRejectionCreatesExecution: false,
      destinationBindingId: accepted.binding.id,
      duplicateAcceptanceSameBinding: true,
      destinationActionReceiptState: executed.delegationReceipt.state,
      receiptPullMutatedCanonicalSourceTruth: false,
      explicitReceiptConsumptionIdempotent: true,
      preStartCancellationState: preStartResolved.state,
      postStartCancellationState: postStartResolved.state,
      restartNetworkReplay: false,
      pageErrors: audit.pageErrors,
      consoleErrors: audit.consoleErrors,
      requestAudit: exchange.requestAudit,
      evidenceDigest: digest({ bilateral, requestIds: [first.id, missingPolicy.id, second.id, third.id], bindingId: accepted.binding.id, receiptDigest: executed.delegationReceipt.receiptDigest }),
    };
    privacyScan(result);
    writeJson('s8-electron-two-instance-audit.json', result);
  } finally {
    await closeInstance(a);
    await closeInstance(b);
    await new Promise((resolve) => exchange.server.close(resolve));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const residual = scopedProcesses(root);
    const cleanup = { status: residual.length ? 'FAIL' : 'PASS', productSha: PRODUCT_SHA, residualScopedProcesses: residual };
    writeJson('s8-cleanup-audit.json', cleanup);
    try { assert.equal(residual.length, 0, `residual scoped processes: ${JSON.stringify(residual)}`); } finally { rmSync(root, { recursive: true, force: true }); }
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
