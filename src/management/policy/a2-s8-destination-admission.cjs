'use strict';

const { A2_S8_SOURCE_SUBMISSION_SCHEMA } = require('./a2-s8-source-submission.cjs');

const A2_S8_DESTINATION_ADMISSION_SCHEMA = 'aiexe.a2-s8-destination-admission.v1';

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

function requiredServiceMethod(service, name) {
  if (!service || typeof service[name] !== 'function') throw new TypeError(`canonical S8 destination owner must expose ${name}`);
}

function latestAdmission(state, proposalId) {
  return (state?.admissionSnapshots || [])
    .filter((item) => item.proposalId === proposalId)
    .sort((left, right) => String(right.observedAt || '').localeCompare(String(left.observedAt || '')))[0] || null;
}

function baseResult(sourceSubmission, destinationWorkspaceId) {
  return {
    schema: A2_S8_DESTINATION_ADMISSION_SCHEMA,
    sourceSubmissionSchema: sourceSubmission?.schema || null,
    actionId: sourceSubmission?.actionId || null,
    actionType: sourceSubmission?.actionType || null,
    projectId: sourceSubmission?.projectId || null,
    authorizationRequestRef: sourceSubmission?.authorizationRequestRef || null,
    authorizationDecisionRef: sourceSubmission?.authorizationDecisionRef || null,
    delegationRequestRef: sourceSubmission?.delegationRequestRef || null,
    delegationRequestDigest: sourceSubmission?.delegationRequestDigest || null,
    destinationWorkspaceId,
    destinationPreflightPerformed: false,
    destinationInboxPullAttempted: false,
    destinationInboxPullObserved: false,
    destinationAdmissionObserved: false,
    destinationAdmissionAdmissible: null,
    destinationAdmissionSnapshotRef: null,
    destinationAdmissionDigest: null,
    destinationAdmissionReasonCodes: [],
    destinationProposalRef: null,
    destinationProposalState: null,
    destinationHumanGateRequested: false,
    destinationHumanGateRef: null,
    destinationHumanGateState: null,
    destinationHumanGateDecisionCreated: false,
    delegationCreated: false,
    destinationExecutionBindingCreated: false,
    destinationExecutionPerformed: false,
    executionAuthorized: false,
    domainWritePerformedByManagementLayer: false,
    automaticReplayAllowed: false,
    binding: false,
    authority: 's8-destination-admission-observation-only',
  };
}

function blocked(sourceSubmission, destinationWorkspaceId, reason, extra = {}) {
  return freezeDeep({
    ...baseResult(sourceSubmission, destinationWorkspaceId),
    destinationAdmissionAccepted: false,
    destinationAdmissionReason: reason,
    ...extra,
  });
}

function inspectDestinationState(state, sourceSubmission) {
  if (!state?.found) return { state: 'blocked', reason: 'destination_workspace_not_found' };
  const requestRef = sourceSubmission.delegationRequestRef;
  const requestDigest = sourceSubmission.delegationRequestDigest;
  const proposal = (state.incomingProposals || []).find((item) => item.delegationRequestId === requestRef) || null;
  if (!proposal) return { state: 'ready_to_pull', reason: 'destination_request_not_yet_observed' };

  const admission = latestAdmission(state, proposal.id);
  if (!admission) return { state: 'review', reason: 'destination_proposal_missing_admission', proposal };
  if (admission.requestDigest !== requestDigest) {
    return { state: 'review', reason: 'destination_admission_request_digest_conflict', proposal, admission };
  }

  const acceptance = (state.acceptances || []).find((item) => item.proposalId === proposal.id) || null;
  const binding = (state.executionBindings || []).find((item) => item.proposalId === proposal.id || item.delegationRequestId === requestRef) || null;
  if (acceptance || binding) {
    return { state: 'review', reason: 'destination_authority_already_advanced', proposal, admission, acceptance, binding };
  }

  if (!admission.admissible) {
    if (proposal.state !== 'inadmissible') return { state: 'review', reason: 'destination_inadmissible_state_mismatch', proposal, admission };
    if (proposal.humanGateId) return { state: 'review', reason: 'inadmissible_proposal_must_not_have_gate', proposal, admission };
    return { state: 'observed_inadmissible', reason: 'destination_local_admission_rejected', proposal, admission };
  }

  const gate = proposal.humanGateId
    ? (state.humanGates || []).find((item) => item.id === proposal.humanGateId) || null
    : null;
  if (proposal.state !== 'waiting_human' || !gate || gate.state !== 'requested') {
    return { state: 'review', reason: 'destination_human_gate_state_not_pending', proposal, admission, gate };
  }
  return { state: 'observed_waiting_human', reason: 'destination_local_admission_requires_human_gate', proposal, admission, gate };
}

function observedResult(sourceSubmission, destinationWorkspaceId, inspection, extra = {}) {
  const { proposal, admission, gate = null } = inspection;
  return freezeDeep({
    ...baseResult(sourceSubmission, destinationWorkspaceId),
    destinationAdmissionAccepted: admission?.admissible === true,
    destinationAdmissionReason: inspection.reason,
    destinationPreflightPerformed: true,
    destinationAdmissionObserved: !!admission,
    destinationAdmissionAdmissible: admission?.admissible === true,
    destinationAdmissionSnapshotRef: admission?.id || null,
    destinationAdmissionDigest: admission?.admissionDigest || null,
    destinationAdmissionReasonCodes: [...(admission?.reasonCodes || [])],
    destinationProposalRef: proposal?.id || null,
    destinationProposalState: proposal?.state || null,
    destinationHumanGateRequested: gate?.state === 'requested',
    destinationHumanGateRef: gate?.id || null,
    destinationHumanGateState: gate?.state || null,
    ...extra,
  });
}

async function observeA2RequestAtS8Destination(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('M2.23 input must be an object');
  const allowed = new Set(['sourceSubmission', 'destinationWorkspaceId', 's8Service']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`M2.23 input contains unsupported field: ${key}`);

  const sourceSubmission = input.sourceSubmission;
  const destinationWorkspaceId = String(input.destinationWorkspaceId || '').trim();
  if (!sourceSubmission || sourceSubmission.schema !== A2_S8_SOURCE_SUBMISSION_SCHEMA) {
    return blocked(sourceSubmission, destinationWorkspaceId || null, 'source_submission_schema_invalid');
  }
  if (!destinationWorkspaceId) return blocked(sourceSubmission, null, 'destination_workspace_required');
  if (sourceSubmission.sourceSubmissionAccepted !== true
    || sourceSubmission.transportSubmissionState !== 'acknowledged'
    || !['accepted', 'duplicate'].includes(sourceSubmission.transportAckState)
    || !sourceSubmission.delegationRequestRef
    || !sourceSubmission.delegationRequestDigest) {
    return blocked(sourceSubmission, destinationWorkspaceId, 'source_submission_not_safely_acknowledged');
  }

  const service = input.s8Service;
  requiredServiceMethod(service, 'queryDelegationState');
  requiredServiceMethod(service, 'pullDelegationInbox');

  let state = service.queryDelegationState(destinationWorkspaceId);
  let inspection = inspectDestinationState(state, sourceSubmission);
  if (inspection.state === 'observed_waiting_human' || inspection.state === 'observed_inadmissible') {
    return observedResult(sourceSubmission, destinationWorkspaceId, inspection, {
      destinationInboxPullAttempted: false,
      destinationInboxPullObserved: false,
      destinationObservationState: 'existing_exact_no_pull',
    });
  }
  if (inspection.state === 'review' || inspection.state === 'blocked') {
    return blocked(sourceSubmission, destinationWorkspaceId, inspection.reason, {
      destinationPreflightPerformed: true,
      destinationObservationState: 'review_needed_no_pull',
    });
  }

  let pull;
  try {
    pull = await service.pullDelegationInbox({ workspaceId: destinationWorkspaceId });
  } catch (error) {
    return blocked(sourceSubmission, destinationWorkspaceId, 'destination_inbox_pull_outcome_uncertain', {
      destinationPreflightPerformed: true,
      destinationInboxPullAttempted: true,
      destinationInboxPullObserved: false,
      destinationObservationState: 'uncertain_requires_review_no_auto_replay',
      destinationTransportReasonCode: error?.message || 'transport_error',
    });
  }

  state = service.queryDelegationState(destinationWorkspaceId);
  inspection = inspectDestinationState(state, sourceSubmission);
  if (inspection.state === 'observed_waiting_human' || inspection.state === 'observed_inadmissible') {
    return observedResult(sourceSubmission, destinationWorkspaceId, inspection, {
      destinationInboxPullAttempted: true,
      destinationInboxPullObserved: pull?.networkRequested === true,
      destinationObservationState: inspection.state,
      destinationPullAcceptedCount: Number(pull?.accepted || 0),
      destinationPullDuplicateCount: Number(pull?.duplicate || 0),
      destinationPullRejectedCount: Number(pull?.rejected || 0),
    });
  }

  return blocked(sourceSubmission, destinationWorkspaceId, inspection.reason === 'destination_request_not_yet_observed'
    ? 'destination_request_not_observed_after_pull'
    : inspection.reason, {
    destinationPreflightPerformed: true,
    destinationInboxPullAttempted: true,
    destinationInboxPullObserved: pull?.networkRequested === true,
    destinationObservationState: inspection.state === 'review' ? 'review_needed_after_pull' : 'not_observed_after_pull',
    destinationPullAcceptedCount: Number(pull?.accepted || 0),
    destinationPullDuplicateCount: Number(pull?.duplicate || 0),
    destinationPullRejectedCount: Number(pull?.rejected || 0),
  });
}

module.exports = {
  A2_S8_DESTINATION_ADMISSION_SCHEMA,
  inspectDestinationState,
  observeA2RequestAtS8Destination,
};