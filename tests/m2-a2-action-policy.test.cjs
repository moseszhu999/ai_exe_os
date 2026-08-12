'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  A3_FORBIDDEN_ACTIONS,
  buildA2ManagementActionPolicy,
  evaluateA2ManagementAction,
} = require('../src/management/policy/a2-action-policy.cjs');

const NOW = '2026-08-09T09:45:00.000Z';

function request(overrides = {}) {
  return {
    actionId: 'a2-test-trainingos',
    actionType: 'run_approved_test_profile',
    projectId: 'trainingos',
    policyRef: 'policy:aiexe:a2:v1',
    policyPreapproved: true,
    capabilityRef: 'training.test@1.0.0',
    evidenceRefs: ['github:trainingos:pr:545'],
    requestedAt: NOW,
    ...overrides,
  };
}

test('M2.2 A2 policy exposes a narrow allow-set and consequential deny-set', () => {
  const policy = buildA2ManagementActionPolicy();
  assert.equal(policy.binding, false);
  assert.equal(policy.executionAuthorized, false);
  assert.equal(policy.allowedActions.includes('collect_project_status'), true);
  assert.equal(policy.allowedActions.includes('run_approved_test_profile'), true);
  assert.equal(policy.allowedActions.includes('merge'), false);
  for (const action of ['merge', 'deploy', 'payment', 'production_mutation']) {
    assert.equal(policy.forbiddenActions.includes(action), true);
  }
});

test('M2.2 an allowed preapproved action may become policy-eligible but never execution-authorized', () => {
  const result = evaluateA2ManagementAction(request());
  assert.equal(result.policyEligible, true);
  assert.equal(result.reason, 'eligible_under_a2_policy_contract');
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.delegationCreated, false);
  assert.equal(result.humanGateDecisionCreated, false);
  assert.equal(result.domainWritePerformed, false);
  assert.equal(result.requiresExistingS8PathForExecution, true);
});

test('M2.2 policy preapproval is mandatory', () => {
  const result = evaluateA2ManagementAction(request({ policyPreapproved: false }));
  assert.equal(result.policyEligible, false);
  assert.equal(result.reason, 'policy_preapproval_required');
});

test('M2.2 capability-bound actions require canonical package@semver reference', () => {
  const missing = evaluateA2ManagementAction(request({ capabilityRef: null }));
  assert.equal(missing.policyEligible, false);
  assert.equal(missing.reason, 'canonical_capability_ref_required');
  assert.throws(() => evaluateA2ManagementAction(request({ capabilityRef: 'training.test:latest' })), /package@semver/);
});

test('M2.2 scheduling requires an already-approved bounded work reference', () => {
  const missing = evaluateA2ManagementAction(request({
    actionType: 'schedule_preapproved_bounded_work',
    capabilityRef: 'work.schedule@1.0.0',
  }));
  assert.equal(missing.policyEligible, false);
  assert.equal(missing.reason, 'preapproved_work_ref_required');

  const eligible = evaluateA2ManagementAction(request({
    actionType: 'schedule_preapproved_bounded_work',
    capabilityRef: 'work.schedule@1.0.0',
    workApprovalRef: 'approval:bounded-work:123',
  }));
  assert.equal(eligible.policyEligible, true);
  assert.equal(eligible.executionAuthorized, false);
});

test('M2.2 every consequential A3 action is mechanically denied', () => {
  for (const actionType of A3_FORBIDDEN_ACTIONS) {
    const result = evaluateA2ManagementAction(request({
      actionType,
      capabilityRef: null,
    }));
    assert.equal(result.policyEligible, false, actionType);
    assert.equal(result.reason, 'forbidden_consequential_action', actionType);
    assert.equal(result.executionAuthorized, false, actionType);
  }
});

test('M2.2 non-binding plan preparation can be eligible without execution capability', () => {
  const result = evaluateA2ManagementAction(request({
    actionType: 'prepare_non_binding_plan',
    capabilityRef: null,
  }));
  assert.equal(result.policyEligible, true);
  assert.equal(result.requiresExistingS8PathForExecution, false);
  assert.equal(result.executionAuthorized, false);
});
