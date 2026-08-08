'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createConcurrencyBudget,
  createProviderCapacitySnapshot,
  createWorkerCapacitySnapshot,
  evaluateCandidateCapacity,
  providerCapacityReason,
  workerCompatibility,
} = require('../src/scheduling/capacity/index.cjs');

function globalBudget(activeObserved = 0) {
  return createConcurrencyBudget({
    id: 'budget-global', scope: 'global', maxActive: 2, activeObserved, status: 'current', observedAt: '2026-08-08T00:00:00.000Z',
  });
}

function workspaceBudget(activeObserved = 0) {
  return createConcurrencyBudget({
    id: 'budget-workspace-a', scope: 'workspace', workspaceId: 'workspace-a', maxActive: 1, activeObserved, status: 'current', observedAt: '2026-08-08T00:00:00.000Z',
  });
}

function provider(status = 'current', activeObserved = 0, overrides = {}) {
  return createProviderCapacitySnapshot({
    id: 'provider-cap-a', workspaceId: 'workspace-a', providerId: 'vercel', action: 'observe_public_deployment',
    maxActive: 1, activeObserved, status, observedAt: '2026-08-08T00:00:00.000Z', expiresAt: '2026-08-08T01:00:00.000Z',
    source: 'explicit-local-policy', ...overrides,
  });
}

function worker(id, overrides = {}) {
  return createWorkerCapacitySnapshot({
    workerId: id, workspaceId: 'workspace-a', status: 'eligible', browserChannel: 'chrome', activeAssignmentCount: 0,
    reusableSession: false,
    safeCompatibilityKeys: ['profile-class-a', 'provider-vercel-observe_public_deployment'],
    ...overrides,
  });
}

function candidate(overrides = {}) {
  return {
    id: 'candidate-a', workspaceId: 'workspace-a', readyState: 'ready',
    requiredResources: ['resource-a'],
    providerRequirement: { providerId: 'vercel', action: 'observe_public_deployment' },
    workerRequirements: { browserChannel: 'chrome', exactProfileClass: 'class-a' },
    ...overrides,
  };
}

test('concurrency budgets are explicit upper bounds', () => {
  const global = globalBudget(2);
  assert.equal(global.remaining, 0);
  assert.match(global.digest, /^sha256:[a-f0-9]{64}$/);
  assert.throws(() => createConcurrencyBudget({ id: 'bad', scope: 'global', maxActive: 0, activeObserved: 0, status: 'current', observedAt: '2026-08-08T00:00:00Z' }), /positive integer/);
});

test('provider capacity fails closed for absent, unknown, stale, expired, blocked and exhausted state', () => {
  assert.equal(providerCapacityReason(candidate(), [], '2026-08-08T00:30:00.000Z').reasonCode, 'provider_capacity_unknown');
  assert.equal(providerCapacityReason(candidate(), [provider('unknown')], '2026-08-08T00:30:00.000Z').reasonCode, 'provider_capacity_unknown');
  assert.equal(providerCapacityReason(candidate(), [provider('stale')], '2026-08-08T00:30:00.000Z').reasonCode, 'provider_capacity_stale');
  assert.equal(providerCapacityReason(candidate(), [provider('blocked')], '2026-08-08T00:30:00.000Z').reasonCode, 'provider_capacity_blocked');
  assert.equal(providerCapacityReason(candidate(), [provider('current', 1)], '2026-08-08T00:30:00.000Z').reasonCode, 'provider_capacity_exhausted');
  assert.equal(providerCapacityReason(candidate(), [provider('current', 0, { expiresAt: '2026-08-08T00:10:00.000Z' })], '2026-08-08T00:30:00.000Z').reasonCode, 'provider_capacity_stale');
  assert.equal(providerCapacityReason(candidate(), [provider('current', 0)], '2026-08-08T00:30:00.000Z').allowed, true);
});

test('WorkerCapacitySnapshot rejects secret/profile/process fields', () => {
  assert.throws(() => worker('worker-secret', { profilePath: '/Users/me/profile' }), /sensitive runtime field/);
  assert.throws(() => worker('worker-token', { token: 'secret' }), /sensitive runtime field/);
  assert.throws(() => worker('worker-pid', { pid: 1234 }), /sensitive runtime field/);
});

test('worker compatibility requires same Workspace and explicit channel/profile/provider compatibility', () => {
  assert.equal(workerCompatibility(candidate(), worker('worker-a')).compatible, true);
  assert.deepEqual(workerCompatibility(candidate(), worker('worker-b', { workspaceId: 'workspace-b' })).reasonCodes, ['cross_workspace_worker']);
  assert.deepEqual(workerCompatibility(candidate(), worker('worker-c', { browserChannel: 'chromium' })).reasonCodes, ['browser_channel_mismatch']);
  assert.deepEqual(workerCompatibility(candidate(), worker('worker-d', { safeCompatibilityKeys: ['provider-vercel-observe_public_deployment'] })).reasonCodes, ['profile_class_mismatch']);
  assert.deepEqual(workerCompatibility(candidate(), worker('worker-e', { safeCompatibilityKeys: ['profile-class-a'] })).reasonCodes, ['provider_surface_mismatch']);
  assert.deepEqual(workerCompatibility(candidate(), worker('worker-f'), ['resource-a']).reasonCodes, ['resource_conflict']);
});

test('candidate capacity applies global/workspace/provider caps before proposing compatible workers', () => {
  const workers = [
    worker('worker-b', { activeAssignmentCount: 1 }),
    worker('worker-a', { reusableSession: true, activeAssignmentCount: 0 }),
  ];
  const allowed = evaluateCandidateCapacity({
    candidate: candidate(), globalBudget: globalBudget(), workspaceBudget: workspaceBudget(), providerCapacities: [provider()], workers,
    evaluatedAt: '2026-08-08T00:30:00.000Z',
  });
  assert.equal(allowed.eligible, true);
  assert.deepEqual(allowed.compatibleWorkerIds, ['worker-a', 'worker-b']);

  const full = evaluateCandidateCapacity({
    candidate: candidate(), globalBudget: globalBudget(2), workspaceBudget: workspaceBudget(1), providerCapacities: [provider('current', 1)], workers,
    evaluatedAt: '2026-08-08T00:30:00.000Z',
  });
  assert.equal(full.eligible, false);
  assert.deepEqual(full.reasonCodes, ['global_capacity_exhausted', 'provider_capacity_exhausted', 'workspace_capacity_exhausted']);
});

test('waiting/blocked work never becomes capacity-eligible', () => {
  const result = evaluateCandidateCapacity({
    candidate: candidate({ readyState: 'waiting_human' }), globalBudget: globalBudget(), workspaceBudget: workspaceBudget(), providerCapacities: [provider()], workers: [worker('worker-a')],
    evaluatedAt: '2026-08-08T00:30:00.000Z',
  });
  assert.deepEqual(result, { eligible: false, compatibleWorkerIds: [], reasonCodes: ['candidate_not_ready'] });
});
