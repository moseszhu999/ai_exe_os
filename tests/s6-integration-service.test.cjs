'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { S6ApplicationService, resourceIdentifier } = require('../src/application/s6-index.cjs');

class FakeWorkerManager {
  constructor(workers = []) {
    this.workers = workers;
    this.startCalls = 0;
    this.submitCalls = 0;
  }
  list() { return this.workers.map((item) => ({ ...item })); }
  async start() { this.startCalls += 1; throw new Error('S6 must not start Worker'); }
  async focus() { throw new Error('unused'); }
  async stop() { throw new Error('unused'); }
  pause() { throw new Error('unused'); }
  resume() { throw new Error('unused'); }
  async submitAuthorizedLocalTask() { this.submitCalls += 1; throw new Error('S6 must not submit runtime task'); }
}

function readyRecord(id, overrides = {}) {
  return {
    id,
    workspaceId: 'workspace-a',
    workspaceStatus: 'active',
    readyState: 'ready',
    missionState: 'active',
    dependenciesSatisfied: true,
    authorityValid: true,
    humanGateClear: true,
    executionIdentityCurrent: true,
    resourceRequirementsDeclared: true,
    providerUseAccepted: true,
    priorEffectState: 'none',
    sourceKind: 'plan_step',
    sourceId: `${id}-step`,
    executionIdentity: `${id}-execution`,
    readySince: '2026-08-08T00:00:00.000Z',
    priority: 'normal',
    requiredResources: [],
    providerRequirement: null,
    workerRequirements: {},
    ...overrides,
  };
}

class HarnessS6ApplicationService extends S6ApplicationService {
  constructor(options = {}) {
    super(options);
    this.harnessRecords = options.harnessRecords || [];
  }
  deriveCanonicalSchedulingRecords(workspaceId) {
    this.requireS6Workspace(workspaceId);
    return Object.freeze(this.harnessRecords.filter((item) => item.workspaceId === workspaceId).map((item) => ({ ...item })));
  }
}

function worker(id, status = 'idle', browserChannel = 'chrome') {
  return { id, projectId: 's1-local-project', role: 'implementation', status, browserChannel, profilePath: `/private/${id}`, processId: 999 };
}

function createService({ databasePath = ':memory:', records = [], workers, clock = () => '2026-08-08T00:05:00.000Z' } = {}) {
  const workerManager = new FakeWorkerManager(workers || [worker('s1-worker-chrome'), worker('s1-worker-chromium', 'idle', 'chromium')]);
  const service = new HarnessS6ApplicationService({ databasePath, workerManager, clock, harnessRecords: records });
  return { service, workerManager };
}

function recordPolicy(service, overrides = {}) {
  return service.recordSchedulingPolicy({
    id: 's6-policy-workspace-a-v1',
    workspaceId: 'workspace-a',
    version: '1.0.0',
    status: 'active',
    globalMaxActive: 2,
    workspaceMaxActive: 1,
    priorityOrder: ['critical', 'high', 'normal', 'low'],
    fairness: { mode: 'bounded-aging', agingIntervalSeconds: 60, maxPriorityBoostSteps: 2 },
    sessionReuse: 'compatible-only',
    createdAt: '2026-08-08T00:00:00.000Z',
    ...overrides,
  });
}

test('S6 persists one immutable Workspace policy and privacy-safe worker capacity', () => {
  const { service } = createService();
  const policy = recordPolicy(service);
  assert.match(policy.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(service.recordSchedulingPolicy({
    id: policy.id,
    workspaceId: policy.workspaceId,
    version: policy.version,
    status: policy.status,
    globalMaxActive: policy.globalMaxActive,
    workspaceMaxActive: policy.workspaceMaxActive,
    priorityOrder: policy.priorityOrder,
    fairness: policy.fairness,
    sessionReuse: policy.sessionReuse,
    createdAt: policy.createdAt,
  }).id, policy.id);
  assert.throws(() => recordPolicy(service, { id: 'second-active-policy' }), /already has an active/);
  const state = service.querySchedulingState('workspace-a');
  assert.equal(state.policy.id, policy.id);
  assert.equal(state.capacity.globalMaxActive, 2);
  assert.equal(state.capacity.workspaceMaxActive, 1);
  assert.equal(state.workers.length, 2);
  const raw = JSON.stringify(state.workers);
  assert.doesNotMatch(raw, /profilePath|processId|\/private\//i);
  assert.match(raw, /profile-worker-s1-worker-chrome/);
  service.close();
});

test('S6 computes deterministic bounded proposal without starting or submitting runtime work', () => {
  const records = [
    readyRecord('candidate-normal', { priority: 'normal', readySince: '2026-08-08T00:04:30.000Z' }),
    readyRecord('candidate-high', { priority: 'high', readySince: '2026-08-08T00:04:50.000Z' }),
  ];
  const { service, workerManager } = createService({ records });
  recordPolicy(service);
  const result = service.computeSchedulingDecisionForWorkspace({ workspaceId: 'workspace-a', id: 'decision-one', proposalId: 'proposal-one' });
  assert.equal(result.decision.selectedCandidateId, 'candidate-high');
  assert.equal(result.decision.selectedWorkerId, 's1-worker-chrome');
  assert.equal(result.proposal.state, 'proposed');
  assert.equal(workerManager.startCalls, 0);
  assert.equal(workerManager.submitCalls, 0);
  assert.match(result.decision.inputDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.decision.decisionDigest, /^sha256:[a-f0-9]{64}$/);

  const accepted = service.revalidateSchedulingProposal({ workspaceId: 'workspace-a', proposalId: result.proposal.id });
  assert.equal(accepted.state, 'accepted');
  assert.equal(accepted.reasonCode, 'accepted_current');
  assert.equal(workerManager.startCalls, 0);
  assert.equal(workerManager.submitCalls, 0);
  service.close();
});

test('waiting_human and uncertain canonical records never enter S6 eligible queue', () => {
  const { service } = createService({ records: [
    readyRecord('candidate-ready'),
    readyRecord('candidate-human', { readyState: 'waiting_human', humanGateClear: false }),
    readyRecord('candidate-uncertain', { priorEffectState: 'uncertain' }),
  ] });
  recordPolicy(service);
  const state = service.querySchedulingState('workspace-a');
  assert.deepEqual(state.eligibleQueue.map((item) => item.id), ['candidate-ready']);
  assert.equal(state.deferred.some((item) => item.candidateId === 'candidate-human' && item.reasonCodes.includes('human_gate_required')), true);
  assert.equal(state.deferred.some((item) => item.candidateId === 'candidate-uncertain' && item.reasonCodes.includes('uncertain_execution')), true);
  service.close();
});

test('unknown provider capacity and held S1 resources fail closed', () => {
  const lockedResource = { type: 'browser_profile', key: 's1-worker-chrome' };
  const lockedId = resourceIdentifier(lockedResource);
  const records = [readyRecord('candidate-provider', {
    providerRequirement: { providerId: 'vercel', action: 'observe_public_deployment' },
    requiredResources: [lockedId],
  })];
  const { service } = createService({ records });
  recordPolicy(service);
  service.locks.acquireAll({
    workspaceId: 'workspace-a', taskId: 'other-task', executionRunId: 'other-run', resources: [lockedResource], acquiredAt: '2026-08-08T00:01:00.000Z',
  });
  const result = service.computeSchedulingDecisionForWorkspace({ workspaceId: 'workspace-a', id: 'decision-blocked' });
  assert.equal(result.decision.selectedCandidateId, null);
  assert.equal(result.proposal, null);
  const reasons = result.decision.deferred[0].reasonCodes;
  assert.ok(reasons.includes('provider_capacity_unknown'));
  assert.ok(reasons.includes('no_compatible_worker'));
  assert.ok(result.inputs.blockedResources.includes(lockedId));
  service.close();
});

test('explicit provider capacity is persisted but never inferred from S5 observations', async () => {
  const { service } = createService();
  const capacity = service.recordProviderCapacity({
    id: 'provider-cap-vercel-observe-v1',
    workspaceId: 'workspace-a',
    providerId: 'vercel',
    action: 'observe_public_deployment',
    maxActive: 1,
    activeObserved: 0,
    status: 'current',
    observedAt: '2026-08-08T00:00:00.000Z',
    expiresAt: '2026-08-08T01:00:00.000Z',
    source: 'explicit-local-policy',
  });
  assert.equal(capacity.status, 'current');
  assert.equal(service.querySchedulingState('workspace-a').providerCapacity[0].id, capacity.id);
  assert.equal(service.queryProviderState('workspace-a').observations.length, 0);
  service.close();
});

test('SQLite restart rehydrates policy/decision/proposal evidence with zero scheduling replay', () => {
  const root = mkdtempSync(join(tmpdir(), 'ai-exe-s6-'));
  const databasePath = join(root, 'state.sqlite');
  const records = [readyRecord('candidate-restart', { priority: 'high' })];
  try {
    const firstBundle = createService({ databasePath, records });
    recordPolicy(firstBundle.service);
    const computed = firstBundle.service.computeSchedulingDecisionForWorkspace({ workspaceId: 'workspace-a', id: 'decision-restart', proposalId: 'proposal-restart' });
    assert.equal(computed.proposal.state, 'proposed');
    const digest = firstBundle.service.store.projectionDigest({ workspaceId: 'workspace-a' });
    firstBundle.service.close();

    const secondBundle = createService({ databasePath, records, clock: () => '2026-08-08T00:06:00.000Z' });
    const state = secondBundle.service.querySchedulingState('workspace-a');
    assert.equal(state.policy.id, 's6-policy-workspace-a-v1');
    assert.equal(state.decisions.some((item) => item.id === 'decision-restart'), true);
    assert.equal(state.proposals.some((item) => item.id === 'proposal-restart' && item.state === 'proposed'), true);
    assert.equal(secondBundle.workerManager.startCalls, 0);
    assert.equal(secondBundle.workerManager.submitCalls, 0);
    assert.equal(secondBundle.service.store.projectionDigest({ workspaceId: 'workspace-a' }), digest);
    secondBundle.service.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('S4 cockpit composition exposes S6 scheduling state and unknown Workspace remains fail-closed', () => {
  const { service } = createService();
  recordPolicy(service);
  const cockpit = service.queryOperatorCockpit('workspace-a');
  assert.equal(cockpit.scheduling.policy.id, 's6-policy-workspace-a-v1');
  const missing = service.querySchedulingState('workspace-missing');
  assert.equal(missing.found, false);
  assert.equal(missing.policy, null);
  assert.deepEqual(missing.eligibleQueue, []);
  service.close();
});
