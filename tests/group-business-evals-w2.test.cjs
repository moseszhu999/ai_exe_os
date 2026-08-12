'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
  createGroupAutonomyPolicy,
  createGroupBusinessEval,
  createGroupDecisionEscalation,
  createGroupWorkEntry,
} = require('../src/group-fabric/group-operating-system.cjs');
const {
  createAutonomyReviewProposal,
  createBusinessEvalSeries,
  createBusinessReviewPolicy,
} = require('../src/group-fabric/group-business-evals.cjs');

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
    evidenceKinds: ['source', 'route', 'outcome'],
    policyEvidenceRefs: ['evidence:policy:buyer-research'],
    validFrom: '2026-08-01T00:00:00Z',
    validUntil: '2026-09-01T00:00:00Z',
    ...overrides,
  });
}

function workEntry(id, overrides = {}) {
  return createGroupWorkEntry({
    entryRef: `group:work-entry:${id}`,
    actorRef: 'group:subject:owner-001',
    organizationRef: 'group:organization:company-001',
    objective: 'Research a qualified buyer candidate and preserve outcome evidence.',
    requestedActionCode: 'buyer_research',
    targetRef: `tradeos:opportunity:${id}`,
    requestedDomain: 'tradeos',
    sourceKind: 'human',
    createdAt: '2026-08-12T00:00:00Z',
    evidenceRefs: [`evidence:request:${id}`],
    ...overrides,
  });
}

function escalation(id, work, pol) {
  return createGroupDecisionEscalation({
    escalationRef: `group:decision-escalation:${id}`,
    workEntry: work,
    policy: pol,
    routeStatus: 'matched',
    routeReasonCode: 'exact_active_policy_match',
    routeEvidenceRefs: [`evidence:route:${id}`],
    observedAt: '2026-08-12T00:01:00Z',
  });
}

function businessEval(id, overrides = {}) {
  const pol = overrides.policy || policy();
  const work = overrides.workEntry || workEntry(id, {
    requestedActionCode: pol.actionCode,
    requestedDomain: pol.ownerDomain,
    targetRef: `${pol.ownerDomain}:target:${id}`,
  });
  const esc = overrides.escalation || escalation(id, work, pol);
  const input = {
    evalRef: `group:business-eval:${id}`,
    workEntry: work,
    policy: pol,
    escalation: esc,
    trialCount: 10,
    successfulTrials: 8,
    unknownTrials: 1,
    humanTakeoverTrials: 2,
    totalHumanMinutes: 50,
    totalCycleTimeMs: 100000,
    totalCostUsd: 10,
    errorCount: 1,
    reversalCount: 0,
    downstreamMetric: { name: 'qualified_buyer_rate', value: 0.6, unit: 'ratio', baseline: 0.4 },
    technicalEvidenceRefs: [`evidence:technical:${id}`],
    businessEvidenceRefs: [`evidence:business:${id}`],
    observedAt: '2026-08-12T00:05:00Z',
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (!['policy', 'workEntry', 'escalation'].includes(key)) input[key] = value;
  }
  return createGroupBusinessEval(input);
}

function series(evals, overrides = {}) {
  return createBusinessEvalSeries({
    seriesRef: 'group:business-eval-series:buyer-research-001',
    businessEvals: evals,
    seriesEvidenceRefs: ['evidence:series:buyer-research-001'],
    observedAt: '2026-08-12T00:10:00Z',
    ...overrides,
  });
}

function reviewPolicy(s, overrides = {}) {
  return createBusinessReviewPolicy({
    reviewPolicyRef: 'group:business-review-policy:buyer-research-001',
    actionCode: s.actionCode,
    ownerDomain: s.ownerDomain,
    policyRef: s.policyRef,
    policyDigest: s.policyDigest,
    minTrials: 20,
    minEvalReceipts: 2,
    minSuccessRate: 0.75,
    maxUnknownRate: 0.15,
    maxHumanTakeoverRate: 0.25,
    maxMeanHumanMinutesPerTrial: 6,
    maxMeanCycleTimeMs: 12000,
    maxMeanCostUsd: 1.2,
    maxErrorRate: 0.15,
    maxReversalRate: 0.05,
    policyEvidenceRefs: ['evidence:review-policy:buyer-research-001'],
    validFrom: '2026-08-01T00:00:00Z',
    validUntil: '2026-09-01T00:00:00Z',
    ...overrides,
  });
}

test('series aggregates multiple eval receipts by trial count, not receipt count', () => {
  const first = businessEval('001', {
    trialCount: 10,
    successfulTrials: 8,
    unknownTrials: 1,
    humanTakeoverTrials: 2,
    totalHumanMinutes: 50,
    totalCycleTimeMs: 100000,
    totalCostUsd: 10,
    errorCount: 1,
    reversalCount: 0,
    downstreamMetric: { name: 'qualified_buyer_rate', value: 0.6, unit: 'ratio', baseline: 0.4 },
  });
  const second = businessEval('002', {
    trialCount: 30,
    successfulTrials: 27,
    unknownTrials: 0,
    humanTakeoverTrials: 3,
    totalHumanMinutes: 90,
    totalCycleTimeMs: 240000,
    totalCostUsd: 24,
    errorCount: 2,
    reversalCount: 1,
    downstreamMetric: { name: 'qualified_buyer_rate', value: 0.8, unit: 'ratio', baseline: 0.4 },
  });
  const result = series([first, second]);
  assert.equal(result.trialCount, 40);
  assert.equal(result.successfulTrials, 35);
  assert.equal(result.successRate, 35 / 40);
  assert.equal(result.humanTakeoverRate, 5 / 40);
  assert.equal(result.meanHumanMinutesPerTrial, 140 / 40);
  assert.equal(result.meanCostUsd, 34 / 40);
  assert.equal(result.downstreamMetric.weightedValue, 0.75);
  assert.equal(result.downstreamMetric.weightedBaseline, 0.4);
  assert.equal(result.autonomyPromoted, false);
  assert.equal(result.productionReadinessGranted, false);
  assert.equal(result.executionAuthorized, false);
});

test('series digest is deterministic across eval receipt order', () => {
  const first = businessEval('003');
  const second = businessEval('004', { successfulTrials: 9, unknownTrials: 0 });
  const left = series([first, second], { seriesRef: 'group:business-eval-series:stable-order' });
  const right = series([second, first], { seriesRef: 'group:business-eval-series:stable-order' });
  assert.equal(left.seriesDigest, right.seriesDigest);
  assert.deepEqual(left.evalDigests, right.evalDigests);
});

test('series rejects duplicate eval receipts', () => {
  const item = businessEval('005');
  assert.throws(() => series([item, item]), /duplicate eval receipts/);
});

test('series rejects mixed action, Domain or autonomy policy identity', () => {
  const first = businessEval('006');
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
  const second = businessEval('007', { policy: trainingPolicy });
  assert.throws(() => series([first, second]), /cannot mix actionCode|cannot mix ownerDomain|cannot mix policy identity/);
});

test('downstream metric is explicitly non-comparable when metric identity differs', () => {
  const first = businessEval('008');
  const second = businessEval('009', {
    downstreamMetric: { name: 'response_rate', value: 0.7, unit: 'ratio', baseline: 0.5 },
  });
  const result = series([first, second]);
  assert.equal(result.downstreamMetric.status, 'not_comparable');
  assert.equal(result.downstreamMetric.reasonCode, 'metric_identity_mismatch');
});

test('review remains insufficient until minimum trial and receipt evidence is reached', () => {
  const s = series([businessEval('010')]);
  const rp = reviewPolicy(s);
  const proposal = createAutonomyReviewProposal({
    proposalRef: 'group:autonomy-review-proposal:insufficient-001',
    series: s,
    reviewPolicy: rp,
    proposalEvidenceRefs: ['evidence:review:insufficient-001'],
    observedAt: '2026-08-12T00:11:00Z',
  });
  assert.equal(proposal.reviewState, 'insufficient_evidence');
  assert.equal(proposal.ownerReviewRequested, false);
  assert.equal(proposal.autonomyPromoted, false);
  assert.equal(proposal.policyMutationPerformed, false);
});

test('threshold success creates only an owner review proposal, never autonomy promotion', () => {
  const s = series([
    businessEval('011', { trialCount: 20, successfulTrials: 18, unknownTrials: 1, humanTakeoverTrials: 2, totalHumanMinutes: 80, totalCycleTimeMs: 160000, totalCostUsd: 16, errorCount: 1, reversalCount: 0 }),
    businessEval('012', { trialCount: 20, successfulTrials: 17, unknownTrials: 1, humanTakeoverTrials: 3, totalHumanMinutes: 100, totalCycleTimeMs: 180000, totalCostUsd: 18, errorCount: 2, reversalCount: 0 }),
  ]);
  const rp = reviewPolicy(s);
  const proposal = createAutonomyReviewProposal({
    proposalRef: 'group:autonomy-review-proposal:ready-001',
    series: s,
    reviewPolicy: rp,
    proposalEvidenceRefs: ['evidence:review:ready-001'],
    observedAt: '2026-08-12T00:11:00Z',
  });
  assert.equal(proposal.reviewState, 'ready_for_owner_review');
  assert.equal(proposal.ownerReviewRequested, true);
  assert.equal(proposal.proposalOnly, true);
  assert.equal(proposal.autonomyPromoted, false);
  assert.equal(proposal.productionReadinessGranted, false);
  assert.equal(proposal.executionEligibilityGranted, false);
  assert.equal(proposal.authorityGrantCreated, false);
});

test('quality shortfall is visible and does not request autonomy review', () => {
  const s = series([
    businessEval('013', { trialCount: 20, successfulTrials: 10, unknownTrials: 5, humanTakeoverTrials: 10, totalHumanMinutes: 300, totalCycleTimeMs: 500000, totalCostUsd: 100, errorCount: 10, reversalCount: 4 }),
    businessEval('014', { trialCount: 20, successfulTrials: 11, unknownTrials: 4, humanTakeoverTrials: 9, totalHumanMinutes: 280, totalCycleTimeMs: 480000, totalCostUsd: 90, errorCount: 8, reversalCount: 3 }),
  ]);
  const proposal = createAutonomyReviewProposal({
    proposalRef: 'group:autonomy-review-proposal:below-001',
    series: s,
    reviewPolicy: reviewPolicy(s),
    proposalEvidenceRefs: ['evidence:review:below-001'],
    observedAt: '2026-08-12T00:11:00Z',
  });
  assert.equal(proposal.reviewState, 'below_thresholds');
  assert.equal(proposal.ownerReviewRequested, false);
  assert.equal(proposal.checks.successRate, false);
  assert.equal(proposal.autonomyPromoted, false);
});

test('L4 evidence can never become an automatic advancement candidate', () => {
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
    policyEvidenceRefs: ['evidence:policy:contract-signature'],
  });
  const one = businessEval('015', { policy: l4, trialCount: 20, successfulTrials: 20, unknownTrials: 0, humanTakeoverTrials: 0, totalHumanMinutes: 0, totalCycleTimeMs: 1000, totalCostUsd: 0, errorCount: 0, reversalCount: 0 });
  const two = businessEval('016', { policy: l4, trialCount: 20, successfulTrials: 20, unknownTrials: 0, humanTakeoverTrials: 0, totalHumanMinutes: 0, totalCycleTimeMs: 1000, totalCostUsd: 0, errorCount: 0, reversalCount: 0 });
  const s = series([one, two], { seriesRef: 'group:business-eval-series:contract-signature' });
  const proposal = createAutonomyReviewProposal({
    proposalRef: 'group:autonomy-review-proposal:l4-001',
    series: s,
    reviewPolicy: reviewPolicy(s, { reviewPolicyRef: 'group:business-review-policy:contract-signature' }),
    proposalEvidenceRefs: ['evidence:review:l4-001'],
    observedAt: '2026-08-12T00:11:00Z',
  });
  assert.equal(proposal.reviewState, 'consequential_manual_only');
  assert.equal(proposal.reasonCode, 'l4_never_auto_advances_from_business_evals');
  assert.equal(proposal.ownerReviewRequested, true);
  assert.equal(proposal.autonomyPromoted, false);
  assert.equal(proposal.humanGateDecisionCreated, false);
});

test('review policy must bind the exact action, Domain and autonomy policy digest', () => {
  const s = series([businessEval('017'), businessEval('018')]);
  const wrong = createBusinessReviewPolicy({
    reviewPolicyRef: 'group:business-review-policy:wrong-binding',
    actionCode: s.actionCode,
    ownerDomain: s.ownerDomain,
    policyRef: s.policyRef,
    policyDigest: '0'.repeat(64),
    minTrials: 1,
    minEvalReceipts: 1,
    minSuccessRate: 0,
    maxUnknownRate: 1,
    maxHumanTakeoverRate: 1,
    maxMeanHumanMinutesPerTrial: 1e9,
    maxMeanCycleTimeMs: 1e15,
    maxMeanCostUsd: 1e9,
    maxErrorRate: 1e6,
    maxReversalRate: 1e6,
    policyEvidenceRefs: ['evidence:review-policy:wrong-binding'],
    validFrom: '2026-08-01T00:00:00Z',
    validUntil: '2026-09-01T00:00:00Z',
  });
  assert.throws(() => createAutonomyReviewProposal({
    proposalRef: 'group:autonomy-review-proposal:wrong-binding',
    series: s,
    reviewPolicy: wrong,
    proposalEvidenceRefs: ['evidence:review:wrong-binding'],
    observedAt: '2026-08-12T00:11:00Z',
  }), /autonomy policy binding does not match/);
});

test('review policy and proposal reject hidden approval or promotion shortcuts', () => {
  const s = series([businessEval('019'), businessEval('020')]);
  assert.throws(() => createBusinessReviewPolicy({
    reviewPolicyRef: 'group:business-review-policy:unsafe',
    actionCode: s.actionCode,
    ownerDomain: s.ownerDomain,
    policyRef: s.policyRef,
    policyDigest: s.policyDigest,
    minTrials: 1,
    minEvalReceipts: 1,
    minSuccessRate: 0,
    maxUnknownRate: 1,
    maxHumanTakeoverRate: 1,
    maxMeanHumanMinutesPerTrial: 1e9,
    maxMeanCycleTimeMs: 1e15,
    maxMeanCostUsd: 1e9,
    maxErrorRate: 1e6,
    maxReversalRate: 1e6,
    policyEvidenceRefs: ['evidence:review-policy:unsafe'],
    validFrom: '2026-08-01T00:00:00Z',
    validUntil: '2026-09-01T00:00:00Z',
    autoPromote: true,
  }), /unsupported field: autoPromote/);

  const rp = reviewPolicy(s);
  assert.throws(() => createAutonomyReviewProposal({
    proposalRef: 'group:autonomy-review-proposal:unsafe',
    series: s,
    reviewPolicy: rp,
    proposalEvidenceRefs: ['evidence:review:unsafe'],
    observedAt: '2026-08-12T00:11:00Z',
    approved: true,
  }), /unsupported field: approved/);
});

test('business eval module has no network, filesystem, child-process, provider or management dependency', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/group-fabric/group-business-evals.cjs'), 'utf8');
  assert.equal(/require\(['"](?:node:)?fs['"]\)/.test(source), false);
  assert.equal(/require\(['"](?:node:)?child_process['"]\)/.test(source), false);
  assert.equal(/\bfetch\s*\(/.test(source), false);
  assert.equal(/src\/management|\.\.\/management|provider-runtime|transport\.invoke/.test(source), false);
});
