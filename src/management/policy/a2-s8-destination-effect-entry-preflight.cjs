'use strict';

const { normalizeDelegatedActionBindings } = require('../../domain/capability-model.cjs');
const { A2_S8_DESTINATION_ACTION_READINESS_SCHEMA } = require('./a2-s8-destination-action-readiness.cjs');

const A2_S8_DESTINATION_EFFECT_ENTRY_PREFLIGHT_SCHEMA = 'aiexe.a2-s8-destination-effect-entry-preflight.v1';

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

function baseResult(actionReadiness, destinationWorkspaceId) {
  return {
    schema: A2_S8_DESTINATION_EFFECT_ENTRY_PREFLIGHT_SCHEMA,
    actionReadinessSchema: actionReadiness?.schema || null,
    actionId: actionReadiness?.actionId || null,
    managementAction: actionReadiness?.actionType || null,
    projectId: actionReadiness?.projectId || null,
    delegationRequestRef: actionReadiness?.delegationRequestRef || null,
    destinationWorkspaceId,
    destinationExecutionBindingRef: actionReadiness?.destinationExecutionBindingRef || null,
    destinationLocalMissionRef: actionReadiness?.destinationLocalMissionRef || null,
    destinationLocalExecutionRunRef: actionReadiness?.destinationLocalExecutionRunRef || null,
    destinationActionTaskRef: actionReadiness?.destinationActionTaskRef || null,
    destinationMissionStateQueryPerformed: false,
    destinationCapabilityVersionObserved: false,
    destinationCapabilityVersionRef: null,
    destinationDelegatedActionBindingObserved: false,
    destinationDelegatedActionBindingCompatible: false,
    destinationDelegatedActionBinding: null,
    destinationRuntimeAction: null,
    destinationRuntimeTarget: null,
    destinationPayloadBinding: null,
    downstreamActionHumanGateState: actionReadiness?.destinationActionHumanGateState || null,
    effectEntryEligible: false,
    effectEntryReason: null,
    managementRuntimeActionChosen: false,
    managementRuntimeTargetChosen: false,
    managementPayloadProjectionPerformed: false,
    destinationActionHumanGateDecisionCreatedByManagementLayer: false,
    destinationExecutionPerformedByManagementLayer: false,
    managementEffectInvocationPerformed: false,
    destinationReceiptObserved: false,
    automaticReplayAllowed: false,
    executionAuthorized: false,
    domainWritePerformedByManagementLayer: false,
    binding: false,
    authority: 'destination-capability-action-binding-preflight-only',
  };
}

function result(actionReadiness, destinationWorkspaceId, accepted, reason, extra = {}) {
  return freezeDeep({
    ...baseResult(actionReadiness, destinationWorkspaceId),
    destinationEffectEntryPreflightAccepted: accepted,
    destinationEffectEntryPreflightReason: reason,
    ...extra,
  });
}

function exactOne(rows, predicate) {
  const matches = (rows || []).filter(predicate);
  return { matches, exact: matches.length === 1, one: matches[0] || null };
}

function observeCapabilityActionBinding({ actionReadiness, missionState }) {
  if (missionState?.activeWorkspaceId !== actionReadiness.destinationWorkspaceId) {
    return { accepted: false, reason: 'destination_mission_state_workspace_mismatch' };
  }
  const s1 = missionState?.s1 || {};
  const task = exactOne(s1.tasks, (item) => item.id === actionReadiness.destinationActionTaskRef);
  if (!task.exact) return { accepted: false, reason: 'destination_action_task_missing_or_ambiguous' };
  if (task.one.workspaceId !== actionReadiness.destinationWorkspaceId) {
    return { accepted: false, reason: 'destination_action_task_workspace_mismatch', task: task.one };
  }
  if (task.one.capabilityAction !== actionReadiness.actionType) {
    return { accepted: false, reason: 'destination_action_task_management_action_drift', task: task.one };
  }

  const installation = exactOne(s1.installations, (item) => item.id === task.one.installationId);
  if (!installation.exact) return { accepted: false, reason: 'destination_action_installation_missing_or_ambiguous', task: task.one };
  if (installation.one.workspaceId !== actionReadiness.destinationWorkspaceId || installation.one.status !== 'installed') {
    return { accepted: false, reason: 'destination_action_installation_not_active_in_workspace', task: task.one, installation: installation.one };
  }
  const capabilityVersionRef = `${installation.one.packageId}@${installation.one.version}`;
  const version = exactOne(
    s1.marketplace,
    (item) => `${item.packageId}@${item.version}` === capabilityVersionRef,
  );
  if (!version.exact) {
    return { accepted: false, reason: 'destination_capability_version_missing_or_ambiguous', task: task.one, installation: installation.one, capabilityVersionRef };
  }
  if (version.one.status !== 'available' || version.one.integrityDigest !== installation.one.integrityDigest) {
    return { accepted: false, reason: 'destination_capability_version_not_exact_installed_version', task: task.one, installation: installation.one, capabilityVersionRef, version: version.one };
  }

  let bindings;
  try {
    bindings = normalizeDelegatedActionBindings(version.one.delegatedActionBindings || []);
  } catch (error) {
    return { accepted: false, reason: 'destination_capability_action_binding_contract_invalid', detail: error.message, task: task.one, installation: installation.one, capabilityVersionRef, version: version.one };
  }
  const matching = bindings.filter((binding) => binding.sourceAction === actionReadiness.actionType && binding.sourceTarget === task.one.target);
  if (matching.length === 0) {
    return {
      accepted: true,
      reason: 'destination_capability_action_binding_missing',
      task: task.one,
      installation: installation.one,
      capabilityVersionRef,
      version: version.one,
      compatible: false,
      binding: null,
    };
  }
  if (matching.length !== 1) {
    return { accepted: false, reason: 'destination_capability_action_binding_ambiguous', task: task.one, installation: installation.one, capabilityVersionRef, version: version.one };
  }
  return {
    accepted: true,
    reason: 'destination_capability_action_binding_exact',
    task: task.one,
    installation: installation.one,
    capabilityVersionRef,
    version: version.one,
    compatible: true,
    binding: matching[0],
  };
}

function observeA2DestinationEffectEntryPreflight(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('M2.26 input must be an object');
  const allowed = new Set(['actionReadiness', 'destinationWorkspaceId', 's8Service']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`M2.26 input contains unsupported field: ${key}`);
  }

  const actionReadiness = input.actionReadiness;
  const destinationWorkspaceId = String(input.destinationWorkspaceId || '').trim();
  if (!actionReadiness || actionReadiness.schema !== A2_S8_DESTINATION_ACTION_READINESS_SCHEMA) {
    return result(actionReadiness, destinationWorkspaceId || null, false, 'destination_action_readiness_schema_invalid');
  }
  if (!destinationWorkspaceId) return result(actionReadiness, null, false, 'destination_workspace_required');
  if (destinationWorkspaceId !== actionReadiness.destinationWorkspaceId) {
    return result(actionReadiness, destinationWorkspaceId, false, 'destination_workspace_mismatch');
  }
  if (actionReadiness.destinationActionReadinessObservationAccepted !== true
    || !['blocked', 'waiting_human'].includes(actionReadiness.destinationActionReadinessState)
    || actionReadiness.destinationActionHumanGateDecisionCreatedByManagementLayer !== false
    || actionReadiness.destinationExecutionPerformedByManagementLayer !== false
    || actionReadiness.managementEffectInvocationPerformed !== false
    || actionReadiness.executionAuthorized !== false
    || actionReadiness.binding !== false
    || !actionReadiness.destinationActionTaskRef) {
    return result(actionReadiness, destinationWorkspaceId, false, 'destination_action_readiness_not_effect_entry_preflight_eligible');
  }

  const service = input.s8Service;
  requiredServiceMethod(service, 'queryMissionState');
  const missionState = service.queryMissionState(destinationWorkspaceId);
  const observation = observeCapabilityActionBinding({ actionReadiness, missionState });
  if (!observation.accepted) {
    return result(actionReadiness, destinationWorkspaceId, false, observation.reason, {
      destinationMissionStateQueryPerformed: true,
      destinationCapabilityVersionObserved: !!observation.version,
      destinationCapabilityVersionRef: observation.capabilityVersionRef || null,
      effectEntryReason: observation.reason,
    });
  }

  if (!observation.compatible) {
    return result(actionReadiness, destinationWorkspaceId, true, observation.reason, {
      destinationMissionStateQueryPerformed: true,
      destinationCapabilityVersionObserved: true,
      destinationCapabilityVersionRef: observation.capabilityVersionRef,
      destinationDelegatedActionBindingObserved: false,
      destinationDelegatedActionBindingCompatible: false,
      effectEntryEligible: false,
      effectEntryReason: observation.reason,
    });
  }

  const actionGatePending = actionReadiness.destinationActionReadinessState === 'waiting_human'
    && actionReadiness.destinationActionHumanGateRequested === true
    && actionReadiness.destinationActionHumanGateState === 'requested';
  const reason = actionGatePending
    ? 'destination_runtime_binding_exact_action_human_gate_pending'
    : 'destination_runtime_binding_exact_action_not_ready';
  return result(actionReadiness, destinationWorkspaceId, true, reason, {
    destinationMissionStateQueryPerformed: true,
    destinationCapabilityVersionObserved: true,
    destinationCapabilityVersionRef: observation.capabilityVersionRef,
    destinationDelegatedActionBindingObserved: true,
    destinationDelegatedActionBindingCompatible: true,
    destinationDelegatedActionBinding: observation.binding,
    destinationRuntimeAction: observation.binding.runtimeAction,
    destinationRuntimeTarget: observation.binding.runtimeTarget,
    destinationPayloadBinding: observation.binding.payloadBinding,
    downstreamActionHumanGateState: actionReadiness.destinationActionHumanGateState || null,
    effectEntryEligible: false,
    effectEntryReason: reason,
  });
}

module.exports = {
  A2_S8_DESTINATION_EFFECT_ENTRY_PREFLIGHT_SCHEMA,
  observeCapabilityActionBinding,
  observeA2DestinationEffectEntryPreflight,
};
