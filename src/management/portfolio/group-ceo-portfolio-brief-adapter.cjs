'use strict';

const { createHash } = require('node:crypto');

const GROUP_CEO_PORTFOLIO_BRIEF_SCHEMA = 'group.ceo-portfolio-brief.v1';
const MANAGEMENT_CEO_PORTFOLIO_VIEW_SCHEMA = 'aiexe.management-ceo-portfolio-view.v1';
const MANAGEMENT_AUTHORITY = 'observe-and-propose';
const SOURCE_TRUTH_AUTHORITY = 'external';

const OWNER_DOMAIN_TO_PROJECT = Object.freeze({
  aiexe: 'aiexe',
  tradeos: 'tradeos',
  trainingos: 'trainingos',
  'shared-media': 'video-operation-shared-media',
});

const CARD_KINDS = Object.freeze(['goal', 'opportunity', 'project', 'exception']);
const HEALTH_STATES = Object.freeze(['on_track', 'attention', 'blocked', 'unknown']);
const FRESHNESS_STATES = Object.freeze(['fresh', 'stale']);
const DECISION_URGENCY = Object.freeze(['normal', 'high', 'critical']);
const DECISION_KINDS = Object.freeze(['review', 'approve', 'reject', 'choose']);
const URGENCY_WEIGHT = Object.freeze({ critical: 0, high: 1, normal: 2 });
const DECISION_TARGET_MIN = 3;
const DECISION_TARGET_MAX = 10;

const ROOT_NO_AUTHORITY_FLAGS = Object.freeze([
  'sourceSemanticsVerifiedByThisModule',
  'llmFactGenerationAllowed',
  'managementPlaneMutationPerformed',
  'decisionTruthCreated',
  'authorizationDecisionCreated',
  'authorityGrantCreated',
  'humanGateDecisionCreated',
  'delegationCreated',
  'executionAuthorized',
  'domainTruthCreated',
  'domainWritePerformed',
  'externalActionPerformed',
  'paymentPerformed',
  'productionDeploymentPerformed',
]);

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) freezeDeep(nested);
  return value;
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function assertAllowedKeys(input, allowed, label) {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TypeError(`${label} contains unsupported field: ${key}`);
  }
}

function requiredText(value, label, max = 320) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new TypeError(`${label} must be bounded non-empty text`);
  return normalized;
}

function safeDisplayText(value, label, max = 500) {
  const normalized = requiredText(value, label, max);
  if (/@[^/\s]+\.[A-Za-z]{2,}/.test(normalized)) throw new TypeError(`${label} must not contain email-like PII`);
  if (/bearer\s+|password\s*[:=]|secret\s*[:=]|token\s*[:=]|api[_-]?key\s*[:=]|cookie\s*[:=]|session\s*[:=]/i.test(normalized)) {
    throw new TypeError(`${label} must not contain secret/session-like material`);
  }
  return normalized;
}

function safeCode(value, label) {
  const normalized = requiredText(value, label, 96);
  if (!/^[a-z][a-z0-9._-]{0,95}$/.test(normalized)) throw new TypeError(`${label} must be a bounded code`);
  return normalized;
}

function safeRef(value, label, prefix = null) {
  const normalized = requiredText(value, label, 320);
  if (/@[^/\s]+\.[A-Za-z]{2,}/.test(normalized)) throw new TypeError(`${label} must not contain email-like PII`);
  if (/bearer|password|secret|token=|api[_-]?key|cookie|session=/i.test(normalized)) {
    throw new TypeError(`${label} must not contain secret/session-like material`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9:._@/-]*$/.test(normalized)) throw new TypeError(`${label} contains invalid characters`);
  if (prefix && !normalized.startsWith(prefix)) throw new TypeError(`${label} must start with ${prefix}`);
  return normalized;
}

function timestamp(value, label) {
  const normalized = requiredText(value, label, 40);
  const time = Date.parse(normalized);
  if (!Number.isFinite(time) || !normalized.endsWith('Z')) {
    throw new TypeError(`${label} must be an ISO-8601 UTC timestamp`);
  }
  return { text: new Date(time).toISOString(), time };
}

function sha256Hex(value, label) {
  const normalized = requiredText(value, label, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new TypeError(`${label} must be a SHA-256 hex digest`);
  return normalized;
}

function normalizedSha256(value, label) {
  const normalized = requiredText(value, label, 80).toLowerCase();
  const match = normalized.match(/^(?:sha256:)?([a-f0-9]{64})$/);
  if (!match) throw new TypeError(`${label} must be a SHA-256 digest`);
  return `sha256:${match[1]}`;
}

function boundedNumber(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new TypeError(`${label} must be a bounded number`);
  }
  return value;
}

function boundedInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) throw new TypeError(`${label} must be a bounded integer`);
  return value;
}

function uniqueEvidenceRefs(value, label, min = 0, max = 64) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new TypeError(`${label} must be a bounded array`);
  const refs = value.map((item) => safeRef(item, label, 'evidence:'));
  if (new Set(refs).size !== refs.length) throw new TypeError(`${label} must not contain duplicates`);
  return Object.freeze([...refs].sort());
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function projectIdForOwnerDomain(ownerDomain) {
  const normalized = safeCode(ownerDomain, 'ownerDomain');
  const projectId = OWNER_DOMAIN_TO_PROJECT[normalized];
  if (!projectId) throw new TypeError(`unsupported ownerDomain: ${normalized}`);
  return projectId;
}

function assertNoAuthorityFlags(value, label) {
  for (const key of ROOT_NO_AUTHORITY_FLAGS) {
    if (value[key] !== false) throw new TypeError(`${label} truth boundary widened: ${key}`);
  }
}

function assertCompactCard(card) {
  plainObject(card, 'CEO portfolio compact card');
  assertAllowedKeys(card, new Set([
    'cardRef', 'ownerDomain', 'cardKind', 'title', 'health', 'freshness',
    'stateCode', 'reasonCode', 'attentionRequired', 'nextActionCode', 'decisionRef',
  ]), 'CEO portfolio compact card');
  const ownerDomain = safeCode(card.ownerDomain, 'compact card ownerDomain');
  projectIdForOwnerDomain(ownerDomain);
  const cardKind = safeCode(card.cardKind, 'compact card cardKind');
  if (!CARD_KINDS.includes(cardKind)) throw new TypeError('compact card cardKind is unsupported');
  const health = safeCode(card.health, 'compact card health');
  if (!HEALTH_STATES.includes(health)) throw new TypeError('compact card health is unsupported');
  const freshness = safeCode(card.freshness, 'compact card freshness');
  if (!FRESHNESS_STATES.includes(freshness)) throw new TypeError('compact card freshness is unsupported');
  if (typeof card.attentionRequired !== 'boolean') throw new TypeError('compact card attentionRequired must be boolean');
  if (freshness === 'stale') {
    if (health !== 'unknown' || card.attentionRequired !== true || card.reasonCode !== 'source_stale') {
      throw new TypeError('stale compact card must fail closed to unknown + owner attention');
    }
  }
  if (cardKind === 'exception' && card.attentionRequired !== true) throw new TypeError('exception compact card must require attention');
  const decisionRef = card.decisionRef == null ? null : safeRef(card.decisionRef, 'compact card decisionRef', 'group:owner-decision:');
  if (decisionRef && card.attentionRequired !== true) throw new TypeError('compact card with decisionRef must require attention');
  return freezeDeep({
    cardRef: safeRef(card.cardRef, 'compact card cardRef', 'group:portfolio-card:'),
    ownerDomain,
    managementProjectId: projectIdForOwnerDomain(ownerDomain),
    cardKind,
    title: safeDisplayText(card.title, 'compact card title', 500),
    health,
    freshness,
    stateCode: safeCode(card.stateCode, 'compact card stateCode'),
    reasonCode: safeCode(card.reasonCode, 'compact card reasonCode'),
    attentionRequired: card.attentionRequired,
    nextActionCode: card.nextActionCode == null ? null : safeCode(card.nextActionCode, 'compact card nextActionCode'),
    decisionRef,
  });
}

function assertDetail(detail) {
  plainObject(detail, 'CEO portfolio detail index row');
  assertAllowedKeys(detail, new Set([
    'cardRef', 'cardDigest', 'workEntryRef', 'workEntryDigest', 'sourceSchema',
    'sourceRef', 'sourceDigest', 'sourceObservedAt', 'evidenceRefs',
  ]), 'CEO portfolio detail index row');
  return freezeDeep({
    cardRef: safeRef(detail.cardRef, 'detail cardRef', 'group:portfolio-card:'),
    cardDigest: sha256Hex(detail.cardDigest, 'detail cardDigest'),
    workEntryRef: safeRef(detail.workEntryRef, 'detail workEntryRef', 'group:work-entry:'),
    workEntryDigest: normalizedSha256(detail.workEntryDigest, 'detail workEntryDigest'),
    sourceSchema: safeCode(detail.sourceSchema, 'detail sourceSchema'),
    sourceRef: safeRef(detail.sourceRef, 'detail sourceRef'),
    sourceDigest: normalizedSha256(detail.sourceDigest, 'detail sourceDigest'),
    sourceObservedAt: timestamp(detail.sourceObservedAt, 'detail sourceObservedAt').text,
    evidenceRefs: uniqueEvidenceRefs(detail.evidenceRefs, 'detail evidenceRefs', 1, 64),
  });
}

function assertDecision(decision, cardByRef) {
  plainObject(decision, 'CEO decision proposal');
  assertAllowedKeys(decision, new Set([
    'decisionRef', 'decisionLabel', 'urgency', 'decisionKind', 'reasonCode', 'evidenceRefs',
    'cardRef', 'proposalOnly', 'ownerDecisionRecorded', 'humanGateDecisionCreated',
    'authorizationDecisionCreated', 'externalActionPerformed',
  ]), 'CEO decision proposal');
  const cardRef = safeRef(decision.cardRef, 'decision cardRef', 'group:portfolio-card:');
  const card = cardByRef.get(cardRef);
  if (!card) throw new TypeError('CEO decision proposal references an unknown card');
  const decisionRef = safeRef(decision.decisionRef, 'decisionRef', 'group:owner-decision:');
  if (card.decisionRef !== decisionRef) throw new TypeError('CEO decision proposal must match compact card decisionRef');
  const urgency = safeCode(decision.urgency, 'decision urgency');
  if (!DECISION_URGENCY.includes(urgency)) throw new TypeError('decision urgency is unsupported');
  const decisionKind = safeCode(decision.decisionKind, 'decision kind');
  if (!DECISION_KINDS.includes(decisionKind)) throw new TypeError('decision kind is unsupported');
  if (decision.proposalOnly !== true) throw new TypeError('CEO decision must remain proposal-only');
  for (const key of ['ownerDecisionRecorded', 'humanGateDecisionCreated', 'authorizationDecisionCreated', 'externalActionPerformed']) {
    if (decision[key] !== false) throw new TypeError(`CEO decision truth boundary widened: ${key}`);
  }
  return freezeDeep({
    decisionRef,
    decisionLabel: safeDisplayText(decision.decisionLabel, 'decisionLabel', 500),
    urgency,
    decisionKind,
    reasonCode: safeCode(decision.reasonCode, 'decision reasonCode'),
    evidenceRefs: uniqueEvidenceRefs(decision.evidenceRefs, 'decision evidenceRefs', 1, 32),
    cardRef,
    managementProjectId: card.managementProjectId,
    proposalOnly: true,
    ownerDecisionRecorded: false,
    humanGateDecisionCreated: false,
    authorizationDecisionCreated: false,
    externalActionPerformed: false,
  });
}

function assertDecisionQueue(queue, cardByRef) {
  plainObject(queue, 'CEO decision queue');
  assertAllowedKeys(queue, new Set([
    'targetMin', 'targetMax', 'coverageStatus', 'totalDecisionCount', 'visibleDecisionCount',
    'deferredDecisionCount', 'decisions', 'decisionsFabricatedToMeetTarget',
  ]), 'CEO decision queue');
  if (queue.targetMin !== DECISION_TARGET_MIN || queue.targetMax !== DECISION_TARGET_MAX) {
    throw new TypeError('CEO decision queue target range drift');
  }
  const totalDecisionCount = boundedInteger(queue.totalDecisionCount, 'totalDecisionCount', { max: 100000 });
  const visibleDecisionCount = boundedInteger(queue.visibleDecisionCount, 'visibleDecisionCount', { max: DECISION_TARGET_MAX });
  const deferredDecisionCount = boundedInteger(queue.deferredDecisionCount, 'deferredDecisionCount', { max: 100000 });
  if (!Array.isArray(queue.decisions) || queue.decisions.length !== visibleDecisionCount) {
    throw new TypeError('CEO decision queue visibleDecisionCount mismatch');
  }
  if (visibleDecisionCount !== Math.min(totalDecisionCount, DECISION_TARGET_MAX)) throw new TypeError('CEO decision queue visible capacity mismatch');
  if (deferredDecisionCount !== Math.max(0, totalDecisionCount - visibleDecisionCount)) throw new TypeError('CEO decision queue deferredDecisionCount mismatch');
  const expectedCoverage = totalDecisionCount < DECISION_TARGET_MIN
    ? 'below_target'
    : totalDecisionCount <= DECISION_TARGET_MAX
      ? 'within_target'
      : 'above_capacity';
  if (queue.coverageStatus !== expectedCoverage) throw new TypeError('CEO decision queue coverageStatus mismatch');
  if (queue.decisionsFabricatedToMeetTarget !== false) throw new TypeError('CEO decision queue cannot fabricate decisions');

  const decisions = queue.decisions.map((item) => assertDecision(item, cardByRef));
  const refs = decisions.map((item) => item.decisionRef);
  if (new Set(refs).size !== refs.length) throw new TypeError('CEO decision queue contains duplicate decision refs');
  const sortedRefs = [...decisions].sort((left, right) => {
    const urgency = URGENCY_WEIGHT[left.urgency] - URGENCY_WEIGHT[right.urgency];
    if (urgency !== 0) return urgency;
    return left.decisionRef.localeCompare(right.decisionRef);
  }).map((item) => item.decisionRef);
  if (JSON.stringify(refs) !== JSON.stringify(sortedRefs)) throw new TypeError('CEO decision queue ordering drift');

  return freezeDeep({
    targetMin: DECISION_TARGET_MIN,
    targetMax: DECISION_TARGET_MAX,
    coverageStatus: expectedCoverage,
    totalDecisionCount,
    visibleDecisionCount,
    deferredDecisionCount,
    decisions: Object.freeze(decisions),
    decisionsFabricatedToMeetTarget: false,
  });
}

function assertDownstreamMetric(metric) {
  if (metric == null) return null;
  plainObject(metric, 'business downstreamMetric');
  assertAllowedKeys(metric, new Set(['name', 'value', 'unit', 'baseline']), 'business downstreamMetric');
  return freezeDeep({
    name: safeCode(metric.name, 'business downstreamMetric name'),
    value: boundedNumber(metric.value, 'business downstreamMetric value', { min: -1e12, max: 1e12 }),
    unit: safeCode(metric.unit, 'business downstreamMetric unit'),
    baseline: metric.baseline == null ? null : boundedNumber(metric.baseline, 'business downstreamMetric baseline', { min: -1e12, max: 1e12 }),
  });
}

function assertBusinessPerformance(value) {
  plainObject(value, 'business performance row');
  assertAllowedKeys(value, new Set([
    'actionCode', 'ownerDomain', 'autonomyLevel', 'trialCount', 'successRate', 'failureRate',
    'unknownRate', 'humanTakeoverRate', 'meanHumanMinutesPerTrial', 'meanCycleTimeMs',
    'meanCostUsd', 'errorRate', 'reversalRate', 'downstreamMetric', 'observedAt',
    'businessEvidenceOnly', 'autonomyPromoted', 'productionReadinessGranted',
  ]), 'business performance row');
  const ownerDomain = safeCode(value.ownerDomain, 'business performance ownerDomain');
  const autonomyLevel = requiredText(value.autonomyLevel, 'business performance autonomyLevel', 2);
  if (!/^L[0-4]$/.test(autonomyLevel)) throw new TypeError('business performance autonomyLevel is unsupported');
  if (value.businessEvidenceOnly !== true) throw new TypeError('business performance must remain evidence-only');
  if (value.autonomyPromoted !== false || value.productionReadinessGranted !== false) {
    throw new TypeError('business performance cannot promote autonomy or production readiness');
  }
  const rates = ['successRate', 'failureRate', 'unknownRate', 'humanTakeoverRate', 'errorRate', 'reversalRate'];
  const normalized = {};
  for (const key of rates) normalized[key] = boundedNumber(value[key], `business performance ${key}`, { min: 0, max: 1 });
  return freezeDeep({
    actionCode: safeCode(value.actionCode, 'business performance actionCode'),
    ownerDomain,
    managementProjectId: projectIdForOwnerDomain(ownerDomain),
    autonomyLevel,
    trialCount: boundedInteger(value.trialCount, 'business performance trialCount', { min: 1, max: 1000000000 }),
    ...normalized,
    meanHumanMinutesPerTrial: boundedNumber(value.meanHumanMinutesPerTrial, 'business performance meanHumanMinutesPerTrial', { max: 1000000000 }),
    meanCycleTimeMs: boundedNumber(value.meanCycleTimeMs, 'business performance meanCycleTimeMs', { max: 1e15 }),
    meanCostUsd: boundedNumber(value.meanCostUsd, 'business performance meanCostUsd', { max: 1e12 }),
    downstreamMetric: assertDownstreamMetric(value.downstreamMetric),
    observedAt: timestamp(value.observedAt, 'business performance observedAt').text,
    businessEvidenceOnly: true,
    autonomyPromoted: false,
    productionReadinessGranted: false,
  });
}

function aggregateProjectHealth(cards) {
  if (cards.some((card) => card.health === 'blocked')) return 'blocked';
  if (cards.some((card) => card.health === 'attention' || card.health === 'unknown')) return 'attention';
  return 'on_track';
}

function buildProjects(cards) {
  const domains = [...new Set(cards.map((card) => card.ownerDomain))].sort();
  return freezeDeep(domains.map((ownerDomain) => {
    const domainCards = cards.filter((card) => card.ownerDomain === ownerDomain);
    return freezeDeep({
      ownerDomain,
      managementProjectId: projectIdForOwnerDomain(ownerDomain),
      health: aggregateProjectHealth(domainCards),
      cardCount: domainCards.length,
      attentionCardCount: domainCards.filter((card) => card.attentionRequired).length,
      staleCardCount: domainCards.filter((card) => card.freshness === 'stale').length,
      cardRefs: Object.freeze(domainCards.map((card) => card.cardRef).sort()),
    });
  }).sort((left, right) => left.managementProjectId.localeCompare(right.managementProjectId))));
}

function createManagementCeoPortfolioView(input) {
  const brief = plainObject(input, 'Group CEO portfolio brief');
  if (brief.schema !== GROUP_CEO_PORTFOLIO_BRIEF_SCHEMA) throw new TypeError('Group CEO portfolio brief schema mismatch');
  const { briefDigest, ...unsigned } = brief;
  if (sha256Hex(briefDigest, 'Group CEO portfolio brief briefDigest') !== digest(unsigned)) {
    throw new TypeError('Group CEO portfolio brief digest mismatch');
  }
  if (brief.readModelOnly !== true || brief.digestTraceHiddenFromPrimaryCards !== true) {
    throw new TypeError('Group CEO portfolio brief read-model boundary drift');
  }
  assertNoAuthorityFlags(brief, 'Group CEO portfolio brief');

  const observedAt = timestamp(brief.observedAt, 'Group CEO portfolio brief observedAt');
  const briefRef = safeRef(brief.briefRef, 'Group CEO portfolio brief briefRef', 'group:ceo-portfolio-brief:');
  const portfolioHealth = safeCode(brief.portfolioHealth, 'Group CEO portfolio brief portfolioHealth');
  if (!['on_track', 'attention', 'blocked'].includes(portfolioHealth)) throw new TypeError('Group CEO portfolio brief portfolioHealth is unsupported');
  if (!Array.isArray(brief.cards) || brief.cards.length < 1 || brief.cards.length > 256) throw new TypeError('Group CEO portfolio brief cards must be bounded');
  const cards = brief.cards.map(assertCompactCard);
  const cardRefs = cards.map((card) => card.cardRef);
  if (new Set(cardRefs).size !== cardRefs.length) throw new TypeError('Group CEO portfolio brief contains duplicate card refs');
  const cardByRef = new Map(cards.map((card) => [card.cardRef, card]));

  if (!Array.isArray(brief.detailIndex) || brief.detailIndex.length !== cards.length) throw new TypeError('Group CEO portfolio brief detailIndex mismatch');
  const details = brief.detailIndex.map(assertDetail);
  const detailRefs = details.map((row) => row.cardRef);
  if (new Set(detailRefs).size !== detailRefs.length) throw new TypeError('Group CEO portfolio brief detailIndex contains duplicate card refs');
  if (JSON.stringify([...cardRefs].sort()) !== JSON.stringify([...detailRefs].sort())) throw new TypeError('Group CEO portfolio brief detailIndex must cover exact card set');
  for (const detail of details) {
    if (Date.parse(detail.sourceObservedAt) > observedAt.time) throw new TypeError('Group CEO portfolio detail cannot be newer than brief');
  }

  const countFields = ['cardCount', 'attentionCardCount', 'staleCardCount', 'goalCount', 'opportunityCount', 'projectCount', 'exceptionCount'];
  for (const key of countFields) boundedInteger(brief[key], `Group CEO portfolio brief ${key}`, { max: 256 });
  if (brief.cardCount !== cards.length) throw new TypeError('Group CEO portfolio brief cardCount mismatch');
  if (brief.attentionCardCount !== cards.filter((card) => card.attentionRequired).length) throw new TypeError('Group CEO portfolio brief attentionCardCount mismatch');
  if (brief.staleCardCount !== cards.filter((card) => card.freshness === 'stale').length) throw new TypeError('Group CEO portfolio brief staleCardCount mismatch');
  const kindCountMap = { goal: 'goalCount', opportunity: 'opportunityCount', project: 'projectCount', exception: 'exceptionCount' };
  for (const [kind, field] of Object.entries(kindCountMap)) {
    if (brief[field] !== cards.filter((card) => card.cardKind === kind).length) throw new TypeError(`Group CEO portfolio brief ${field} mismatch`);
  }

  const decisions = assertDecisionQueue(brief.decisions, cardByRef);
  const decisionCardRefs = new Set(decisions.decisions.map((decision) => decision.cardRef));
  for (const card of cards) {
    if (card.decisionRef && !decisionCardRefs.has(card.cardRef)) throw new TypeError('visible compact card decisionRef lacks visible decision proposal');
  }

  if (!Array.isArray(brief.businessPerformance) || brief.businessPerformance.length > 64) throw new TypeError('Group CEO portfolio brief businessPerformance must be bounded');
  const businessPerformance = brief.businessPerformance.map(assertBusinessPerformance);
  for (const row of businessPerformance) {
    if (Date.parse(row.observedAt) > observedAt.time) throw new TypeError('business performance cannot be newer than brief');
  }

  if (!Array.isArray(brief.detailOnlyFieldsExcludedFromCards)) throw new TypeError('detailOnlyFieldsExcludedFromCards must be an array');
  const expectedExcluded = ['cardDigest', 'workEntryDigest', 'sourceDigest', 'evidenceRefs'];
  if (JSON.stringify(brief.detailOnlyFieldsExcludedFromCards) !== JSON.stringify(expectedExcluded)) {
    throw new TypeError('detail-only field boundary drift');
  }

  const ownerAttention = freezeDeep(cards
    .filter((card) => card.attentionRequired)
    .map((card) => ({
      managementProjectId: card.managementProjectId,
      ownerDomain: card.ownerDomain,
      cardRef: card.cardRef,
      cardKind: card.cardKind,
      title: card.title,
      health: card.health,
      freshness: card.freshness,
      stateCode: card.stateCode,
      reasonCode: card.reasonCode,
      decisionRef: card.decisionRef,
      proposalOnly: true,
      decisionTruthCreated: false,
      managementMutationPerformed: false,
    }))
    .sort((left, right) => left.managementProjectId.localeCompare(right.managementProjectId) || left.cardRef.localeCompare(right.cardRef)));

  const view = {
    schema: MANAGEMENT_CEO_PORTFOLIO_VIEW_SCHEMA,
    observedAt: observedAt.text,
    sourceBrief: freezeDeep({
      schema: GROUP_CEO_PORTFOLIO_BRIEF_SCHEMA,
      briefRef,
      briefDigest,
      observedAt: observedAt.text,
    }),
    portfolioHealth,
    counts: freezeDeep({
      cardCount: brief.cardCount,
      attentionCardCount: brief.attentionCardCount,
      staleCardCount: brief.staleCardCount,
      goalCount: brief.goalCount,
      opportunityCount: brief.opportunityCount,
      projectCount: brief.projectCount,
      exceptionCount: brief.exceptionCount,
    }),
    projects: buildProjects(cards),
    cards: freezeDeep(cards.map((card) => ({ ...card }))),
    ownerAttention,
    decisions,
    businessPerformance: freezeDeep([...businessPerformance].sort((left, right) => left.managementProjectId.localeCompare(right.managementProjectId) || left.actionCode.localeCompare(right.actionCode))),
    detailIndex: freezeDeep([...details].sort((left, right) => left.cardRef.localeCompare(right.cardRef))),
    primaryViewHidesDigestTrace: true,
    sourceSemanticsReinterpreted: false,
    managementProposalCreated: false,
    managementAuthority: MANAGEMENT_AUTHORITY,
    sourceTruthAuthority: SOURCE_TRUTH_AUTHORITY,
    readOnly: true,
    writeAuthority: 'none',
    ...Object.fromEntries(ROOT_NO_AUTHORITY_FLAGS.map((key) => [key, false])),
  };
  return freezeDeep({ ...view, viewDigest: digest(view) });
}

module.exports = {
  DECISION_TARGET_MAX,
  DECISION_TARGET_MIN,
  GROUP_CEO_PORTFOLIO_BRIEF_SCHEMA,
  MANAGEMENT_CEO_PORTFOLIO_VIEW_SCHEMA,
  OWNER_DOMAIN_TO_PROJECT,
  createManagementCeoPortfolioView,
  projectIdForOwnerDomain,
};
