'use strict';

const { assertSafeIdentifier } = require('../../domain/identifiers.cjs');
const { requiredText } = require('../../domain/workspace-model.cjs');
const { digest } = require('../../sync/envelope/index.cjs');

const PROPOSAL_STATES = Object.freeze(['received', 'inadmissible', 'waiting_human', 'accepted', 'rejected', 'cancelled_before_start', 'bound', 'terminal']);

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

function safeId(value, label) { return assertSafeIdentifier(value, label); }
function list(value) { return Array.isArray(value) ? value : []; }

function createIncomingDelegationProposal(input) {
  const state = input?.state || 'received';
  if (!PROPOSAL_STATES.includes(state)) throw new Error('Invalid IncomingDelegationProposal state');
  return freezeDeep({
    id: safeId(input?.id, 'incoming delegation proposal id'),
    delegationRequestId: safeId(input?.delegationRequestId, 'delegation request id'),
    peerBindingId: safeId(input?.peerBindingId, 'peer binding id'),
    policyId: safeId(input?.policyId, 'policy id'),
    workspaceId: safeId(input?.workspaceId, 'workspace id'),
    state,
    reasonCode: input?.reasonCode == null ? null : safeId(input.reasonCode, 'proposal reason code'),
    receivedAt: isoInstant(input?.receivedAt || new Date().toISOString(), 'proposal receivedAt'),
    updatedAt: isoInstant(input?.updatedAt || input?.receivedAt || new Date().toISOString(), 'proposal updatedAt'),
  });
}

function addReason(reasons, condition, code) { if (condition) reasons.push(code); }

function evaluateDelegationAdmission(input) {
  if (!input || typeof input !== 'object') throw new TypeError('delegation admission input is required');
  const { request, peerBinding, policy, localInstallation, localGrant } = input;
  if (!request) throw new TypeError('delegation request is required');
  const observedAt = isoInstant(input.observedAt || new Date().toISOString(), 'admission observedAt');
  const reasons = [];
  const localRuntimeIntent = input.localRuntimeIntent || null;
  const localAction = localRuntimeIntent?.runtimeAction || request.action;
  const localTarget = localRuntimeIntent?.runtimeTarget || request.target;

  addReason(reasons, !peerBinding, 'peer_binding_missing');
  if (peerBinding) {
    addReason(reasons, peerBinding.status === 'suspended', 'peer_binding_suspended');
    addReason(reasons, peerBinding.status === 'revoked', 'peer_binding_revoked');
    addReason(reasons, peerBinding.id !== request.peerBindingId, 'peer_binding_mismatch');
    addReason(reasons, peerBinding.sourceInstanceId !== request.sourceInstanceId, 'unknown_source_instance');
    addReason(reasons, peerBinding.destinationInstanceId !== request.destinationInstanceId, 'wrong_destination_instance');
    addReason(reasons, peerBinding.sourceWorkspaceId !== request.sourceWorkspaceId || peerBinding.destinationWorkspaceId !== request.destinationWorkspaceId, 'cross_workspace');
  }

  addReason(reasons, !policy, 'policy_missing');
  if (policy) {
    addReason(reasons, policy.status === 'revoked', 'policy_revoked');
    addReason(reasons, policy.status === 'superseded', 'policy_stale');
    addReason(reasons, policy.id !== request.policyId || policy.version !== request.policyVersion, 'policy_version_mismatch');
    addReason(reasons, policy.peerBindingId !== request.peerBindingId, 'peer_binding_mismatch');
    addReason(reasons, policy.destinationWorkspaceId !== request.destinationWorkspaceId, 'cross_workspace');
    addReason(reasons, !!policy.expiresAt && Date.parse(policy.expiresAt) <= Date.parse(observedAt), 'policy_expired');
    addReason(reasons, !list(policy.allowedCapabilityVersionIds).includes(request.capabilityVersionId), 'capability_not_allowed');
    addReason(reasons, !list(policy.allowedActions).includes(request.action), 'action_not_allowed');
    addReason(reasons, !list(policy.allowedTargets).includes(request.target), 'target_not_allowed');
    addReason(reasons, Number(input.pendingCount || 0) >= Number(policy.maxPendingRequests || Infinity), 'pending_limit_reached');
    addReason(reasons, Number(input.acceptedNotStartedCount || 0) >= Number(policy.maxAcceptedNotStarted || Infinity), 'accepted_not_started_limit_reached');
  }

  addReason(reasons, !localInstallation, 'local_installation_missing');
  if (localInstallation) {
    addReason(reasons, localInstallation.workspaceId !== request.destinationWorkspaceId, 'cross_workspace');
    addReason(reasons, localInstallation.capabilityVersionId !== request.capabilityVersionId, 'local_installation_version_mismatch');
    addReason(reasons, localInstallation.status && !['active', 'installed'].includes(localInstallation.status), 'local_installation_inactive');
  }

  addReason(reasons, !localGrant, 'local_grant_missing');
  if (localGrant) {
    addReason(reasons, localGrant.workspaceId !== request.destinationWorkspaceId, 'cross_workspace');
    addReason(reasons, localInstallation && localGrant.installationId !== localInstallation.id, 'local_grant_installation_mismatch');
    addReason(reasons, localGrant.status && localGrant.status !== 'active', 'local_grant_inactive');
    addReason(reasons, Array.isArray(localGrant.allowedActions) && !localGrant.allowedActions.includes(localAction), 'local_grant_action_missing');
    addReason(reasons, Array.isArray(localGrant.allowedTargets) && !localGrant.allowedTargets.includes(localTarget), 'local_grant_target_missing');
  }

  if (input.providerRequired === true) {
    addReason(reasons, !input.providerAuthority, 'provider_authority_missing');
    if (input.providerAuthority) addReason(reasons, input.providerAuthority.status !== 'current', 'provider_authority_stale');
  }

  if (input.resourceState) {
    addReason(reasons, input.resourceState.status === 'stale', 'resource_state_stale');
    addReason(reasons, input.resourceState.status === 'blocked', 'resource_blocked');
  }
  if (input.schedulingState) {
    addReason(reasons, input.schedulingState.status === 'stale', 'scheduling_state_stale');
    addReason(reasons, input.schedulingState.status === 'over_capacity', 'scheduling_capacity_exhausted');
  }

  const uniqueReasons = [...new Set(reasons)].sort();
  const base = {
    id: safeId(input.id || `admission-${request.id}`, 'delegation admission snapshot id'),
    proposalId: safeId(input.proposalId, 'proposal id'),
    workspaceId: safeId(request.destinationWorkspaceId, 'workspace id'),
    peerBindingDigest: peerBinding ? digest(peerBinding) : null,
    policyDigest: policy ? digest(policy) : null,
    capabilityInstallationId: localInstallation?.id || null,
    agentCapabilityGrantId: localGrant?.id || null,
    providerUseDigest: input.providerAuthority ? digest(input.providerAuthority) : null,
    resourceStateDigest: input.resourceState ? digest(input.resourceState) : null,
    schedulingStateDigest: input.schedulingState ? digest(input.schedulingState) : null,
    requestDigest: requiredText(request.requestDigest, 'requestDigest', 100),
    admissible: uniqueReasons.length === 0,
    reasonCodes: uniqueReasons,
    observedAt,
  };
  return freezeDeep({ ...base, admissionDigest: digest(base) });
}

function applyAdmissionToProposal(proposal, admission, updatedAt = new Date().toISOString()) {
  if (!proposal || proposal.id !== admission?.proposalId) throw new Error('proposal/admission mismatch');
  if (!['received', 'inadmissible'].includes(proposal.state)) throw new Error(`cannot apply admission from proposal state ${proposal.state}`);
  return createIncomingDelegationProposal({
    ...proposal,
    state: admission.admissible ? 'waiting_human' : 'inadmissible',
    reasonCode: admission.admissible ? 'human_gate_required' : (admission.reasonCodes[0] || 'inadmissible'),
    updatedAt,
  });
}

function createDelegationAcceptance(input) {
  const proposal = input?.proposal;
  if (!proposal || proposal.state !== 'waiting_human') throw new Error('delegation proposal must be waiting_human');
  const state = input.state;
  if (!['accepted', 'rejected'].includes(state)) throw new Error('DelegationAcceptance state must be accepted or rejected');
  if (!input.admission || input.admission.proposalId !== proposal.id || input.admission.admissible !== true) throw new Error('current admissible snapshot is required');
  return freezeDeep({
    id: safeId(input.id, 'delegation acceptance id'),
    proposalId: proposal.id,
    workspaceId: proposal.workspaceId,
    humanGateId: safeId(input.humanGateId, 'human gate id'),
    state,
    admissionSnapshotId: safeId(input.admission.id, 'admission snapshot id'),
    decidedAt: isoInstant(input.decidedAt || new Date().toISOString(), 'delegation acceptance decidedAt'),
  });
}

function createDelegatedExecutionBinding(input) {
  if (input?.existingBinding) throw new Error('delegation request is already bound');
  const proposal = input?.proposal;
  const acceptance = input?.acceptance;
  const admission = input?.admission;
  if (!proposal || proposal.state !== 'waiting_human') throw new Error('proposal must still be waiting_human before binding');
  if (!acceptance || acceptance.proposalId !== proposal.id || acceptance.state !== 'accepted') throw new Error('accepted destination HumanGate decision is required');
  if (!admission || admission.proposalId !== proposal.id || admission.admissible !== true) throw new Error('current admissible snapshot is required');
  if (acceptance.admissionSnapshotId !== admission.id) throw new Error('acceptance/admission snapshot mismatch');
  const identity = input.localIdentity || {};
  const refs = ['localMissionId', 'localPlanStepId', 'localTaskId', 'localStepAttemptId', 'localExecutionRunId'];
  if (!refs.some((key) => identity[key])) throw new Error('destination-local execution identity is required');
  const normalized = Object.fromEntries(refs.map((key) => [key, identity[key] == null ? null : safeId(identity[key], key)]));
  return freezeDeep({
    id: safeId(input.id, 'delegated execution binding id'),
    proposalId: proposal.id,
    delegationRequestId: proposal.delegationRequestId,
    workspaceId: proposal.workspaceId,
    ...normalized,
    createdAt: isoInstant(input.createdAt || new Date().toISOString(), 'delegated execution binding createdAt'),
  });
}

function applyCancellationProposal({ proposal, executionBinding = null, acceptedLocally = false, updatedAt = new Date().toISOString() }) {
  if (!proposal) throw new TypeError('proposal is required');
  if (executionBinding) return freezeDeep({ proposal, state: proposal.state, reasonCode: 'post_start_remote_cancel_non_authoritative' });
  if (!acceptedLocally) return freezeDeep({ proposal, state: proposal.state, reasonCode: 'cancellation_proposal_pending_local_decision' });
  if (!['received', 'inadmissible', 'waiting_human'].includes(proposal.state)) throw new Error(`cannot cancel proposal from state ${proposal.state}`);
  const cancelled = createIncomingDelegationProposal({ ...proposal, state: 'cancelled_before_start', reasonCode: 'source_cancellation_accepted_locally', updatedAt });
  return freezeDeep({ proposal: cancelled, state: cancelled.state, reasonCode: cancelled.reasonCode });
}

module.exports = {
  PROPOSAL_STATES,
  applyAdmissionToProposal,
  applyCancellationProposal,
  createDelegatedExecutionBinding,
  createDelegationAcceptance,
  createIncomingDelegationProposal,
  evaluateDelegationAdmission,
};