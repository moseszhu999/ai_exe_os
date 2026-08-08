'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeEffectivePriority,
  createSchedulingDecisionDigest,
  createSchedulingInputDigest,
  createSchedulingPolicySnapshot,
  rankSchedulingCandidates,
} = require('../src/scheduling/policy/index.cjs');

function policy(overrides = {}) {
  return createSchedulingPolicySnapshot({
    id: 'policy-a-v1',
    workspaceId: 'workspace-a',
    version: '1.0.0',
    status: 'active',
    globalMaxActive: 4,
    workspaceMaxActive: 2,
    priorityOrder: ['critical', 'high', 'normal', 'low'],
    fairness: { mode: 'bounded-aging', agingIntervalSeconds: 60, maxPriorityBoostSteps: 2 },
    sessionReuse: 'compatible-only',
    createdAt: '2026-08-08T00:00:00.000Z',
    ...overrides,
  });
}

function candidate(id, priority, readySince, overrides = {}) {
  return {
    id,
    workspaceId: 'workspace-a',
    readyState: 'ready',
    priority,
    readySince,
    reusableSessionCompatible: false,
    ...overrides,
  };
}

test('SchedulingPolicySnapshot is immutable, bounded and digest-bound', () => {
  const value = policy();
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.fairness), true);
  assert.match(value.digest, /^sha256:[a-f0-9]{64}$/);
  assert.throws(() => policy({ workspaceMaxActive: 5 }), /cannot exceed/);
  assert.throws(() => policy({ priorityOrder: ['critical', 'high', 'normal', 'normal'] }), /permutation/);
  assert.throws(() => policy({ fairness: { mode: 'opaque-score', agingIntervalSeconds: 60, maxPriorityBoostSteps: 1 } }), /bounded-aging/);
  assert.throws(() => policy({ fairness: { mode: 'bounded-aging', agingIntervalSeconds: 60, maxPriorityBoostSteps: 4 } }), /exceeds/);
});

test('bounded aging lifts priority by no more than configured tiers', () => {
  const value = policy();
  const fresh = computeEffectivePriority(candidate('candidate-fresh', 'low', '2026-08-08T00:04:30.000Z'), value, '2026-08-08T00:05:00.000Z');
  const old = computeEffectivePriority(candidate('candidate-old', 'low', '2026-08-08T00:00:00.000Z'), value, '2026-08-08T00:05:00.000Z');
  assert.equal(fresh.rawRank, 3);
  assert.equal(fresh.boostSteps, 0);
  assert.equal(fresh.effectiveRank, 3);
  assert.equal(old.boostSteps, 2);
  assert.equal(old.effectiveRank, 1);
});

test('candidate ordering is deterministic independent of input collection order', () => {
  const value = policy();
  const candidates = [
    candidate('candidate-normal-new', 'normal', '2026-08-08T00:04:00.000Z'),
    candidate('candidate-low-old', 'low', '2026-08-08T00:00:00.000Z'),
    candidate('candidate-high', 'high', '2026-08-08T00:04:50.000Z'),
  ];
  const first = rankSchedulingCandidates({ policy: value, candidates, evaluatedAt: '2026-08-08T00:05:00.000Z' });
  const second = rankSchedulingCandidates({ policy: value, candidates: [...candidates].reverse(), evaluatedAt: '2026-08-08T00:05:00.000Z' });
  assert.deepEqual(first.map((item) => item.id), second.map((item) => item.id));
  assert.deepEqual(first.map((item) => item.id), ['candidate-low-old', 'candidate-high', 'candidate-normal-new']);
  assert.equal(createSchedulingInputDigest({ policy: value, candidates, evaluatedAt: '2026-08-08T00:05:00.000Z' }), createSchedulingInputDigest({ policy: value, candidates: [...candidates].reverse(), evaluatedAt: '2026-08-08T00:05:00.000Z' }));
});

test('compatible session reuse only affects candidates after higher policy dimensions tie', () => {
  const value = policy();
  const candidates = [
    candidate('candidate-z', 'normal', '2026-08-08T00:04:00.000Z'),
    candidate('candidate-a', 'normal', '2026-08-08T00:04:00.000Z', { reusableSessionCompatible: true }),
  ];
  const ordered = rankSchedulingCandidates({ policy: value, candidates, evaluatedAt: '2026-08-08T00:05:00.000Z' });
  assert.deepEqual(ordered.map((item) => item.id), ['candidate-a', 'candidate-z']);
  assert.equal(ordered[0].reusePreferred, true);
});

test('policy domain fails closed on non-ready and cross-Workspace candidates', () => {
  const value = policy();
  assert.throws(() => rankSchedulingCandidates({
    policy: value,
    candidates: [candidate('blocked', 'normal', '2026-08-08T00:00:00.000Z', { readyState: 'waiting_human' })],
    evaluatedAt: '2026-08-08T00:05:00.000Z',
  }), /only ranks canonical ready/);
  assert.throws(() => rankSchedulingCandidates({
    policy: value,
    candidates: [candidate('cross', 'normal', '2026-08-08T00:00:00.000Z', { workspaceId: 'workspace-b' })],
    evaluatedAt: '2026-08-08T00:05:00.000Z',
  }), /Cross-Workspace/);
});

test('decision digest is stable and reason-code order independent', () => {
  const input = {
    policySnapshotId: 'policy-a-v1',
    inputDigest: `sha256:${'a'.repeat(64)}`,
    orderedCandidateIds: ['candidate-a', 'candidate-b'],
    selectedCandidateId: 'candidate-a',
    selectedWorkerId: 'worker-a',
    reasonCodes: ['provider_capacity_current', 'selected'],
  };
  assert.equal(
    createSchedulingDecisionDigest(input),
    createSchedulingDecisionDigest({ ...input, reasonCodes: [...input.reasonCodes].reverse() }),
  );
});
