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
const { S6SchedulingApplicationService } = require('../src/application/s6-scheduler-service.cjs');
const {
  createSchedulingInputDigest,
  createSchedulingPolicySnapshot,
  rankSchedulingCandidates,
} = require('../src/scheduling/policy/index.cjs');
const {
  createProviderCapacitySnapshot,
  createWorkerCapacitySnapshot,
  providerCapacityReason,
  workerCompatibility,
} = require('../src/scheduling/capacity/index.cjs');
const {
  createAssignmentProposal,
  revalidateAssignmentProposal,
} = require('../src/scheduling/orchestration/index.cjs');

const PRODUCT_SHA = process.env.S6_PRODUCT_SHA || 'b9cce3a331b33c273e5eecd11fa3269fd5c9b135';
const OUTPUT = process.env.S6_ACCEPTANCE_OUTPUT || join(process.cwd(), 'runtime', 's6-acceptance');
const CHROME = process.env.S6_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function sh(name, args = []) { return execFileSync(name, args, { encoding: 'utf8' }).trim(); }
function shOr(name, args, fallback = 'unavailable') { try { return sh(name, args); } catch { return fallback; } }
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function writeJson(name, value) { writeFileSync(join(OUTPUT, name), `${JSON.stringify(value, null, 2)}\n`); }
function submissionCount(store) { return store.readAll().filter((event) => event.type === 'task.submission_started').length; }

function architecture(path, label) {
  assert.ok(existsSync(path), `${label} missing: ${path}`);
  const file = sh('file', ['-b', path]);
  const lipo = shOr('lipo', ['-archs', path]);
  assert.match(`${file} ${lipo}`, /arm64/, `${label} is not arm64-capable`);
  return { file, lipo };
}

function sourceAudit() {
  const head = sh('git', ['rev-parse', 'HEAD']);
  sh('git', ['merge-base', '--is-ancestor', PRODUCT_SHA, head]);
  const raw = shOr('git', ['diff', '--name-only', PRODUCT_SHA, head], '');
  const changedPaths = raw ? raw.split('\n').filter(Boolean) : [];
  for (const path of changedPaths) {
    assert.ok(
      path.startsWith('scripts/s6-acceptance-') || path.startsWith('.github/workflows/s6-') || path === 'docs/results/S6-results.md',
      `acceptance carrier modified product path: ${path}`,
    );
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
        response.end(JSON.stringify({ ok: true, scope: 's6-acceptance-loopback' }));
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

function recordPolicy(service, overrides = {}) {
  return service.recordSchedulingPolicy({
    id: 's6-native-policy-v1', workspaceId: 'workspace-a', version: '1.0.0', status: 'active',
    globalMaxActive: 2, workspaceMaxActive: 2,
    priorityOrder: ['critical', 'high', 'normal', 'low'],
    fairness: { mode: 'bounded-aging', agingIntervalSeconds: 60, maxPriorityBoostSteps: 2 },
    sessionReuse: 'compatible-only', createdAt: '2026-08-08T00:00:00.000Z', ...overrides,
  });
}

function prepareMission(service, baseUrl) {
  const targets = {
    high: `${baseUrl}/task-form.html?s6-slot=high`,
    normal: `${baseUrl}/task-form.html?s6-slot=normal`,
    low: `${baseUrl}/task-form.html?s6-slot=low`,
  };
  const install = service.installCapability({ workspaceId: 'workspace-a', packageId: 'local.form-submit', version: '1.0.0' });
  service.grantCapability({
    workspaceId: 'workspace-a', agentId: 'agent-a', installationId: install.id,
    allowedActions: ['submit_payload'], allowedTargets: Object.values(targets),
  });
  service.createMission({
    id: 's6-native-mission', workspaceId: 'workspace-a', title: 'S6 native bounded scheduling mission',
    objective: 'three canonical ready steps compete for two bounded Worker slots',
  });
  return service.createRevision({
    id: 's6-native-revision', workspaceId: 'workspace-a', missionId: 's6-native-mission', revision: 1,
    objective: 'exercise priority, capacity, locks and HumanGate boundary',
    terminalStepIds: ['step-high', 'step-normal', 'step-low'],
    steps: [
      {
        id: 'step-low', name: 'Low priority Chrome work', agentId: 'agent-a', installationId: install.id,
        capabilityVersionId: 'local.form-submit@1.0.0', action: 'submit_payload', target: targets.low,
        workerId: 's1-worker-chrome', dependsOn: [], declaredInputs: [], declaredOutputs: ['low-result'],
        evidenceRequirements: ['local result text'], humanGatePolicy: 'action', resourceRequirements: [], priority: 'low', payload: 'low',
      },
      {
        id: 'step-normal', name: 'Normal priority Chromium work', agentId: 'agent-a', installationId: install.id,
        capabilityVersionId: 'local.form-submit@1.0.0', action: 'submit_payload', target: targets.normal,
        workerId: 's1-worker-chromium', dependsOn: [], declaredInputs: [], declaredOutputs: ['normal-result'],
        evidenceRequirements: ['local result text'], humanGatePolicy: 'action', resourceRequirements: [], priority: 'normal', payload: 'normal',
      },
      {
        id: 'step-high', name: 'High priority Chrome work', agentId: 'agent-a', installationId: install.id,
        capabilityVersionId: 'local.form-submit@1.0.0', action: 'submit_payload', target: targets.high,
        workerId: 's1-worker-chrome', dependsOn: [], declaredInputs: [], declaredOutputs: ['high-result'],
        evidenceRequirements: ['local result text'], humanGatePolicy: 'action', resourceRequirements: [], priority: 'high', payload: 'high',
      },
    ],
  });
}

function fairnessAndDeterminismEvidence() {
  const policy = createSchedulingPolicySnapshot({
    id: 's6-fairness-policy', workspaceId: 'workspace-a', version: '1.0.0', status: 'active',
    globalMaxActive: 2, workspaceMaxActive: 2,
    priorityOrder: ['critical', 'high', 'normal', 'low'],
    fairness: { mode: 'bounded-aging', agingIntervalSeconds: 60, maxPriorityBoostSteps: 2 },
    sessionReuse: 'compatible-only', createdAt: '2026-08-08T00:00:00.000Z',
  });
  const candidates = [
    { id: 'critical-fresh', workspaceId: 'workspace-a', readyState: 'ready', priority: 'critical', readySince: '2026-08-08T00:04:50.000Z', reusableSessionCompatible: false },
    { id: 'high-fresh', workspaceId: 'workspace-a', readyState: 'ready', priority: 'high', readySince: '2026-08-08T00:04:50.000Z', reusableSessionCompatible: false },
    { id: 'low-aged', workspaceId: 'workspace-a', readyState: 'ready', priority: 'low', readySince: '2026-08-08T00:00:00.000Z', reusableSessionCompatible: false },
  ];
  const evaluatedAt = '2026-08-08T00:05:00.000Z';
  const ranked = rankSchedulingCandidates({ policy, candidates, evaluatedAt });
  const reversed = rankSchedulingCandidates({ policy, candidates: [...candidates].reverse(), evaluatedAt });
  const digestA = createSchedulingInputDigest({ policy, candidates, evaluatedAt });
  const digestB = createSchedulingInputDigest({ policy, candidates: [...candidates].reverse(), evaluatedAt });
  assert.deepEqual(ranked.map((item) => item.id), reversed.map((item) => item.id));
  assert.equal(digestA, digestB);
  assert.equal(ranked[0].id, 'critical-fresh', 'bounded aging must not outrank critical work');
  assert.ok(ranked.findIndex((item) => item.id === 'low-aged') < ranked.findIndex((item) => item.id === 'high-fresh'), 'aged low work should eventually beat fresh high work at the bounded tie');
  assert.equal(ranked.find((item) => item.id === 'low-aged').boundedBoostSteps, 2);
  return { status: 'PASS', evaluatedAt, ranked, digestA, digestB };
}

function conservativeBoundaryEvidence() {
  const providerCandidate = {
    id: 'provider-candidate', workspaceId: 'workspace-a', readyState: 'ready', priority: 'normal', readySince: '2026-08-08T00:00:00.000Z',
    providerRequirement: { providerId: 'provider-a', action: 'observe' }, workerRequirements: {}, requiredResources: [],
  };
  const unknown = providerCapacityReason(providerCandidate, [], '2026-08-08T00:05:00.000Z');
  const staleSnapshot = createProviderCapacitySnapshot({
    id: 'provider-cap-stale', workspaceId: 'workspace-a', providerId: 'provider-a', action: 'observe',
    maxActive: 1, activeObserved: 0, status: 'stale', observedAt: '2026-08-08T00:00:00.000Z',
    expiresAt: '2026-08-08T00:04:00.000Z', source: 'explicit-local-policy',
  });
  const stale = providerCapacityReason(providerCandidate, [staleSnapshot], '2026-08-08T00:05:00.000Z');
  assert.equal(unknown.allowed, false);
  assert.equal(unknown.reasonCode, 'provider_capacity_unknown');
  assert.equal(stale.allowed, false);
  assert.equal(stale.reasonCode, 'provider_capacity_stale');

  const crossWorkspaceWorker = createWorkerCapacitySnapshot({
    workerId: 'worker-b', workspaceId: 'workspace-b', status: 'eligible', browserChannel: 'chrome',
    activeAssignmentCount: 0, reusableSession: true, safeCompatibilityKeys: [],
  });
  const compatibility = workerCompatibility({ ...providerCandidate, providerRequirement: null }, crossWorkspaceWorker);
  assert.equal(compatibility.compatible, false);
  assert.ok(compatibility.reasonCodes.includes('cross_workspace_worker'));

  const proposal = createAssignmentProposal({
    id: 'proposal-stale',
    decision: { id: 'decision-stale', selectedCandidateId: 'provider-candidate', selectedWorkerId: 'worker-a' },
    candidate: { ...providerCandidate, providerRequirement: null, executionIdentity: 'exec-a' },
    authoritySnapshotDigest: `sha256:${'a'.repeat(64)}`,
  });
  const staleProposal = revalidateAssignmentProposal({
    proposal,
    current: {
      authoritySnapshotDigest: `sha256:${'b'.repeat(64)}`, executionIdentity: 'exec-a', candidateReady: true,
      resourceAvailable: true, providerCapacityCurrent: true, humanGateClear: true, priorEffectCertain: true,
    },
  });
  assert.equal(staleProposal.state, 'stale');
  assert.equal(staleProposal.reasonCode, 'stale_authority_snapshot');

  return {
    status: 'PASS',
    unknownProvider: { allowed: unknown.allowed, reasonCode: unknown.reasonCode },
    staleProvider: { allowed: stale.allowed, reasonCode: stale.reasonCode },
    crossWorkspaceCompatibility: compatibility,
    staleProposal: { state: staleProposal.state, reasonCode: staleProposal.reasonCode },
  };
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

  const fairness = fairnessAndDeterminismEvidence();
  const boundaries = conservativeBoundaryEvidence();
  writeJson('fairness-determinism-matrix.json', fairness);
  writeJson('conservative-boundary-matrix.json', boundaries);

  const runtimeRoot = mkdtempSync(join(tmpdir(), 'ai-exe-os-s6-native-'));
  const s0Store = new JsonlEventStore(join(runtimeRoot, 'events.jsonl'));
  const server = new AcceptanceLocalTestServer({ rootDirectory: join(process.cwd(), 'test-pages'), port: 0 });
  const audit = { pageErrors: [], consoleErrors: [] };
  let manager;
  let service;
  try {
    const baseUrl = await server.start();
    manager = new BrowserWorkerManager({
      profilesRoot: join(runtimeRoot, 'profiles'), leaseManager: new ProfileLeaseManager(), eventStore: s0Store, testBaseUrl: baseUrl,
    });
    manager.create({ id: 's1-worker-chrome', projectId: 's1-local-project', role: 'implementation', browserChannel: 'chrome' });
    manager.create({ id: 's1-worker-chromium', projectId: 's1-local-project', role: 'review', browserChannel: 'chromium' });
    await manager.start('s1-worker-chrome');
    await manager.start('s1-worker-chromium');
    const pageA = attachAudit(manager, 's1-worker-chrome', audit);
    const pageB = attachAudit(manager, 's1-worker-chromium', audit);
    await Promise.all([pageA.reload(), pageB.reload()]);
    assert.equal(manager.requireWorker('s1-worker-chrome').status, 'idle');
    assert.equal(manager.requireWorker('s1-worker-chromium').status, 'idle');

    const databasePath = join(runtimeRoot, 'state.sqlite');
    service = new S6SchedulingApplicationService({ databasePath, workerManager: manager, localTarget: `${baseUrl}/task-form.html` });
    recordPolicy(service);
    const revision = prepareMission(service, baseUrl);
    const started = service.startMission({
      workspaceId: 'workspace-a', missionId: 's6-native-mission', revisionId: revision.revision.id, runId: 's6-native-run',
    });
    assert.equal(started.run.state, 'running');

    const missionState = service.queryMissionState('workspace-a');
    const attempts = missionState.stepAttempts.filter((item) => item.missionRunId === 's6-native-run');
    assert.equal(attempts.length, 2, 'three eligible candidates must be bounded to two active assignments');
    assert.deepEqual(attempts.map((item) => item.stepId).sort(), ['step-high', 'step-normal']);
    assert.ok(attempts.every((item) => item.state === 'waiting_human'));
    assert.equal(missionState.humanGates.filter((item) => item.state === 'requested').length, 2);
    const readPlan = missionState.plans.find((item) => item.id === revision.plan.id);
    assert.equal(readPlan.steps.find((item) => item.id === 'step-low').state, 'ready');
    assert.equal(submissionCount(s0Store), 0, 'HumanGate boundary must prevent browser submission');

    const scheduling = service.querySchedulingState('workspace-a');
    assert.equal(scheduling.capacity.globalActive, 2);
    assert.equal(scheduling.capacity.workspaceActive, 2);
    assert.equal(scheduling.capacity.globalMaxActive, 2);
    assert.equal(scheduling.capacity.workspaceMaxActive, 2);
    assert.equal(scheduling.eligibleQueue.length, 1);
    assert.equal(scheduling.eligibleQueue[0].priority, 'low');
    assert.equal(scheduling.proposals.filter((item) => item.state === 'accepted').length, 2);
    assert.ok(scheduling.decisions.some((item) => item.selectedCandidateId === null && item.reasonCodes.includes('no_assignment')));
    assert.equal(service.locks.list().filter((item) => item.resourceType === 'browser_profile').length, 2);
    assert.equal(service.locks.list().filter((item) => item.resourceType === 'provider_surface').length, 2);

    const cockpit = service.queryOperatorCockpit('workspace-a');
    assert.equal(cockpit.scheduling.policy.id, 's6-native-policy-v1');
    assert.equal(cockpit.scheduling.eligibleQueue.length, 1);
    assert.ok(cockpit.scheduling.deferred.length >= 1);
    writeJson('native-scheduling-state.json', {
      status: 'PASS', productSha: PRODUCT_SHA,
      policy: scheduling.policy,
      capacity: scheduling.capacity,
      eligibleQueue: scheduling.eligibleQueue,
      deferred: scheduling.deferred,
      decisions: scheduling.decisions,
      proposals: scheduling.proposals,
      attempts: attempts.map((item) => ({ id: item.id, stepId: item.stepId, state: item.state, workerId: item.workerId })),
      humanGates: missionState.humanGates.map((item) => ({ id: item.id, state: item.state })),
      lockSummary: service.locks.list().map((item) => ({ resourceType: item.resourceType, resourceKeyDigest: digest(item.resourceKey) })),
    });
    writeJson('cockpit-scheduling-state.json', {
      status: 'PASS', productSha: PRODUCT_SHA,
      scheduling: cockpit.scheduling,
      attention: cockpit.attention,
    });

    const projectionBefore = service.store.projectionDigest({ workspaceId: 'workspace-a' });
    const eventCountBefore = service.store.listEvents().length;
    const decisionCountBefore = service.schedulingDecision.list().length;
    const proposalCountBefore = service.assignmentProposal.list().length;
    const attemptCountBefore = service.stepAttempt.list().length;
    const submissionsBefore = submissionCount(s0Store);
    service.store.exportEventsJsonl(join(OUTPUT, 'canonical-events.jsonl'));
    service.close();
    service = new S6SchedulingApplicationService({ databasePath, workerManager: manager, localTarget: `${baseUrl}/task-form.html` });
    const projectionAfter = service.store.projectionDigest({ workspaceId: 'workspace-a' });
    const eventCountAfter = service.store.listEvents().length;
    const decisionCountAfter = service.schedulingDecision.list().length;
    const proposalCountAfter = service.assignmentProposal.list().length;
    const attemptCountAfter = service.stepAttempt.list().length;
    const submissionsAfter = submissionCount(s0Store);
    assert.equal(projectionAfter, projectionBefore);
    assert.equal(eventCountAfter, eventCountBefore);
    assert.equal(decisionCountAfter, decisionCountBefore);
    assert.equal(proposalCountAfter, proposalCountBefore);
    assert.equal(attemptCountAfter, attemptCountBefore);
    assert.equal(submissionsAfter, submissionsBefore);
    const restartState = service.querySchedulingState('workspace-a');
    assert.equal(restartState.decisions.length, decisionCountBefore);
    assert.equal(restartState.proposals.length, proposalCountBefore);
    writeJson('projection-restart-digests.json', {
      status: 'PASS', productSha: PRODUCT_SHA,
      projectionBefore, projectionAfter, eventCountBefore, eventCountAfter,
      decisionCountBefore, decisionCountAfter, proposalCountBefore, proposalCountAfter,
      attemptCountBefore, attemptCountAfter, submissionsBefore, submissionsAfter,
    });

    assert.deepEqual(audit.pageErrors, []);
    assert.deepEqual(audit.consoleErrors, []);
    const result = {
      status: 'PASS', productSha: PRODUCT_SHA, source, architecture: arch,
      rows: {
        exactSourceScope: 'PASS', nativeArm64: 'PASS', dualWorkerSessions: 'PASS', candidatesGreaterThanCapacity: 'PASS',
        priorityStable: 'PASS', boundedFairness: 'PASS', deterministicDigest: 'PASS', globalWorkspaceCaps: 'PASS',
        s1ResourceLocksFinal: 'PASS', humanGateNoStart: 'PASS', unknownProviderFailClosed: 'PASS', staleProviderFailClosed: 'PASS',
        crossWorkspaceReuseFailClosed: 'PASS', staleProposalRejected: 'PASS', restartNoReplay: 'PASS', cockpitExplanation: 'PASS',
        workerPageErrorsZero: 'PASS', workerConsoleErrorsZero: 'PASS', privacySafeEvidence: 'PASS',
      },
      pageErrors: audit.pageErrors, consoleErrors: audit.consoleErrors,
      activeAssignments: attempts.length, remainingEligibleCandidates: scheduling.eligibleQueue.length,
      s0SubmissionCount: submissionCount(s0Store), evidenceClass: 'github-hosted-native-apple-silicon',
    };
    writeJson('native-scheduling-matrix.json', result);
    console.log(JSON.stringify(result, null, 2));

    service.close();
    service = null;
    await manager.stopAll();
    await server.stop();
    await new Promise((resolve) => setTimeout(resolve, 750));
    const residual = sh('ps', ['-axo', 'command']).split('\n').filter((line) => line.includes(runtimeRoot));
    assert.deepEqual(residual, []);
    writeJson('cleanup-audit.json', { status: 'PASS', productSha: PRODUCT_SHA, residualScopedProcesses: residual });
  } finally {
    try { service?.close(); } catch {}
    try { await manager?.stopAll(); } catch {}
    try { await server.stop(); } catch {}
    rmSync(runtimeRoot, { recursive: true, force: true });
  }

  const raw = readFileSync(join(OUTPUT, 'native-scheduling-matrix.json'));
  writeFileSync(join(OUTPUT, 'native-scheduling-matrix.sha256'), `${digest(raw)}  native-scheduling-matrix.json\n`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
