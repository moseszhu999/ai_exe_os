'use strict';

const { A2_S8_DESTINATION_BINDING_SCHEMA } = require('./a2-s8-destination-binding.cjs');

const A2_S8_DESTINATION_ACTION_READINESS_SCHEMA = 'aiexe.a2-s8-destination-action-readiness.v1';

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

function baseResult(destinationBinding, destinationWorkspaceId) {
  return {
    schema: A2_S8_DESTINATION_ACTION_READINESS_SCHEMA,
    destinationBindingSchema: destinationBinding?.schema || null,
    actionId: destinationBinding?.actionId || null,
    actionType: destinationBinding?.actionType || null,
    projectId: destinationBinding?.projectId || null,
    authorizationRequestRef: destinationBinding?.authorizationRequestRef || null,
    authorizationDecisionRef: destinationBinding?.authorizationDecisionRef || null,
    delegationRequestRef: destinationBinding?.delegationRequestRef || null,
    delegationRequestDigest: destinationBinding?.delegationRequestDigest || null,
    destinationWorkspaceId,
    destinationProposalRef: destinationBinding?.destinationProposalRef || null,
    destinationDelegationHumanGateRef: destinationBinding?.destinationHumanGateRef || null,
    destinationAcceptanceRef: destinationBinding?.destinationAcceptanceRef || null,
    destinationExecutionBindingRef: destinationBinding?.destinationExecutionBindingRef || null,
    destinationLocalMissionRef: destinationBinding?.destinationLocalMissionRef || null,
    destinationLocalPlanStepRef: destinationBinding?.destinationLocalPlanStepRef || null,
    destinationLocalStepAttemptRef: destinationBinding?.destinationLocalStepAttemptRef || null,
    destinationLocalExecutionRunRef: destinationBinding?.destinationLocalExecutionRunRef || null,
    destinationDelegationStateQueryPerformed: false,
    destinationMissionStateQueryPerformed: false,
    destinationActionReadinessObserved: false,
    destinationActionReadinessState: null,
    destinationActionMissionRunRef: null,
    destinationActionMissionRunState: null,
    destinationActionStepAttemptState: null,
    destinationActionTaskRef: null,
    destinationActionTaskState: null,
    destinationActionExecutionRunState: null,
    destinationActionBlockers: Object.freeze([]),
    destinationActionHumanGateObserved: false,
    destinationActionHumanGateRef: null,
    destinationActionHumanGateState: null,
    destinationActionHumanGateRequested: false,
    destinationActionHumanGateDecisionObserved: false,
    destinationActionAdvancedBeyondReadinessSlice: false,
    destinationDelegationHumanGateDecisionCreatedByManagementLayer: false,
    destinationActionHumanGateDecisionCreatedByManagementLayer: false,
    destinationExecutionPerformedByManagementLayer: false,
    managementEffectInvocationPerformed: false,
    destinationReceiptObserved: false,
    automaticReplayAllowed: false,
    executionAuthorized: false,
    domainWritePerformedByManagementLayer: false,
    binding: false,
    authority: 's8-destination-action-readiness-observation-only',
  };
}

function blocked(destinationBinding, destinationWorkspaceId, reason, extra = {}) {
  return freezeDeep({
    ...baseResult(destinationBinding, destinationWorkspaceId),
    destinationActionReadinessObservationAccepted: false,
    destinationActionReadinessObservationReason: reason,
    ...extra,
  });
}

function exactOne(rows, predicate) {
  const matches = (rows || []).filter(predicate);
  return { matches, exact: matches.length === 1, one: matches[0] || null };
}

function sameStringSet(left, right) {
  const normalize = (rows) => [...new Set((rows || []).map((item) => JSON.stringify(item)))].sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function inspectActionReadiness({ delegationState, missionState, destinationBinding }) {
  if (!delegationState?.found) return { state: 'review', reason: 'destination_workspace_not_found' };
  if (missionState?.activeWorkspaceId !== destinationBinding.destinationWorkspaceId) {
    return { state: 'review', reason: 'destination_mission_state_workspace_mismatch' };
  }

  const bindingCardinality = exactOne(
    delegationState.executionBindings,
    (item) => item.id === destinationBinding.destinationExecutionBindingRef,
  );
  if (!bindingCardinality.exact) return { state: 'review', reason: 'destination_execution_binding_missing_or_ambiguous' };
  const executionBinding = bindingCardinality.one;
  if (executionBinding.delegationRequestId !== destinationBinding.delegationRequestRef
    || executionBinding.proposalId !== destinationBinding.destinationProposalRef
    || executionBinding.localMissionId !== destinationBinding.destinationLocalMissionRef
    || executionBinding.localPlanStepId !== destinationBinding.destinationLocalPlanStepRef
    || executionBinding.localStepAttemptId !== destinationBinding.destinationLocalStepAttemptRef
    || (executionBinding.localExecutionRunId || null) !== (destinationBinding.destinationLocalExecutionRunRef || null)) {
    return { state: 'review', reason: 'destination_execution_binding_identity_drift', executionBinding };
  }

  const delegationGate = exactOne(
    delegationState.humanGates,
    (item) => item.id === destinationBinding.destinationHumanGateRef,
  );
  if (!delegationGate.exact || delegationGate.one.state !== 'approved') {
    return { state: 'review', reason: 'destination_delegation_gate_no_longer_approved', executionBinding, delegationGate: delegationGate.one };
  }

  const acceptance = exactOne(
    delegationState.acceptances,
    (item) => item.id === destinationBinding.destinationAcceptanceRef,
  );
  if (!acceptance.exact || acceptance.one.state !== 'accepted') {
    return { state: 'review', reason: 'destination_acceptance_no_longer_exact_accepted', executionBinding, acceptance: acceptance.one };
  }

  const mission = exactOne(missionState.missions, (item) => item.id === destinationBinding.destinationLocalMissionRef);
  if (!mission.exact) return { state: 'review', reason: 'destination_local_mission_missing_or_ambiguous', executionBinding };

  const attempt = exactOne(
    missionState.stepAttempts,
    (item) => item.id === destinationBinding.destinationLocalStepAttemptRef,
  );
  if (!attempt.exact) return { state: 'review', reason: 'destination_local_step_attempt_missing_or_ambiguous', executionBinding };
  if (attempt.one.stepId !== destinationBinding.destinationLocalPlanStepRef) {
    return { state: 'review', reason: 'destination_local_step_attempt_plan_step_mismatch', executionBinding, attempt: attempt.one };
  }
  if ((attempt.one.executionRunId || null) !== (destinationBinding.destinationLocalExecutionRunRef || null)) {
    return { state: 'review', reason: 'destination_local_step_attempt_execution_run_mismatch', executionBinding, attempt: attempt.one };
  }

  const missionRun = exactOne(
    missionState.missionRuns,
    (item) => item.id === attempt.one.missionRunId && item.missionId === destinationBinding.destinationLocalMissionRef,
  );
  if (!missionRun.exact) {
    return { state: 'review', reason: 'destination_local_mission_run_missing_or_ambiguous', executionBinding, attempt: attempt.one };
  }

  if (!destinationBinding.destinationLocalExecutionRunRef) {
    return {
      state: 'not_created',
      reason: 'destination_action_execution_run_not_created',
      executionBinding,
      mission: mission.one,
      attempt: attempt.one,
      missionRun: missionRun.one,
      executionRun: null,
      task: null,
      actionGate: null,
    };
  }

  const s1 = missionState.s1 || {};
  const executionRun = exactOne(
    s1.executionRuns,
    (item) => item.id === destinationBinding.destinationLocalExecutionRunRef,
  );
  if (!executionRun.exact) {
    return { state: 'review', reason: 'destination_action_execution_run_missing_or_ambiguous', executionBinding, attempt: attempt.one, missionRun: missionRun.one };
  }

  const task = exactOne(s1.tasks, (item) => item.id === executionRun.one.taskId);
  if (!task.exact) {
    return { state: 'review', reason: 'destination_action_task_missing_or_ambiguous', executionBinding, attempt: attempt.one, missionRun: missionRun.one, executionRun: executionRun.one };
  }

  const gates = (missionState.humanGates || s1.humanGates || []).filter((item) => item.executionRunId === executionRun.one.id);
  if (gates.length > 1) {
    return { state: 'review', reason: 'destination_action_human_gate_ambiguous', executionBinding, attempt: attempt.one, missionRun: missionRun.one, executionRun: executionRun.one, task: task.one };
  }
  const actionGate = gates[0] || null;

  if (executionRun.one.state === 'blocked') {
    if (actionGate) return { state: 'review', reason: 'destination_blocked_action_must_not_have_human_gate', executionBinding, attempt: attempt.one, missionRun: missionRun.one, executionRun: executionRun.one, task: task.one, actionGate };
    if (attempt.one.state !== 'blocked') return { state: 'review', reason: 'destination_blocked_action_attempt_state_conflict', executionBinding, attempt: attempt.one, missionRun: missionRun.one, executionRun: executionRun.one, task: task.one };
    if (!Array.isArray(executionRun.one.blockers) || executionRun.one.blockers.length < 1) {
      return { state: 'review', reason: 'destination_blocked_action_missing_blockers', executionBinding, attempt: attempt.one, missionRun: missionRun.one, executionRun: executionRun.one, task: task.one };
    }
    if (!sameStringSet(attempt.one.blockers, executionRun.one.blockers)) {
      return { state: 'review', reason: 'destination_blocked_action_blocker_drift', executionBinding, attempt: attempt.one, missionRun: missionRun.one, executionRun: executionRun.one, task: task.one };
    }
    return { state: 'blocked', reason: 'destination_action_blocked_before_action_human_gate', executionBinding, mission: mission.one, attempt: attempt.one, missionRun: missionRun.one, executionRun: executionRun.one, task: task.one, actionGate: null };
  }

  if (executionRun.one.state === 'waiting_human') {
    if (attempt.one.state !== 'waiting_human') return { state: 'review', reason: 'destination_waiting_human_attempt_state_conflict', executionBinding, attempt: attempt.one, missionRun: missionRun.one, executionRun: executionRun.one, task: task.one, actionGate };
    if (!actionGate || actionGate.state !== 'requested') {
      return { state: 'review', reason: 'destination_action_human_gate_not_exact_requested', executionBinding, attempt: attempt.one, missionRun: missionRun.one, executionRun: executionRun.one, task: task.one, actionGate };
    }
    if (attempt.one.humanGateId && attempt.one.humanGateId !== actionGate.id) {
      return { state: 'review', reason: 'destination_action_attempt_gate_binding_mismatch', executionBinding, attempt: attempt.one, missionRun: missionRun.one, executionRun: executionRun.one, task: task.one, actionGate };
    }
    return { state: 'waiting_human', reason: 'destination_action_human_gate_requested', executionBinding, mission: mission.one, attempt: attempt.one, missionRun: missionRun.one, executionRun: executionRun.one, task: task.one, actionGate };
  }

  if (executionRun.one.state === 'cancelled' && actionGate?.state === 'rejected') {
    if (attempt.one.state !== 'cancelled') return { state: 'review', reason: 'destination_rejected_action_attempt_state_conflict', executionBinding, attempt: attempt.one, missionRun: missionRun.one, executionRun: executionRun.one, task: task.one, actionGate };
    return { state: 'rejected', reason: 'destination_action_human_gate_rejected', executionBinding, mission: mission.one, attempt: attempt.one, missionRun: missionRun.one, executionRun: executionRun.one, task: task.one, actionGate };
  }

  if (['active', 'result_observed', 'completed'].includes(executionRun.one.state)
    || actionGate?.state === 'approved'
    || executionRun.one.recoveryReason) {
    return { state: 'advanced', reason: 'destination_action_state_advanced_beyond_readiness_slice', executionBinding, mission: mission.one, attempt: attempt.one, missionRun: missionRun.one, executionRun: executionRun.one, task: task.one, actionGate };
  }

  return { state: 'review', reason: 'destination_action_state_unrecognized', executionBinding, mission: mission.one, attempt: attempt.one, missionRun: missionRun.one, executionRun: executionRun.one, task: task.one, actionGate };
}

function observedResult(destinationBinding, destinationWorkspaceId, inspection) {
  const { missionRun = null, attempt = null, executionRun = null, task = null, actionGate = null } = inspection;
  const accepted = ['blocked', 'waiting_human', 'rejected', 'not_created'].includes(inspection.state);
  return freezeDeep({
    ...baseResult(destinationBinding, destinationWorkspaceId),
    destinationActionReadinessObservationAccepted: accepted,
    destinationActionReadinessObservationReason: inspection.reason,
    destinationDelegationStateQueryPerformed: true,
    destinationMissionStateQueryPerformed: true,
    destinationActionReadinessObserved: true,
    destinationActionReadinessState: inspection.state,
    destinationActionMissionRunRef: missionRun?.id || null,
    destinationActionMissionRunState: missionRun?.state || null,
    destinationActionStepAttemptState: attempt?.state || null,
    destinationActionTaskRef: task?.id || null,
    destinationActionTaskState: task?.state || null,
    destinationActionExecutionRunState: executionRun?.state || null,
    destinationActionBlockers: Object.freeze([...(executionRun?.blockers || attempt?.blockers || [])]),
    destinationActionHumanGateObserved: !!actionGate,
    destinationActionHumanGateRef: actionGate?.id || null,
    destinationActionHumanGateState: actionGate?.state || null,
    destinationActionHumanGateRequested: actionGate?.state === 'requested',
    destinationActionHumanGateDecisionObserved: ['approved', 'rejected'].includes(actionGate?.state),
    destinationActionAdvancedBeyondReadinessSlice: inspection.state === 'advanced',
  });
}

function observeA2DestinationActionReadiness(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('M2.25 input must be an object');
  const allowed = new Set(['destinationBinding', 'destinationWorkspaceId', 's8Service']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`M2.25 input contains unsupported field: ${key}`);

  const destinationBinding = input.destinationBinding;
  const destinationWorkspaceId = String(input.destinationWorkspaceId || '').trim();
  if (!destinationBinding || destinationBinding.schema !== A2_S8_DESTINATION_BINDING_SCHEMA) {
    return blocked(destinationBinding, destinationWorkspaceId || null, 'destination_binding_schema_invalid');
  }
  if (!destinationWorkspaceId) return blocked(destinationBinding, null, 'destination_workspace_required');
  if (destinationWorkspaceId !== destinationBinding.destinationWorkspaceId) {
    return blocked(destinationBinding, destinationWorkspaceId, 'destination_workspace_mismatch');
  }
  if (destinationBinding.destinationBindingObservationAccepted !== true
    || destinationBinding.destinationDecisionObserved !== true
    || destinationBinding.destinationHumanGateDecision !== 'approved'
    || destinationBinding.destinationHumanGateState !== 'approved'
    || destinationBinding.destinationAcceptanceObserved !== true
    || destinationBinding.destinationAcceptanceState !== 'accepted'
    || destinationBinding.destinationExecutionBindingObserved !== true
    || !destinationBinding.destinationExecutionBindingRef
    || !destinationBinding.destinationLocalMissionRef
    || !destinationBinding.destinationLocalPlanStepRef
    || !destinationBinding.destinationLocalStepAttemptRef
    || destinationBinding.destinationHumanGateDecisionCreatedByManagementLayer !== false
    || destinationBinding.destinationExecutionBindingCreatedByManagementLayer !== false
    || destinationBinding.destinationExecutionPerformedByManagementLayer !== false
    || destinationBinding.managementEffectInvocationPerformed !== false) {
    return blocked(destinationBinding, destinationWorkspaceId, 'destination_binding_not_ready_for_action_readiness_observation');
  }

  const service = input.s8Service;
  requiredServiceMethod(service, 'queryDelegationState');
  requiredServiceMethod(service, 'queryMissionState');
  const delegationState = service.queryDelegationState(destinationWorkspaceId);
  const missionState = service.queryMissionState(destinationWorkspaceId);
  const inspection = inspectActionReadiness({ delegationState, missionState, destinationBinding });
  if (inspection.state === 'advanced') {
    return blocked(destinationBinding, destinationWorkspaceId, inspection.reason, {
      destinationDelegationStateQueryPerformed: true,
      destinationMissionStateQueryPerformed: true,
      destinationActionReadinessObserved: true,
      destinationActionReadinessState: inspection.state,
      destinationActionAdvancedBeyondReadinessSlice: true,
    });
  }
  if (inspection.state === 'review') {
    return blocked(destinationBinding, destinationWorkspaceId, inspection.reason, {
      destinationDelegationStateQueryPerformed: true,
      destinationMissionStateQueryPerformed: true,
      destinationActionReadinessObserved: true,
      destinationActionReadinessState: 'review_needed',
    });
  }
  return observedResult(destinationBinding, destinationWorkspaceId, inspection);
}

module.exports = {
  A2_S8_DESTINATION_ACTION_READINESS_SCHEMA,
  inspectActionReadiness,
  observeA2DestinationActionReadiness,
};
