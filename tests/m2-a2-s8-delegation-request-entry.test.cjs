'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  composeA2AuthorizedS8DelegationRequest,
} = require('../src/management/policy/a2-s8-delegation-request-entry.cjs');

function a2(overrides = {}) {
  return {
    actionId: 'aiexe:management-action:run-tests:21',
    actionType: 'run_approved_test_profile',
    projectId: 'trainingos',
    policyRef: 'aiexe:policy:a2-management-v1',
    policyPreapproved: true,
    capabilityRef: 'testing.run@1.0.0',
    workApprovalRef: null,
    evidenceRefs: ['evidence:trainingos:test-profile-approved'],
    requestedAt: '2026-08-10T11:55:00.000Z',
    ...overrides,
  };
}

function authorization(overrides = {}) {
  const input = {
    schema: 'execution.authorization.request.v1',
    requestRef: 'aiexe:exec-auth-request:21',
    organizationRef: 'group:org:1',
    actorRef: 'aiexe:agent:group-manager-1',
    actorKind: 'agent',
    requestedActionRef: 'aiexe:management-action:run-tests:21',
    action: 'run_approved_test_profile',
    targetRef: 'project:trainingos',
    observedAt: '2026-08-10T11:55:00.000Z',
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
        expiresAt: '2026-08-11T11:55:00.000Z',
      },
      delegation: {
        ref: 'aiexe:delegation:trainingos-tests',
        status: 'active',
        organizationRef: 'group:org:1',
        actorRef: 'aiexe:agent:group-manager-1',
        allowedActions: ['run_approved_test_profile'],
        allowedTargets: ['project:trainingos'],
        expiresAt: '2026-08-11T10:55:00.000Z',
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

function envelope(overrides = {}) {
  return {
    id: 'management-delegation-request-21',
    sourceInstanceId: 'aiexe-source-instance',
    sourceWorkspaceId: 'aiexe-group-workspace',
    destinationInstanceId: 'trainingos-destination-instance',
    destinationWorkspaceId: 'trainingos-workspace',
    peerBindingId: 'aiexe-to-trainingos-peer',
    policyId: 'trainingos-delegation-policy-v1',
    policyVersion: '1.0.0',
    sourceMissionId: 'management-mission-21',
    sourcePlanStepId: 'management-step-21',
    requestSequence: 1,
    previousRequestDigest: null,
    createdAt: '2026-08-10T11:56:00.000Z',
    ...overrides,
  };
}

test('M2.21 constructs one canonical S8 request only after A2 and A7 both allow entry', () => {
  const result = composeA2AuthorizedS8DelegationRequest({
    a2Request: a2(),
    authorizationRequest: authorization(),
    delegationEnvelope: envelope(),
  });

  assert.equal(result.authorizationDecision, 'allow');
  assert.equal(result.authorizationCoreAllowed, true);
  assert.equal(result.s8EntryEligible, true);
  assert.equal(result.delegationRequestConstructed, true);
  assert.equal(result.delegationRequest.action, 'run_approved_test_profile');
  assert.equal(result.delegationRequest.target, 'project:trainingos');
  assert.equal(result.delegationRequest.capabilityVersionId, 'testing.run@1.0.0');
  assert.equal(result.delegationRequest.payloadClass, 'management-authorization');
  assert.match(result.delegationRequest.requestDigest, /^sha256:[a-f0-9]{64}$/);
});

test('M2.21 derives action target capability and payload refs instead of accepting caller substitutions', () => {
  const result = composeA2AuthorizedS8DelegationRequest({
    a2Request: a2({ evidenceRefs: ['evidence:z', 'evidence:a'] }),
    authorizationRequest: (() => {
      const auth = authorization();
      auth.requirements.requiredEvidenceRefs = ['evidence:a', 'evidence:z'];
      auth.resolved.evidence = [
        { ref: 'evidence:a', status: 'current' },
        { ref: 'evidence:z', status: 'current' },
      ];
      return auth;
    })(),
    delegationEnvelope: envelope(),
  });

  assert.deepEqual(result.delegationRequest.payload.evidenceRefs, ['evidence:a', 'evidence:z']);
  assert.equal(result.delegationRequest.payload.managementActionRef, 'aiexe:management-action:run-tests:21');
  assert.equal(result.delegationRequest.payload.authorizationRequestRef, 'aiexe:exec-auth-request:21');
  assert.match(result.delegationRequest.payload.authorizationDecisionRef, /^execauth_[a-f0-9]{24}$/);
  assert.equal('authorityGrant' in result.delegationRequest.payload, false);
  assert.equal('delegation' in result.delegationRequest.payload, false);
});

test('M2.21 refuses to construct S8 request while authorization still needs HumanGate review', () => {
  const auth = authorization();
  auth.requirements.humanGateRequired = true;

  const result = composeA2AuthorizedS8DelegationRequest({
    a2Request: a2(),
    authorizationRequest: auth,
    delegationEnvelope: envelope(),
  });

  assert.equal(result.authorizationDecision, 'needs_human_review');
  assert.equal(result.s8EntryEligible, false);
  assert.equal(result.delegationRequestConstructed, false);
  assert.equal(result.delegationRequest, null);
  assert.equal(result.destinationHumanGateDecisionCreated, false);
});

test('M2.21 refuses S8 construction when A2-to-authorization binding is not valid', () => {
  const auth = authorization();
  auth.targetRef = 'project:tradeos';
  auth.resolved.authorityGrant.allowedTargets = ['project:tradeos'];
  auth.resolved.delegation.allowedTargets = ['project:tradeos'];

  const result = composeA2AuthorizedS8DelegationRequest({
    a2Request: a2(),
    authorizationRequest: auth,
    delegationEnvelope: envelope(),
  });

  assert.equal(result.s8EntryEligible, false);
  assert.equal(result.s8EntryReason, 'authorization_entry_blocked:authorization_project_target_mismatch');
  assert.equal(result.delegationRequestConstructed, false);
});

test('M2.21 delegation envelope cannot smuggle action target capability or arbitrary payload', () => {
  for (const injected of [
    { action: 'merge' },
    { target: 'project:tradeos' },
    { capabilityVersionId: 'danger.write@1.0.0' },
    { payload: { bypass: true } },
  ]) {
    assert.throws(() => composeA2AuthorizedS8DelegationRequest({
      a2Request: a2(),
      authorizationRequest: authorization(),
      delegationEnvelope: envelope(injected),
    }), /unsupported field/);
  }
});

test('M2.21 constructs request data but never upgrades it into S8 invocation or execution authority', () => {
  const result = composeA2AuthorizedS8DelegationRequest({
    a2Request: a2(),
    authorizationRequest: authorization(),
    delegationEnvelope: envelope(),
  });

  assert.equal(result.delegationCreated, false);
  assert.equal(result.s8InvocationPerformed, false);
  assert.equal(result.transportSubmissionPerformed, false);
  assert.equal(result.destinationAdmissionPerformed, false);
  assert.equal(result.destinationHumanGateDecisionCreated, false);
  assert.equal(result.destinationExecutionPerformed, false);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.domainWritePerformed, false);
  assert.equal(result.binding, false);
});

test('M2.21 bridge is pure and imports no S8 transport application process wallet or provider side effects', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/management/policy/a2-s8-delegation-request-entry.cjs'), 'utf8');
  assert.doesNotMatch(source, /delegation\/transport|application\/s8|node:http|node:https|child_process|wallet|settlement|bankAdapter|dexAdapter/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\.send\s*\(/);
  assert.doesNotMatch(source, /\.invoke\s*\(/);
  assert.match(source, /createDelegationRequest/);
});
