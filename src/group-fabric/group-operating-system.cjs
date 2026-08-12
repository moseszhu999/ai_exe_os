'use strict';

const { createHash } = require('node:crypto');

const GROUP_WORK_ENTRY_SCHEMA = 'group.work-entry.v1';
const GROUP_AUTONOMY_POLICY_SCHEMA = 'group.autonomy-policy.v1';
const GROUP_DECISION_ESCALATION_SCHEMA = 'group.decision-escalation.v1';
const GROUP_BUSINESS_EVAL_SCHEMA = 'group.business-eval.v1';

const DOMAIN_CODES = Object.freeze([
  'group',
  'aiexe',
  'tradeos',
  'trainingos',
  'shared-media',
  'research',
  'back-office',
]);

const AUTONOMY_LEVELS = Object.freeze(['L0', 'L1', 'L2', 'L3', 'L4']);
const REVERSIBILITY_BY_LEVEL = Object.freeze({
  L0: 'read_only',
  L1: 'draft_only',
  L2: 'internal_reversible',
  L3: 'external_reversible',
  L4: 'external_consequential',
});
const RETRY_CLASSES = Object.freeze(['none', 'safe_idempotent', 'reviewed_only']);
const ROUTE_STATUSES = Object.freeze(['matched', 'ambiguous', 'blocked']);
const SOURCE_KINDS = Object.freeze(['human', 'email', 'calendar', 'web', 'api', 'domain_event', 'scheduled']);

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
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw new TypeError(`${label} must be a bounded non-empty string`);
  return trimmed;
}

function safeCode(value, label) {
  const normalized = text(value, label, 96);
  if (!/^[a-z][a-z0-9._-]{0,95}$/.test(normalized)) throw new TypeError(`${label} must be a bounded code`);
  return normalized;
}

function safeDomain(value, label) {
  const normalized = safeCode(value, label);
  if (!DOMAIN_CODES.includes(normalized)) throw new TypeError(`${label} is not a supported group domain`);
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

function uniqueCodes(value, label, min = 1, max = 32) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const codes = value.map((item) => safeCode(item, label));
  if (new Set(codes).size !== codes.length) throw new TypeError(`${label} must not contain duplicates`);
  return Object.freeze([...codes].sort());
}

function uniqueRefs(value, label, prefix = null, min = 1, max = 32) {
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

function baseNoAuthorityFlags() {
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

function validateRetrySemantics(level, retryClass, maxAttempts) {
  if (!RETRY_CLASSES.includes(retryClass)) throw new TypeError('retryClass is unsupported');
  if (retryClass === 'none' && maxAttempts !== 1) {
    throw new TypeError('retryClass none requires maxAttempts=1');
  }
  if (retryClass === 'safe_idempotent' && maxAttempts > 5) {
    throw new TypeError('safe_idempotent retry is capped at 5 attempts');
  }
  if (retryClass === 'reviewed_only' && maxAttempts > 2) {
    throw new TypeError('reviewed_only retry is capped at 2 attempts');
  }
  if (level === 'L4' && retryClass === 'safe_idempotent') {
    throw new TypeError('L4 external consequential actions cannot use automatic safe_idempotent retry');
  }
  if (level === 'L4' && maxAttempts !== 1) {
    throw new TypeError('L4 external consequential actions require maxAttempts=1');
  }
}

function createGroupAutonomyPolicy(input) {
  plainObject(input, 'autonomy policy');
  assertAllowedKeys(input, new Set([
    'policyRef', 'actionCode', 'ownerDomain', 'autonomyLevel', 'reversibility',
    'humanGateRequired', 'retryClass', 'maxAttempts', 'maxCostUsd', 'maxActions',
    'evidenceKinds', 'policyEvidenceRefs', 'validFrom', 'validUntil',
  ]), 'autonomy policy');

  const autonomyLevel = text(input.autonomyLevel, 'autonomyLevel', 2);
  if (!AUTONOMY_LEVELS.includes(autonomyLevel)) throw new TypeError('autonomyLevel is unsupported');
  const reversibility = safeCode(input.reversibility, 'reversibility');
  if (reversibility !== REVERSIBILITY_BY_LEVEL[autonomyLevel]) {
    throw new TypeError(`reversibility must be ${REVERSIBILITY_BY_LEVEL[autonomyLevel]} for ${autonomyLevel}`);
  }
  if (typeof input.humanGateRequired !== 'boolean') throw new TypeError('humanGateRequired must be a boolean');
  if (autonomyLevel === 'L4' && input.humanGateRequired !== true) {
    throw new TypeError('L4 external consequential actions always require a human gate');
  }

  const maxAttempts = boundedInteger(input.maxAttempts, 'maxAttempts', 1, 10);
  const retryClass = safeCode(input.retryClass, 'retryClass');
  validateRetrySemantics(autonomyLevel, retryClass, maxAttempts);

  const validFrom = timestamp(input.validFrom, 'validFrom');
  const validUntil = timestamp(input.validUntil, 'validUntil');
  if (validUntil.time <= validFrom.time) throw new TypeError('validUntil must be after validFrom');

  const unsigned = {
    schema: GROUP_AUTONOMY_POLICY_SCHEMA,
    policyRef: safeRef(input.policyRef, 'policyRef', 'group:autonomy-policy:'),
    actionCode: safeCode(input.actionCode, 'actionCode'),
    ownerDomain: safeDomain(input.ownerDomain, 'ownerDomain'),
    autonomyLevel,
    reversibility,
    humanGateRequired: input.humanGateRequired,
    retryClass,
    maxAttempts,
    maxCostUsd: boundedNumber(input.maxCostUsd, 'maxCostUsd', 0, 100000),
    maxActions: boundedInteger(input.maxActions, 'maxActions', 1, 100),
    evidenceKinds: uniqueCodes(input.evidenceKinds, 'evidenceKinds'),
    policyEvidenceRefs: uniqueRefs(input.policyEvidenceRefs, 'policyEvidenceRefs', 'evidence:'),
    validFrom: validFrom.text,
    validUntil: validUntil.text,
    policyOnly: true,
    autonomyPromotionPerformed: false,
    ...baseNoAuthorityFlags(),
  };

  return freezeDeep({ ...unsigned, policyDigest: digest(unsigned) });
}

function assertAutonomyPolicy(policy) {
  plainObject(policy, 'autonomy policy');
  if (policy.schema !== GROUP_AUTONOMY_POLICY_SCHEMA) throw new TypeError('autonomy policy schema mismatch');
  const { policyDigest, ...unsigned } = policy;
  if (typeof policyDigest !== 'string' || policyDigest !== digest(unsigned)) throw new TypeError('autonomy policy digest mismatch');
  for (const [key, expected] of Object.entries(baseNoAuthorityFlags())) {
    if (policy[key] !== expected) throw new TypeError(`autonomy policy truth boundary widened: ${key}`);
  }
  if (policy.policyOnly !== true || policy.autonomyPromotionPerformed !== false) {
    throw new TypeError('autonomy policy control flags are invalid');
  }
  if (policy.reversibility !== REVERSIBILITY_BY_LEVEL[policy.autonomyLevel]) {
    throw new TypeError('autonomy policy level/reversibility drift');
  }
  if (policy.autonomyLevel === 'L4' && policy.humanGateRequired !== true) {
    throw new TypeError('L4 autonomy policy human gate drift');
  }
  validateRetrySemantics(policy.autonomyLevel, policy.retryClass, policy.maxAttempts);
  return policy;
}

function createGroupWorkEntry(input) {
  plainObject(input, 'work entry');
  assertAllowedKeys(input, new Set([
    'entryRef', 'actorRef', 'organizationRef', 'objective', 'requestedActionCode',
    'targetRef', 'requestedDomain', 'sourceKind', 'createdAt', 'evidenceRefs',
  ]), 'work entry');

  const sourceKind = safeCode(input.sourceKind, 'sourceKind');
  if (!SOURCE_KINDS.includes(sourceKind)) throw new TypeError('sourceKind is unsupported');

  const unsigned = {
    schema: GROUP_WORK_ENTRY_SCHEMA,
    entryRef: safeRef(input.entryRef, 'entryRef', 'group:work-entry:'),
    actorRef: safeRef(input.actorRef, 'actorRef'),
    organizationRef: safeRef(input.organizationRef, 'organizationRef'),
    objective: text(input.objective, 'objective', 2000),
    requestedActionCode: safeCode(input.requestedActionCode, 'requestedActionCode'),
    targetRef: safeRef(input.targetRef, 'targetRef'),
    requestedDomain: input.requestedDomain === undefined || input.requestedDomain === null
      ? null
      : safeDomain(input.requestedDomain, 'requestedDomain'),
    sourceKind,
    createdAt: timestamp(input.createdAt, 'createdAt').text,
    evidenceRefs: uniqueRefs(input.evidenceRefs, 'evidenceRefs', 'evidence:', 0, 32),
    routingProposalOnly: true,
    managerMayProposeRoute: true,
    managerMayMintDomainTruth: false,
    ...baseNoAuthorityFlags(),
  };

  return freezeDeep({ ...unsigned, entryDigest: digest(unsigned) });
}

function assertWorkEntry(workEntry) {
  plainObject(workEntry, 'work entry');
  if (workEntry.schema !== GROUP_WORK_ENTRY_SCHEMA) throw new TypeError('work entry schema mismatch');
  const { entryDigest, ...unsigned } = workEntry;
  if (typeof entryDigest !== 'string' || entryDigest !== digest(unsigned)) throw new TypeError('work entry digest mismatch');
  for (const [key, expected] of Object.entries(baseNoAuthorityFlags())) {
    if (workEntry[key] !== expected) throw new TypeError(`work entry truth boundary widened: ${key}`);
  }
  if (workEntry.routingProposalOnly !== true || workEntry.managerMayMintDomainTruth !== false) {
    throw new TypeError('work entry manager boundary drift');
  }
  return workEntry;
}

function createGroupDecisionEscalation(input) {
  plainObject(input, 'decision escalation');
  assertAllowedKeys(input, new Set([
    'escalationRef', 'workEntry', 'policy', 'routeStatus', 'routeReasonCode',
    'routeEvidenceRefs', 'observedAt',
  ]), 'decision escalation');

  const workEntry = assertWorkEntry(input.workEntry);
  const policy = assertAutonomyPolicy(input.policy);
  if (workEntry.requestedActionCode !== policy.actionCode) {
    throw new TypeError('work entry action does not match autonomy policy action');
  }

  const routeStatus = safeCode(input.routeStatus, 'routeStatus');
  if (!ROUTE_STATUSES.includes(routeStatus)) throw new TypeError('routeStatus is unsupported');
  const requestedDomainMismatch = workEntry.requestedDomain !== null && workEntry.requestedDomain !== policy.ownerDomain;

  let decisionState = 'ready_for_bounded_processing';
  let ownerDecisionRequired = false;
  let reasonCode = safeCode(input.routeReasonCode, 'routeReasonCode');

  if (routeStatus === 'blocked' || requestedDomainMismatch) {
    decisionState = 'blocked';
    ownerDecisionRequired = true;
    if (requestedDomainMismatch) reasonCode = 'requested_domain_conflicts_with_policy_owner';
  } else if (routeStatus === 'ambiguous' || policy.humanGateRequired) {
    decisionState = 'needs_human_review';
    ownerDecisionRequired = true;
  }

  const unsigned = {
    schema: GROUP_DECISION_ESCALATION_SCHEMA,
    escalationRef: safeRef(input.escalationRef, 'escalationRef', 'group:decision-escalation:'),
    workEntryRef: workEntry.entryRef,
    workEntryDigest: workEntry.entryDigest,
    policyRef: policy.policyRef,
    policyDigest: policy.policyDigest,
    actionCode: policy.actionCode,
    ownerDomain: policy.ownerDomain,
    autonomyLevel: policy.autonomyLevel,
    routeStatus,
    reasonCode,
    decisionState,
    ownerDecisionRequired,
    humanGateRequiredForExecution: policy.humanGateRequired,
    routeEvidenceRefs: uniqueRefs(input.routeEvidenceRefs, 'routeEvidenceRefs', 'evidence:'),
    observedAt: timestamp(input.observedAt, 'observedAt').text,
    routingDecisionOnly: true,
    policyMatched: routeStatus === 'matched' && !requestedDomainMismatch,
    executionEligibilityGranted: false,
    ...baseNoAuthorityFlags(),
  };

  return freezeDeep({ ...unsigned, escalationDigest: digest(unsigned) });
}

function assertDecisionEscalation(escalation, workEntry, policy) {
  plainObject(escalation, 'decision escalation');
  if (escalation.schema !== GROUP_DECISION_ESCALATION_SCHEMA) throw new TypeError('decision escalation schema mismatch');
  const { escalationDigest, ...unsigned } = escalation;
  if (typeof escalationDigest !== 'string' || escalationDigest !== digest(unsigned)) {
    throw new TypeError('decision escalation digest mismatch');
  }
  if (escalation.workEntryDigest !== workEntry.entryDigest || escalation.policyDigest !== policy.policyDigest) {
    throw new TypeError('decision escalation upstream binding mismatch');
  }
  for (const [key, expected] of Object.entries(baseNoAuthorityFlags())) {
    if (escalation[key] !== expected) throw new TypeError(`decision escalation truth boundary widened: ${key}`);
  }
  if (escalation.executionEligibilityGranted !== false) throw new TypeError('decision escalation cannot grant execution eligibility');
  return escalation;
}

function normalizeDownstreamMetric(input) {
  if (input === undefined || input === null) return null;
  plainObject(input, 'downstreamMetric');
  assertAllowedKeys(input, new Set(['name', 'value', 'unit', 'baseline']), 'downstreamMetric');
  const value = boundedNumber(input.value, 'downstreamMetric.value', -1e12, 1e12);
  const baseline = input.baseline === undefined || input.baseline === null
    ? null
    : boundedNumber(input.baseline, 'downstreamMetric.baseline', -1e12, 1e12);
  return freezeDeep({
    name: safeCode(input.name, 'downstreamMetric.name'),
    value,
    unit: safeCode(input.unit, 'downstreamMetric.unit'),
    baseline,
  });
}

function createGroupBusinessEval(input) {
  plainObject(input, 'business eval');
  assertAllowedKeys(input, new Set([
    'evalRef', 'workEntry', 'policy', 'decisionEscalation', 'trialCount', 'successfulTrials',
    'unknownTrials', 'humanTakeoverTrials', 'totalHumanMinutes', 'totalCycleTimeMs',
    'totalCostUsd', 'errorCount', 'reversalCount', 'technicalEvidenceRefs',
    'businessEvidenceRefs', 'downstreamMetric', 'observedAt',
  ]), 'business eval');

  const workEntry = assertWorkEntry(input.workEntry);
  const policy = assertAutonomyPolicy(input.policy);
  if (workEntry.requestedActionCode !== policy.actionCode) throw new TypeError('business eval action/policy mismatch');
  const escalation = assertDecisionEscalation(input.decisionEscalation, workEntry, policy);

  const trialCount = boundedInteger(input.trialCount, 'trialCount', 1, 10000);
  const successfulTrials = boundedInteger(input.successfulTrials, 'successfulTrials', 0, trialCount);
  const unknownTrials = boundedInteger(input.unknownTrials, 'unknownTrials', 0, trialCount);
  const humanTakeoverTrials = boundedInteger(input.humanTakeoverTrials, 'humanTakeoverTrials', 0, trialCount);
  if (successfulTrials + unknownTrials > trialCount) {
    throw new TypeError('successfulTrials + unknownTrials cannot exceed trialCount');
  }

  const totalHumanMinutes = boundedNumber(input.totalHumanMinutes, 'totalHumanMinutes', 0, 1e9);
  const totalCycleTimeMs = boundedNumber(input.totalCycleTimeMs, 'totalCycleTimeMs', 0, 1e15);
  const totalCostUsd = boundedNumber(input.totalCostUsd, 'totalCostUsd', 0, 1e9);
  const errorCount = boundedInteger(input.errorCount, 'errorCount', 0, 1000000);
  const reversalCount = boundedInteger(input.reversalCount, 'reversalCount', 0, 1000000);

  const unsigned = {
    schema: GROUP_BUSINESS_EVAL_SCHEMA,
    evalRef: safeRef(input.evalRef, 'evalRef', 'group:business-eval:'),
    workEntryRef: workEntry.entryRef,
    workEntryDigest: workEntry.entryDigest,
    policyRef: policy.policyRef,
    policyDigest: policy.policyDigest,
    escalationRef: escalation.escalationRef,
    escalationDigest: escalation.escalationDigest,
    actionCode: policy.actionCode,
    ownerDomain: policy.ownerDomain,
    autonomyLevel: policy.autonomyLevel,
    trialCount,
    successfulTrials,
    unknownTrials,
    failedTrials: trialCount - successfulTrials - unknownTrials,
    humanTakeoverTrials,
    successRate: successfulTrials / trialCount,
    unknownRate: unknownTrials / trialCount,
    humanTakeoverRate: humanTakeoverTrials / trialCount,
    totalHumanMinutes,
    meanHumanMinutesPerTrial: totalHumanMinutes / trialCount,
    totalCycleTimeMs,
    meanCycleTimeMs: totalCycleTimeMs / trialCount,
    totalCostUsd,
    meanCostUsd: totalCostUsd / trialCount,
    errorCount,
    reversalCount,
    technicalEvidenceRefs: uniqueRefs(input.technicalEvidenceRefs, 'technicalEvidenceRefs', 'evidence:'),
    businessEvidenceRefs: uniqueRefs(input.businessEvidenceRefs, 'businessEvidenceRefs', 'evidence:'),
    downstreamMetric: normalizeDownstreamMetric(input.downstreamMetric),
    observedAt: timestamp(input.observedAt, 'observedAt').text,
    businessEvalOnly: true,
    autonomyPromoted: false,
    productionReadinessGranted: false,
    ...baseNoAuthorityFlags(),
  };

  return freezeDeep({ ...unsigned, evalDigest: digest(unsigned) });
}

module.exports = {
  AUTONOMY_LEVELS,
  DOMAIN_CODES,
  GROUP_AUTONOMY_POLICY_SCHEMA,
  GROUP_BUSINESS_EVAL_SCHEMA,
  GROUP_DECISION_ESCALATION_SCHEMA,
  GROUP_WORK_ENTRY_SCHEMA,
  REVERSIBILITY_BY_LEVEL,
  createGroupAutonomyPolicy,
  createGroupBusinessEval,
  createGroupDecisionEscalation,
  createGroupWorkEntry,
};
