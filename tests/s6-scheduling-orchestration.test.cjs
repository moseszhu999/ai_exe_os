'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalReadiness,
  computeSchedulingDecision,
  createAssignmentProposal,
  deriveSchedulingCandidates,
  revalidateAssignmentProposal,
} = require('../src/scheduling/orchestration/index.cjs');

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
    sourceId: `${id}-source`,
    executionIdentity: `${id}-exec`,
    readySince: '2026-08-08T00:00:00.000Z',
    priority: 'normal',
    requiredResources: ['resource-a'],
    providerRequirement: null,
    workerRequirements: { browserChannel: 'chrome' },
    ...overrides,
  };
}

const policy = Object.freeze({
  id: 'policy-a',
  workspaceId: 'workspace-a',
  status: 'active',
  digest: `sha256:${'a'.repeat(64)}`,
});

const workers = Object.freeze([
  Object.freeze({ workerId: 'worker-a', workspaceId: 'workspace-a' }),
  Object.freeze({ workerId: 'worker-b', workspaceId: 'workspace-a' }),
]);

test('canonical readiness is fail-closed and never upgrades waiting/uncertain work', () => {
  assert.equal(canonicalReadiness(readyRecord('candidate-a')), null);
  assert.equal(canonicalReadiness(readyRecord('candidate-b', { readyState: 'waiting_human' })).code, 'human_gate_required');
  assert.equal(canonicalReadiness(readyRecord('candidate-c', { dependenciesSatisfied: false })).code, 'dependencies_unsatisfied');
  assert.equal(canonicalReadiness(readyRecord('candidate-d', { priorEffectState: 'uncertain' })).code, 'uncertain_execution');
  assert.equal(canonicalReadiness(readyRecord('candidate-e', { providerRequirement: { providerId: 'vercel', action: 'observe' }, providerUseAccepted: false })).code, 'provider_use_not_accepted');
});

test('candidate derivation is a strict subset of canonical source records', () => {
  const source = [
    readyRecord('candidate-a'),
    readyRecord('candidate-b', { readyState: 'waiting_human' }),
    readyRecord('candidate-c', { authorityValid: false }),
  ];
  const result = deriveSchedulingCandidates(source);
  assert.deepEqual(result.candidates.map((item) => item.id), ['candidate-a']);
  assert.deepEqual(result.deferred.map((item) => item.candidateId), ['candidate-b', 'candidate-c']);
  assert.equal(result.candidates.length < source.length, true);
});

test('pure orchestration selects the first ranked capacity-eligible candidate without starting work', () => {
  const candidates = deriveSchedulingCandidates([readyRecord('candidate-a'), readyRecord('candidate-b')]).candidates;
  let evaluationCount = 0;
  const decision = computeSchedulingDecision({
    id: 'decision-a', policy, candidates, workers, capacitySnapshot: { digest: `sha256:${'b'.repeat(64)}` }, evaluatedAt: '2026-08-08T00:05:00.000Z',
    rankCandidates: ({ candidates: input }) => [...input].reverse().map((item) => ({ id: item.id })),
    evaluateCapacity: ({ candidate }) => {
      evaluationCount += 1;
      if (candidate.id === 'candidate-b') return { eligible: true, compatibleWorkerIds: ['worker-b'], reasonCodes: [] };
      return { eligible: false, compatibleWorkerIds: [], reasonCodes: ['workspace_capacity_exhausted'] };
    },
  });
  assert.equal(evaluationCount, 2);
  assert.deepEqual(decision.orderedCandidateIds, ['candidate-b', 'candidate-a']);
  assert.equal(decision.selectedCandidateId, 'candidate-b');
  assert.equal(decision.selectedWorkerId, 'worker-b');
  assert.match(decision.inputDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(decision.decisionDigest, /^sha256:[a-f0-9]{64}$/);
});

test('no eligible capacity produces no_assignment and explicit deferred reasons', () => {
  const candidates = deriveSchedulingCandidates([readyRecord('candidate-a')]).candidates;
  const decision = computeSchedulingDecision({
    id: 'decision-none', policy, candidates, workers, capacitySnapshot: {}, evaluatedAt: '2026-08-08T00:05:00.000Z',
    rankCandidates: ({ candidates: input }) => input.map((item) => ({ id: item.id })),
    evaluateCapacity: () => ({ eligible: false, compatibleWorkerIds: [], reasonCodes: ['provider_capacity_unknown'] }),
  });
  assert.equal(decision.selectedCandidateId, null);
  assert.equal(decision.selectedWorkerId, null);
  assert.deepEqual(decision.reasonCodes, ['no_assignment']);
  assert.deepEqual(decision.deferred[0].reasonCodes, ['provider_capacity_unknown']);
});

test('AssignmentProposal is not execution authority and must be revalidated', () => {
  const candidate = deriveSchedulingCandidates([readyRecord('candidate-a')]).candidates[0];
  const decision = Object.freeze({ id: 'decision-a', selectedCandidateId: 'candidate-a', selectedWorkerId: 'worker-a' });
  const proposal = createAssignmentProposal({
    id: 'proposal-a', decision, candidate, authoritySnapshotDigest: `sha256:${'c'.repeat(64)}`,
  });
  assert.equal(proposal.state, 'proposed');

  const accepted = revalidateAssignmentProposal({
    proposal,
    current: {
      authoritySnapshotDigest: proposal.authoritySnapshotDigest,
      executionIdentity: proposal.executionIdentity,
      candidateReady: true,
      resourceAvailable: true,
      providerCapacityCurrent: true,
      humanGateClear: true,
      priorEffectCertain: true,
    },
  });
  assert.equal(accepted.state, 'accepted');
  assert.equal(accepted.reasonCode, 'accepted_current');
});

test('revalidation rejects stale authority, HumanGate, resource, provider and uncertain-effect drift', () => {
  const candidate = deriveSchedulingCandidates([readyRecord('candidate-a')]).candidates[0];
  const proposal = createAssignmentProposal({
    id: 'proposal-a', decision: { id: 'decision-a', selectedCandidateId: 'candidate-a', selectedWorkerId: 'worker-a' }, candidate,
    authoritySnapshotDigest: `sha256:${'c'.repeat(64)}`,
  });
  const base = {
    authoritySnapshotDigest: proposal.authoritySnapshotDigest,
    executionIdentity: proposal.executionIdentity,
    candidateReady: true,
    resourceAvailable: true,
    providerCapacityCurrent: true,
    humanGateClear: true,
    priorEffectCertain: true,
  };
  assert.equal(revalidateAssignmentProposal({ proposal, current: { ...base, authoritySnapshotDigest: `sha256:${'d'.repeat(64)}` } }).reasonCode, 'stale_authority_snapshot');
  assert.equal(revalidateAssignmentProposal({ proposal, current: { ...base, humanGateClear: false } }).reasonCode, 'rejected_human_gate');
  assert.equal(revalidateAssignmentProposal({ proposal, current: { ...base, resourceAvailable: false } }).reasonCode, 'rejected_resource_conflict');
  assert.equal(revalidateAssignmentProposal({ proposal, current: { ...base, providerCapacityCurrent: false } }).reasonCode, 'rejected_provider_capacity');
  assert.equal(revalidateAssignmentProposal({ proposal, current: { ...base, priorEffectCertain: false } }).reasonCode, 'rejected_uncertain');
});
