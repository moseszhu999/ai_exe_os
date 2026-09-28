'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  evaluateA2ExecutionAuthorizationEntry,
} = require('../src/management/policy/a2-execution-authorization-entry.cjs');

function a2(overrides = {}) {
  return {
    actionId: 'aiexe:management-action:run-tests:1',
    actionType: 'run_approved_test_profile',
    projectId: 'trainingos',
    policyRef: 'aiexe:policy:a2-management-v1',
    policyPreapproved: true,
    capabilityRef: 'testing.run@1.0.0',
    workApprovalRef: null,
    evidenceRefs: ['evidence:trainingos:test-profile-approved'],
    requestedAt: '2026-08-10T10:35:00.000Z',
    ...overrides,
  };
}

function authorization(overrides = {}) {
  const input = {
    schema: 'execution.authorization.request.v1',
    requestRef: 'aiexe:exec-auth-request:1',
    organizationRef: 'group:org:1',
    actorRef: 'aiexe:agent:group-manager-1',
    actorKind: 'agent',
    requestedActionRef: 'aiexe:management-action:run-tests:1',
    action: 'run_approved_test_profile',
    targetRef: 'project:trainingos',
    observedAt: '2026-08-10T10:35:00.000Z',
    requirements: {
      requiredHumanCapabilityRefs: [],
      requiredAgentCapabilityRefs: ['testing.run@1.0.0'],
      requiredEvidenceRefs: ['evidence:trainingos:test-profile-approved'],
      requiredPolicyRefs: ['aiexe:policy:a2-management-v1'],
      humanGateRequired: false,
    },
    resolved: {
      authorityGrant: {
        ref: 'group:authority-grant:aiexe-manager',
        status: 'active',
        organizationRef: 'group:org:1',
        actorRef: 'aiexe:agent:group-manager-1',
        allowedActions: ['run_approved_test_profile'],
        allowedTargets: ['project:trainingos'],
        expiresAt: '2026-08-11T10:35:00.000Z',
      },
      delegation: {
        ref: 'aiexe:delegation:trainingos-tests',
        status: 'active',
        organizationRef: 'group:org:1',
        actorRef: 'aiexe:agent:group-manager-1',
        allowedActions: ['run_approved_test_profile'],
        allowedTargets: ['project:trainingos'],
        expiresAt: '2026-08-11T09:35:00.000Z',
      },
      humanCapabilityCredentials: [],
      agentCapabilityPackages: [{ ref: 'testing.run@1.0.0', status: 'accepted' }],
      evidence: [{ ref: 'evidence:trainingos:test-profile-approved', status: 'current' }],
      policies: [{ ref: 'aiexe:policy:a2-management-v1', status: 'accepted' }],
      humanGate: null,
      revocations: [],
    },
  };
  return Object.assign(input, overrides);
}

test('M2.20 composes A2 eligibility into accepted authorization core without granting execution', () => {
  const result = evaluateA2ExecutionAuthorizationEntry({
    a2Request: a2(),
    authorizationRequest: authorization(),
  });

  assert.equal(result.policyEligible, true);
  assert.equal(result.entryEligible, true);
  assert.equal(result.authorizationCoreEvaluated, true);
  assert.equal(result.authorizationDecision, 'allow');
  assert.equal(result.authorizationCoreAllowed, true);
  assert.match(result.authorizationDecisionRef, /^execauth_[a-f0-9]{24}$/);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.s8InvocationPerformed, false);
  assert.equal(result.destinationExecutionPerformed, false);
  assert.equal(result.humanGateDecisionCreated, false);
  assert.equal(result.domainWritePerformed, false);
  assert.equal(result.binding, false);
});

test('M2.20 refuses authorization entry when A2 evidence is not bound into authorization requirements', () => {
  const auth = authorization();
  auth.requirements.requiredEvidenceRefs = ['evidence:other'];
  auth.resolved.evidence = [{ ref: 'evidence:other', status: 'current' }];

  const result = evaluateA2ExecutionAuthorizationEntry({ a2Request: a2(), authorizationRequest: auth });
  assert.equal(result.entryEligible, false);
  assert.equal(result.entryReason, 'a2_evidence_not_bound_into_authorization_requirements');
  assert.equal(result.authorizationCoreEvaluated, false);
  assert.equal(result.executionAuthorized, false);
});

test('M2.20 propagates HumanGate requirement from authorization core without deciding it', () => {
  const auth = authorization();
  auth.requirements.humanGateRequired = true;

  const result = evaluateA2ExecutionAuthorizationEntry({ a2Request: a2(), authorizationRequest: auth });
  assert.equal(result.entryEligible, true);
  assert.equal(result.authorizationCoreEvaluated, true);
  assert.equal(result.authorizationDecision, 'needs_human_review');
  assert.equal(result.authorizationCoreAllowed, false);
  assert.equal(result.humanGateDecisionCreated, false);
  assert.equal(result.executionAuthorized, false);
});

test('M2.20 forbidden consequential A2 action is blocked before authorization core evaluation', () => {
  const result = evaluateA2ExecutionAuthorizationEntry({
    a2Request: a2({
      actionId: 'aiexe:management-action:merge:1',
      actionType: 'merge',
      capabilityRef: null,
    }),
    authorizationRequest: authorization(),
  });

  assert.equal(result.policyEligible, false);
  assert.equal(result.entryEligible, false);
  assert.equal(result.entryReason, 'a2_policy_blocked:forbidden_consequential_action');
  assert.equal(result.authorizationCoreEvaluated, false);
  assert.equal(result.executionAuthorized, false);
});

test('M2.20 non-binding plan intentionally bypasses execution authorization entry', () => {
  const result = evaluateA2ExecutionAuthorizationEntry({
    a2Request: a2({
      actionId: 'aiexe:management-action:plan:1',
      actionType: 'prepare_non_binding_plan',
      capabilityRef: null,
    }),
    authorizationRequest: authorization(),
  });

  assert.equal(result.policyEligible, true);
  assert.equal(result.entryEligible, false);
  assert.equal(result.entryReason, 'non_execution_action_does_not_enter_authorization_core');
  assert.equal(result.authorizationCoreEvaluated, false);
});

test('M2.20 preapproved bounded work must bind the approval reference as current authorization evidence', () => {
  const request = a2({
    actionId: 'aiexe:management-action:schedule:1',
    actionType: 'schedule_preapproved_bounded_work',
    capabilityRef: 'work.schedule@1.0.0',
    workApprovalRef: 'approval:trainingos:bounded-work:7',
    evidenceRefs: ['evidence:trainingos:schedule-context'],
  });
  const auth = authorization();
  auth.requestedActionRef = request.actionId;
  auth.action = request.actionType;
  auth.requirements.requiredAgentCapabilityRefs = ['work.schedule@1.0.0'];
  auth.requirements.requiredEvidenceRefs = ['evidence:trainingos:schedule-context'];
  auth.resolved.agentCapabilityPackages = [{ ref: 'work.schedule@1.0.0', status: 'accepted' }];
  auth.resolved.evidence = [{ ref: 'evidence:trainingos:schedule-context', status: 'current' }];
  auth.resolved.authorityGrant.allowedActions = [request.actionType];
  auth.resolved.delegation.allowedActions = [request.actionType];

  const blocked = evaluateA2ExecutionAuthorizationEntry({ a2Request: request, authorizationRequest: auth });
  assert.equal(blocked.entryEligible, false);
  assert.equal(blocked.entryReason, 'preapproved_work_not_bound_as_authorization_evidence');

  auth.requirements.requiredEvidenceRefs.push(request.workApprovalRef);
  auth.resolved.evidence.push({ ref: request.workApprovalRef, status: 'current' });
  const bound = evaluateA2ExecutionAuthorizationEntry({ a2Request: request, authorizationRequest: auth });
  assert.equal(bound.entryEligible, true);
  assert.equal(bound.authorizationDecision, 'allow');
  assert.equal(bound.executionAuthorized, false);
});

test('M2.20 entry adapter stays pure and has no provider, transport, execution, wallet or process side-effect dependencies', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/management/policy/a2-execution-authorization-entry.cjs'), 'utf8');
  assert.doesNotMatch(source, /require\(['"](?:node:fs|fs|node:http|http|node:https|https|node:child_process|child_process)['"]\)/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\.send\s*\(/);
  assert.doesNotMatch(source, /\.invoke\s*\(/);
  assert.doesNotMatch(source, /signTransaction|privateKey|walletAdapter|bankAdapter|dexAdapter|settlementAdapter/);
});
