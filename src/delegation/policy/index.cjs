'use strict';

const { assertSafeIdentifier } = require('../../domain/identifiers.cjs');
const { requiredText } = require('../../domain/workspace-model.cjs');
const { digest, safeClone } = require('../../sync/envelope/index.cjs');

const POLICY_STATES = Object.freeze(['active', 'superseded', 'revoked']);
const PEER_STATES = Object.freeze(['active', 'suspended', 'revoked']);

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

function isoInstant(value, label) {
  const text = requiredText(value, label, 40);
  const time = Date.parse(text);
  if (!Number.isFinite(time)) throw new TypeError(`${label} must be ISO-compatible`);
  return new Date(time).toISOString();
}

function positiveInteger(value, label, { allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < (allowZero ? 0 : 1)) throw new TypeError(`${label} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`);
  return number;
}

function exactIdentifier(value, label) {
  const id = assertSafeIdentifier(value, label);
  if (id.includes('*')) throw new Error(`${label} must not be wildcarded`);
  return id;
}

function uniqueIdentifierList(value, label) {
  if (!Array.isArray(value) || value.length < 1) throw new TypeError(`${label} must be a non-empty array`);
  const items = value.map((item) => exactIdentifier(item, label));
  if (new Set(items).size !== items.length) throw new Error(`${label} must not contain duplicates`);
  return Object.freeze([...items].sort());
}

function uniqueTextList(value, label, maxLength = 2048) {
  if (!Array.isArray(value) || value.length < 1) throw new TypeError(`${label} must be a non-empty array`);
  const items = value.map((item) => requiredText(item, label, maxLength));
  if (items.some((item) => item.includes('*'))) throw new Error(`${label} must not contain wildcard entries`);
  if (new Set(items).size !== items.length) throw new Error(`${label} must not contain duplicates`);
  return Object.freeze([...items].sort());
}

function createDelegationPeerBinding(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('DelegationPeerBinding input is required');
  const status = input.status || 'active';
  if (!PEER_STATES.includes(status)) throw new Error('Invalid DelegationPeerBinding status');
  const sourceInstanceId = exactIdentifier(input.sourceInstanceId, 'source instance id');
  const destinationInstanceId = exactIdentifier(input.destinationInstanceId, 'destination instance id');
  if (sourceInstanceId === destinationInstanceId) throw new Error('delegation peer binding requires distinct source and destination instances');
  return freezeDeep({
    id: exactIdentifier(input.id, 'delegation peer binding id'),
    sourceInstanceId,
    sourceWorkspaceId: exactIdentifier(input.sourceWorkspaceId, 'source workspace id'),
    destinationInstanceId,
    destinationWorkspaceId: exactIdentifier(input.destinationWorkspaceId, 'destination workspace id'),
    status,
    createdAt: isoInstant(input.createdAt || new Date().toISOString(), 'peer binding createdAt'),
    updatedAt: isoInstant(input.updatedAt || input.createdAt || new Date().toISOString(), 'peer binding updatedAt'),
  });
}

function createDelegationPolicySnapshot(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('DelegationPolicySnapshot input is required');
  const status = input.status || 'active';
  if (!POLICY_STATES.includes(status)) throw new Error('Invalid DelegationPolicySnapshot status');
  const expiresAt = input.expiresAt == null ? null : isoInstant(input.expiresAt, 'policy expiresAt');
  const createdAt = isoInstant(input.createdAt || new Date().toISOString(), 'policy createdAt');
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(createdAt)) throw new Error('policy expiry must be after creation');
  return freezeDeep({
    id: exactIdentifier(input.id, 'delegation policy id'),
    version: requiredText(input.version, 'delegation policy version', 80),
    peerBindingId: exactIdentifier(input.peerBindingId, 'peer binding id'),
    destinationWorkspaceId: exactIdentifier(input.destinationWorkspaceId, 'destination workspace id'),
    status,
    allowedCapabilityVersionIds: uniqueIdentifierList(input.allowedCapabilityVersionIds, 'allowed capability version id'),
    allowedActions: uniqueIdentifierList(input.allowedActions, 'allowed action'),
    allowedTargets: uniqueTextList(input.allowedTargets, 'allowed target'),
    maxPendingRequests: positiveInteger(input.maxPendingRequests ?? 8, 'maxPendingRequests'),
    maxAcceptedNotStarted: positiveInteger(input.maxAcceptedNotStarted ?? 2, 'maxAcceptedNotStarted'),
    expiresAt,
    createdAt,
  });
}

function assertPolicyAllowsRequest(policy, request, { observedAt = new Date().toISOString() } = {}) {
  if (!policy || policy.status !== 'active') return freezeDeep({ allowed: false, reasonCode: policy?.status === 'revoked' ? 'policy_revoked' : 'policy_missing' });
  if (policy.expiresAt && Date.parse(policy.expiresAt) <= Date.parse(observedAt)) return freezeDeep({ allowed: false, reasonCode: 'policy_expired' });
  if (policy.id !== request.policyId || policy.version !== request.policyVersion) return freezeDeep({ allowed: false, reasonCode: 'policy_version_mismatch' });
  if (policy.peerBindingId !== request.peerBindingId) return freezeDeep({ allowed: false, reasonCode: 'peer_binding_mismatch' });
  if (policy.destinationWorkspaceId !== request.destinationWorkspaceId) return freezeDeep({ allowed: false, reasonCode: 'cross_workspace' });
  if (!policy.allowedCapabilityVersionIds.includes(request.capabilityVersionId)) return freezeDeep({ allowed: false, reasonCode: 'capability_not_allowed' });
  if (!policy.allowedActions.includes(request.action)) return freezeDeep({ allowed: false, reasonCode: 'action_not_allowed' });
  if (!policy.allowedTargets.includes(request.target)) return freezeDeep({ allowed: false, reasonCode: 'target_not_allowed' });
  return freezeDeep({ allowed: true, reasonCode: 'policy_allows_request' });
}

function createDelegationRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('DelegationRequest input is required');
  const requestSequence = positiveInteger(input.requestSequence, 'delegation request sequence');
  const previousRequestDigest = input.previousRequestDigest == null ? null : requiredText(input.previousRequestDigest, 'previousRequestDigest', 100);
  if (requestSequence === 1 && previousRequestDigest !== null) throw new Error('request sequence 1 must not have previousRequestDigest');
  if (requestSequence > 1 && previousRequestDigest === null) throw new Error('request sequence > 1 requires previousRequestDigest');
  const payload = freezeDeep(safeClone(input.payload ?? {}));
  const payloadDigest = digest(payload);
  const base = {
    id: exactIdentifier(input.id, 'delegation request id'),
    sourceInstanceId: exactIdentifier(input.sourceInstanceId, 'source instance id'),
    sourceWorkspaceId: exactIdentifier(input.sourceWorkspaceId, 'source workspace id'),
    destinationInstanceId: exactIdentifier(input.destinationInstanceId, 'destination instance id'),
    destinationWorkspaceId: exactIdentifier(input.destinationWorkspaceId, 'destination workspace id'),
    peerBindingId: exactIdentifier(input.peerBindingId, 'peer binding id'),
    policyId: exactIdentifier(input.policyId, 'delegation policy id'),
    policyVersion: requiredText(input.policyVersion, 'delegation policy version', 80),
    sourceMissionId: input.sourceMissionId == null ? null : exactIdentifier(input.sourceMissionId, 'source mission id'),
    sourcePlanStepId: input.sourcePlanStepId == null ? null : exactIdentifier(input.sourcePlanStepId, 'source plan step id'),
    capabilityVersionId: exactIdentifier(input.capabilityVersionId, 'capability version id'),
    action: exactIdentifier(input.action, 'delegation action'),
    target: requiredText(input.target, 'delegation target', 2048),
    payloadClass: exactIdentifier(input.payloadClass || 'bounded-input', 'payload class'),
    payload,
    payloadDigest,
    requestSequence,
    previousRequestDigest,
    createdAt: isoInstant(input.createdAt || new Date().toISOString(), 'delegation request createdAt'),
  };
  return freezeDeep({ ...base, requestDigest: digest(base) });
}

function classifyDelegationRequestAppend({ peerBinding, lastSequence = 0, lastRequestDigest = null, existingRequest = null, request }) {
  if (!peerBinding || typeof peerBinding !== 'object') throw new TypeError('peerBinding is required');
  if (!request || typeof request !== 'object') throw new TypeError('request is required');
  if (peerBinding.status !== 'active') return freezeDeep({ state: 'rejected', reasonCode: `peer_binding_${peerBinding.status}` });
  if (request.peerBindingId !== peerBinding.id) return freezeDeep({ state: 'rejected', reasonCode: 'peer_binding_mismatch' });
  if (request.sourceInstanceId !== peerBinding.sourceInstanceId) return freezeDeep({ state: 'rejected', reasonCode: 'unknown_source_instance' });
  if (request.destinationInstanceId !== peerBinding.destinationInstanceId) return freezeDeep({ state: 'rejected', reasonCode: 'wrong_destination_instance' });
  if (request.sourceWorkspaceId !== peerBinding.sourceWorkspaceId || request.destinationWorkspaceId !== peerBinding.destinationWorkspaceId) {
    return freezeDeep({ state: 'rejected', reasonCode: 'cross_workspace' });
  }
  if (existingRequest) {
    if (existingRequest.id !== request.id) throw new Error('existingRequest id mismatch');
    if (existingRequest.requestDigest === request.requestDigest) return freezeDeep({ state: 'duplicate', reasonCode: 'exact_duplicate', requestSequence: request.requestSequence });
    return freezeDeep({ state: 'divergent', reasonCode: 'request_digest_conflict', requestSequence: request.requestSequence });
  }
  if (request.requestSequence <= lastSequence) return freezeDeep({ state: 'divergent', reasonCode: 'request_sequence_reuse_or_regression', expectedSequence: lastSequence + 1 });
  if (request.requestSequence > lastSequence + 1) return freezeDeep({ state: 'gap', reasonCode: 'request_sequence_gap', expectedSequence: lastSequence + 1 });
  if (lastSequence === 0) {
    if (request.previousRequestDigest !== null) return freezeDeep({ state: 'divergent', reasonCode: 'unexpected_previous_request_digest' });
  } else if (request.previousRequestDigest !== lastRequestDigest) {
    return freezeDeep({ state: 'divergent', reasonCode: 'previous_request_digest_mismatch' });
  }
  return freezeDeep({ state: 'accepted', reasonCode: 'append_current', requestSequence: request.requestSequence, requestDigest: request.requestDigest });
}

function createDelegationCancellationProposal(input) {
  return freezeDeep({
    id: exactIdentifier(input?.id, 'delegation cancellation proposal id'),
    delegationRequestId: exactIdentifier(input?.delegationRequestId, 'delegation request id'),
    reasonClass: exactIdentifier(input?.reasonClass || 'source_withdrawal', 'cancellation reason class'),
    createdAt: isoInstant(input?.createdAt || new Date().toISOString(), 'cancellation proposal createdAt'),
  });
}

module.exports = {
  PEER_STATES,
  POLICY_STATES,
  assertPolicyAllowsRequest,
  classifyDelegationRequestAppend,
  createDelegationCancellationProposal,
  createDelegationPeerBinding,
  createDelegationPolicySnapshot,
  createDelegationRequest,
};
