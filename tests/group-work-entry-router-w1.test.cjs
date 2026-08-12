'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
  createGroupAutonomyPolicy,
  createGroupWorkEntry,
} = require('../src/group-fabric/group-operating-system.cjs');
const {
  createOwnerDecisionItem,
  routeGroupWorkEntry,
} = require('../src/group-fabric/group-work-entry-router.cjs');

function policy(overrides = {}) {
  return createGroupAutonomyPolicy({
    policyRef: 'group:autonomy-policy:buyer-research',
    actionCode: 'buyer_research',
    ownerDomain: 'tradeos',
    autonomyLevel: 'L0',
    reversibility: 'read_only',
    humanGateRequired: false,
    retryClass: 'safe_idempotent',
    maxAttempts: 3,
    maxCostUsd: 5,
    maxActions: 10,
    evidenceKinds: ['source', 'route'],
    policyEvidenceRefs: ['evidence:policy:buyer-research'],
    validFrom: '2026-08-01T00:00:00Z',
    validUntil: '2026-09-01T00:00:00Z',
    ...overrides,
  });
}

function entry(overrides = {}) {
  return createGroupWorkEntry({
    entryRef: 'group:work-entry:001',
    actorRef: 'group:subject:owner-001',
    organizationRef: 'group:organization:company-001',
    objective: 'Find a qualified buyer candidate and prepare evidence for review.',
    requestedActionCode: 'buyer_research',
    targetRef: 'tradeos:opportunity:001',
    requestedDomain: 'tradeos',
    sourceKind: 'human',
    createdAt: '2026-08-12T00:00:00Z',
    evidenceRefs: ['evidence:request:001'],
    ...overrides,
  });
}

function route(overrides = {}) {
  return routeGroupWorkEntry({
    routeRef: 'group:work-route:001',
    workEntry: entry(),
    policies: [policy()],
    routeEvidenceRefs: ['evidence:route:catalog-001'],
    observedAt: '2026-08-12T00:01:00Z',
    ...overrides,
  });
}

test('exact active low-risk policy routes deterministically without owner attention', () => {
  const result = route();
  assert.equal(result.routeState, 'matched');
  assert.equal(result.reasonCode, 'exact_active_policy_match');
  assert.equal(result.ownerDomain, 'tradeos');
  assert.equal(result.managementIntakeEligible, true);
  assert.equal(result.ownerAttentionRequired, false);
  assert.equal(result.managerFallbackEligible, false);
  assert.equal(result.managerSuggestionApplied, false);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.domainTruthCreated, false);
  assert.equal(Object.isFrozen(result), true);
});

test('L4 matched work is routed to owner attention and cannot become execution authority', () => {
  const l4 = policy({
    policyRef: 'group:autonomy-policy:contract-signature',
    actionCode: 'contract_signature',
    ownerDomain: 'back-office',
    autonomyLevel: 'L4',
    reversibility: 'external_consequential',
    humanGateRequired: true,
    retryClass: 'none',
    maxAttempts: 1,
    maxCostUsd: 0,
    maxActions: 1,
  });
  const work = entry({
    entryRef: 'group:work-entry:contract-001',
    requestedActionCode: 'contract_signature',
    requestedDomain: 'back-office',
    targetRef: 'back-office:contract:001',
  });
  const result = route({
    routeRef: 'group:work-route:contract-001',
    workEntry: work,
    policies: [l4],
  });
  assert.equal(result.routeState, 'needs_human_review');
  assert.equal(result.reasonCode, 'matched_policy_requires_human_review');
  assert.equal(result.managementIntakeEligible, false);
  assert.equal(result.ownerAttentionRequired, true);
  assert.equal(result.executionAuthorized, false);

  const item = createOwnerDecisionItem({
    itemRef: 'group:owner-decision:contract-001',
    routeResult: result,
    createdAt: '2026-08-12T00:02:00Z',
    evidenceRefs: ['evidence:decision-queue:001'],
  });
  assert.equal(item.priority, 'critical');
  assert.equal(item.approvalRecorded, false);
  assert.equal(item.humanGateDecisionCreated, false);
});

test('requested Domain cannot override the policy-owned Domain', () => {
  const result = route({
    workEntry: entry({ requestedDomain: 'trainingos' }),
  });
  assert.equal(result.routeState, 'blocked');
  assert.equal(result.reasonCode, 'requested_domain_conflicts_with_policy_owner');
  assert.equal(result.managementIntakeEligible, false);
  assert.equal(result.ownerAttentionRequired, true);
});

test('expired policy is ignored and unresolved work is sent to human review', () => {
  const expired = policy({
    validFrom: '2026-07-01T00:00:00Z',
    validUntil: '2026-08-01T00:00:00Z',
  });
  const result = route({ policies: [expired] });
  assert.equal(result.routeState, 'needs_human_review');
  assert.equal(result.reasonCode, 'no_active_policy_match');
  assert.equal(result.ownerDomain, null);
  assert.equal(result.managerFallbackEligible, true);
  assert.equal(result.managementIntakeEligible, false);
});

test('multiple active policies for one action fail closed as a policy conflict', () => {
  const second = policy({
    policyRef: 'group:autonomy-policy:buyer-research-2',
    ownerDomain: 'research',
    policyEvidenceRefs: ['evidence:policy:buyer-research-2'],
  });
  const result = route({ policies: [policy(), second] });
  assert.equal(result.routeState, 'blocked');
  assert.equal(result.reasonCode, 'conflicting_active_policies');
  assert.equal(result.managerFallbackEligible, false);
  assert.equal(result.managementIntakeEligible, false);
});

test('manager fallback may only suggest an existing active policy and is never auto-applied', () => {
  const trainingPolicy = policy({
    policyRef: 'group:autonomy-policy:training-proposal',
    actionCode: 'training_proposal',
    ownerDomain: 'trainingos',
    autonomyLevel: 'L1',
    reversibility: 'draft_only',
    retryClass: 'none',
    maxAttempts: 1,
    policyEvidenceRefs: ['evidence:policy:training-proposal'],
  });
  const unknown = entry({
    entryRef: 'group:work-entry:unknown-001',
    requestedActionCode: 'classify_request',
    requestedDomain: null,
    targetRef: 'group:intake:001',
  });
  const result = route({
    routeRef: 'group:work-route:unknown-001',
    workEntry: unknown,
    policies: [trainingPolicy],
    managerSuggestion: {
      suggestionRef: 'group:route-suggestion:unknown-001',
      suggestedActionCode: 'training_proposal',
      suggestedDomain: 'trainingos',
      rationaleCode: 'objective_matches_training_delivery',
      evidenceRefs: ['evidence:manager-route:001'],
      modelRef: 'model:manager-primary',
      generatedAt: '2026-08-12T00:00:30Z',
    },
  });
  assert.equal(result.routeState, 'needs_human_review');
  assert.equal(result.reasonCode, 'manager_classification_proposal_available');
  assert.equal(result.managerSuggestion.candidatePolicyRef, trainingPolicy.policyRef);
  assert.equal(result.managerSuggestion.applied, false);
  assert.equal(result.managerSuggestion.ownerApprovalRequired, true);
  assert.equal(result.managerSuggestionApplied, false);
  assert.equal(result.domainTruthCreated, false);
});

test('manager suggestion cannot be attached to an already deterministic route', () => {
  assert.throws(() => route({
    managerSuggestion: {
      suggestionRef: 'group:route-suggestion:001',
      suggestedActionCode: 'buyer_research',
      suggestedDomain: 'tradeos',
      rationaleCode: 'redundant_model_guess',
      evidenceRefs: ['evidence:manager-route:002'],
      modelRef: 'model:manager-primary',
      generatedAt: '2026-08-12T00:00:30Z',
    },
  }), /only when deterministic routing has no active policy match/);
});

test('manager suggestion cannot invent an unregistered policy target', () => {
  const unknown = entry({
    entryRef: 'group:work-entry:unknown-002',
    requestedActionCode: 'classify_request',
    requestedDomain: null,
    targetRef: 'group:intake:002',
  });
  assert.throws(() => route({
    routeRef: 'group:work-route:unknown-002',
    workEntry: unknown,
    policies: [policy()],
    managerSuggestion: {
      suggestionRef: 'group:route-suggestion:unknown-002',
      suggestedActionCode: 'invented_action',
      suggestedDomain: 'tradeos',
      rationaleCode: 'model_invented_route',
      evidenceRefs: ['evidence:manager-route:003'],
      modelRef: 'model:manager-primary',
      generatedAt: '2026-08-12T00:00:30Z',
    },
  }), /exactly one active existing policy candidate/);
});

test('owner decision item is impossible for automatic matched work', () => {
  assert.throws(() => createOwnerDecisionItem({
    itemRef: 'group:owner-decision:automatic-001',
    routeResult: route(),
    createdAt: '2026-08-12T00:02:00Z',
    evidenceRefs: ['evidence:decision-queue:002'],
  }), /requires owner attention/);
});

test('routing contract rejects hidden approval or execution shortcuts', () => {
  assert.throws(() => routeGroupWorkEntry({
    routeRef: 'group:work-route:unsafe-001',
    workEntry: entry(),
    policies: [policy()],
    routeEvidenceRefs: ['evidence:route:catalog-001'],
    observedAt: '2026-08-12T00:01:00Z',
    approved: true,
  }), /unsupported field: approved/);
});

test('router source contains no network, fs, child-process, provider or management write dependency', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/group-fabric/group-work-entry-router.cjs'), 'utf8');
  assert.equal(/require\(['"](?:node:)?fs['"]\)/.test(source), false);
  assert.equal(/require\(['"](?:node:)?child_process['"]\)/.test(source), false);
  assert.equal(/\bfetch\s*\(/.test(source), false);
  assert.equal(/src\/management|\.\.\/management|provider-runtime|transport\.invoke/.test(source), false);
});
