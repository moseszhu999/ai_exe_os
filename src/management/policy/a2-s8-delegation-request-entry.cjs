'use strict';

const { evaluateA2ExecutionAuthorizationEntry } = require('./a2-execution-authorization-entry.cjs');
const { createDelegationRequest } = require('../../delegation/policy/index.cjs');

const A2_S8_DELEGATION_ENTRY_SCHEMA = 'aiexe.a2-s8-delegation-request-entry.v1';

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

function closedObject(value, label, allowed) {
  const object = plainObject(value, label);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field: ${key}`);
  }
  return object;
}

function blocked(entry, reason) {
  return freezeDeep({
    schema: A2_S8_DELEGATION_ENTRY_SCHEMA,
    actionId: entry.actionId,
    actionType: entry.actionType,
    projectId: entry.projectId,
    eligibilityRef: entry.eligibilityRef,
    authorizationRequestRef: entry.authorizationRequestRef,
    authorizationDecisionRef: entry.authorizationDecisionRef,
    authorizationDecision: entry.authorizationDecision,
    authorizationCoreAllowed: entry.authorizationCoreAllowed,
    s8EntryEligible: false,
    s8EntryReason: reason,
    delegationRequestConstructed: false,
    delegationRequest: null,
    delegationCreated: false,
    s8InvocationPerformed: false,
    transportSubmissionPerformed: false,
    destinationAdmissionPerformed: false,
    destinationHumanGateDecisionCreated: false,
    destinationExecutionPerformed: false,
    executionAuthorized: false,
    domainWritePerformed: false,
    binding: false,
    authority: 's8-request-construction-proof-only',
  });
}

function composeA2AuthorizedS8DelegationRequest(input) {
  closedObject(input, 'A2 S8 entry input', new Set(['a2Request', 'authorizationRequest', 'delegationEnvelope']));

  const entry = evaluateA2ExecutionAuthorizationEntry({
    a2Request: input.a2Request,
    authorizationRequest: input.authorizationRequest,
  });

  if (!entry.entryEligible) return blocked(entry, `authorization_entry_blocked:${entry.entryReason}`);
  if (entry.authorizationDecision !== 'allow' || entry.authorizationCoreAllowed !== true) {
    return blocked(entry, `authorization_not_allowed:${entry.authorizationDecision || 'none'}`);
  }

  const envelope = closedObject(
    input.delegationEnvelope,
    'delegation envelope',
    new Set([
      'id',
      'sourceInstanceId',
      'sourceWorkspaceId',
      'destinationInstanceId',
      'destinationWorkspaceId',
      'peerBindingId',
      'policyId',
      'policyVersion',
      'sourceMissionId',
      'sourcePlanStepId',
      'requestSequence',
      'previousRequestDigest',
      'createdAt',
    ]),
  );

  const a2Request = plainObject(input.a2Request, 'A2 management action request');
  const authorizationRequest = plainObject(input.authorizationRequest, 'execution authorization request');
  if (!a2Request.capabilityRef) throw new Error('authorized executable A2 action must carry capabilityRef');

  const payload = freezeDeep({
    managementActionRef: entry.actionId,
    eligibilityRef: entry.eligibilityRef,
    authorizationRequestRef: entry.authorizationRequestRef,
    authorizationDecisionRef: entry.authorizationDecisionRef,
    a2PolicyRef: a2Request.policyRef,
    evidenceRefs: Object.freeze([...a2Request.evidenceRefs].sort()),
    workApprovalRef: a2Request.workApprovalRef || null,
  });

  const delegationRequest = createDelegationRequest({
    ...envelope,
    capabilityVersionId: a2Request.capabilityRef,
    action: entry.actionType,
    target: authorizationRequest.targetRef,
    payloadClass: 'management-authorization',
    payload,
  });

  return freezeDeep({
    schema: A2_S8_DELEGATION_ENTRY_SCHEMA,
    actionId: entry.actionId,
    actionType: entry.actionType,
    projectId: entry.projectId,
    eligibilityRef: entry.eligibilityRef,
    authorizationRequestRef: entry.authorizationRequestRef,
    authorizationDecisionRef: entry.authorizationDecisionRef,
    authorizationDecision: entry.authorizationDecision,
    authorizationCoreAllowed: true,
    s8EntryEligible: true,
    s8EntryReason: 'authorized_a2_action_bound_into_canonical_s8_request',
    delegationRequestConstructed: true,
    delegationRequest,
    delegationCreated: false,
    s8InvocationPerformed: false,
    transportSubmissionPerformed: false,
    destinationAdmissionPerformed: false,
    destinationHumanGateDecisionCreated: false,
    destinationExecutionPerformed: false,
    executionAuthorized: false,
    domainWritePerformed: false,
    binding: false,
    authority: 's8-request-construction-proof-only',
  });
}

module.exports = {
  A2_S8_DELEGATION_ENTRY_SCHEMA,
  composeA2AuthorizedS8DelegationRequest,
};
