'use strict';

const { evaluateA2ManagementAction } = require('./a2-action-policy.cjs');
const { evaluateExecutionAuthorizationV1 } = require('../../authorization/execution-authorization-v1.cjs');

const A2_AUTHORIZATION_ENTRY_SCHEMA = 'aiexe.a2-execution-authorization-entry.v1';

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function requiredText(value, label, maxLength = 320) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const text = value.trim();
  if (!text) throw new TypeError(`${label} must not be empty`);
  if (text.length > maxLength) throw new TypeError(`${label} is too long`);
  return text;
}

function sortedUnique(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const rows = value.map((item) => requiredText(item, label));
  if (new Set(rows).size !== rows.length) throw new Error(`${label} must not contain duplicates`);
  return Object.freeze([...rows].sort());
}

function includesAll(haystack, needles) {
  const set = new Set(haystack);
  return needles.every((value) => set.has(value));
}

function buildBlockedResult({ eligibility, reason, authorizationRequestRef = null }) {
  return freezeDeep({
    schema: A2_AUTHORIZATION_ENTRY_SCHEMA,
    actionId: eligibility.actionId,
    actionType: eligibility.actionType,
    projectId: eligibility.projectId,
    eligibilityRef: `${eligibility.schema}:${eligibility.actionId}`,
    policyEligible: eligibility.policyEligible,
    entryEligible: false,
    entryReason: reason,
    authorizationRequestRef,
    authorizationDecisionRef: null,
    authorizationDecision: null,
    authorizationCoreEvaluated: false,
    authorizationCoreAllowed: false,
    executionAuthorized: false,
    s8InvocationPerformed: false,
    destinationExecutionPerformed: false,
    humanGateDecisionCreated: false,
    domainWritePerformed: false,
    binding: false,
    authority: 'authorization-entry-proof-only',
  });
}

function evaluateA2ExecutionAuthorizationEntry(input) {
  plainObject(input, 'A2 authorization entry input');
  const allowed = new Set(['a2Request', 'authorizationRequest']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`A2 authorization entry input contains unsupported field: ${key}`);
  }

  const eligibility = evaluateA2ManagementAction(input.a2Request);
  if (!eligibility.policyEligible) {
    return buildBlockedResult({ eligibility, reason: `a2_policy_blocked:${eligibility.reason}` });
  }

  if (eligibility.actionType === 'prepare_non_binding_plan') {
    return buildBlockedResult({ eligibility, reason: 'non_execution_action_does_not_enter_authorization_core' });
  }

  const authorizationRequest = plainObject(input.authorizationRequest, 'execution authorization request');
  const requestRef = requiredText(authorizationRequest.requestRef, 'authorization request ref');

  if (authorizationRequest.schema !== 'execution.authorization.request.v1') {
    return buildBlockedResult({ eligibility, reason: 'authorization_request_schema_mismatch', authorizationRequestRef: requestRef });
  }
  if (authorizationRequest.actorKind !== 'agent') {
    return buildBlockedResult({ eligibility, reason: 'management_a2_requires_agent_authorization_subject', authorizationRequestRef: requestRef });
  }
  if (authorizationRequest.requestedActionRef !== eligibility.actionId) {
    return buildBlockedResult({ eligibility, reason: 'authorization_action_ref_mismatch', authorizationRequestRef: requestRef });
  }
  if (authorizationRequest.action !== eligibility.actionType) {
    return buildBlockedResult({ eligibility, reason: 'authorization_action_type_mismatch', authorizationRequestRef: requestRef });
  }
  if (authorizationRequest.targetRef !== `project:${eligibility.projectId}`) {
    return buildBlockedResult({ eligibility, reason: 'authorization_project_target_mismatch', authorizationRequestRef: requestRef });
  }

  const requirements = plainObject(authorizationRequest.requirements, 'authorization requirements');
  const requiredPolicies = sortedUnique(requirements.requiredPolicyRefs, 'required policy ref');
  const requiredEvidence = sortedUnique(requirements.requiredEvidenceRefs, 'required evidence ref');
  const requiredAgentCapabilities = sortedUnique(requirements.requiredAgentCapabilityRefs, 'required agent capability ref');
  const requiredHumanCapabilities = sortedUnique(requirements.requiredHumanCapabilityRefs, 'required human capability ref');

  if (!requiredPolicies.includes(eligibility.policyRef)) {
    return buildBlockedResult({ eligibility, reason: 'a2_policy_not_bound_into_authorization_requirements', authorizationRequestRef: requestRef });
  }
  if (!includesAll(requiredEvidence, eligibility.evidenceRefs)) {
    return buildBlockedResult({ eligibility, reason: 'a2_evidence_not_bound_into_authorization_requirements', authorizationRequestRef: requestRef });
  }
  if (eligibility.workApprovalRef && !requiredEvidence.includes(eligibility.workApprovalRef)) {
    return buildBlockedResult({ eligibility, reason: 'preapproved_work_not_bound_as_authorization_evidence', authorizationRequestRef: requestRef });
  }
  if (eligibility.capabilityRef && !requiredAgentCapabilities.includes(eligibility.capabilityRef)) {
    return buildBlockedResult({ eligibility, reason: 'a2_capability_not_bound_into_agent_authorization_requirements', authorizationRequestRef: requestRef });
  }
  if (requiredHumanCapabilities.length > 0) {
    return buildBlockedResult({ eligibility, reason: 'management_agent_entry_cannot_require_human_capability_binding', authorizationRequestRef: requestRef });
  }

  const authorizationDecision = evaluateExecutionAuthorizationV1(authorizationRequest);
  return freezeDeep({
    schema: A2_AUTHORIZATION_ENTRY_SCHEMA,
    actionId: eligibility.actionId,
    actionType: eligibility.actionType,
    projectId: eligibility.projectId,
    eligibilityRef: `${eligibility.schema}:${eligibility.actionId}`,
    policyEligible: true,
    entryEligible: true,
    entryReason: 'a2_requirements_bound_and_authorization_core_evaluated',
    authorizationRequestRef: requestRef,
    authorizationDecisionRef: authorizationDecision.decisionRef,
    authorizationDecision: authorizationDecision.decision,
    authorizationCoreEvaluated: true,
    authorizationCoreAllowed: authorizationDecision.decision === 'allow',
    executionAuthorized: false,
    s8InvocationPerformed: false,
    destinationExecutionPerformed: false,
    humanGateDecisionCreated: false,
    domainWritePerformed: false,
    binding: false,
    authority: 'authorization-entry-proof-only',
  });
}

module.exports = {
  A2_AUTHORIZATION_ENTRY_SCHEMA,
  evaluateA2ExecutionAuthorizationEntry,
};
