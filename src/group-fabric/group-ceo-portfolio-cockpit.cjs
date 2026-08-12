'use strict';

const { createHash } = require('node:crypto');
const {
  GROUP_BUSINESS_EVAL_SERIES_SCHEMA,
} = require('./group-business-evals.cjs');

const GROUP_DOMAIN_PORTFOLIO_CARD_SCHEMA = 'group.domain-portfolio-card.v1';
const GROUP_CEO_PORTFOLIO_BRIEF_SCHEMA = 'group.ceo-portfolio-brief.v1';
const MAX_CARD_AGE_SECONDS = 24 * 60 * 60;
const DECISION_TARGET_MIN = 3;
const DECISION_TARGET_MAX = 10;

const OWNER_DOMAINS = Object.freeze(['aiexe', 'tradeos', 'trainingos', 'shared-media']);
const CARD_KINDS = Object.freeze(['goal', 'opportunity', 'project', 'exception']);
const HEALTH_STATES = Object.freeze(['on_track', 'attention', 'blocked', 'unknown']);
const DECISION_URGENCY = Object.freeze(['normal', 'high', 'critical']);
const DECISION_KINDS = Object.freeze(['review', 'approve', 'reject', 'choose']);
const URGENCY_WEIGHT = Object.freeze({ critical: 0, high: 1, normal: 2 });

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

function text(value, label, max = 240) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new TypeError(`${label} must be bounded non-empty text`);
  return normalized;
}

function safeDisplayText(value, label, max = 500) {
  const normalized = text(value, label, max);
  if (/@[^/\s]+\.[A-Za-z]{2,}/.test(normalized)) throw new TypeError(`${label} must not contain email-like PII`);
  if (/bearer\s+|password\s*[:=]|secret\s*[:=]|token\s*[:=]|api[_-]?key\s*[:=]|cookie\s*[:=]|session\s*[:=]/i.test(normalized)) {
    throw new TypeError(`${label} must not contain secret/session-like material`);
  }
  return normalized;
}

function safeCode(value, label) {
  const normalized = text(value, label, 96);
  if (!/^[a-z][a-z0-9._-]{0,95}$/.test(normalized)) throw new TypeError(`${label} must be a bounded code`);
  return normalized;
}

function safeRef(value, label, prefix = null) {
  const normalized = text(value, label, 280);
  if (/@[^/\s]+\.[A-Za-z]{2,}/.test(normalized)) throw new TypeError(`${label} must not contain email-like PII`);
  if (/bearer|password|secret|token=|api[_-]?key|cookie|session=/i.test(normalized)) {
    throw new TypeError(`${label} must not contain secret/session-like material`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9:._@/-]*$/.test(normalized)) throw new TypeError(`${label} contains invalid characters`);
  if (prefix && !normalized.startsWith(prefix)) throw new TypeError(`${label} must start with ${prefix}`);
  return normalized;
}

function timestamp(value, label) {
  const normalized = text(value, label, 40);
  const time = Date.parse(normalized);
  if (!Number.isFinite(time) || !normalized.endsWith('Z')) {
    throw new TypeError(`${label} must be an ISO-8601 UTC timestamp`);
  }
  return { text: new Date(time).toISOString(), time };
}

function normalizedSha256(value, label) {
  const normalized = text(value, label, 80).toLowerCase();
  const match = normalized.match(/^(?:sha256:)?([a-f0-9]{64})$/);
  if (!match) throw new TypeError(`${label} must be a SHA-256 digest`);
  return `sha256:${match[1]}`;
}

function digestHex(value, label) {
  const normalized = text(value, label, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new TypeError(`${label} must be a SHA-256 hex digest`);
  return normalized;
}

function uniqueRefs(value, label, min = 0, max = 64) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new TypeError(`${label} must be a bounded array`);
  }
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

function noAuthorityFlags() {
  return {
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
  };
}

function assertFalse(value, label) {
  if (value !== false) throw new TypeError(`${label} must be false`);
}

function assertNoAuthorityFlags(value, label) {
  const flags = noAuthorityFlags();
  for (const [key, expected] of Object.entries(flags)) {
    if (value[key] !== expected) throw new TypeError(`${label} truth boundary widened: ${key}`);
  }
}

function normalizeDecision(input, cardRef) {
  if (input == null) return null;
  const decision = plainObject(input, 'decision item');
  assertAllowedKeys(decision, new Set([
    'decisionRef', 'decisionLabel', 'urgency', 'decisionKind', 'reasonCode', 'evidenceRefs',
  ]), 'decision item');
  const urgency = safeCode(decision.urgency, 'decision urgency');
  if (!DECISION_URGENCY.includes(urgency)) throw new TypeError('decision urgency is unsupported');
  const decisionKind = safeCode(decision.decisionKind, 'decision kind');
  if (!DECISION_KINDS.includes(decisionKind)) throw new TypeError('decision kind is unsupported');
  return freezeDeep({
    decisionRef: safeRef(decision.decisionRef, 'decisionRef', 'group:owner-decision:'),
    decisionLabel: safeDisplayText(decision.decisionLabel, 'decisionLabel', 500),
    urgency,
    decisionKind,
    reasonCode: safeCode(decision.reasonCode, 'decision reasonCode'),
    evidenceRefs: uniqueRefs(decision.evidenceRefs, 'decision evidenceRefs', 1, 32),
    cardRef,
    proposalOnly: true,
    ownerDecisionRecorded: false,
    humanGateDecisionCreated: false,
    authorizationDecisionCreated: false,
    externalActionPerformed: false,
  });
}

function createDomainPortfolioCard(input, options = {}) {
  const card = plainObject(input, 'portfolio card');
  assertAllowedKeys(card, new Set([
    'cardRef', 'ownerDomain', 'cardKind', 'title',
    'workEntryRef', 'workEntryDigest', 'sourceSchema', 'sourceRef', 'sourceDigest',
    'sourceObservedAt', 'health', 'stateCode', 'reasonCode', 'attentionRequired',
    'nextActionCode', 'decision', 'evidenceRefs', 'observedAt',
  ]), 'portfolio card');
  const observedAt = timestamp(card.observedAt, 'portfolio card observedAt');
  const sourceObservedAt = timestamp(card.sourceObservedAt, 'portfolio card sourceObservedAt');
  if (sourceObservedAt.time > observedAt.time) throw new TypeError('portfolio card sourceObservedAt cannot be in the future');
  const maxAgeSeconds = options.maxAgeSeconds ?? MAX_CARD_AGE_SECONDS;
  if (maxAgeSeconds !== MAX_CARD_AGE_SECONDS) throw new TypeError('portfolio card freshness window is fixed');

  const ownerDomain = safeCode(card.ownerDomain, 'portfolio card ownerDomain');
  if (!OWNER_DOMAINS.includes(ownerDomain)) throw new TypeError('portfolio card ownerDomain is unsupported');
  const cardKind = safeCode(card.cardKind, 'portfolio card cardKind');
  if (!CARD_KINDS.includes(cardKind)) throw new TypeError('portfolio card cardKind is unsupported');
  const suppliedHealth = safeCode(card.health, 'portfolio card health');
  if (!HEALTH_STATES.includes(suppliedHealth)) throw new TypeError('portfolio card health is unsupported');
  if (typeof card.attentionRequired !== 'boolean') throw new TypeError('portfolio card attentionRequired must be boolean');

  const cardRef = safeRef(card.cardRef, 'portfolio card cardRef', 'group:portfolio-card:');
  const ageSeconds = Math.floor((observedAt.time - sourceObservedAt.time) / 1000);
  const stale = ageSeconds > MAX_CARD_AGE_SECONDS;
  const health = stale ? 'unknown' : suppliedHealth;
  const attentionRequired = stale ? true : card.attentionRequired;
  const reasonCode = stale ? 'source_stale' : safeCode(card.reasonCode, 'portfolio card reasonCode');
  const decision = normalizeDecision(card.decision, cardRef);
  if (decision && !attentionRequired) throw new TypeError('portfolio card with a decision item must require attention');
  if (!decision && cardKind === 'exception' && !attentionRequired) throw new TypeError('exception portfolio card must require attention');

  const unsigned = {
    schema: GROUP_DOMAIN_PORTFOLIO_CARD_SCHEMA,
    cardRef,
    ownerDomain,
    cardKind,
    title: safeDisplayText(card.title, 'portfolio card title', 500),
    workEntryRef: safeRef(card.workEntryRef, 'portfolio card workEntryRef', 'group:work-entry:'),
    workEntryDigest: normalizedSha256(card.workEntryDigest, 'portfolio card workEntryDigest'),
    sourceSchema: safeCode(card.sourceSchema, 'portfolio card sourceSchema'),
    sourceRef: safeRef(card.sourceRef, 'portfolio card sourceRef'),
    sourceDigest: normalizedSha256(card.sourceDigest, 'portfolio card sourceDigest'),
    sourceObservedAt: sourceObservedAt.text,
    sourceAgeSeconds: ageSeconds,
    freshness: stale ? 'stale' : 'fresh',
    health,
    stateCode: safeCode(card.stateCode, 'portfolio card stateCode'),
    reasonCode,
    attentionRequired,
    nextActionCode: card.nextActionCode == null ? null : safeCode(card.nextActionCode, 'portfolio card nextActionCode'),
    decision,
    evidenceRefs: uniqueRefs(card.evidenceRefs, 'portfolio card evidenceRefs', 1, 64),
    observedAt: observedAt.text,
    readModelOnly: true,
    staleSourceMayGrantPositiveTruth: false,
    ...noAuthorityFlags(),
  };
  return freezeDeep({ ...unsigned, cardDigest: digest(unsigned) });
}

function assertDomainPortfolioCard(value) {
  const card = plainObject(value, 'portfolio card');
  if (card.schema !== GROUP_DOMAIN_PORTFOLIO_CARD_SCHEMA) throw new TypeError('portfolio card schema mismatch');
  const { cardDigest, ...unsigned } = card;
  if (digestHex(cardDigest, 'portfolio card cardDigest') !== digest(unsigned)) throw new TypeError('portfolio card digest mismatch');
  if (card.readModelOnly !== true || card.staleSourceMayGrantPositiveTruth !== false) throw new TypeError('portfolio card control boundary drift');
  assertNoAuthorityFlags(card, 'portfolio card');
  if (!OWNER_DOMAINS.includes(card.ownerDomain)) throw new TypeError('portfolio card ownerDomain drift');
  if (!CARD_KINDS.includes(card.cardKind)) throw new TypeError('portfolio card cardKind drift');
  if (!HEALTH_STATES.includes(card.health)) throw new TypeError('portfolio card health drift');
  if (!['fresh', 'stale'].includes(card.freshness)) throw new TypeError('portfolio card freshness drift');
  normalizedSha256(card.workEntryDigest, 'portfolio card workEntryDigest');
  normalizedSha256(card.sourceDigest, 'portfolio card sourceDigest');
  timestamp(card.sourceObservedAt, 'portfolio card sourceObservedAt');
  timestamp(card.observedAt, 'portfolio card observedAt');
  return card;
}

function assertBusinessEvalSeries(series) {
  const value = plainObject(series, 'business eval series');
  if (value.schema !== GROUP_BUSINESS_EVAL_SERIES_SCHEMA) throw new TypeError('business eval series schema mismatch');
  const { seriesDigest, ...unsigned } = value;
  if (digestHex(seriesDigest, 'business eval series seriesDigest') !== digest(unsigned)) throw new TypeError('business eval series digest mismatch');
  const requiredFalse = [
    'authorizationDecisionCreated', 'authorityGrantCreated', 'humanGateDecisionCreated',
    'delegationCreated', 'executionAuthorized', 'domainTruthCreated', 'domainWritePerformed',
    'externalActionPerformed', 'productionReadinessGranted', 'autonomyPromoted',
  ];
  for (const key of requiredFalse) assertFalse(value[key], `business eval series ${key}`);
  if (value.businessEvidenceOnly !== true || value.weightedByTrials !== true) throw new TypeError('business eval series evidence boundary drift');
  if (!Number.isInteger(value.trialCount) || value.trialCount < 1) throw new TypeError('business eval series trialCount is invalid');
  const numeric = [
    'successRate', 'failureRate', 'unknownRate', 'humanTakeoverRate',
    'meanHumanMinutesPerTrial', 'meanCycleTimeMs', 'meanCostUsd', 'errorRate', 'reversalRate',
  ];
  for (const key of numeric) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0) {
      throw new TypeError(`business eval series ${key} is invalid`);
    }
  }
  timestamp(value.observedAt, 'business eval series observedAt');
  return value;
}

function businessPerformanceCard(series) {
  const value = assertBusinessEvalSeries(series);
  return freezeDeep({
    actionCode: safeCode(value.actionCode, 'business eval actionCode'),
    ownerDomain: safeCode(value.ownerDomain, 'business eval ownerDomain'),
    autonomyLevel: text(value.autonomyLevel, 'business eval autonomyLevel', 2),
    trialCount: value.trialCount,
    successRate: value.successRate,
    failureRate: value.failureRate,
    unknownRate: value.unknownRate,
    humanTakeoverRate: value.humanTakeoverRate,
    meanHumanMinutesPerTrial: value.meanHumanMinutesPerTrial,
    meanCycleTimeMs: value.meanCycleTimeMs,
    meanCostUsd: value.meanCostUsd,
    errorRate: value.errorRate,
    reversalRate: value.reversalRate,
    downstreamMetric: value.downstreamMetric,
    observedAt: value.observedAt,
    businessEvidenceOnly: true,
    autonomyPromoted: false,
    productionReadinessGranted: false,
  });
}

function healthSummary(cards) {
  if (cards.some((card) => card.health === 'blocked')) return 'blocked';
  if (cards.some((card) => card.health === 'attention' || card.health === 'unknown')) return 'attention';
  return 'on_track';
}

function decisionQueue(cards) {
  const all = cards
    .map((card) => card.decision)
    .filter(Boolean)
    .sort((left, right) => {
      const urgency = URGENCY_WEIGHT[left.urgency] - URGENCY_WEIGHT[right.urgency];
      if (urgency !== 0) return urgency;
      return left.decisionRef.localeCompare(right.decisionRef);
    });
  const visible = all.slice(0, DECISION_TARGET_MAX);
  const coverageStatus = all.length < DECISION_TARGET_MIN
    ? 'below_target'
    : all.length <= DECISION_TARGET_MAX
      ? 'within_target'
      : 'above_capacity';
  return freezeDeep({
    targetMin: DECISION_TARGET_MIN,
    targetMax: DECISION_TARGET_MAX,
    coverageStatus,
    totalDecisionCount: all.length,
    visibleDecisionCount: visible.length,
    deferredDecisionCount: Math.max(0, all.length - visible.length),
    decisions: Object.freeze(visible.map((item) => freezeDeep({ ...item }))),
    decisionsFabricatedToMeetTarget: false,
  });
}

function compactCard(card) {
  return freezeDeep({
    cardRef: card.cardRef,
    ownerDomain: card.ownerDomain,
    cardKind: card.cardKind,
    title: card.title,
    health: card.health,
    freshness: card.freshness,
    stateCode: card.stateCode,
    reasonCode: card.reasonCode,
    attentionRequired: card.attentionRequired,
    nextActionCode: card.nextActionCode,
    decisionRef: card.decision?.decisionRef ?? null,
  });
}

function detailIndex(cards) {
  return freezeDeep(cards.map((card) => ({
    cardRef: card.cardRef,
    cardDigest: card.cardDigest,
    workEntryRef: card.workEntryRef,
    workEntryDigest: card.workEntryDigest,
    sourceSchema: card.sourceSchema,
    sourceRef: card.sourceRef,
    sourceDigest: card.sourceDigest,
    sourceObservedAt: card.sourceObservedAt,
    evidenceRefs: card.evidenceRefs,
  })));
}

function createCeoPortfolioBrief(input) {
  const root = plainObject(input, 'CEO portfolio brief');
  assertAllowedKeys(root, new Set([
    'briefRef', 'cards', 'businessEvalSeries', 'observedAt',
  ]), 'CEO portfolio brief');
  const observedAt = timestamp(root.observedAt, 'CEO portfolio brief observedAt');
  if (!Array.isArray(root.cards) || root.cards.length < 1 || root.cards.length > 256) {
    throw new TypeError('CEO portfolio brief cards must be a non-empty bounded array');
  }
  const cards = root.cards.map(assertDomainPortfolioCard);
  const uniqueCardDigests = new Set(cards.map((card) => card.cardDigest));
  if (uniqueCardDigests.size !== cards.length) throw new TypeError('CEO portfolio brief cannot contain duplicate cards');
  for (const card of cards) {
    if (Date.parse(card.observedAt) > observedAt.time) throw new TypeError('portfolio card cannot be newer than CEO portfolio brief');
  }
  const sortedCards = [...cards].sort((left, right) => left.cardRef.localeCompare(right.cardRef));

  const businessSeries = root.businessEvalSeries ?? [];
  if (!Array.isArray(businessSeries) || businessSeries.length > 64) {
    throw new TypeError('businessEvalSeries must be a bounded array');
  }
  const performance = businessSeries.map(businessPerformanceCard).sort((left, right) => {
    const owner = left.ownerDomain.localeCompare(right.ownerDomain);
    return owner !== 0 ? owner : left.actionCode.localeCompare(right.actionCode);
  });

  const counts = Object.fromEntries(CARD_KINDS.map((kind) => [
    `${kind}Count`,
    sortedCards.filter((card) => card.cardKind === kind).length,
  ]));
  const decisions = decisionQueue(sortedCards);
  const compactCards = Object.freeze(sortedCards.map(compactCard));
  const details = detailIndex(sortedCards);

  const unsigned = {
    schema: GROUP_CEO_PORTFOLIO_BRIEF_SCHEMA,
    briefRef: safeRef(root.briefRef, 'CEO portfolio brief briefRef', 'group:ceo-portfolio-brief:'),
    observedAt: observedAt.text,
    portfolioHealth: healthSummary(sortedCards),
    cardCount: sortedCards.length,
    attentionCardCount: sortedCards.filter((card) => card.attentionRequired).length,
    staleCardCount: sortedCards.filter((card) => card.freshness === 'stale').length,
    ...counts,
    cards: compactCards,
    decisions,
    businessPerformance: Object.freeze(performance),
    detailIndex: details,
    detailOnlyFieldsExcludedFromCards: Object.freeze(['cardDigest', 'workEntryDigest', 'sourceDigest', 'evidenceRefs']),
    readModelOnly: true,
    digestTraceHiddenFromPrimaryCards: true,
    ...noAuthorityFlags(),
  };
  return freezeDeep({ ...unsigned, briefDigest: digest(unsigned) });
}

module.exports = {
  CARD_KINDS,
  DECISION_TARGET_MAX,
  DECISION_TARGET_MIN,
  GROUP_CEO_PORTFOLIO_BRIEF_SCHEMA,
  GROUP_DOMAIN_PORTFOLIO_CARD_SCHEMA,
  HEALTH_STATES,
  MAX_CARD_AGE_SECONDS,
  OWNER_DOMAINS,
  createCeoPortfolioBrief,
  createDomainPortfolioCard,
};
