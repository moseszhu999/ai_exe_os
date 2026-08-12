'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createGroupAutonomyPolicy,
  createGroupBusinessEval,
  createGroupDecisionEscalation,
  createGroupWorkEntry,
} = require('../src/group-fabric/group-operating-system.cjs');

function policyInput(overrides = {}) {
  return {
    policyRef: 'group:autonomy-policy:buyer-research-v1',
    actionCode: 'buyer_research',
    ownerDomain: 'tradeos',
    autonomyLevel: 'L0',
    reversibility: 'read_only',
    humanGateRequired: false,
    retryClass: 'safe_idempotent',
    maxAttempts: 3,
    maxCostUsd: 5,
    maxActions: 20,
    evidenceKinds: ['source_provenance', 'result_trace'],
    policyEvidenceRefs: ['evidence:policy:buyer-research-v1'],
    validFrom: '2026-08-12T00:00:00Z',
    validUntil: '2027-08-12T00:00:00Z',
    ...overrides,
  };
}

function workEntryInput(overrides = {}) {
  return {
    entryRef: 'group:work-entry:001',
    actorRef: 'group:subject:owner-001',
    organizationRef: 'group:organization:company-001',
    objective: 'Research a buyer and prepare evidence for later CRM review.',
    requestedActionCode: 'buyer_research',
    targetRef: 'tradeos:market-party-candidate:buyer-001',
    requestedDomain: 'tradeos',
    sourceKind: 'human',
    createdAt: '2026-08-12T00:05:00Z',
    evidenceRefs: ['evidence:intake:001'],
    ...overrides,
  };
}

function createMatchedEscalation(overrides = {}) {
  const workEntry = createGroupWorkEntry(workEntryInput());
  const policy = createGroupAutonomyPolicy(policyInput());
  const escalation = createGroupDecisionEscalation({
    escalationRef: 'group:decision-escalation:001',
    workEntry,
    policy,
    routeStatus: 'matched',
    routeReasonCode: 'exact_action_owner_match',
    routeEvidenceRefs: ['evidence:routing:001'],
    observedAt: '2026-08-12T00:06:00Z',
    ...overrides,
  });
  return { workEntry, policy, escalation };
}

test('L0 policy is deterministic and never grants authority', () => {
  const first = createGroupAutonomyPolicy(policyInput());
  const second = createGroupAutonomyPolicy({
    ...policyInput(),
    evidenceKinds: [...policyInput().evidenceKinds].reverse(),
  });
  assert.equal(first.policyDigest, second.policyDigest);
  assert.equal(first.policyOnly, true);
  assert.equal(first.executionAuthorized, false);
  assert.equal(first.domainWritePerformed, false);
  assert.equal(first.externalActionPerformed, false);
  assert.equal(Object.isFrozen(first), true);
});

test('autonomy level cannot be relabelled with a safer reversibility class', () => {
  assert.throws(() => createGroupAutonomyPolicy(policyInput({
    autonomyLevel: 'L3',
    reversibility: 'draft_only',
  })), /reversibility must be external_reversible/);
});

test('L4 always requires human gate and forbids automatic safe idempotent retry', () => {
  assert.throws(() => createGroupAutonomyPolicy(policyInput({
    autonomyLevel: 'L4',
    reversibility: 'external_consequential',
    humanGateRequired: false,
    retryClass: 'none',
    maxAttempts: 1,
  })), /always require a human gate/);

  assert.throws(() => createGroupAutonomyPolicy(policyInput({
    autonomyLevel: 'L4',
    reversibility: 'external_consequential',
    humanGateRequired: true,
    retryClass: 'safe_idempotent',
    maxAttempts: 1,
  })), /cannot use automatic safe_idempotent retry/);
});

test('retry none cannot hide multiple attempts', () => {
  assert.throws(() => createGroupAutonomyPolicy(policyInput({
    retryClass: 'none',
    maxAttempts: 2,
  })), /requires maxAttempts=1/);
});

test('work entry is routing input only and rejects hidden approval fields', () => {
  const entry = createGroupWorkEntry(workEntryInput());
  assert.equal(entry.routingProposalOnly, true);
  assert.equal(entry.managerMayMintDomainTruth, false);
  assert.equal(entry.authorizationDecisionCreated, false);
  assert.equal(entry.executionAuthorized, false);
  assert.throws(() => createGroupWorkEntry({
    ...workEntryInput(),
    approved: true,
  }), /unsupported field: approved/);
});

test('matched low-risk work is ready only for bounded processing, not execution authorization', () => {
  const { escalation } = createMatchedEscalation();
  assert.equal(escalation.decisionState, 'ready_for_bounded_processing');
  assert.equal(escalation.ownerDecisionRequired, false);
  assert.equal(escalation.policyMatched, true);
  assert.equal(escalation.executionEligibilityGranted, false);
  assert.equal(escalation.executionAuthorized, false);
});

test('requested domain cannot override the policy owner domain', () => {
  const workEntry = createGroupWorkEntry(workEntryInput({ requestedDomain: 'trainingos' }));
  const policy = createGroupAutonomyPolicy(policyInput());
  const escalation = createGroupDecisionEscalation({
    escalationRef: 'group:decision-escalation:domain-mismatch',
    workEntry,
    policy,
    routeStatus: 'matched',
    routeReasonCode: 'caller_requested_route',
    routeEvidenceRefs: ['evidence:routing:domain-mismatch'],
    observedAt: '2026-08-12T00:06:00Z',
  });
  assert.equal(escalation.decisionState, 'blocked');
  assert.equal(escalation.ownerDecisionRequired, true);
  assert.equal(escalation.reasonCode, 'requested_domain_conflicts_with_policy_owner');
  assert.equal(escalation.policyMatched, false);
});

test('L4 matched routing still escalates to human review and never authorizes execution', () => {
  const workEntry = createGroupWorkEntry(workEntryInput({ requestedActionCode: 'sign_contract' }));
  const policy = createGroupAutonomyPolicy(policyInput({
    policyRef: 'group:autonomy-policy:sign-contract-v1',
    actionCode: 'sign_contract',
    autonomyLevel: 'L4',
    reversibility: 'external_consequential',
    humanGateRequired: true,
    retryClass: 'none',
    maxAttempts: 1,
    maxCostUsd: 0,
    maxActions: 1,
  }));
  const escalation = createGroupDecisionEscalation({
    escalationRef: 'group:decision-escalation:contract-001',
    workEntry,
    policy,
    routeStatus: 'matched',
    routeReasonCode: 'exact_action_owner_match',
    routeEvidenceRefs: ['evidence:routing:contract-001'],
    observedAt: '2026-08-12T00:06:00Z',
  });
  assert.equal(escalation.decisionState, 'needs_human_review');
  assert.equal(escalation.ownerDecisionRequired, true);
  assert.equal(escalation.humanGateRequiredForExecution, true);
  assert.equal(escalation.humanGateDecisionCreated, false);
  assert.equal(escalation.executionAuthorized, false);
});

test('business eval derives rates from trial evidence and cannot auto-promote autonomy', () => {
  const { workEntry, policy, escalation } = createMatchedEscalation();
  const evalReceipt = createGroupBusinessEval({
    evalRef: 'group:business-eval:buyer-research-001',
    workEntry,
    policy,
    decisionEscalation: escalation,
    trialCount: 10,
    successfulTrials: 8,
    unknownTrials: 1,
    humanTakeoverTrials: 2,
    totalHumanMinutes: 25,
    totalCycleTimeMs: 100000,
    totalCostUsd: 4,
    errorCount: 1,
    reversalCount: 0,
    technicalEvidenceRefs: ['evidence:trace:001'],
    businessEvidenceRefs: ['evidence:business-outcome:001'],
    downstreamMetric: { name: 'qualified_buyer_candidates', value: 8, unit: 'count', baseline: 3 },
    observedAt: '2026-08-12T01:00:00Z',
  });
  assert.equal(evalReceipt.failedTrials, 1);
  assert.equal(evalReceipt.successRate, 0.8);
  assert.equal(evalReceipt.humanTakeoverRate, 0.2);
  assert.equal(evalReceipt.meanHumanMinutesPerTrial, 2.5);
  assert.equal(evalReceipt.meanCostUsd, 0.4);
  assert.equal(evalReceipt.autonomyPromoted, false);
  assert.equal(evalReceipt.productionReadinessGranted, false);
  assert.equal(evalReceipt.executionAuthorized, false);
});

test('business eval rejects impossible trial accounting and hidden promotion fields', () => {
  const { workEntry, policy, escalation } = createMatchedEscalation();
  const base = {
    evalRef: 'group:business-eval:buyer-research-invalid',
    workEntry,
    policy,
    decisionEscalation: escalation,
    trialCount: 5,
    successfulTrials: 5,
    unknownTrials: 1,
    humanTakeoverTrials: 0,
    totalHumanMinutes: 10,
    totalCycleTimeMs: 5000,
    totalCostUsd: 1,
    errorCount: 0,
    reversalCount: 0,
    technicalEvidenceRefs: ['evidence:trace:invalid'],
    businessEvidenceRefs: ['evidence:business-outcome:invalid'],
    downstreamMetric: null,
    observedAt: '2026-08-12T01:00:00Z',
  };
  assert.throws(() => createGroupBusinessEval(base), /cannot exceed trialCount/);
  assert.throws(() => createGroupBusinessEval({
    ...base,
    successfulTrials: 4,
    unknownTrials: 0,
    autonomyPromoted: true,
  }), /unsupported field: autonomyPromoted/);
});
