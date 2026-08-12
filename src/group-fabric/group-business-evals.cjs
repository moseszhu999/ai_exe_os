'use strict';

const { createHash } = require('node:crypto');
const { GROUP_BUSINESS_EVAL_SCHEMA } = require('./group-operating-system.cjs');

const GROUP_BUSINESS_EVAL_SERIES_SCHEMA = 'group.business-eval-series.v1';
const GROUP_BUSINESS_REVIEW_POLICY_SCHEMA = 'group.business-review-policy.v1';
const GROUP_AUTONOMY_REVIEW_PROPOSAL_SCHEMA = 'group.autonomy-review-proposal.v1';

const REVIEW_STATES = Object.freeze([
  'insufficient_evidence',
  'below_thresholds',
  'ready_for_owner_review',
  'consequential_manual_only',
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

function text(value, label, max = 240) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new TypeError(`${label} must be a bounded non-empty string`);
  return normalized;
}

function safeCode(value, label) {
  const normalized = text(value, label, 96);
  if (!/^[a-z][a-z0-9._-]{0,95}$/.test(normalized)) throw new TypeError(`${label} must be a bounded code`);
  return normalized;
}

function safeRef(value, label, prefix = null) {
  const normalized = text(value, label, 260);
  if (prefix && !normalized.startsWith(prefix)) throw new TypeError(`${label} must start with ${prefix}`);
  if (/@[^/\s]+\.[A-Za-z]{2,}/.test(normalized)) throw new TypeError(`${label} must not contain email-like PII`);
  if (/bearer|password|secret|token=|api[_-]?key|cookie|session=/i.test(normalized)) {
    throw new TypeError(`${label} must not contain secret/session-like material`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9:._@/-]*$/.test(normalized)) throw new TypeError(`${label} contains invalid characters`);
  return normalized;
}

function timestamp(value, label) {
  const normalized = text(value, label, 40);
  const time = Date.parse(normalized);
  if (!Number.isFinite(time) || !normalized.endsWith('Z')) {
    throw new TypeError(`${label} must be an ISO-8601 UTC timestamp`);
  }
  return { text: normalized, time };
}

function boundedInteger(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function boundedNumber(value, label, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new TypeError(`${label} must be a finite number between ${min} and ${max}`);
  }
  return value;
}

function uniqueRefs(value, label, prefix = 'evidence:', min = 1, max = 128) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const refs = value.map((item) => safeRef(item, label, prefix));
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
    authorizationDecisionCreated: false,
    authorityGrantCreated: false,
    humanGateDecisionCreated: false,
    delegationCreated: false,
    executionAuthorized: false,
    domainTruthCreated: false,
    domainWritePerformed: false,
    externalActionPerformed: false,
  };
}

function assertNoAuthorityFlags(value, label) {
  for (const [key, expected] of Object.entries(noAuthorityFlags())) {
    if (value[key] !== expected) throw new TypeError(`${label} truth boundary widened: ${key}`);
  }
}

function assertDigestObject(value, schema, digestField, label) {
  plainObject(value, label);
  if (value.schema !== schema) throw new TypeError(`${label} schema mismatch`);
  const actual = value[digestField];
  const unsigned = { ...value };
  delete unsigned[digestField];
  if (typeof actual !== 'string' || actual !== digest(unsigned)) throw new TypeError(`${label} digest mismatch`);
  return value;
}

function assertBusinessEval(value) {
  assertDigestObject(value, GROUP_BUSINESS_EVAL_SCHEMA, 'evalDigest', 'business eval');
  assertNoAuthorityFlags(value, 'business eval');
  if (value.businessEvalOnly !== true || value.autonomyPromoted !== false || value.productionReadinessGranted !== false) {
    throw new TypeError('business eval control boundary drift');
  }

  const trialCount = boundedInteger(value.trialCount, 'business eval trialCount', 1, 10000);
  const successfulTrials = boundedInteger(value.successfulTrials, 'business eval successfulTrials', 0, trialCount);
  const unknownTrials = boundedInteger(value.unknownTrials, 'business eval unknownTrials', 0, trialCount);
  const humanTakeoverTrials = boundedInteger(value.humanTakeoverTrials, 'business eval humanTakeoverTrials', 0, trialCount);
  if (successfulTrials + unknownTrials > trialCount) throw new TypeError('business eval trial accounting is invalid');
  const failedTrials = trialCount - successfulTrials - unknownTrials;
  if (value.failedTrials !== failedTrials) throw new TypeError('business eval failedTrials drift');
  if (value.successRate !== successfulTrials / trialCount) throw new TypeError('business eval successRate drift');
  if (value.unknownRate !== unknownTrials / trialCount) throw new TypeError('business eval unknownRate drift');
  if (value.humanTakeoverRate !== humanTakeoverTrials / trialCount) throw new TypeError('business eval humanTakeoverRate drift');

  const totalHumanMinutes = boundedNumber(value.totalHumanMinutes, 'business eval totalHumanMinutes', 0, 1e9);
  const totalCycleTimeMs = boundedNumber(value.totalCycleTimeMs, 'business eval totalCycleTimeMs', 0, 1e15);
  const totalCostUsd = boundedNumber(value.totalCostUsd, 'business eval totalCostUsd', 0, 1e9);
  boundedInteger(value.errorCount, 'business eval errorCount', 0, 1000000);
  boundedInteger(value.reversalCount, 'business eval reversalCount', 0, 1000000);
  if (value.meanHumanMinutesPerTrial !== totalHumanMinutes / trialCount) throw new TypeError('business eval meanHumanMinutesPerTrial drift');
  if (value.meanCycleTimeMs !== totalCycleTimeMs / trialCount) throw new TypeError('business eval meanCycleTimeMs drift');
  if (value.meanCostUsd !== totalCostUsd / trialCount) throw new TypeError('business eval meanCostUsd drift');

  safeRef(value.evalRef, 'business eval evalRef', 'group:business-eval:');
  safeRef(value.workEntryRef, 'business eval workEntryRef', 'group:work-entry:');
  safeRef(value.policyRef, 'business eval policyRef', 'group:autonomy-policy:');
  safeRef(value.escalationRef, 'business eval escalationRef', 'group:decision-escalation:');
  safeCode(value.actionCode, 'business eval actionCode');
  safeCode(value.ownerDomain, 'business eval ownerDomain');
  if (!['L0', 'L1', 'L2', 'L3', 'L4'].includes(value.autonomyLevel)) throw new TypeError('business eval autonomyLevel is unsupported');
  timestamp(value.observedAt, 'business eval observedAt');
  uniqueRefs(value.technicalEvidenceRefs, 'business eval technicalEvidenceRefs');
  uniqueRefs(value.businessEvidenceRefs, 'business eval businessEvidenceRefs');
  return value;
}

function normalizeDownstreamAggregate(evals) {
  const metrics = evals.map((item) => item.downstreamMetric).filter(Boolean);
  if (metrics.length !== evals.length || metrics.length === 0) {
    return freezeDeep({ status: 'not_comparable', reasonCode: 'missing_metric_on_one_or_more_evals' });
  }
  const first = metrics[0];
  const comparable = metrics.every((metric) => metric.name === first.name && metric.unit === first.unit);
  if (!comparable) return freezeDeep({ status: 'not_comparable', reasonCode: 'metric_identity_mismatch' });

  const weightedValue = evals.reduce((sum, item) => sum + (item.downstreamMetric.value * item.trialCount), 0)
    / evals.reduce((sum, item) => sum + item.trialCount, 0);
  const baselineRows = evals.filter((item) => item.downstreamMetric.baseline !== null);
  const weightedBaseline = baselineRows.length === evals.length
    ? evals.reduce((sum, item) => sum + (item.downstreamMetric.baseline * item.trialCount), 0)
      / evals.reduce((sum, item) => sum + item.trialCount, 0)
    : null;
  return freezeDeep({
    status: 'comparable',
    name: first.name,
    unit: first.unit,
    weightedValue,
    weightedBaseline,
    deltaFromBaseline: weightedBaseline === null ? null : weightedValue - weightedBaseline,
  });
}

function createBusinessEvalSeries(input) {
  plainObject(input, 'business eval series');
  assertAllowedKeys(input, new Set([
    'seriesRef', 'businessEvals', 'seriesEvidenceRefs', 'observedAt',
  ]), 'business eval series');

  if (!Array.isArray(input.businessEvals) || input.businessEvals.length < 1 || input.businessEvals.length > 256) {
    throw new TypeError('businessEvals must be a non-empty bounded array');
  }
  const evals = input.businessEvals.map(assertBusinessEval);
  const uniqueDigests = new Set(evals.map((item) => item.evalDigest));
  if (uniqueDigests.size !== evals.length) throw new TypeError('businessEvals must not contain duplicate eval receipts');

  const first = evals[0];
  for (const item of evals) {
    if (item.actionCode !== first.actionCode) throw new TypeError('business eval series cannot mix actionCode');
    if (item.ownerDomain !== first.ownerDomain) throw new TypeError('business eval series cannot mix ownerDomain');
    if (item.policyRef !== first.policyRef || item.policyDigest !== first.policyDigest) {
      throw new TypeError('business eval series cannot mix policy identity');
    }
    if (item.autonomyLevel !== first.autonomyLevel) throw new TypeError('business eval series cannot mix autonomyLevel');
  }

  const observedAt = timestamp(input.observedAt, 'observedAt');
  for (const item of evals) {
    if (Date.parse(item.observedAt) > observedAt.time) throw new TypeError('business eval cannot be observed after series observedAt');
  }

  const sorted = [...evals].sort((left, right) => left.evalDigest.localeCompare(right.evalDigest));
  const evalRefs = Object.freeze(sorted.map((item) => item.evalRef));
  const evalDigests = Object.freeze(sorted.map((item) => item.evalDigest));
  const workEntryRefs = Object.freeze([...new Set(sorted.map((item) => item.workEntryRef))].sort());

  const trialCount = sorted.reduce((sum, item) => sum + item.trialCount, 0);
  const successfulTrials = sorted.reduce((sum, item) => sum + item.successfulTrials, 0);
  const unknownTrials = sorted.reduce((sum, item) => sum + item.unknownTrials, 0);
  const failedTrials = sorted.reduce((sum, item) => sum + item.failedTrials, 0);
  const humanTakeoverTrials = sorted.reduce((sum, item) => sum + item.humanTakeoverTrials, 0);
  const totalHumanMinutes = sorted.reduce((sum, item) => sum + item.totalHumanMinutes, 0);
  const totalCycleTimeMs = sorted.reduce((sum, item) => sum + item.totalCycleTimeMs, 0);
  const totalCostUsd = sorted.reduce((sum, item) => sum + item.totalCostUsd, 0);
  const errorCount = sorted.reduce((sum, item) => sum + item.errorCount, 0);
  const reversalCount = sorted.reduce((sum, item) => sum + item.reversalCount, 0);

  const unsigned = {
    schema: GROUP_BUSINESS_EVAL_SERIES_SCHEMA,
    seriesRef: safeRef(input.seriesRef, 'seriesRef', 'group:business-eval-series:'),
    actionCode: first.actionCode,
    ownerDomain: first.ownerDomain,
    policyRef: first.policyRef,
    policyDigest: first.policyDigest,
    autonomyLevel: first.autonomyLevel,
    evalRefs,
    evalDigests,
    workEntryRefs,
    evalCount: sorted.length,
    trialCount,
    successfulTrials,
    failedTrials,
    unknownTrials,
    humanTakeoverTrials,
    successRate: successfulTrials / trialCount,
    failureRate: failedTrials / trialCount,
    unknownRate: unknownTrials / trialCount,
    humanTakeoverRate: humanTakeoverTrials / trialCount,
    totalHumanMinutes,
    meanHumanMinutesPerTrial: totalHumanMinutes / trialCount,
    totalCycleTimeMs,
    meanCycleTimeMs: totalCycleTimeMs / trialCount,
    totalCostUsd,
    meanCostUsd: totalCostUsd / trialCount,
    errorCount,
    errorRate: errorCount / trialCount,
    reversalCount,
    reversalRate: reversalCount / trialCount,
    downstreamMetric: normalizeDownstreamAggregate(sorted),
    seriesEvidenceRefs: uniqueRefs(input.seriesEvidenceRefs, 'seriesEvidenceRefs'),
    observedAt: observedAt.text,
    weightedByTrials: true,
    businessEvidenceOnly: true,
    productionReadinessGranted: false,
    autonomyPromoted: false,
    ...noAuthorityFlags(),
  };

  return freezeDeep({ ...unsigned, seriesDigest: digest(unsigned) });
}

function assertBusinessEvalSeries(series) {
  assertDigestObject(series, GROUP_BUSINESS_EVAL_SERIES_SCHEMA, 'seriesDigest', 'business eval series');
  assertNoAuthorityFlags(series, 'business eval series');
  if (series.weightedByTrials !== true || series.businessEvidenceOnly !== true) throw new TypeError('business eval series control boundary drift');
  if (series.productionReadinessGranted !== false || series.autonomyPromoted !== false) {
    throw new TypeError('business eval series cannot grant production readiness or autonomy');
  }
  boundedInteger(series.evalCount, 'business eval series evalCount', 1, 256);
  const trialCount = boundedInteger(series.trialCount, 'business eval series trialCount', 1, 2560000);
  const successfulTrials = boundedInteger(series.successfulTrials, 'business eval series successfulTrials', 0, trialCount);
  const failedTrials = boundedInteger(series.failedTrials, 'business eval series failedTrials', 0, trialCount);
  const unknownTrials = boundedInteger(series.unknownTrials, 'business eval series unknownTrials', 0, trialCount);
  if (successfulTrials + failedTrials + unknownTrials !== trialCount) throw new TypeError('business eval series trial accounting drift');
  const humanTakeoverTrials = boundedInteger(series.humanTakeoverTrials, 'business eval series humanTakeoverTrials', 0, trialCount);
  if (series.successRate !== successfulTrials / trialCount) throw new TypeError('business eval series successRate drift');
  if (series.failureRate !== failedTrials / trialCount) throw new TypeError('business eval series failureRate drift');
  if (series.unknownRate !== unknownTrials / trialCount) throw new TypeError('business eval series unknownRate drift');
  if (series.humanTakeoverRate !== humanTakeoverTrials / trialCount) throw new TypeError('business eval series humanTakeoverRate drift');
  if (series.errorRate !== series.errorCount / trialCount) throw new TypeError('business eval series errorRate drift');
  if (series.reversalRate !== series.reversalCount / trialCount) throw new TypeError('business eval series reversalRate drift');
  return series;
}

function createBusinessReviewPolicy(input) {
  plainObject(input, 'business review policy');
  assertAllowedKeys(input, new Set([
    'reviewPolicyRef', 'actionCode', 'ownerDomain', 'policyRef', 'policyDigest',
    'minTrials', 'minEvalReceipts', 'minSuccessRate', 'maxUnknownRate', 'maxHumanTakeoverRate',
    'maxMeanHumanMinutesPerTrial', 'maxMeanCycleTimeMs', 'maxMeanCostUsd',
    'maxErrorRate', 'maxReversalRate', 'policyEvidenceRefs', 'validFrom', 'validUntil',
  ]), 'business review policy');

  const validFrom = timestamp(input.validFrom, 'validFrom');
  const validUntil = timestamp(input.validUntil, 'validUntil');
  if (validUntil.time <= validFrom.time) throw new TypeError('validUntil must be after validFrom');
  const unsigned = {
    schema: GROUP_BUSINESS_REVIEW_POLICY_SCHEMA,
    reviewPolicyRef: safeRef(input.reviewPolicyRef, 'reviewPolicyRef', 'group:business-review-policy:'),
    actionCode: safeCode(input.actionCode, 'actionCode'),
    ownerDomain: safeCode(input.ownerDomain, 'ownerDomain'),
    policyRef: safeRef(input.policyRef, 'policyRef', 'group:autonomy-policy:'),
    policyDigest: text(input.policyDigest, 'policyDigest', 64),
    minTrials: boundedInteger(input.minTrials, 'minTrials', 1, 1000000),
    minEvalReceipts: boundedInteger(input.minEvalReceipts, 'minEvalReceipts', 1, 256),
    minSuccessRate: boundedNumber(input.minSuccessRate, 'minSuccessRate', 0, 1),
    maxUnknownRate: boundedNumber(input.maxUnknownRate, 'maxUnknownRate', 0, 1),
    maxHumanTakeoverRate: boundedNumber(input.maxHumanTakeoverRate, 'maxHumanTakeoverRate', 0, 1),
    maxMeanHumanMinutesPerTrial: boundedNumber(input.maxMeanHumanMinutesPerTrial, 'maxMeanHumanMinutesPerTrial', 0, 1e9),
    maxMeanCycleTimeMs: boundedNumber(input.maxMeanCycleTimeMs, 'maxMeanCycleTimeMs', 0, 1e15),
    maxMeanCostUsd: boundedNumber(input.maxMeanCostUsd, 'maxMeanCostUsd', 0, 1e9),
    maxErrorRate: boundedNumber(input.maxErrorRate, 'maxErrorRate', 0, 1e6),
    maxReversalRate: boundedNumber(input.maxReversalRate, 'maxReversalRate', 0, 1e6),
    policyEvidenceRefs: uniqueRefs(input.policyEvidenceRefs, 'policyEvidenceRefs'),
    validFrom: validFrom.text,
    validUntil: validUntil.text,
    reviewCriteriaOnly: true,
    canPromoteAutonomy: false,
    canGrantProductionReadiness: false,
    ...noAuthorityFlags(),
  };
  return freezeDeep({ ...unsigned, reviewPolicyDigest: digest(unsigned) });
}

function assertBusinessReviewPolicy(policy) {
  assertDigestObject(policy, GROUP_BUSINESS_REVIEW_POLICY_SCHEMA, 'reviewPolicyDigest', 'business review policy');
  assertNoAuthorityFlags(policy, 'business review policy');
  if (policy.reviewCriteriaOnly !== true || policy.canPromoteAutonomy !== false || policy.canGrantProductionReadiness !== false) {
    throw new TypeError('business review policy authority boundary drift');
  }
  return policy;
}

function createAutonomyReviewProposal(input) {
  plainObject(input, 'autonomy review proposal');
  assertAllowedKeys(input, new Set([
    'proposalRef', 'series', 'reviewPolicy', 'proposalEvidenceRefs', 'observedAt',
  ]), 'autonomy review proposal');

  const series = assertBusinessEvalSeries(input.series);
  const reviewPolicy = assertBusinessReviewPolicy(input.reviewPolicy);
  const observedAt = timestamp(input.observedAt, 'observedAt');
  const validFrom = Date.parse(reviewPolicy.validFrom);
  const validUntil = Date.parse(reviewPolicy.validUntil);
  if (observedAt.time < validFrom || observedAt.time >= validUntil) throw new TypeError('business review policy is not active at observedAt');
  if (series.actionCode !== reviewPolicy.actionCode || series.ownerDomain !== reviewPolicy.ownerDomain) {
    throw new TypeError('review policy action/domain does not match business eval series');
  }
  if (series.policyRef !== reviewPolicy.policyRef || series.policyDigest !== reviewPolicy.policyDigest) {
    throw new TypeError('review policy autonomy policy binding does not match business eval series');
  }

  const checks = freezeDeep({
    minimumTrials: series.trialCount >= reviewPolicy.minTrials,
    minimumEvalReceipts: series.evalCount >= reviewPolicy.minEvalReceipts,
    successRate: series.successRate >= reviewPolicy.minSuccessRate,
    unknownRate: series.unknownRate <= reviewPolicy.maxUnknownRate,
    humanTakeoverRate: series.humanTakeoverRate <= reviewPolicy.maxHumanTakeoverRate,
    meanHumanMinutesPerTrial: series.meanHumanMinutesPerTrial <= reviewPolicy.maxMeanHumanMinutesPerTrial,
    meanCycleTimeMs: series.meanCycleTimeMs <= reviewPolicy.maxMeanCycleTimeMs,
    meanCostUsd: series.meanCostUsd <= reviewPolicy.maxMeanCostUsd,
    errorRate: series.errorRate <= reviewPolicy.maxErrorRate,
    reversalRate: series.reversalRate <= reviewPolicy.maxReversalRate,
  });

  const evidenceSufficient = checks.minimumTrials && checks.minimumEvalReceipts;
  const qualityChecks = Object.entries(checks)
    .filter(([name]) => !['minimumTrials', 'minimumEvalReceipts'].includes(name))
    .every(([, passed]) => passed === true);

  let reviewState = 'insufficient_evidence';
  let reasonCode = 'minimum_business_evidence_not_met';
  let ownerReviewRequested = false;
  if (evidenceSufficient && series.autonomyLevel === 'L4') {
    reviewState = 'consequential_manual_only';
    reasonCode = 'l4_never_auto_advances_from_business_evals';
    ownerReviewRequested = true;
  } else if (evidenceSufficient && qualityChecks) {
    reviewState = 'ready_for_owner_review';
    reasonCode = 'business_review_thresholds_met';
    ownerReviewRequested = true;
  } else if (evidenceSufficient) {
    reviewState = 'below_thresholds';
    reasonCode = 'one_or_more_business_review_thresholds_not_met';
  }

  if (!REVIEW_STATES.includes(reviewState)) throw new TypeError('reviewState is unsupported');

  const unsigned = {
    schema: GROUP_AUTONOMY_REVIEW_PROPOSAL_SCHEMA,
    proposalRef: safeRef(input.proposalRef, 'proposalRef', 'group:autonomy-review-proposal:'),
    seriesRef: series.seriesRef,
    seriesDigest: series.seriesDigest,
    reviewPolicyRef: reviewPolicy.reviewPolicyRef,
    reviewPolicyDigest: reviewPolicy.reviewPolicyDigest,
    actionCode: series.actionCode,
    ownerDomain: series.ownerDomain,
    policyRef: series.policyRef,
    policyDigest: series.policyDigest,
    currentAutonomyLevel: series.autonomyLevel,
    reviewState,
    reasonCode,
    checks,
    ownerReviewRequested,
    proposalEvidenceRefs: uniqueRefs(input.proposalEvidenceRefs, 'proposalEvidenceRefs'),
    observedAt: observedAt.text,
    proposalOnly: true,
    policyMutationPerformed: false,
    autonomyPromoted: false,
    productionReadinessGranted: false,
    executionEligibilityGranted: false,
    ...noAuthorityFlags(),
  };

  return freezeDeep({ ...unsigned, proposalDigest: digest(unsigned) });
}

module.exports = {
  GROUP_AUTONOMY_REVIEW_PROPOSAL_SCHEMA,
  GROUP_BUSINESS_EVAL_SERIES_SCHEMA,
  GROUP_BUSINESS_REVIEW_POLICY_SCHEMA,
  REVIEW_STATES,
  createAutonomyReviewProposal,
  createBusinessEvalSeries,
  createBusinessReviewPolicy,
};
