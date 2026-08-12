'use strict';

const A2_ACTION_POLICY_SCHEMA = 'aiexe.a2-management-action-policy.v1';
const A2_ELIGIBILITY_SCHEMA = 'aiexe.a2-management-action-eligibility.v1';

const A2_ALLOWED_ACTIONS = Object.freeze({
  collect_project_status: Object.freeze({ capabilityRequired: true, workApprovalRequired: false }),
  prepare_non_binding_plan: Object.freeze({ capabilityRequired: false, workApprovalRequired: false }),
  request_controller_attestation: Object.freeze({ capabilityRequired: true, workApprovalRequired: false }),
  request_existing_ci_validation: Object.freeze({ capabilityRequired: true, workApprovalRequired: false }),
  run_approved_test_profile: Object.freeze({ capabilityRequired: true, workApprovalRequired: false }),
  schedule_preapproved_bounded_work: Object.freeze({ capabilityRequired: true, workApprovalRequired: true }),
});

const A3_FORBIDDEN_ACTIONS = Object.freeze([
  'credential_grant_or_write',
  'deploy',
  'domain_truth_mutation',
  'external_contractual_commitment',
  'human_impersonation',
  'merge',
  'payment',
  'policy_widening',
  'production_mutation',
]);

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

function optionalText(value, label, maxLength = 320) {
  if (value == null) return null;
  return requiredText(value, label, maxLength);
}

function isoInstant(value, label) {
  const text = requiredText(value, label, 80);
  if (!Number.isFinite(Date.parse(text))) throw new TypeError(`${label} must be an ISO timestamp`);
  return text;
}

function uniqueTextList(value, label, maxLength = 320) {
  if (!Array.isArray(value) || value.length < 1) throw new TypeError(`${label} must be a non-empty array`);
  const rows = value.map((item) => requiredText(item, label, maxLength));
  if (new Set(rows).size !== rows.length) throw new Error(`${label} must not contain duplicates`);
  return Object.freeze([...rows].sort());
}

function canonicalCapabilityRef(value) {
  if (value == null) return null;
  const text = requiredText(value, 'capability ref', 180);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}@[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/.test(text)) {
    throw new TypeError('capability ref must use canonical package@semver form');
  }
  return text;
}

function buildA2ManagementActionPolicy() {
  return freezeDeep({
    schema: A2_ACTION_POLICY_SCHEMA,
    authorityClass: 'A2-eligibility-only',
    binding: false,
    executionAuthorized: false,
    allowedActions: Object.keys(A2_ALLOWED_ACTIONS).sort(),
    forbiddenActions: [...A3_FORBIDDEN_ACTIONS],
    invariants: Object.freeze([
      'evidence-required',
      'explicit-policy-preapproval-required',
      'canonical-capability-reference-required-when-applicable',
      'existing-s8-path-required-for-future-execution',
      'destination-local-revalidation-required',
      'eligibility-is-not-execution-authority',
    ]),
  });
}

function evaluateA2ManagementAction(input) {
  plainObject(input, 'A2 management action request');
  const allowed = new Set([
    'actionId', 'actionType', 'projectId', 'policyRef', 'policyPreapproved',
    'capabilityRef', 'workApprovalRef', 'evidenceRefs', 'requestedAt',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`A2 management action request contains unsupported field: ${key}`);
  }

  const actionId = requiredText(input.actionId, 'action id', 160);
  const actionType = requiredText(input.actionType, 'action type', 120);
  const projectId = requiredText(input.projectId, 'project id', 120);
  const policyRef = requiredText(input.policyRef, 'policy ref', 320);
  const requestedAt = isoInstant(input.requestedAt, 'requested at');
  const evidenceRefs = uniqueTextList(input.evidenceRefs, 'A2 evidence ref', 320);
  const capabilityRef = canonicalCapabilityRef(input.capabilityRef);
  const workApprovalRef = optionalText(input.workApprovalRef, 'work approval ref', 320);

  const rule = A2_ALLOWED_ACTIONS[actionType] || null;
  let policyEligible = true;
  let reason = 'eligible_under_a2_policy_contract';

  if (A3_FORBIDDEN_ACTIONS.includes(actionType)) {
    policyEligible = false;
    reason = 'forbidden_consequential_action';
  } else if (!rule) {
    policyEligible = false;
    reason = 'action_not_in_a2_allow_set';
  } else if (input.policyPreapproved !== true) {
    policyEligible = false;
    reason = 'policy_preapproval_required';
  } else if (rule.capabilityRequired && capabilityRef == null) {
    policyEligible = false;
    reason = 'canonical_capability_ref_required';
  } else if (rule.workApprovalRequired && workApprovalRef == null) {
    policyEligible = false;
    reason = 'preapproved_work_ref_required';
  }

  return freezeDeep({
    schema: A2_ELIGIBILITY_SCHEMA,
    actionId,
    actionType,
    projectId,
    policyRef,
    capabilityRef,
    workApprovalRef,
    evidenceRefs,
    requestedAt,
    policyEligible,
    reason,
    binding: false,
    executionAuthorized: false,
    delegationCreated: false,
    humanGateDecisionCreated: false,
    domainWritePerformed: false,
    requiresExistingS8PathForExecution: policyEligible && actionType !== 'prepare_non_binding_plan',
    authority: 'eligibility-evaluation-only',
  });
}

module.exports = {
  A2_ACTION_POLICY_SCHEMA,
  A2_ALLOWED_ACTIONS,
  A2_ELIGIBILITY_SCHEMA,
  A3_FORBIDDEN_ACTIONS,
  buildA2ManagementActionPolicy,
  evaluateA2ManagementAction,
};
