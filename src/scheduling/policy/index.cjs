'use strict';

const { createHash } = require('node:crypto');
const { assertSafeIdentifier } = require('../../domain/identifiers.cjs');
const { deepFreeze, requiredText } = require('../../domain/workspace-model.cjs');

const PRIORITIES = Object.freeze(['critical', 'high', 'normal', 'low']);
const SESSION_REUSE = new Set(['compatible-only', 'disabled']);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')}`;
}

function positiveInteger(value, label, { allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < (allowZero ? 0 : 1)) {
    throw new TypeError(`${label} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`);
  }
  return number;
}

function isoInstant(value, label) {
  const text = requiredText(value, label, 40);
  const time = Date.parse(text);
  if (!Number.isFinite(time)) throw new TypeError(`${label} must be ISO-compatible`);
  return new Date(time).toISOString();
}

function normalizePriorityOrder(order) {
  if (!Array.isArray(order) || order.length !== PRIORITIES.length) {
    throw new TypeError('priorityOrder must contain exactly four priority classes');
  }
  const normalized = order.map((item) => String(item));
  if (new Set(normalized).size !== PRIORITIES.length || PRIORITIES.some((priority) => !normalized.includes(priority))) {
    throw new Error('priorityOrder must be a permutation of critical, high, normal, low');
  }
  return normalized;
}

function createSchedulingPolicySnapshot(input) {
  const status = input?.status || 'active';
  if (!['active', 'superseded'].includes(status)) throw new Error('Invalid SchedulingPolicySnapshot status');
  const globalMaxActive = positiveInteger(input?.globalMaxActive, 'globalMaxActive');
  const workspaceMaxActive = positiveInteger(input?.workspaceMaxActive, 'workspaceMaxActive');
  if (workspaceMaxActive > globalMaxActive) throw new Error('workspaceMaxActive cannot exceed globalMaxActive');
  if (input?.fairness?.mode !== 'bounded-aging') throw new Error('S6 v1 fairness mode must be bounded-aging');
  const agingIntervalSeconds = positiveInteger(input?.fairness?.agingIntervalSeconds, 'agingIntervalSeconds');
  const maxPriorityBoostSteps = positiveInteger(input?.fairness?.maxPriorityBoostSteps ?? 0, 'maxPriorityBoostSteps', { allowZero: true });
  if (maxPriorityBoostSteps > PRIORITIES.length - 1) throw new Error('maxPriorityBoostSteps exceeds available priority tiers');
  const sessionReuse = input?.sessionReuse || 'compatible-only';
  if (!SESSION_REUSE.has(sessionReuse)) throw new Error('Invalid sessionReuse mode');
  const createdAt = isoInstant(input?.createdAt || new Date().toISOString(), 'createdAt');
  const base = {
    id: assertSafeIdentifier(input?.id, 'scheduling policy id'),
    workspaceId: assertSafeIdentifier(input?.workspaceId, 'workspace id'),
    version: requiredText(input?.version, 'scheduling policy version', 80),
    status,
    globalMaxActive,
    workspaceMaxActive,
    priorityOrder: normalizePriorityOrder(input?.priorityOrder || PRIORITIES),
    fairness: {
      mode: 'bounded-aging',
      agingIntervalSeconds,
      maxPriorityBoostSteps,
    },
    sessionReuse,
    createdAt,
  };
  return deepFreeze({ ...base, digest: digest(base) });
}

function assertCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new TypeError('SchedulingCandidate is required');
  if (candidate.readyState !== 'ready') throw new Error('S6 policy only ranks canonical ready candidates');
  if (!PRIORITIES.includes(candidate.priority)) throw new Error('Invalid candidate priority');
  return {
    id: assertSafeIdentifier(candidate.id, 'scheduling candidate id'),
    workspaceId: assertSafeIdentifier(candidate.workspaceId, 'workspace id'),
    priority: candidate.priority,
    readySince: isoInstant(candidate.readySince, 'candidate readySince'),
    reusableSessionCompatible: candidate.reusableSessionCompatible === true,
  };
}

function computeEffectivePriority(candidate, policy, evaluatedAt) {
  const normalized = assertCandidate(candidate);
  if (!policy || !Array.isArray(policy.priorityOrder)) throw new TypeError('SchedulingPolicySnapshot is required');
  const nowMs = Date.parse(isoInstant(evaluatedAt, 'evaluatedAt'));
  const readyMs = Date.parse(normalized.readySince);
  const ageSeconds = Math.max(0, Math.floor((nowMs - readyMs) / 1000));
  const rawRank = policy.priorityOrder.indexOf(normalized.priority);
  if (rawRank < 0) throw new Error('Candidate priority is not present in policy priorityOrder');
  const boostSteps = Math.min(
    policy.fairness.maxPriorityBoostSteps,
    Math.floor(ageSeconds / policy.fairness.agingIntervalSeconds),
  );
  return deepFreeze({
    rawRank,
    boostSteps,
    effectiveRank: Math.max(0, rawRank - boostSteps),
    ageBucket: Math.floor(ageSeconds / policy.fairness.agingIntervalSeconds),
    ageSeconds,
  });
}

function rankSchedulingCandidates({ policy, candidates, evaluatedAt, workspaceActiveCounts = {} }) {
  if (!policy || policy.status !== 'active') throw new Error('An active SchedulingPolicySnapshot is required');
  if (!Array.isArray(candidates)) throw new TypeError('candidates must be an array');
  const evaluated = isoInstant(evaluatedAt, 'evaluatedAt');
  const seen = new Set();
  const ranked = candidates.map((candidate) => {
    const normalized = assertCandidate(candidate);
    if (normalized.workspaceId !== policy.workspaceId) throw new Error('Cross-Workspace SchedulingCandidate denied');
    if (seen.has(normalized.id)) throw new Error('SchedulingCandidate ids must be unique');
    seen.add(normalized.id);
    const priority = computeEffectivePriority(normalized, policy, evaluated);
    const workspaceActiveCount = positiveInteger(workspaceActiveCounts[normalized.workspaceId] ?? 0, 'workspace active count', { allowZero: true });
    const reusePreference = policy.sessionReuse === 'compatible-only' && normalized.reusableSessionCompatible ? 0 : 1;
    return {
      candidate,
      normalized,
      priority,
      tuple: [
        priority.effectiveRank,
        priority.ageBucket === 0 ? 1 : 0,
        workspaceActiveCount,
        reusePreference,
        normalized.readySince,
        normalized.id,
      ],
    };
  });

  ranked.sort((left, right) => {
    for (let index = 0; index < left.tuple.length; index += 1) {
      if (left.tuple[index] < right.tuple[index]) return -1;
      if (left.tuple[index] > right.tuple[index]) return 1;
    }
    return 0;
  });

  return deepFreeze(ranked.map(({ normalized, priority, tuple }) => ({
    id: normalized.id,
    workspaceId: normalized.workspaceId,
    priority: normalized.priority,
    readySince: normalized.readySince,
    effectivePriorityRank: priority.effectiveRank,
    boundedBoostSteps: priority.boostSteps,
    ageBucket: priority.ageBucket,
    workspaceActiveCount: tuple[2],
    reusePreferred: tuple[3] === 0,
  })));
}

function createSchedulingInputDigest({ policy, candidates, evaluatedAt, workspaceActiveCounts = {} }) {
  const ranked = rankSchedulingCandidates({ policy, candidates, evaluatedAt, workspaceActiveCounts });
  return digest({
    policyDigest: policy.digest,
    evaluatedAt: isoInstant(evaluatedAt, 'evaluatedAt'),
    ranked,
  });
}

function createSchedulingDecisionDigest(input) {
  if (!input || typeof input !== 'object') throw new TypeError('decision input is required');
  const orderedCandidateIds = Array.isArray(input.orderedCandidateIds)
    ? input.orderedCandidateIds.map((id) => assertSafeIdentifier(id, 'ordered candidate id'))
    : (() => { throw new TypeError('orderedCandidateIds must be an array'); })();
  const selectedCandidateId = input.selectedCandidateId == null ? null : assertSafeIdentifier(input.selectedCandidateId, 'selected candidate id');
  const selectedWorkerId = input.selectedWorkerId == null ? null : assertSafeIdentifier(input.selectedWorkerId, 'selected worker id');
  const reasonCodes = Array.isArray(input.reasonCodes)
    ? [...new Set(input.reasonCodes.map((code) => assertSafeIdentifier(code, 'scheduling reason code')))].sort()
    : [];
  return digest({
    policySnapshotId: assertSafeIdentifier(input.policySnapshotId, 'scheduling policy id'),
    inputDigest: requiredText(input.inputDigest, 'scheduling input digest', 100),
    orderedCandidateIds,
    selectedCandidateId,
    selectedWorkerId,
    reasonCodes,
  });
}

module.exports = {
  PRIORITIES,
  computeEffectivePriority,
  createSchedulingDecisionDigest,
  createSchedulingInputDigest,
  createSchedulingPolicySnapshot,
  digest,
  rankSchedulingCandidates,
  stableValue,
};
