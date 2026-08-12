'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');

const {
  GROUP_CEO_PORTFOLIO_BRIEF_SCHEMA,
  MANAGEMENT_CEO_PORTFOLIO_VIEW_SCHEMA,
  OWNER_DOMAIN_TO_PROJECT,
  createManagementCeoPortfolioView,
} = require('../src/management/portfolio/group-ceo-portfolio-brief-adapter.cjs');

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);
const HEX_C = 'c'.repeat(64);
const OBSERVED_AT = '2026-08-12T04:00:00.000Z';

const NO_AUTHORITY = Object.freeze({
  sourceSemanticsVerifiedByThisModule: false,
  llmFactGenerationAllowed: false,
  managementPlaneMutationPerformed: false,
  decisionTruthCreated: false,
  authorizationDecisionCreated: false,
  authorityGrantCreated: false,
  humanGateDecisionCreated: false,
  delegationCreated: false,
  executionAuthorized: false,
  domainTruthCreated: false,
  domainWritePerformed: false,
  externalActionPerformed: false,
  paymentPerformed: false,
  productionDeploymentPerformed: false,
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function compactCard(id, overrides = {}) {
  return {
    cardRef: `group:portfolio-card:${id}`,
    ownerDomain: 'tradeos',
    cardKind: 'project',
    title: `Portfolio ${id}`,
    health: 'on_track',
    freshness: 'fresh',
    stateCode: 'active',
    reasonCode: 'source_current',
    attentionRequired: false,
    nextActionCode: null,
    decisionRef: null,
    ...overrides,
  };
}

function detail(id, overrides = {}) {
  return {
    cardRef: `group:portfolio-card:${id}`,
    cardDigest: HEX_A,
    workEntryRef: `group:work-entry:${id}`,
    workEntryDigest: `sha256:${HEX_B}`,
    sourceSchema: 'tradeos.group-buyer-research-loop.v1',
    sourceRef: `tradeos:loop:${id}`,
    sourceDigest: `sha256:${HEX_C}`,
    sourceObservedAt: '2026-08-12T03:00:00.000Z',
    evidenceRefs: [`evidence:portfolio:${id}`],
    ...overrides,
  };
}

function decision(id, cardId, urgency = 'normal', overrides = {}) {
  return {
    decisionRef: `group:owner-decision:${id}`,
    decisionLabel: `Review ${id}`,
    urgency,
    decisionKind: 'review',
    reasonCode: 'owner_attention_required',
    evidenceRefs: [`evidence:decision:${id}`],
    cardRef: `group:portfolio-card:${cardId}`,
    proposalOnly: true,
    ownerDecisionRecorded: false,
    humanGateDecisionCreated: false,
    authorizationDecisionCreated: false,
    externalActionPerformed: false,
    ...overrides,
  };
}

function performance(ownerDomain = 'tradeos', overrides = {}) {
  return {
    actionCode: 'buyer_research',
    ownerDomain,
    autonomyLevel: 'L1',
    trialCount: 10,
    successRate: 0.8,
    failureRate: 0.1,
    unknownRate: 0.1,
    humanTakeoverRate: 0.2,
    meanHumanMinutesPerTrial: 3,
    meanCycleTimeMs: 10000,
    meanCostUsd: 0.125,
    errorRate: 0.1,
    reversalRate: 0,
    downstreamMetric: { name: 'proposal_acceptance_rate', value: 0.6, unit: 'ratio', baseline: 0.4 },
    observedAt: '2026-08-12T03:30:00.000Z',
    businessEvidenceOnly: true,
    autonomyPromoted: false,
    productionReadinessGranted: false,
    ...overrides,
  };
}

function makeBrief({ cards, details, decisions = [], totalDecisionCount = decisions.length, businessPerformance = [], overrides = {} }) {
  const counts = {
    cardCount: cards.length,
    attentionCardCount: cards.filter((card) => card.attentionRequired).length,
    staleCardCount: cards.filter((card) => card.freshness === 'stale').length,
    goalCount: cards.filter((card) => card.cardKind === 'goal').length,
    opportunityCount: cards.filter((card) => card.cardKind === 'opportunity').length,
    projectCount: cards.filter((card) => card.cardKind === 'project').length,
    exceptionCount: cards.filter((card) => card.cardKind === 'exception').length,
  };
  const visibleDecisionCount = decisions.length;
  const coverageStatus = totalDecisionCount < 3 ? 'below_target' : totalDecisionCount <= 10 ? 'within_target' : 'above_capacity';
  const unsigned = {
    schema: GROUP_CEO_PORTFOLIO_BRIEF_SCHEMA,
    briefRef: 'group:ceo-portfolio-brief:2026-08-12-am',
    observedAt: OBSERVED_AT,
    portfolioHealth: cards.some((card) => card.health === 'blocked')
      ? 'blocked'
      : cards.some((card) => card.health === 'attention' || card.health === 'unknown')
        ? 'attention'
        : 'on_track',
    ...counts,
    cards,
    decisions: {
      targetMin: 3,
      targetMax: 10,
      coverageStatus,
      totalDecisionCount,
      visibleDecisionCount,
      deferredDecisionCount: Math.max(0, totalDecisionCount - visibleDecisionCount),
      decisions,
      decisionsFabricatedToMeetTarget: false,
    },
    businessPerformance,
    detailIndex: details,
    detailOnlyFieldsExcludedFromCards: ['cardDigest', 'workEntryDigest', 'sourceDigest', 'evidenceRefs'],
    readModelOnly: true,
    digestTraceHiddenFromPrimaryCards: true,
    ...NO_AUTHORITY,
    ...overrides,
  };
  return { ...unsigned, briefDigest: digest(unsigned) };
}

test('maps the four Group owner domains onto existing Management Plane project identities', () => {
  const cards = [
    compactCard('aiexe', { ownerDomain: 'aiexe', cardKind: 'goal' }),
    compactCard('shared', { ownerDomain: 'shared-media', cardKind: 'opportunity' }),
    compactCard('trade', { ownerDomain: 'tradeos' }),
    compactCard('training', { ownerDomain: 'trainingos' }),
  ];
  const result = createManagementCeoPortfolioView(makeBrief({
    cards,
    details: [detail('aiexe'), detail('shared'), detail('trade'), detail('training')],
  }));
  assert.equal(result.schema, MANAGEMENT_CEO_PORTFOLIO_VIEW_SCHEMA);
  assert.deepEqual(OWNER_DOMAIN_TO_PROJECT, {
    aiexe: 'aiexe',
    tradeos: 'tradeos',
    trainingos: 'trainingos',
    'shared-media': 'video-operation-shared-media',
  });
  assert.deepEqual(result.projects.map((row) => row.managementProjectId), [
    'aiexe', 'tradeos', 'trainingos', 'video-operation-shared-media',
  ]);
});

test('keeps the source Group brief as read-only external truth instead of a second management owner', () => {
  const result = createManagementCeoPortfolioView(makeBrief({ cards: [compactCard('one')], details: [detail('one')] }));
  assert.equal(result.readOnly, true);
  assert.equal(result.writeAuthority, 'none');
  assert.equal(result.managementAuthority, 'observe-and-propose');
  assert.equal(result.sourceTruthAuthority, 'external');
  assert.equal(result.sourceSemanticsReinterpreted, false);
  assert.equal(result.managementProposalCreated, false);
});

test('projects attention-required cards without manufacturing a ManagementProposal or decision truth', () => {
  const card = compactCard('blocked', {
    cardKind: 'exception',
    health: 'blocked',
    attentionRequired: true,
    reasonCode: 'owner_conflict',
  });
  const result = createManagementCeoPortfolioView(makeBrief({ cards: [card], details: [detail('blocked')] }));
  assert.equal(result.ownerAttention.length, 1);
  assert.equal(result.ownerAttention[0].managementProjectId, 'tradeos');
  assert.equal(result.ownerAttention[0].proposalOnly, true);
  assert.equal(result.ownerAttention[0].decisionTruthCreated, false);
  assert.equal('proposal' in result.ownerAttention[0], false);
});

test('preserves a real CEO decision proposal and never converts approve/reject category into chosen outcome', () => {
  const card = compactCard('decision', {
    health: 'attention', attentionRequired: true, reasonCode: 'owner_attention_required',
    decisionRef: 'group:owner-decision:decision-1',
  });
  const item = decision('decision-1', 'decision', 'critical', { decisionKind: 'approve' });
  const result = createManagementCeoPortfolioView(makeBrief({ cards: [card], details: [detail('decision')], decisions: [item] }));
  assert.equal(result.decisions.decisions[0].decisionKind, 'approve');
  assert.equal(result.decisions.decisions[0].proposalOnly, true);
  assert.equal(result.decisions.decisions[0].ownerDecisionRecorded, false);
  assert.equal(result.decisions.decisions[0].authorizationDecisionCreated, false);
});

test('stale cards must already be failed closed by the producer before Management Plane accepts them', () => {
  const stale = compactCard('stale', {
    health: 'unknown', freshness: 'stale', attentionRequired: true, reasonCode: 'source_stale',
  });
  const result = createManagementCeoPortfolioView(makeBrief({ cards: [stale], details: [detail('stale')] }));
  assert.equal(result.portfolioHealth, 'attention');
  assert.equal(result.projects[0].health, 'attention');
  assert.equal(result.counts.staleCardCount, 1);

  const bad = compactCard('bad-stale', { freshness: 'stale', health: 'on_track', attentionRequired: false });
  assert.throws(() => createManagementCeoPortfolioView(makeBrief({ cards: [bad], details: [detail('bad-stale')] })), /stale compact card must fail closed/);
});

test('tampering any source brief field without recomputing exact digest is rejected', () => {
  const source = makeBrief({ cards: [compactCard('tamper')], details: [detail('tamper')] });
  assert.throws(() => createManagementCeoPortfolioView({ ...source, portfolioHealth: 'blocked' }), /brief digest mismatch/);
});

test('authority drift in a correctly re-digested producer brief is still rejected', () => {
  const source = makeBrief({
    cards: [compactCard('authority')],
    details: [detail('authority')],
    overrides: { executionAuthorized: true },
  });
  assert.throws(() => createManagementCeoPortfolioView(source), /truth boundary widened: executionAuthorized/);
});

test('detail index must cover the exact card set and cannot smuggle PII or secret-shaped refs', () => {
  assert.throws(() => createManagementCeoPortfolioView(makeBrief({
    cards: [compactCard('one')],
    details: [detail('other')],
  })), /detailIndex must cover exact card set/);

  assert.throws(() => createManagementCeoPortfolioView(makeBrief({
    cards: [compactCard('pii')],
    details: [detail('pii', { sourceRef: 'tradeos:buyer:user@example.com' })],
  })), /email-like PII/);

  assert.throws(() => createManagementCeoPortfolioView(makeBrief({
    cards: [compactCard('secret')],
    details: [detail('secret', { workEntryRef: 'group:work-entry:token=abc' })],
  })), /secret\/session-like material/);
});

test('decision queue target is 3-10, preserves capacity evidence, and cannot fabricate missing decisions', () => {
  const cards = Array.from({ length: 10 }, (_, index) => compactCard(`d-${index}`, {
    health: 'attention', attentionRequired: true, reasonCode: 'owner_attention_required',
    decisionRef: `group:owner-decision:d-${String(index).padStart(2, '0')}`,
  }));
  const decisions = cards.map((card, index) => decision(
    `d-${String(index).padStart(2, '0')}`,
    `d-${index}`,
    index === 0 ? 'critical' : index < 3 ? 'high' : 'normal',
  ));
  const result = createManagementCeoPortfolioView(makeBrief({
    cards,
    details: cards.map((_, index) => detail(`d-${index}`)),
    decisions,
    totalDecisionCount: 12,
  }));
  assert.equal(result.decisions.coverageStatus, 'above_capacity');
  assert.equal(result.decisions.visibleDecisionCount, 10);
  assert.equal(result.decisions.deferredDecisionCount, 2);
  assert.equal(result.decisions.decisionsFabricatedToMeetTarget, false);
});

test('measured W2 business performance remains evidence-only and cannot promote autonomy or readiness', () => {
  const result = createManagementCeoPortfolioView(makeBrief({
    cards: [compactCard('biz')], details: [detail('biz')], businessPerformance: [performance()],
  }));
  assert.equal(result.businessPerformance[0].managementProjectId, 'tradeos');
  assert.equal(result.businessPerformance[0].successRate, 0.8);
  assert.equal(result.businessPerformance[0].businessEvidenceOnly, true);
  assert.equal(result.businessPerformance[0].autonomyPromoted, false);
  assert.equal(result.businessPerformance[0].productionReadinessGranted, false);

  assert.throws(() => createManagementCeoPortfolioView(makeBrief({
    cards: [compactCard('promote')], details: [detail('promote')],
    businessPerformance: [performance('tradeos', { autonomyPromoted: true })],
  })), /cannot promote autonomy or production readiness/);
});

test('unsupported domains and future provenance fail closed', () => {
  assert.throws(() => createManagementCeoPortfolioView(makeBrief({
    cards: [compactCard('finance', { ownerDomain: 'finance' })], details: [detail('finance')],
  })), /unsupported ownerDomain/);

  assert.throws(() => createManagementCeoPortfolioView(makeBrief({
    cards: [compactCard('future')],
    details: [detail('future', { sourceObservedAt: '2026-08-12T05:00:00.000Z' })],
  })), /detail cannot be newer than brief/);
});

test('primary view hides digest trace while deterministic output and provenance remain deeply frozen', () => {
  const source = makeBrief({ cards: [compactCard('freeze')], details: [detail('freeze')] });
  const first = createManagementCeoPortfolioView(source);
  const second = createManagementCeoPortfolioView(source);
  assert.equal(first.viewDigest, second.viewDigest);
  assert.equal(first.primaryViewHidesDigestTrace, true);
  assert.equal('cardDigest' in first.cards[0], false);
  assert.match(first.detailIndex[0].cardDigest, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.cards), true);
  assert.equal(Object.isFrozen(first.detailIndex[0]), true);
  assert.throws(() => { first.projects.push({}); }, TypeError);
});
