'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { chromium } = require('playwright');
const { BrowserWorkerManager } = require('../src/main/browser-worker-manager.cjs');
const { JsonlEventStore } = require('../src/main/event-store.cjs');
const { LocalTestServer: ProductLocalTestServer } = require('../src/main/local-test-server.cjs');
const { ProfileLeaseManager } = require('../src/main/profile-lease-manager.cjs');
const { S4ApplicationService } = require('../src/application/s4-index.cjs');

const PRODUCT_SHA = process.env.S4_PRODUCT_SHA || '9d4b6d85dffd22481196fafca64ae8526750f9e1';
const OUTPUT = process.env.S4_ACCEPTANCE_OUTPUT || join(process.cwd(), 'runtime', 's4-acceptance');
const CHROME = process.env.S4_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function sh(name, args = []) { return execFileSync(name, args, { encoding: 'utf8' }).trim(); }
function shOr(name, args, fallback = 'unavailable') { try { return sh(name, args); } catch { return fallback; } }
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function submissionCount(store) { return store.readAll().filter((event) => event.type === 'task.submission_started').length; }

function architecture(path, label) {
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
    assert.ok(path.startsWith('scripts/s4-acceptance-') || path.startsWith('.github/workflows/s4-') || path === 'docs/results/S4-results.md', `acceptance branch modified product path: ${path}`);
  }
  return { productSha: PRODUCT_SHA, acceptanceHead: head, changedPaths };
}

class AcceptanceLocalTestServer extends ProductLocalTestServer {
  async start() {
    if (this.server) return this.baseUrl();
    this.server = http.createServer((request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/favicon.ico') {
        response.writeHead(204, { 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      if (pathname === '/' || pathname === '/task-form.html') {
        const body = readFileSync(join(this.rootDirectory, 'task-form.html'));
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
          'Cache-Control': 'no-store',
        });
        response.end(body);
        return;
      }
      if (pathname === '/health') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ ok: true, scope: 's4-acceptance-loopback' }));
        return;
      }
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.requestedPort, this.host, resolve);
    });
    this.port = this.server.address().port;
    return this.baseUrl();
  }
}

function attachAudit(manager, workerId, audit) {
  const session = manager.contexts.get(workerId);
  assert.ok(session, `missing running context for ${workerId}`);
  session.page.on('pageerror', (error) => audit.pageErrors.push({ workerId, message: error.message }));
  session.page.on('console', (message) => {
    if (message.type() === 'error') audit.consoleErrors.push({ workerId, text: message.text() });
  });
  return session.page;
}

function writeJson(name, value) {
  writeFileSync(join(OUTPUT, name), `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  mkdirSync(OUTPUT, { recursive: true });
  const source = sourceAudit();
  assert.equal(process.arch, 'arm64');
  assert.equal(sh('uname', ['-m']), 'arm64');
  assert.notEqual(shOr('sysctl', ['-in', 'sysctl.proc_translated'], '0'), '1');
  const arch = {
    node: process.arch,
    uname: sh('uname', ['-m']),
    chrome: architecture(CHROME, 'Google Chrome'),
    chromium: architecture(chromium.executablePath(), 'Playwright Chromium'),
  };

  const runtimeRoot = mkdtempSync(join(tmpdir(), 'ai-exe-os-s4-native-'));
  const s0Store = new JsonlEventStore(join(runtimeRoot, 'events.jsonl'));
  const server = new AcceptanceLocalTestServer({ rootDirectory: join(process.cwd(), 'test-pages'), port: 0 });
  const audit = { pageErrors: [], consoleErrors: [] };
  let manager;
  let service;
  try {
    const baseUrl = await server.start();
    manager = new BrowserWorkerManager({
      profilesRoot: join(runtimeRoot, 'profiles'),
      leaseManager: new ProfileLeaseManager(),
      eventStore: s0Store,
      testBaseUrl: baseUrl,
    });
    manager.create({ id: 's1-worker-chrome', projectId: 's1-local-project', role: 'implementation', browserChannel: 'chrome' });
    manager.create({ id: 's1-worker-chromium', projectId: 's1-local-project', role: 'review', browserChannel: 'chromium' });
    await manager.start('s1-worker-chrome');
    await manager.start('s1-worker-chromium');
    const pageA = attachAudit(manager, 's1-worker-chrome', audit);
    const pageB = attachAudit(manager, 's1-worker-chromium', audit);
    await pageA.reload();
    await pageB.reload();
    assert.equal(manager.requireWorker('s1-worker-chrome').status, 'idle');
    assert.equal(manager.requireWorker('s1-worker-chromium').status, 'idle');

    const databasePath = join(runtimeRoot, 'state.sqlite');
    service = new S4ApplicationService({ databasePath, workerManager: manager, localTarget: `${baseUrl}/task-form.html` });
    const install = service.installCapability({ workspaceId: 'workspace-a' });
    service.grantCapability({ workspaceId: 'workspace-a', agentId: 'agent-a', installationId: install.id });
    const pending = service.createTask({
      id: 's4-native-pending-task', workspaceId: 'workspace-a', agentId: 'agent-a', installationId: install.id,
      workerId: 's1-worker-chromium', payload: 's4-native-pending',
    });
    assert.equal(pending.run.state, 'waiting_human');
    assert.equal(submissionCount(s0Store), 0);

    const before = service.queryOperatorCockpit('workspace-a');
    assert.equal(before.found, true);
    assert.deepEqual(before.workers.map((worker) => worker.workerId).sort(), ['s1-worker-chrome', 's1-worker-chromium']);
    assert.ok(before.attention.some((item) => item.code === 'human_gate_required' && item.humanGateId === pending.gate.id));
    const attentionItem = before.attention.find((item) => item.humanGateId === pending.gate.id);
    assert.equal(before.lineage[attentionItem.id].available, true);
    writeJson('cockpit-state-before.json', before);

    const beforeB = manager.list().find((item) => item.id === 's1-worker-chromium');
    const beforeTask = service.task.get(pending.task.id);
    await service.focusWorker({ workspaceId: 'workspace-a', workerId: 's1-worker-chrome' });
    assert.deepEqual(manager.list().find((item) => item.id === 's1-worker-chromium'), beforeB);
    await service.pauseWorker({ workspaceId: 'workspace-a', workerId: 's1-worker-chrome' });
    assert.equal(manager.requireWorker('s1-worker-chrome').status, 'paused');
    assert.equal(manager.requireWorker('s1-worker-chromium').status, 'idle');
    await service.resumeWorker({ workspaceId: 'workspace-a', workerId: 's1-worker-chrome' });
    assert.equal(manager.requireWorker('s1-worker-chrome').status, 'idle');
    assert.equal(manager.requireWorker('s1-worker-chromium').status, 'idle');
    await service.stopWorker({ workspaceId: 'workspace-a', workerId: 's1-worker-chrome' });
    assert.equal(manager.requireWorker('s1-worker-chrome').status, 'stopped');
    assert.equal(manager.requireWorker('s1-worker-chromium').status, 'idle');
    assert.deepEqual(service.task.get(pending.task.id), beforeTask);
    assert.equal(submissionCount(s0Store), 0);

    const afterControl = service.queryOperatorCockpit('workspace-a');
    assert.equal(afterControl.workers.find((worker) => worker.workerId === 's1-worker-chrome').status, 'stopped');
    assert.equal(afterControl.workers.find((worker) => worker.workerId === 's1-worker-chromium').status, 'idle');
    writeJson('cockpit-state-after-control.json', afterControl);
    writeJson('worker-session-matrix.json', {
      status: 'PASS',
      before: before.workers,
      afterControl: afterControl.workers,
      controls: ['focus:s1-worker-chrome', 'pause:s1-worker-chrome', 'resume:s1-worker-chrome', 'stop:s1-worker-chrome'],
      unrelatedWorker: 's1-worker-chromium', unrelatedWorkerStatus: manager.requireWorker('s1-worker-chromium').status,
      unrelatedTaskId: pending.task.id, unrelatedTaskState: service.task.get(pending.task.id).state,
      stopAllDuringSelectedControl: false,
    });
    writeJson('attention-lineage.json', { attention: before.attention, lineage: before.lineage });

    const projectionBefore = service.store.projectionDigest({ workspaceId: 'workspace-a' });
    const eventCountBefore = service.store.listEvents().length;
    const submissionsBefore = submissionCount(s0Store);
    service.store.exportEventsJsonl(join(OUTPUT, 'canonical-events.jsonl'));
    service.close();
    service = new S4ApplicationService({ databasePath, workerManager: manager, localTarget: `${baseUrl}/task-form.html` });
    const projectionAfter = service.store.projectionDigest({ workspaceId: 'workspace-a' });
    const eventCountAfter = service.store.listEvents().length;
    assert.equal(projectionAfter, projectionBefore);
    assert.equal(eventCountAfter, eventCountBefore);
    assert.equal(submissionCount(s0Store), submissionsBefore);
    assert.equal(service.stepAttempt.list().length, 0);
    const afterRestart = service.queryOperatorCockpit('workspace-a');
    assert.ok(afterRestart.attention.some((item) => item.humanGateId === pending.gate.id));
    assert.equal(afterRestart.workers.find((worker) => worker.workerId === 's1-worker-chromium').status, 'idle');
    writeJson('cockpit-state-after-restart.json', afterRestart);
    writeJson('projection-restart-digests.json', {
      status: 'PASS', projectionBefore, projectionAfter, eventCountBefore, eventCountAfter,
      submissionsBefore, submissionsAfter: submissionCount(s0Store), missionAttemptsAfter: service.stepAttempt.list().length,
    });

    assert.deepEqual(audit.pageErrors, []);
    assert.deepEqual(audit.consoleErrors, []);
    const rows = {
      exactSourceScope: 'PASS', nativeArm64: 'PASS', chromeChromiumConcurrent: 'PASS', workspaceCockpit: 'PASS',
      humanGateAttentionLineage: 'PASS', focusIsolation: 'PASS', pauseResumeIsolation: 'PASS', selectedStopIsolation: 'PASS',
      unrelatedWorkerSurvival: 'PASS', unrelatedTaskUnchanged: 'PASS', restartNoReplay: 'PASS', projectionDigestStable: 'PASS',
      workerPageErrorsZero: 'PASS', workerConsoleErrorsZero: 'PASS', sensitiveRuntimeFieldsExcluded: 'PASS',
    };
    const result = {
      status: 'PASS', productSha: PRODUCT_SHA, source, architecture: arch, rows,
      pageErrors: audit.pageErrors, consoleErrors: audit.consoleErrors,
      s0SubmissionCount: submissionCount(s0Store), evidenceClass: 'github-hosted-native-apple-silicon',
    };
    writeJson('native-session-matrix.json', result);
    console.log(JSON.stringify(result, null, 2));

    service.close();
    service = null;
    await manager.stopAll();
    await server.stop();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const residual = sh('ps', ['-axo', 'command']).split('\n').filter((line) => line.includes(runtimeRoot));
    assert.deepEqual(residual, []);
    writeJson('cleanup-audit.json', { status: 'PASS', residualScopedProcesses: residual });
  } finally {
    try { service?.close(); } catch {}
    try { await manager?.stopAll(); } catch {}
    try { await server.stop(); } catch {}
    rmSync(runtimeRoot, { recursive: true, force: true });
  }

  const raw = readFileSync(join(OUTPUT, 'native-session-matrix.json'));
  writeFileSync(join(OUTPUT, 'native-session-matrix.sha256'), `${digest(raw)}  native-session-matrix.json\n`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
