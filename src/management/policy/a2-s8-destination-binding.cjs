'use strict';

const { A2_S8_DESTINATION_ADMISSION_SCHEMA } = require('./a2-s8-destination-admission.cjs');

const A2_S8_DESTINATION_BINDING_SCHEMA = 'aiexe.a2-s8-destination-binding.v1';

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

function requiredServiceMethod(service, name) {
  if (!service || typeof service[name] !== 'function') {
    throw new TypeError(`canonical S8 destination owner must expose ${name}`);
  }
}

function baseResult(destinationAdmission, destinationWorkspaceId) {
  return {
    schema: A2_S8_DESTINATION_BINDING_SCHEMA,
    destinationAdmissionSchema: destinationAdmission?.schema || null,
    actionId: destinationAdmission?.actionId || null,
    actionType: destinationAdmission?.actionType || null,
    projectId: destinationAdmission?.projectId || null,
    authorizationRequestRef: destinationAdmission?.authorizationRequestRef || null,
    authorizationDecisionRef: destinationAdmission?.authorizationDecisionRef || null,
    delegationRequestRef: destinationAdmission?.delegationRequestRef || null,
    delegationRequestDigest: destinationAdmission?.delegationRequestDigest || null,
    destinationWorkspaceId,
    destinationProposalRef: destinationAdmission?.destinationProposalRef || null,
    destinationOriginalAdmissionRef: destinationAdmission?.destinationAdmissionSnapshotRef || null,
    destinationOriginalAdmissionDigest: destinationAdmission?.destinationAdmissionDigest || null,
    destinationHumanGateRef: destinationAdmission?.destinationHumanGateRef || null,
    destinationStateQueryPerformed: false,
    destinationDecisionObserved: false,
    destinationHumanGateState: null,
    destinationHumanGateDecision: null,
    destinationFreshAdmissionObserved: false,
    destinationFreshAdmissionRef: null,
    destinationFreshAdmissionDigest: null,
    destinationAcceptanceObserved: false,
    destinationAcceptanceRef: null,
    destinationAcceptanceState: null,
    destinationExecutionBindingObserved: false,
    destinationExecutionBindingRef: null,
    destinationLocalMissionRef: null,
    destinationLocalPlanStepRef: null,
    destinationLocalStepAttemptRef: null,
    destinationLocalExecutionRunRef: null,
    destinationReceiptObserved: false,
    destinationCompletedReceiptObserved: false,
    destinationHumanGateDecisionCreatedByManagementLayer: false,
    destinationExecutionBindingCreatedByManagementLayer: false,
    destinationExecutionPerformedByManagementLayer: false,
    managementEffectInvocationPerformed: false,
    automaticReplayAllowed: false,
    executionAuthorized: false,
    domainWritePerformedByManagementLayer: false,
    binding: false,
    authority: 's8-destination-decision-binding-observation-only',
  };
}

function blocked(destinationAdmission, destinationWorkspaceId, reason, extra = {}) {
  return freezeDeep({
    ...baseResult(destinationAdmission, destinationWorkspaceId),
    destinationBindingObservationAccepted: false,
    destinationBindingObservationReason: reason,
    ...extra,
  });
}

function exactCardinality(rows, predicate) {
  const matches = (rows || []).filter(predicate);
  return { matches, exact: matches.length === 1, one: matches[0] || null };
}

function inspectDestinationDecisionAndBinding(state, destinationAdmission) {
  if (!state?.found) return { state: 'review', reason: 'destination_workspace_not_found' };

  const proposal = (state.incomingProposals || []).find((item) => item.id === destinationAdmission.destinationProposalRef) || null;
  if (!proposal) return { state: 'review', reason: 'destination_proposal_not_found' };
  if (proposal.delegationRequestId !== destinationAdmission.delegationRequestRef) {
    return { state: 'review', reason: 'destination_proposal_request_mismatch', proposal };
  }

  const gate = (state.humanGates || []).find((item) => item.id === destinationAdmission.destinationHumanGateRef) || null;
  if (!gate) return { state: 'review', reason: 'destination_human_gate_not_found', proposal };
  if (gate.proposalId && gate.proposalId !== proposal.id) return { state: 'review', reason: 'destination_human_gate_proposal_mismatch', proposal, gate };
  if (gate.delegationRequestId && gate.delegationRequestId !== destinationAdmission.delegationRequestRef) {
    return { state: 'review', reason: 'destination_human_gate_request_mismatch', proposal, gate };
  }

  const acceptanceCardinality = exactCardinality(state.acceptances, (item) => item.proposalId === proposal.id);
  const bindingCardinality = exactCardinality(state.executionBindings, (item) => item.proposalId === proposal.id || item.delegationRequestId === destinationAdmission.delegationRequestRef);

  if (proposal.state === 'waiting_human') {
    if (gate.state !== 'requested') return { state: 'review', reason: 'destination_pending_gate_state_conflict', proposal, gate };
    if (acceptanceCardinality.matches.length || bindingCardinality.matches.length) {
      return { state: 'review', reason: 'destination_pending_state_has_advanced_records', proposal, gate };
    }
    return { state: 'pending', reason: 'destination_human_gate_still_pending', proposal, gate };
  }

  if (proposal.state === 'rejected') {
    if (gate.state !== 'rejected') return { state: 'review', reason: 'destination_rejected_gate_state_conflict', proposal, gate };
    if (!acceptanceCardinality.exact || acceptanceCardinality.one.state !== 'rejected') {
      return { state: 'review', reason: 'destination_rejection_acceptance_missing_or_ambiguous', proposal, gate };
    }
    if (acceptanceCardinality.one.humanGateId !== gate.id) {
      return { state: 'review', reason: 'destination_rejection_gate_binding_mismatch', proposal, gate, acceptance: acceptanceCardinality.one };
    }
    if (bindingCardinality.matches.length) {
      return { state: 'review', reason: 'destination_rejected_proposal_must_not_have_execution_binding', proposal, gate, acceptance: acceptanceCardinality.one };
    }
    const admission = (state.admissionSnapshots || []).find((item) => item.id === acceptanceCardinality.one.admissionSnapshotId) || null;
    if (!admission || admission.proposalId !== proposal.id || admission.requestDigest !== destinationAdmission.delegationRequestDigest || admission.admissible !== true) {
      return { state: 'review', reason: 'destination_rejection_admission_binding_invalid', proposal, gate, acceptance: acceptanceCardinality.one, admission };
    }
    return { state: 'rejected', reason: 'destination_human_gate_rejected', proposal, gate, acceptance: acceptanceCardinality.one, admission };
  }

  if (proposal.state !== 'bound') return { state: 'review', reason: 'destination_proposal_state_not_binding_terminal', proposal, gate };
  if (gate.state !== 'approved') return { state: 'review', reason: 'destination_bound_gate_not_approved', proposal, gate };
  if (!acceptanceCardinality.exact || acceptanceCardinality.one.state !== 'accepted') {
    return { state: 'review', reason: 'destination_acceptance_missing_or_ambiguous', proposal, gate };
  }
  const acceptance = acceptanceCardinality.one;
  if (acceptance.humanGateId !== gate.id) return { state: 'review', reason: 'destination_acceptance_gate_binding_mismatch', proposal, gate, acceptance };

  const freshAdmission = (state.admissionSnapshots || []).find((item) => item.id === acceptance.admissionSnapshotId) || null;
  if (!freshAdmission || freshAdmission.proposalId !== proposal.id || freshAdmission.admissible !== true) {
    return { state: 'review', reason: 'destination_fresh_admission_missing_or_inadmissible', proposal, gate, acceptance, freshAdmission };
  }
  if (freshAdmission.requestDigest !== destinationAdmission.delegationRequestDigest) {
    return { state: 'review', reason: 'destination_fresh_admission_request_digest_mismatch', proposal, gate, acceptance, freshAdmission };
  }
  if (!bindingCardinality.exact) {
    return { state: 'review', reason: 'destination_execution_binding_missing_or_ambiguous', proposal, gate, acceptance, freshAdmission };
  }
  const executionBinding = bindingCardinality.one;
  if (executionBinding.proposalId !== proposal.id || executionBinding.delegationRequestId !== destinationAdmission.delegationRequestRef || executionBinding.workspaceId !== destinationAdmission.destinationWorkspaceId) {
    return { state: 'review', reason: 'destination_execution_binding_scope_mismatch', proposal, gate, acceptance, freshAdmission, executionBinding };
  }
  const localRefs = [
    executionBinding.localMissionId,
    executionBinding.localPlanStepId,
    executionBinding.localTaskId,
    executionBinding.localStepAttemptId,
    executionBinding.localExecutionRunId,
  ].filter(Boolean);
  if (localRefs.length === 0) {
    return { state: 'review', reason: 'destination_execution_binding_has_no_local_identity', proposal, gate, acceptance, freshAdmission, executionBinding };
  }

  const receipts = (state.receipts || []).filter((item) => item.delegationRequestId === destinationAdmission.delegationRequestRef);
  return {
    state: 'bound',
    reason: 'destination_human_gate_approved_and_binding_observed',
    proposal,
    gate,
    acceptance,
    freshAdmission,
    executionBinding,
    receipts,
  };
}

function observedResult(destinationAdmission, destinationWorkspaceId, inspection) {
  const { proposal = null, gate = null, acceptance = null, admission = null, freshAdmission = admission, executionBinding = null, receipts = [] } = inspection;
  const decision = gate?.state === 'approved' ? 'approved' : gate?.state === 'rejected' ? 'rejected' : null;
  return freezeDeep({
    ...baseResult(destinationAdmission, destinationWorkspaceId),
    destinationBindingObservationAccepted: inspection.state === 'bound' || inspection.state === 'rejected' || inspection.state === 'pending',
    destinationBindingObservationReason: inspection.reason,
    destinationStateQueryPerformed: true,
    destinationDecisionObserved: decision !== null,
    destinationHumanGateState: gate?.state || null,
    destinationHumanGateDecision: decision,
    destinationFreshAdmissionObserved: !!freshAdmission && decision !== null,
    destinationFreshAdmissionRef: freshAdmission?.id || null,
    destinationFreshAdmissionDigest: freshAdmission?.admissionDigest || null,
    destinationAcceptanceObserved: !!acceptance,
    destinationAcceptanceRef: acceptance?.id || null,
    destinationAcceptanceState: acceptance?.state || null,
    destinationExecutionBindingObserved: !!executionBinding,
    destinationExecutionBindingRef: executionBinding?.id || null,
    destinationLocalMissionRef: executionBinding?.localMissionId || null,
    destinationLocalPlanStepRef: executionBinding?.localPlanStepId || null,
    destinationLocalStepAttemptRef: executionBinding?.localStepAttemptId || null,
    destinationLocalExecutionRunRef: executionBinding?.localExecutionRunId || null,
    destinationReceiptObserved: receipts.length > 0,
    destinationCompletedReceiptObserved: receipts.some((item) => item.state === 'completed'),
    destinationProposalState: proposal?.state || null,
  });
}

function observeA2DestinationDecisionAndBinding(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('M2.24 input must be an object');
  const allowed = new Set(['destinationAdmission', 'destinationWorkspaceId', 's8Service']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`M2.24 input contains unsupported field: ${key}`);

  const destinationAdmission = input.destinationAdmission;
  const destinationWorkspaceId = String(input.destinationWorkspaceId || '').trim();
  if (!destinationAdmission || destinationAdmission.schema !== A2_S8_DESTINATION_ADMISSION_SCHEMA) {
    return blocked(destinationAdmission, destinationWorkspaceId || null, 'destination_admission_schema_invalid');
  }
  if (!destinationWorkspaceId) return blocked(destinationAdmission, null, 'destination_workspace_required');
  if (destinationWorkspaceId !== destinationAdmission.destinationWorkspaceId) {
    return blocked(destinationAdmission, destinationWorkspaceId, 'destination_workspace_mismatch');
  }
  if (destinationAdmission.destinationAdmissionAccepted !== true
    || destinationAdmission.destinationAdmissionAdmissible !== true
    || destinationAdmission.destinationProposalState !== 'waiting_human'
    || destinationAdmission.destinationHumanGateRequested !== true
    || destinationAdmission.destinationHumanGateState !== 'requested'
    || destinationAdmission.destinationHumanGateDecisionCreated !== false
    || !destinationAdmission.destinationProposalRef
    || !destinationAdmission.destinationHumanGateRef
    || !destinationAdmission.delegationRequestRef
    || !destinationAdmission.delegationRequestDigest) {
    return blocked(destinationAdmission, destinationWorkspaceId, 'destination_admission_not_ready_for_independent_decision_observation');
  }

  const service = input.s8Service;
  requiredServiceMethod(service, 'queryDelegationState');
  const state = service.queryDelegationState(destinationWorkspaceId);
  const inspection = inspectDestinationDecisionAndBinding(state, destinationAdmission);
  if (['bound', 'rejected', 'pending'].includes(inspection.state)) {
    return observedResult(destinationAdmission, destinationWorkspaceId, inspection);
  }
  return blocked(destinationAdmission, destinationWorkspaceId, inspection.reason, {
    destinationStateQueryPerformed: true,
    destinationObservationState: 'review_needed',
  });
}

module.exports = {
  A2_S8_DESTINATION_BINDING_SCHEMA,
  inspectDestinationDecisionAndBinding,
  observeA2DestinationDecisionAndBinding,
};
