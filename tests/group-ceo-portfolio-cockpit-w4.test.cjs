'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createGroupAutonomyPolicy,
  createGroupBusinessEval,
  createGroupDecisionEscalation,
  createGroupWorkEntry,
} = require('../src/group-fabric/group-operating-system.cjs');
const {
  createBusinessEvalSeries,
} = require('../src/group-fabric/group-business-evals.cjs');
const {
  GROUP_CEO_PORTFOLIO_BRIEF_SCHEMA,
  GROUP_DOMAIN_PORTFOLIO_CARD_SCHEMA,
  createCeoPortfolioBrief,
  createDomainPortfolioCard,
} = require('../src/group-fabric/group-ceo-portfolio-cockpit.cjs');

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);
const OBSERVED_AT = '2026-08-12T02:00:00Z';

function decision(id, urgency = 'normal', overrides = {}) {
  return {
    decisionRef: `group:owner-decision:${id}`,
    decisionLabel: `Review ${id}`,
    urgency,
    decisionKind: 'review',
    reasonCode: 'owner_attention_required',
    evidenceRefs: [`evidence:decision:${id}`],
    ...overrides,
  };
}

function cardInput(id, overrides = {}) {
  return {
    cardRef: `group:portfolio-card:${id}`,
    ownerDomain: 'tradeos',
    cardKind: 'project',
    title: `Portfolio item ${id}`,
    workEntryRef: `group:work-entry:${id}`,
    workEntryDigest: HEX_A,
    sourceSchema: 'tradeos.group-buyer-research-loop.v1',
    sourceRef: `tradeos:loop:${id}`,
    sourceDigest: `sha256:${HEX_B}`,
    sourceObservedAt: '2026-08-12T01:00:00Z',
    health: 'on_track',
    stateCode: 'active',
    reasonCode: 'source_current',
    attentionRequired: false,
    nextActionCode: null,
    decision: null,
    evidenceRefs: [`evidence:portfolio:${id}`],
    observedAt: OBSERVED_AT,
    ...overrides,
  };
}

function card(id, overrides = {}) {
  return createDomainPortfolioCard(cardInput(id, overrides));
}

function brief(cards, overrides = {}) {
  return createCeoPortfolioBrief({
    briefRef: 'group:ceo-portfolio-brief:2026-08-12-am',
    cards,
    businessEvalSeries: [],
    observedAt: OBSERVED_AT,
    ...overrides,
  });
}

function businessSeries() {
  const workEntry = createGroupWorkEntry({
    entryRef: 'group:work-entry:biz-eval-001',
    actorRef: 'actor-owner-001',
    organizationRef: 'organization-group-001',
    objective: 'Prepare a bounded buyer research draft.',
    requestedActionCode: 'buyer_research',
    targetRef: 'buyer-research-target-001',
    requestedDomain: 'tradeos',
    sourceKind: 'human',
    createdAt: '2026-08-12T00:00:00Z',
    evidenceRefs: ['evidence:work-entry:001'],
  });
  const policy = createGroupAutonomyPolicy({
    policyRef: 'group:autonomy-policy:buyer-research-l1',
    actionCode: 'buyer_research',
    ownerDomain: 'tradeos',
    autonomyLevel: 'L1',
    reversibility: 'draft_only',
    humanGateRequired: false,
    retryClass: 'none',
    maxAttempts: 1,
    maxCostUsd: 2,
    maxActions: 1,
    evidenceKinds: ['source_evidence'],
    policyEvidenceRefs: ['evidence:policy:001'],
    validFrom: '2026-08-11T00:00:00Z',
    validUntil: '2026-08-13T00:00:00Z',
  });
  const escalation = createGroupDecisionEscalation({
    escalationRef: 'group:decision-escalation:biz-eval-001',
    workEntry,
    policy,
    routeStatus: 'matched',
    routeReasonCode: 'exact_policy_match',
    routeEvidenceRefs: ['evidence:route:001'],
    observedAt: '2026-08-12T00:05:00Z',
  });
  const evalReceipt = createGroupBusinessEval({
    evalRef: 'group:business-eval:001',
    workEntry,
    policy,
    decisionEscalation: escalation,
    trialCount: 10,
    successfulTrials: 8,
    unknownTrials: 1,
    humanTakeoverTrials: 2,
    totalHumanMinutes: 30,
    totalCycleTimeMs: 100000,
    totalCostUsd: 1.25,
    errorCount: 1,
    reversalCount: 0,
    technicalEvidenceRefs: ['evidence:technical:001'],
    businessEvidenceRefs: ['evidence:business:001'],
    downstreamMetric: { name: 'proposal_acceptance_rate', value: 0.6, unit: 'ratio', baseline: 0.4 },
    observedAt: '2026-08-12T00:10:00Z',
  });
  return createBusinessEvalSeries({
    seriesRef: 'group:business-eval-series:buyer-research-001',
    businessEvals: [evalReceipt],
    seriesEvidenceRefs: ['evidence:series:001'],
    observedAt: '2026-08-12T00:20:00Z',
  });
}

test('three healthy domain cards produce an on-track daily brief', () => {
  const result = brief([
    card('goal', { ownerDomain: 'aiexe', cardKind: 'goal' }),
    card('opportunity', { ownerDomain: 'tradeos', cardKind: 'opportunity' }),
    card('project', { ownerDomain: 'trainingos', cardKind: 'project' }),
  ]);
  assert.equal(result.schema, GROUP_CEO_PORTFOLIO_BRIEF_SCHEMA);
  assert.equal(result.portfolioHealth, 'on_track');
  assert.equal(result.goalCount, 1);
  assert.equal(result.opportunityCount, 1);
  assert.equal(result.projectCount, 1);
  assert.equal(result.exceptionCount, 0);
  assert.equal(result.attentionCardCount, 0);
});

test('blocked outranks attention while attention outranks on-track', () => {
  const attention = card('attention', { health: 'attention', attentionRequired: true });
  const blocked = card('blocked', { health: 'blocked', attentionRequired: true });
  assert.equal(brief([card('ok'), attention]).portfolioHealth, 'attention');
  assert.equal(brief([card('ok2'), attention, blocked]).portfolioHealth, 'blocked');
});

test('stale source is fail-closed to unknown plus owner attention', () => {
  const stale = card('stale', {
    sourceObservedAt: '2026-08-10T00:00:00Z',
    health: 'on_track',
    attentionRequired: false,
  });
  assert.equal(stale.schema, GROUP_DOMAIN_PORTFOLIO_CARD_SCHEMA);
  assert.equal(stale.freshness, 'stale');
  assert.equal(stale.health, 'unknown');
  assert.equal(stale.attentionRequired, true);
  assert.equal(stale.reasonCode, 'source_stale');
  assert.equal(stale.staleSourceMayGrantPositiveTruth, false);
});

test('CEO decisions sort deterministically critical then high then normal', () => {
  const result = brief([
    card('normal', { health: 'attention', attentionRequired: true, decision: decision('z-normal', 'normal') }),
    card('critical-b', { health: 'blocked', attentionRequired: true, decision: decision('b-critical', 'critical') }),
    card('high', { health: 'attention', attentionRequired: true, decision: decision('a-high', 'high') }),
    card('critical-a', { health: 'blocked', attentionRequired: true, decision: decision('a-critical', 'critical') }),
  ]);
  assert.deepEqual(result.decisions.decisions.map((item) => item.decisionRef), [
    'group:owner-decision:a-critical',
    'group:owner-decision:b-critical',
    'group:owner-decision:a-high',
    'group:owner-decision:z-normal',
  ]);
  assert.equal(result.decisions.coverageStatus, 'within_target');
});

test('more than ten real decisions are capped without deleting capacity evidence', () => {
  const cards = Array.from({ length: 12 }, (_, index) => card(`decision-${index}`, {
    health: 'attention',
    attentionRequired: true,
    decision: decision(`decision-${String(index).padStart(2, '0')}`, index < 2 ? 'critical' : 'normal'),
  }));
  const result = brief(cards);
  assert.equal(result.decisions.coverageStatus, 'above_capacity');
  assert.equal(result.decisions.totalDecisionCount, 12);
  assert.equal(result.decisions.visibleDecisionCount, 10);
  assert.equal(result.decisions.deferredDecisionCount, 2);
  assert.equal(result.decisions.decisions.length, 10);
});

test('fewer than three real decisions remain below-target and are never fabricated', () => {
  const result = brief([
    card('one', { health: 'attention', attentionRequired: true, decision: decision('one', 'high') }),
    card('two', { health: 'attention', attentionRequired: true, decision: decision('two', 'normal') }),
  ]);
  assert.equal(result.decisions.coverageStatus, 'below_target');
  assert.equal(result.decisions.totalDecisionCount, 2);
  assert.equal(result.decisions.decisionsFabricatedToMeetTarget, false);
});

test('primary cards hide digest and evidence trace while detailIndex preserves provenance', () => {
  const result = brief([card('detail')]);
  const primary = result.cards[0];
  assert.equal('cardDigest' in primary, false);
  assert.equal('workEntryDigest' in primary, false);
  assert.equal('sourceDigest' in primary, false);
  assert.equal('evidenceRefs' in primary, false);
  assert.match(result.detailIndex[0].cardDigest, /^[a-f0-9]{64}$/);
  assert.match(result.detailIndex[0].sourceDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.digestTraceHiddenFromPrimaryCards, true);
});

test('valid W2 business-eval series is projected as compact measured performance only', () => {
  const result = brief([card('biz')], { businessEvalSeries: [businessSeries()] });
  assert.equal(result.businessPerformance.length, 1);
  const performance = result.businessPerformance[0];
  assert.equal(performance.ownerDomain, 'tradeos');
  assert.equal(performance.actionCode, 'buyer_research');
  assert.equal(performance.trialCount, 10);
  assert.equal(performance.successRate, 0.8);
  assert.equal(performance.businessEvidenceOnly, true);
  assert.equal(performance.autonomyPromoted, false);
  assert.equal(performance.productionReadinessGranted, false);
});

test('tampered W2 business-eval series is rejected before cockpit projection', () => {
  const series = businessSeries();
  const tampered = { ...series, successRate: 1 };
  assert.throws(() => brief([card('tamper')], { businessEvalSeries: [tampered] }), /series digest mismatch/);
});

test('PII, secret-shaped references, unsupported domains and future source timestamps fail closed', () => {
  assert.throws(() => card('pii', { sourceRef: 'tradeos:buyer:user@example.com' }), /email-like PII/);
  assert.throws(() => card('secret', { workEntryRef: 'group:work-entry:token=abc' }), /secret\/session-like material/);
  assert.throws(() => card('domain', { ownerDomain: 'finance' }), /ownerDomain is unsupported/);
  assert.throws(() => card('future', { sourceObservedAt: '2026-08-12T03:00:00Z' }), /cannot be in the future/);
});

test('authority-shaped fields and decision truth injection are rejected', () => {
  assert.throws(() => createDomainPortfolioCard({ ...cardInput('authority'), executionAuthorized: true }), /unsupported field/);
  assert.throws(() => card('decision-truth', {
    health: 'attention',
    attentionRequired: true,
    decision: { ...decision('truth'), ownerDecisionRecorded: true },
  }), /unsupported field/);
  const result = brief([card('closed-boundary')]);
  assert.equal(result.llmFactGenerationAllowed, false);
  assert.equal(result.managementPlaneMutationPerformed, false);
  assert.equal(result.decisionTruthCreated, false);
  assert.equal(result.humanGateDecisionCreated, false);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.externalActionPerformed, false);
  assert.equal(result.paymentPerformed, false);
  assert.equal(result.productionDeploymentPerformed, false);
});

test('brief digest and ordering are deterministic and deeply frozen', () => {
  const left = card('left', { ownerDomain: 'trainingos' });
  const right = card('right', { ownerDomain: 'shared-media' });
  const first = brief([right, left]);
  const second = brief([left, right]);
  assert.equal(first.briefDigest, second.briefDigest);
  assert.deepEqual(first.cards.map((item) => item.cardRef), [
    'group:portfolio-card:left',
    'group:portfolio-card:right',
  ]);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.cards), true);
  assert.equal(Object.isFrozen(first.detailIndex[0]), true);
  assert.throws(() => { first.cards.push({}); }, TypeError);
});
