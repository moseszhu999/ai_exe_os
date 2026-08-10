'use strict';

const { A2_S8_DESTINATION_ACTION_READINESS_SCHEMA } = require('./a2-s8-destination-action-readiness.cjs');
const { A2_S8_DESTINATION_EFFECT_ENTRY_PREFLIGHT_SCHEMA } = require('./a2-s8-destination-effect-entry-preflight.cjs');

const A2_S8_DESTINATION_EFFECT_OBSERVATION_SCHEMA = 'aiexe.a2-s8-destination-effect-observation.v1';

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}
function exactOne(rows, predicate) {
  const matches = (rows || []).filter(predicate);
  return { exact: matches.length === 1, one: matches[0] || null };
}
function base(readiness, preflight, workspaceId) {
  return {
    schema: A2_S8_DESTINATION_EFFECT_OBSERVATION_SCHEMA,
    actionReadinessSchema: readiness?.schema || null,
    effectPreflightSchema: preflight?.schema || null,
    actionId: readiness?.actionId || null,
    actionType: readiness?.actionType || null,
    projectId: readiness?.projectId || null,
    delegationRequestRef: readiness?.delegationRequestRef || null,
    destinationWorkspaceId: workspaceId,
    destinationExecutionBindingRef: readiness?.destinationExecutionBindingRef || null,
    destinationLocalMissionRef: readiness?.destinationLocalMissionRef || null,
    destinationLocalStepAttemptRef: readiness?.destinationLocalStepAttemptRef || null,
    destinationLocalExecutionRunRef: readiness?.destinationLocalExecutionRunRef || null,
    destinationActionTaskRef: readiness?.destinationActionTaskRef || null,
    destinationActionHumanGateRef: readiness?.destinationActionHumanGateRef || null,
    destinationRuntimeAction: preflight?.destinationRuntimeAction || null,
    destinationRuntimeTarget: preflight?.destinationRuntimeTarget || null,
    destinationMissionStateQueryPerformed: false,
    destinationActionHumanGateDecisionObserved: false,
    destinationActionHumanGateState: null,
    destinationExecutionObserved: false,
    destinationExecutionRunState: null,
    destinationStepAttemptState: null,
    destinationMissionRunState: null,
    destinationEffectState: null,
    destinationEffectEvidenceRefs: Object.freeze([]),
    destinationEffectCompleted: false,
    destinationEffectUncertain: false,
    destinationActionHumanGateDecisionCreatedByManagementLayer: false,
    destinationExecutionPerformedByManagementLayer: false,
    managementEffectInvocationPerformed: false,
    destinationReceiptObserved: false,
    sourceReceiptPulled: false,
    sourceReceiptConsumed: false,
    automaticReplayAllowed: false,
    executionAuthorized: false,
    domainWritePerformedByManagementLayer: false,
    binding: false,
    authority: 'destination-effect-observation-only',
  };
}
function result(readiness, preflight, workspaceId, accepted, reason, extra = {}) {
  return freezeDeep({
    ...base(readiness, preflight, workspaceId),
    destinationEffectObservationAccepted: accepted,
    destinationEffectObservationReason: reason,
    ...extra,
  });
}

function observeA2DestinationEffect(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('M2.28 input must be an object');
  const allowed = new Set(['actionReadiness', 'effectPreflight', 'destinationWorkspaceId', 's8Service']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`M2.28 input contains unsupported field: ${key}`);
  const readiness = input.actionReadiness;
  const preflight = input.effectPreflight;
  const workspaceId = String(input.destinationWorkspaceId || '').trim();
  if (!readiness || readiness.schema !== A2_S8_DESTINATION_ACTION_READINESS_SCHEMA) return result(readiness, preflight, workspaceId || null, false, 'destination_action_readiness_schema_invalid');
  if (!preflight || preflight.schema !== A2_S8_DESTINATION_EFFECT_ENTRY_PREFLIGHT_SCHEMA) return result(readiness, preflight, workspaceId || null, false, 'destination_effect_preflight_schema_invalid');
  if (!workspaceId || workspaceId !== readiness.destinationWorkspaceId || workspaceId !== preflight.destinationWorkspaceId) return result(readiness, preflight, workspaceId || null, false, 'destination_workspace_mismatch');
  if (readiness.destinationActionReadinessObservationAccepted !== true
    || readiness.destinationActionReadinessState !== 'waiting_human'
    || readiness.destinationActionHumanGateRequested !== true
    || readiness.destinationActionHumanGateState !== 'requested'
    || !readiness.destinationActionHumanGateRef
    || readiness.destinationActionHumanGateDecisionCreatedByManagementLayer !== false
    || readiness.destinationExecutionPerformedByManagementLayer !== false
    || readiness.managementEffectInvocationPerformed !== false) {
    return result(readiness, preflight, workspaceId, false, 'destination_action_readiness_not_exact_pending_gate');
  }
  if (preflight.destinationEffectEntryPreflightAccepted !== true
    || preflight.destinationDelegatedActionBindingCompatible !== true
    || !preflight.destinationRuntimeAction
    || !preflight.destinationRuntimeTarget
    || preflight.destinationActionTaskRef !== readiness.destinationActionTaskRef
    || preflight.destinationLocalExecutionRunRef !== readiness.destinationLocalExecutionRunRef
    || preflight.destinationExecutionPerformedByManagementLayer !== false
    || preflight.managementEffectInvocationPerformed !== false) {
    return result(readiness, preflight, workspaceId, false, 'destination_effect_preflight_not_exact_bound');
  }
  const service = input.s8Service;
  if (!service || typeof service.queryMissionState !== 'function') throw new TypeError('canonical S8 destination owner must expose queryMissionState');
  const state = service.queryMissionState(workspaceId);
  if (state?.activeWorkspaceId !== workspaceId) return result(readiness, preflight, workspaceId, false, 'destination_mission_state_workspace_mismatch', { destinationMissionStateQueryPerformed: true });
  const attempt = exactOne(state.stepAttempts, (item) => item.id === readiness.destinationLocalStepAttemptRef);
  const executionRun = exactOne(state.s1?.executionRuns, (item) => item.id === readiness.destinationLocalExecutionRunRef);
  const task = exactOne(state.s1?.tasks, (item) => item.id === readiness.destinationActionTaskRef);
  const gate = exactOne(state.humanGates || state.s1?.humanGates, (item) => item.id === readiness.destinationActionHumanGateRef);
  if (!attempt.exact || !executionRun.exact || !task.exact || !gate.exact) return result(readiness, preflight, workspaceId, false, 'destination_effect_identity_missing_or_ambiguous', { destinationMissionStateQueryPerformed: true });
  if (attempt.one.executionRunId !== executionRun.one.id || executionRun.one.taskId !== task.one.id || gate.one.executionRunId !== executionRun.one.id || attempt.one.humanGateId !== gate.one.id) {
    return result(readiness, preflight, workspaceId, false, 'destination_effect_identity_drift', { destinationMissionStateQueryPerformed: true });
  }
  if (task.one.capabilityAction !== preflight.destinationRuntimeAction || task.one.target !== preflight.destinationRuntimeTarget) {
    return result(readiness, preflight, workspaceId, false, 'destination_effect_runtime_semantic_drift', { destinationMissionStateQueryPerformed: true });
  }
  const missionRun = exactOne(state.missionRuns, (item) => item.id === attempt.one.missionRunId && item.missionId === readiness.destinationLocalMissionRef);
  if (!missionRun.exact) return result(readiness, preflight, workspaceId, false, 'destination_effect_mission_run_missing_or_ambiguous', { destinationMissionStateQueryPerformed: true });
  const evidence = (state.evidence || []).filter((item) => item.stepAttemptId === attempt.one.id || item.executionRunId === executionRun.one.id);
  const evidenceRefs = [...new Set(evidence.map((item) => item.id))].sort();

  if (gate.one.state === 'approved' && executionRun.one.state === 'result_observed' && attempt.one.state === 'completed' && missionRun.one.state === 'completed' && evidenceRefs.length > 0) {
    return result(readiness, preflight, workspaceId, true, 'destination_bounded_effect_completed', {
      destinationMissionStateQueryPerformed: true,
      destinationActionHumanGateDecisionObserved: true,
      destinationActionHumanGateState: 'approved',
      destinationExecutionObserved: true,
      destinationExecutionRunState: executionRun.one.state,
      destinationStepAttemptState: attempt.one.state,
      destinationMissionRunState: missionRun.one.state,
      destinationEffectState: 'completed',
      destinationEffectEvidenceRefs: Object.freeze(evidenceRefs),
      destinationEffectCompleted: true,
    });
  }
  if (attempt.one.state === 'recovery_required' || missionRun.one.state === 'recovery_required' || executionRun.one.recoveryReason) {
    return result(readiness, preflight, workspaceId, true, 'destination_effect_uncertain_requires_review', {
      destinationMissionStateQueryPerformed: true,
      destinationActionHumanGateDecisionObserved: gate.one.state === 'approved',
      destinationActionHumanGateState: gate.one.state,
      destinationExecutionObserved: true,
      destinationExecutionRunState: executionRun.one.state,
      destinationStepAttemptState: attempt.one.state,
      destinationMissionRunState: missionRun.one.state,
      destinationEffectState: 'uncertain',
      destinationEffectEvidenceRefs: Object.freeze(evidenceRefs),
      destinationEffectUncertain: true,
      automaticReplayAllowed: false,
    });
  }
  return result(readiness, preflight, workspaceId, false, 'destination_effect_state_not_completed_or_contained', {
    destinationMissionStateQueryPerformed: true,
    destinationActionHumanGateDecisionObserved: ['approved', 'rejected'].includes(gate.one.state),
    destinationActionHumanGateState: gate.one.state,
    destinationExecutionRunState: executionRun.one.state,
    destinationStepAttemptState: attempt.one.state,
    destinationMissionRunState: missionRun.one.state,
    destinationEffectEvidenceRefs: Object.freeze(evidenceRefs),
  });
}

module.exports = { A2_S8_DESTINATION_EFFECT_OBSERVATION_SCHEMA, observeA2DestinationEffect };
