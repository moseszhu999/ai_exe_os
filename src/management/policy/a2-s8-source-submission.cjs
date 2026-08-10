'use strict';

const { composeA2AuthorizedS8DelegationRequest } = require('./a2-s8-delegation-request-entry.cjs');

const A2_S8_SOURCE_SUBMISSION_SCHEMA = 'aiexe.a2-s8-source-submission.v1';

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

function requiredServiceMethod(service, name) {
  if (!service || typeof service[name] !== 'function') {
    throw new TypeError(`canonical S8 owner must expose ${name}`);
  }
}

function baseResult(entry) {
  return {
    schema: A2_S8_SOURCE_SUBMISSION_SCHEMA,
    actionId: entry.actionId,
    actionType: entry.actionType,
    projectId: entry.projectId,
    eligibilityRef: entry.eligibilityRef,
    authorizationRequestRef: entry.authorizationRequestRef,
    authorizationDecisionRef: entry.authorizationDecisionRef,
    authorizationDecision: entry.authorizationDecision,
    authorizationCoreAllowed: entry.authorizationCoreAllowed === true,
    delegationRequestConstructed: entry.delegationRequestConstructed === true,
    delegationRequestRef: entry.delegationRequest?.id || null,
    delegationRequestDigest: entry.delegationRequest?.requestDigest || null,
    s8OwnerPreflightPerformed: false,
    s8OwnerPreflightPassed: false,
    s8RequestPersistencePerformed: false,
    s8RequestAlreadyPresent: false,
    s8InvocationPerformed: false,
    transportSubmissionAttempted: false,
    transportSubmissionObserved: false,
    transportSubmissionPerformed: false,
    transportSubmissionState: 'not_attempted',
    transportAckState: null,
    transportAckReasonCode: null,
    automaticReplayAllowed: false,
    delegationCreated: false,
    destinationAdmissionPerformed: false,
    destinationHumanGateDecisionCreated: false,
    destinationExecutionPerformed: false,
    executionAuthorized: false,
    domainWritePerformed: false,
    binding: false,
    authority: 's8-source-submission-proof-only',
  };
}

function blocked(entry, reason, extra = {}) {
  return freezeDeep({
    ...baseResult(entry),
    sourceSubmissionAccepted: false,
    sourceSubmissionReason: reason,
    ...extra,
  });
}

function matchingPeer(peer, request) {
  return peer
    && peer.status === 'active'
    && peer.id === request.peerBindingId
    && peer.sourceInstanceId === request.sourceInstanceId
    && peer.sourceWorkspaceId === request.sourceWorkspaceId
    && peer.destinationInstanceId === request.destinationInstanceId
    && peer.destinationWorkspaceId === request.destinationWorkspaceId;
}

function inspectSourceState(state, request) {
  if (!state?.found) return { state: 'blocked', reason: 'source_workspace_not_found' };
  if (!state.endpointId) return { state: 'blocked', reason: 'delegation_endpoint_unavailable' };
  if (state.localInstanceId !== request.sourceInstanceId) return { state: 'blocked', reason: 'source_instance_mismatch' };

  const peer = (state.peerBindings || []).find((item) => item.id === request.peerBindingId) || null;
  if (!matchingPeer(peer, request)) return { state: 'blocked', reason: peer ? 'peer_binding_mismatch_or_inactive' : 'peer_binding_missing' };

  const outbound = (state.outboundRequests || [])
    .filter((item) => item.peerBindingId === request.peerBindingId)
    .sort((left, right) => Number(left.requestSequence) - Number(right.requestSequence));
  const existing = outbound.find((item) => item.id === request.id) || null;
  if (existing) {
    if (existing.requestDigest !== request.requestDigest) {
      return { state: 'blocked', reason: 'existing_request_digest_conflict', existing };
    }
    if (existing.transportState === 'acknowledged') {
      return { state: 'existing_acknowledged', reason: 'exact_request_already_acknowledged', existing };
    }
    return { state: 'existing_requires_review', reason: 'existing_request_not_safely_replayable', existing };
  }

  const previous = outbound.at(-1) || null;
  const expectedSequence = previous ? Number(previous.requestSequence) + 1 : 1;
  const expectedPreviousDigest = previous?.requestDigest || null;
  if (Number(request.requestSequence) !== expectedSequence) {
    return { state: 'blocked', reason: 'request_sequence_not_current', expectedSequence, expectedPreviousDigest };
  }
  if ((request.previousRequestDigest || null) !== expectedPreviousDigest) {
    return { state: 'blocked', reason: 'previous_request_digest_not_current', expectedSequence, expectedPreviousDigest };
  }
  return { state: 'ready', reason: 's8_source_state_exact', expectedSequence, expectedPreviousDigest };
}

function toS8CreateCommand(request) {
  return freezeDeep({
    workspaceId: request.sourceWorkspaceId,
    id: request.id,
    peerBindingId: request.peerBindingId,
    policyId: request.policyId,
    policyVersion: request.policyVersion,
    sourceMissionId: request.sourceMissionId,
    sourcePlanStepId: request.sourcePlanStepId,
    capabilityVersionId: request.capabilityVersionId,
    action: request.action,
    target: request.target,
    payloadClass: request.payloadClass,
    payload: request.payload,
    createdAt: request.createdAt,
  });
}

async function submitA2AuthorizedRequestThroughS8Source(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('M2.22 input must be an object');
  const allowed = new Set(['a2Request', 'authorizationRequest', 'delegationEnvelope', 's8Service']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`M2.22 input contains unsupported field: ${key}`);
  }

  const entry = composeA2AuthorizedS8DelegationRequest({
    a2Request: input.a2Request,
    authorizationRequest: input.authorizationRequest,
    delegationEnvelope: input.delegationEnvelope,
  });
  if (!entry.s8EntryEligible || !entry.delegationRequestConstructed || !entry.delegationRequest) {
    return blocked(entry, `m2_21_blocked:${entry.s8EntryReason}`);
  }

  const service = input.s8Service;
  requiredServiceMethod(service, 'queryDelegationState');
  requiredServiceMethod(service, 'createDelegationRequest');
  requiredServiceMethod(service, 'pushDelegationRequest');

  const request = entry.delegationRequest;
  const ownerState = service.queryDelegationState(request.sourceWorkspaceId);
  const inspection = inspectSourceState(ownerState, request);

  if (inspection.state === 'existing_acknowledged') {
    return blocked(entry, inspection.reason, {
      s8OwnerPreflightPerformed: true,
      s8OwnerPreflightPassed: true,
      s8RequestAlreadyPresent: true,
      transportSubmissionState: 'already_acknowledged_no_replay',
    });
  }
  if (inspection.state === 'existing_requires_review') {
    return blocked(entry, inspection.reason, {
      s8OwnerPreflightPerformed: true,
      s8OwnerPreflightPassed: true,
      s8RequestAlreadyPresent: true,
      transportSubmissionState: 'requires_review_no_auto_replay',
    });
  }
  if (inspection.state !== 'ready') {
    return blocked(entry, inspection.reason, {
      s8OwnerPreflightPerformed: true,
      s8OwnerPreflightPassed: false,
    });
  }

  const persisted = service.createDelegationRequest(toS8CreateCommand(request));
  if (!persisted || persisted.id !== request.id || persisted.requestDigest !== request.requestDigest) {
    return blocked(entry, 'canonical_s8_persistence_digest_mismatch', {
      s8OwnerPreflightPerformed: true,
      s8OwnerPreflightPassed: true,
      s8RequestPersistencePerformed: true,
      s8InvocationPerformed: true,
      transportSubmissionState: 'blocked_before_transport',
    });
  }

  try {
    const pushed = await service.pushDelegationRequest({
      workspaceId: request.sourceWorkspaceId,
      requestId: persisted.id,
    });
    const ackState = pushed?.ack?.state || null;
    const ackReasonCode = pushed?.ack?.reasonCode || null;
    const observed = pushed?.networkRequested === true;
    const accepted = observed && ['accepted', 'duplicate'].includes(ackState);
    return freezeDeep({
      ...baseResult(entry),
      sourceSubmissionAccepted: accepted,
      sourceSubmissionReason: accepted ? 'canonical_s8_source_submission_acknowledged' : 'canonical_s8_source_submission_not_accepted',
      s8OwnerPreflightPerformed: true,
      s8OwnerPreflightPassed: true,
      s8RequestPersistencePerformed: true,
      s8InvocationPerformed: true,
      transportSubmissionAttempted: true,
      transportSubmissionObserved: observed,
      transportSubmissionPerformed: observed,
      transportSubmissionState: accepted ? 'acknowledged' : 'rejected_or_divergent',
      transportAckState: ackState,
      transportAckReasonCode: ackReasonCode,
    });
  } catch (error) {
    return blocked(entry, 'transport_submission_outcome_uncertain', {
      s8OwnerPreflightPerformed: true,
      s8OwnerPreflightPassed: true,
      s8RequestPersistencePerformed: true,
      s8InvocationPerformed: true,
      transportSubmissionAttempted: true,
      transportSubmissionObserved: false,
      transportSubmissionPerformed: false,
      transportSubmissionState: 'uncertain_requires_review_no_auto_replay',
      transportAckReasonCode: error?.message || 'transport_error',
    });
  }
}

module.exports = {
  A2_S8_SOURCE_SUBMISSION_SCHEMA,
  inspectSourceState,
  submitA2AuthorizedRequestThroughS8Source,
  toS8CreateCommand,
};