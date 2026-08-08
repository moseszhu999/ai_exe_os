'use strict';

const { createHash } = require('node:crypto');
const { assertSafeIdentifier } = require('../../domain/identifiers.cjs');
const { deepFreeze, requiredText } = require('../../domain/workspace-model.cjs');

const PROVIDER_STATUSES = new Set(['current', 'stale', 'unknown', 'blocked']);
const WORKER_STATUSES = new Set(['eligible', 'draining', 'unavailable']);
const CAPACITY_SOURCES = new Set(['explicit-local-policy', 'accepted-provider-evidence']);
const SENSITIVE_KEY = /^(authorization|proxy-authorization|cookie|cookies|set-cookie|password|passwd|token|access[_-]?token|refresh[_-]?token|secret|private[_ -]?key|profilePath|profileDir|profileDirectory|browserProfile|userData|userDataDir|storageState|processId|pid|ppid)$/i;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')}`;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new TypeError(`${label} must be a non-negative integer`);
  return number;
}

function positiveInteger(value, label) {
  const number = nonNegativeInteger(value, label);
  if (number < 1) throw new TypeError(`${label} must be a positive integer`);
  return number;
}

function isoInstant(value, label, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  const text = requiredText(value, label, 40);
  const time = Date.parse(text);
  if (!Number.isFinite(time)) throw new TypeError(`${label} must be ISO-compatible`);
  return new Date(time).toISOString();
}

function assertNoSensitiveFields(input, label) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError(`${label} must be an object`);
  for (const key of Object.keys(input)) {
    if (SENSITIVE_KEY.test(key)) throw new Error(`${label} must not contain sensitive runtime field: ${key}`);
  }
  return input;
}

function normalizeSafeKeys(keys) {
  if (keys == null) return [];
  if (!Array.isArray(keys)) throw new TypeError('safeCompatibilityKeys must be an array');
  const normalized = keys.map((key) => assertSafeIdentifier(key, 'safe compatibility key'));
  if (new Set(normalized).size !== normalized.length) throw new Error('safeCompatibilityKeys must be unique');
  return normalized.sort();
}

function createConcurrencyBudget(input) {
  const scope = input?.scope;
  if (!['global', 'workspace'].includes(scope)) throw new Error('ConcurrencyBudget scope must be global or workspace');
  const maxActive = positiveInteger(input?.maxActive, 'ConcurrencyBudget maxActive');
  const activeObserved = nonNegativeInteger(input?.activeObserved ?? 0, 'ConcurrencyBudget activeObserved');
  const base = {
    id: assertSafeIdentifier(input?.id, 'concurrency budget id'),
    workspaceId: scope === 'workspace' ? assertSafeIdentifier(input?.workspaceId, 'workspace id') : null,
    scope,
    maxActive,
    activeObserved,
    status: input?.status === 'current' ? 'current' : (() => { throw new Error('ConcurrencyBudget must be current'); })(),
    observedAt: isoInstant(input?.observedAt, 'ConcurrencyBudget observedAt'),
  };
  return deepFreeze({ ...base, remaining: Math.max(0, maxActive - activeObserved), digest: digest(base) });
}

function createProviderCapacitySnapshot(input) {
  const status = input?.status;
  if (!PROVIDER_STATUSES.has(status)) throw new Error('Invalid ProviderCapacitySnapshot status');
  const maxActive = positiveInteger(input?.maxActive, 'ProviderCapacitySnapshot maxActive');
  const activeObserved = nonNegativeInteger(input?.activeObserved ?? 0, 'ProviderCapacitySnapshot activeObserved');
  if (!CAPACITY_SOURCES.has(input?.source)) throw new Error('Invalid ProviderCapacitySnapshot source');
  const observedAt = isoInstant(input?.observedAt, 'ProviderCapacitySnapshot observedAt');
  const expiresAt = isoInstant(input?.expiresAt, 'ProviderCapacitySnapshot expiresAt', { nullable: true });
  if (expiresAt !== null && Date.parse(expiresAt) < Date.parse(observedAt)) throw new Error('ProviderCapacitySnapshot expiresAt precedes observedAt');
  const base = {
    id: assertSafeIdentifier(input?.id, 'provider capacity snapshot id'),
    workspaceId: assertSafeIdentifier(input?.workspaceId, 'workspace id'),
    providerId: assertSafeIdentifier(input?.providerId, 'provider id'),
    action: assertSafeIdentifier(input?.action, 'provider action'),
    maxActive,
    activeObserved,
    status,
    observedAt,
    expiresAt,
    source: input.source,
  };
  return deepFreeze({ ...base, remaining: Math.max(0, maxActive - activeObserved), digest: digest(base) });
}

function createWorkerCapacitySnapshot(input) {
  assertNoSensitiveFields(input, 'WorkerCapacitySnapshot');
  const status = input?.status;
  if (!WORKER_STATUSES.has(status)) throw new Error('Invalid WorkerCapacitySnapshot status');
  const browserChannel = requiredText(input?.browserChannel, 'worker browserChannel', 40);
  if (!['chrome', 'chromium'].includes(browserChannel)) throw new Error('worker browserChannel must be chrome or chromium');
  return deepFreeze({
    workerId: assertSafeIdentifier(input?.workerId, 'worker id'),
    workspaceId: assertSafeIdentifier(input?.workspaceId, 'workspace id'),
    status,
    browserChannel,
    activeAssignmentCount: nonNegativeInteger(input?.activeAssignmentCount ?? 0, 'worker activeAssignmentCount'),
    reusableSession: input?.reusableSession === true,
    safeCompatibilityKeys: normalizeSafeKeys(input?.safeCompatibilityKeys),
  });
}

function providerCapacityReason(candidate, snapshots, now = new Date().toISOString()) {
  const requirement = candidate?.providerRequirement;
  if (requirement == null) return { allowed: true, reasonCode: 'provider_not_required', snapshot: null };
  const providerId = assertSafeIdentifier(requirement.providerId, 'provider id');
  const action = assertSafeIdentifier(requirement.action, 'provider action');
  const workspaceId = assertSafeIdentifier(candidate?.workspaceId, 'workspace id');
  const matches = (snapshots || []).filter((snapshot) => snapshot.workspaceId === workspaceId && snapshot.providerId === providerId && snapshot.action === action);
  if (matches.length === 0) return { allowed: false, reasonCode: 'provider_capacity_unknown', snapshot: null };
  if (matches.length > 1) throw new Error('Multiple ProviderCapacitySnapshots match one provider requirement');
  const snapshot = matches[0];
  if (snapshot.status === 'unknown') return { allowed: false, reasonCode: 'provider_capacity_unknown', snapshot };
  if (snapshot.status === 'stale') return { allowed: false, reasonCode: 'provider_capacity_stale', snapshot };
  if (snapshot.status === 'blocked') return { allowed: false, reasonCode: 'provider_capacity_blocked', snapshot };
  if (snapshot.expiresAt && Date.parse(snapshot.expiresAt) <= Date.parse(isoInstant(now, 'capacity evaluatedAt'))) {
    return { allowed: false, reasonCode: 'provider_capacity_stale', snapshot };
  }
  if (snapshot.activeObserved >= snapshot.maxActive) return { allowed: false, reasonCode: 'provider_capacity_exhausted', snapshot };
  return { allowed: true, reasonCode: 'provider_capacity_current', snapshot };
}

function workerCompatibility(candidate, worker, blockedResources = []) {
  if (!candidate || candidate.readyState !== 'ready') return { compatible: false, reasonCodes: ['candidate_not_ready'] };
  const reasons = [];
  const workspaceId = assertSafeIdentifier(candidate.workspaceId, 'workspace id');
  if (!worker || worker.workspaceId !== workspaceId) reasons.push('cross_workspace_worker');
  if (worker?.status === 'draining') reasons.push('worker_draining');
  else if (worker?.status !== 'eligible') reasons.push('worker_unavailable');
  const requirements = candidate.workerRequirements || {};
  if (requirements.browserChannel && worker?.browserChannel !== requirements.browserChannel) reasons.push('browser_channel_mismatch');
  if (requirements.exactProfileClass) {
    const key = `profile-${assertSafeIdentifier(requirements.exactProfileClass, 'exact profile class')}`;
    if (!worker?.safeCompatibilityKeys?.includes(key)) reasons.push('profile_class_mismatch');
  }
  if (candidate.providerRequirement) {
    const providerKey = `provider-${assertSafeIdentifier(candidate.providerRequirement.providerId, 'provider id')}-${assertSafeIdentifier(candidate.providerRequirement.action, 'provider action')}`;
    if (!worker?.safeCompatibilityKeys?.includes(providerKey)) reasons.push('provider_surface_mismatch');
  }
  const blocked = new Set((blockedResources || []).map((resource) => assertSafeIdentifier(resource, 'blocked resource id')));
  for (const resource of candidate.requiredResources || []) {
    if (blocked.has(assertSafeIdentifier(resource, 'required resource id'))) reasons.push('resource_conflict');
  }
  return deepFreeze({ compatible: reasons.length === 0, reasonCodes: [...new Set(reasons)].sort() });
}

function evaluateCandidateCapacity({ candidate, globalBudget, workspaceBudget, providerCapacities = [], workers = [], blockedResources = [], evaluatedAt }) {
  if (!candidate || candidate.readyState !== 'ready') return deepFreeze({ eligible: false, compatibleWorkerIds: [], reasonCodes: ['candidate_not_ready'] });
  const reasons = [];
  if (!globalBudget || globalBudget.scope !== 'global' || globalBudget.status !== 'current') reasons.push('global_capacity_unknown');
  else if (globalBudget.activeObserved >= globalBudget.maxActive) reasons.push('global_capacity_exhausted');
  if (!workspaceBudget || workspaceBudget.scope !== 'workspace' || workspaceBudget.workspaceId !== candidate.workspaceId || workspaceBudget.status !== 'current') {
    reasons.push('workspace_capacity_unknown');
  } else if (workspaceBudget.activeObserved >= workspaceBudget.maxActive) reasons.push('workspace_capacity_exhausted');

  const provider = providerCapacityReason(candidate, providerCapacities, evaluatedAt);
  if (!provider.allowed) reasons.push(provider.reasonCode);

  const compatibility = workers.map((worker) => ({ worker, result: workerCompatibility(candidate, worker, blockedResources) }));
  const compatibleWorkers = compatibility.filter((item) => item.result.compatible).map((item) => item.worker);
  if (compatibleWorkers.length === 0) reasons.push('no_compatible_worker');

  const orderedWorkers = compatibleWorkers.sort((left, right) => {
    if (left.activeAssignmentCount !== right.activeAssignmentCount) return left.activeAssignmentCount - right.activeAssignmentCount;
    if (left.reusableSession !== right.reusableSession) return left.reusableSession ? -1 : 1;
    return left.workerId.localeCompare(right.workerId);
  });

  return deepFreeze({
    eligible: reasons.length === 0,
    compatibleWorkerIds: orderedWorkers.map((worker) => worker.workerId),
    reasonCodes: [...new Set(reasons)].sort(),
    providerCapacityId: provider.snapshot?.id || null,
    providerCapacityDigest: provider.snapshot?.digest || null,
  });
}

module.exports = {
  createConcurrencyBudget,
  createProviderCapacitySnapshot,
  createWorkerCapacitySnapshot,
  digest,
  evaluateCandidateCapacity,
  providerCapacityReason,
  workerCompatibility,
};
