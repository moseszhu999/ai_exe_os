'use strict';

const { createHash } = require('node:crypto');
const { assertSafeIdentifier } = require('../../domain/identifiers.cjs');
const { deepFreeze, requiredText } = require('../../domain/workspace-model.cjs');

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')}`;
}

function isoInstant(value, label) {
  const text = requiredText(value, label, 40);
  const time = Date.parse(text);
  if (!Number.isFinite(time)) throw new TypeError(`${label} must be ISO-compatible`);
  return new Date(time).toISOString();
}

function reason(code, detail = null) {
  return deepFreeze({ code: assertSafeIdentifier(code, 'scheduling reason code'), detail });
}

function canonicalReadiness(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return reason('invalid_source_record');
  if (record.workspaceStatus !== 'active') return reason('workspace_not_active');
  if (record.readyState !== 'ready') return reason(record.readyState === 'waiting_human' ? 'human_gate_required' : 'source_not_ready');
  if (record.missionState && record.missionState !== 'active') return reason('mission_not_active');
  if (record.dependenciesSatisfied !== true) return reason('dependencies_unsatisfied');
  if (record.authorityValid !== true) return reason('authority_invalid');
  if (record.humanGateClear !== true) return reason('human_gate_required');
  if (record.executionIdentityCurrent !== true) return reason('stale_execution_identity');
  if (record.resourceRequirementsDeclared !== true) return reason('resource_requirements_unknown');
  if (record.providerRequirement && record.providerUseAccepted !== true) return reason('provider_use_not_accepted');
  if (record.priorEffectState === 'uncertain') return reason('uncertain_execution');
  return null;
}

function toCandidate(record) {
  const requiredResources = Array.isArray(record.requiredResources)
    ? record.requiredResources.map((item) => assertSafeIdentifier(item, 'required resource id'))
    : [];
  const providerRequirement = record.providerRequirement == null ? null : {
    providerId: assertSafeIdentifier(record.providerRequirement.providerId, 'provider id'),
    action: assertSafeIdentifier(record.providerRequirement.action, 'provider action'),
  };
  const workerRequirements = record.workerRequirements && typeof record.workerRequirements === 'object'
    ? {
        ...(record.workerRequirements.browserChannel ? { browserChannel: requiredText(record.workerRequirements.browserChannel, 'browser channel', 40) } : {}),
        ...(record.workerRequirements.exactProfileClass ? { exactProfileClass: assertSafeIdentifier(record.workerRequirements.exactProfileClass, 'exact profile class') } : {}),
      }
    : {};
  const candidate = {
    id: assertSafeIdentifier(record.id, 'scheduling candidate id'),
    workspaceId: assertSafeIdentifier(record.workspaceId, 'workspace id'),
    sourceKind: ['task', 'plan_step'].includes(record.sourceKind) ? record.sourceKind : (() => { throw new Error('Scheduling sourceKind must be task or plan_step'); })(),
    sourceId: assertSafeIdentifier(record.sourceId, 'scheduling source id'),
    executionIdentity: assertSafeIdentifier(record.executionIdentity, 'execution identity'),
    readyState: 'ready',
    readySince: isoInstant(record.readySince, 'candidate readySince'),
    priority: ['critical', 'high', 'normal', 'low'].includes(record.priority) ? record.priority : (() => { throw new Error('Invalid scheduling priority'); })(),
    requiredResources,
    providerRequirement,
    workerRequirements,
  };
  return deepFreeze(candidate);
}

function deriveSchedulingCandidates(records) {
  if (!Array.isArray(records)) throw new TypeError('canonical source records must be an array');
  const candidates = [];
  const deferred = [];
  const seen = new Set();
  for (const record of records) {
    const blocker = canonicalReadiness(record);
    if (blocker) {
      deferred.push(deepFreeze({ sourceId: record?.sourceId || null, candidateId: record?.id || null, reasonCodes: [blocker.code] }));
      continue;
    }
    const candidate = toCandidate(record);
    if (seen.has(candidate.id)) throw new Error('SchedulingCandidate ids must be unique');
    seen.add(candidate.id);
    candidates.push(candidate);
  }
  return deepFreeze({ candidates, deferred });
}

function createInputDigest({ policy, candidates, workers, capacitySnapshot, evaluatedAt }) {
  return digest({
    policyDigest: requiredText(policy?.digest, 'policy digest', 100),
    evaluatedAt: isoInstant(evaluatedAt, 'evaluatedAt'),
    candidateIds: candidates.map((item) => assertSafeIdentifier(item.id, 'candidate id')).sort(),
    workerIds: workers.map((item) => assertSafeIdentifier(item.workerId, 'worker id')).sort(),
    capacityDigest: capacitySnapshot?.digest || digest(capacitySnapshot || {}),
  });
}

function computeSchedulingDecision({ id, policy, candidates, workers = [], capacitySnapshot = {}, evaluatedAt, rankCandidates, evaluateCapacity }) {
  if (typeof rankCandidates !== 'function') throw new TypeError('rankCandidates contract is required');
  if (typeof evaluateCapacity !== 'function') throw new TypeError('evaluateCapacity contract is required');
  if (!policy || policy.status !== 'active') throw new Error('Active scheduling policy is required');
  if (!Array.isArray(candidates) || !Array.isArray(workers)) throw new TypeError('candidates/workers must be arrays');
  const evaluated = isoInstant(evaluatedAt, 'evaluatedAt');
  const ordered = rankCandidates({ policy, candidates, evaluatedAt: evaluated, capacitySnapshot });
  if (!Array.isArray(ordered)) throw new TypeError('rankCandidates must return an array');
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const orderedCandidateIds = ordered.map((item) => assertSafeIdentifier(item.id || item.candidateId, 'ordered candidate id'));
  if (new Set(orderedCandidateIds).size !== orderedCandidateIds.length) throw new Error('rankCandidates returned duplicate candidate ids');
  for (const candidateId of orderedCandidateIds) if (!byId.has(candidateId)) throw new Error('rankCandidates returned an unknown candidate id');

  const deferred = [];
  let selectedCandidateId = null;
  let selectedWorkerId = null;
  for (const candidateId of orderedCandidateIds) {
    const candidate = byId.get(candidateId);
    const result = evaluateCapacity({ candidate, policy, workers, capacitySnapshot, evaluatedAt: evaluated });
    if (!result || typeof result !== 'object') throw new TypeError('evaluateCapacity must return an object');
    const workerIds = Array.isArray(result.compatibleWorkerIds) ? result.compatibleWorkerIds.map((workerId) => assertSafeIdentifier(workerId, 'compatible worker id')) : [];
    if (result.eligible === true && workerIds.length > 0 && selectedCandidateId === null) {
      selectedCandidateId = candidateId;
      selectedWorkerId = workerIds[0];
      continue;
    }
    deferred.push(deepFreeze({
      candidateId,
      reasonCodes: Array.isArray(result.reasonCodes) && result.reasonCodes.length > 0
        ? [...new Set(result.reasonCodes.map((code) => assertSafeIdentifier(code, 'capacity reason code')))].sort()
        : ['no_compatible_worker'],
    }));
  }

  const inputDigest = createInputDigest({ policy, candidates, workers, capacitySnapshot, evaluatedAt: evaluated });
  const reasonCodes = selectedCandidateId ? ['selected'] : ['no_assignment'];
  const base = {
    id: assertSafeIdentifier(id, 'scheduling decision id'),
    policySnapshotId: assertSafeIdentifier(policy.id, 'scheduling policy id'),
    inputDigest,
    evaluatedAt: evaluated,
    orderedCandidateIds,
    selectedCandidateId,
    selectedWorkerId,
    reasonCodes,
    deferred,
  };
  return deepFreeze({ ...base, decisionDigest: digest(base) });
}

function createAssignmentProposal({ id, decision, candidate, authoritySnapshotDigest }) {
  if (!decision?.selectedCandidateId || !decision?.selectedWorkerId) throw new Error('SchedulingDecision has no selected assignment');
  if (!candidate || candidate.id !== decision.selectedCandidateId || candidate.readyState !== 'ready') throw new Error('Selected candidate does not match SchedulingDecision');
  const base = {
    id: assertSafeIdentifier(id, 'assignment proposal id'),
    decisionId: assertSafeIdentifier(decision.id, 'scheduling decision id'),
    workspaceId: assertSafeIdentifier(candidate.workspaceId, 'workspace id'),
    candidateId: assertSafeIdentifier(candidate.id, 'candidate id'),
    workerId: assertSafeIdentifier(decision.selectedWorkerId, 'worker id'),
    executionIdentity: assertSafeIdentifier(candidate.executionIdentity, 'execution identity'),
    authoritySnapshotDigest: requiredText(authoritySnapshotDigest, 'authority snapshot digest', 100),
    state: 'proposed',
  };
  return deepFreeze(base);
}

function revalidateAssignmentProposal({ proposal, current }) {
  if (!proposal || proposal.state !== 'proposed') throw new Error('Only proposed assignments can be revalidated');
  if (!current || typeof current !== 'object') throw new TypeError('current authority state is required');
  const reject = (state, reasonCode) => deepFreeze({ ...proposal, state, reasonCode });
  if (current.authoritySnapshotDigest !== proposal.authoritySnapshotDigest) return reject('stale', 'stale_authority_snapshot');
  if (current.executionIdentity !== proposal.executionIdentity) return reject('stale', 'stale_execution_identity');
  if (current.candidateReady !== true) return reject('rejected', 'rejected_not_ready');
  if (current.resourceAvailable !== true) return reject('rejected', 'rejected_resource_conflict');
  if (current.providerCapacityCurrent !== true) return reject('rejected', 'rejected_provider_capacity');
  if (current.humanGateClear !== true) return reject('rejected', 'rejected_human_gate');
  if (current.priorEffectCertain !== true) return reject('rejected', 'rejected_uncertain');
  return deepFreeze({ ...proposal, state: 'accepted', reasonCode: 'accepted_current' });
}

module.exports = {
  canonicalReadiness,
  computeSchedulingDecision,
  createAssignmentProposal,
  createInputDigest,
  deriveSchedulingCandidates,
  digest,
  revalidateAssignmentProposal,
  toCandidate,
};
