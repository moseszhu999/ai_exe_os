'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { evaluateExecutionAuthorizationV1 } = require('../src/authorization/execution-authorization-v1.cjs');

function base(overrides = {}) {
  const input = {
    schema: 'execution.authorization.request.v1',
    requestRef: 'tradeos:request:1',
    organizationRef: 'group:org:1',
    actorRef: 'group:human:1',
    actorKind: 'human',
    requestedActionRef: 'tradeos:action:1',
    action: 'prepare_settlement',
    targetRef: 'tradeos:obligation:1',
    observedAt: '2026-08-10T10:00:00.000Z',
    requirements: {
      requiredHumanCapabilityRefs: ['trainingos:competency:settlement-review'],
      requiredAgentCapabilityRefs: [],
      requiredEvidenceRefs: ['tradeos:evidence:invoice-1'],
      requiredPolicyRefs: ['group:policy:settlement-v1'],
      humanGateRequired: false,
    },
    resolved: {
      authorityGrant: {
        ref: 'group:authority-grant:1', status: 'active', organizationRef: 'group:org:1', actorRef: 'group:human:1',
        allowedActions: ['prepare_settlement'], allowedTargets: ['tradeos:obligation:1'], expiresAt: '2026-08-11T10:00:00.000Z',
      },
      delegation: null,
      humanCapabilityCredentials: [{
        ref: 'trainingos:credential:1', capabilityRef: 'trainingos:competency:settlement-review', status: 'valid', eligibility: 'eligible_prerequisite',
      }],
      agentCapabilityPackages: [],
      evidence: [{ ref: 'tradeos:evidence:invoice-1', status: 'current' }],
      policies: [{ ref: 'group:policy:settlement-v1', status: 'accepted' }],
      humanGate: null,
      revocations: [],
    },
  };
  return Object.assign(input, overrides);
}

function agentBase() {
  const input = base();
  input.actorRef = 'aiexe:agent:treasury-1';
  input.actorKind = 'agent';
  input.requirements.requiredHumanCapabilityRefs = [];
  input.requirements.requiredAgentCapabilityRefs = ['trade.treasury@1.0.0'];
  input.resolved.authorityGrant.actorRef = input.actorRef;
  input.resolved.delegation = {
    ref: 'aiexe:delegation:1', status: 'active', organizationRef: input.organizationRef, actorRef: input.actorRef,
    allowedActions: [input.action], allowedTargets: [input.targetRef], expiresAt: '2026-08-11T09:00:00.000Z',
  };
  input.resolved.humanCapabilityCredentials = [];
  input.resolved.agentCapabilityPackages = [{ ref: 'trade.treasury@1.0.0', status: 'accepted' }];
  return input;
}

test('allows only when an independent human authority grant and all prerequisites pass', () => {
  const result = evaluateExecutionAuthorizationV1(base());
  assert.equal(result.decision, 'allow');
  assert.match(result.decisionEvidenceDigest, /^[a-f0-9]{64}$/);
  assert.equal(result.authorityGrantCreated, false);
  assert.equal(result.executionPerformed, false);
  assert.equal(Object.isFrozen(result), true);
});

test('valid human capability credential never substitutes for AuthorityGrant', () => {
  const input = base();
  input.resolved.authorityGrant = null;
  const result = evaluateExecutionAuthorizationV1(input);
  assert.equal(result.decision, 'unknown');
  assert.ok(result.reasonCodes.includes('authority_grant_unknown'));
});

test('human authorization ignores irrelevant delegation facts instead of verifying them', () => {
  const input = base();
  input.resolved.delegation = {
    ref: 'aiexe:delegation:irrelevant', status: 'revoked', organizationRef: 'group:org:other', actorRef: 'aiexe:agent:other',
    allowedActions: ['other_action'], allowedTargets: ['other_target'], expiresAt: '2026-08-09T10:00:00.000Z',
  };
  const result = evaluateExecutionAuthorizationV1(input);
  assert.equal(result.decision, 'allow');
  assert.equal(result.verifiedPrerequisiteRefs.includes('aiexe:delegation:irrelevant'), false);
});

test('rejects caller-supplied authorization answer fields anywhere in input', () => {
  const input = base();
  input.requirements.decision = 'allow';
  assert.throws(() => evaluateExecutionAuthorizationV1(input), /forbidden self-authorization input/);
});

test('required missing HumanGate yields needs_human_review instead of allow', () => {
  const input = base();
  input.requirements.humanGateRequired = true;
  const result = evaluateExecutionAuthorizationV1(input);
  assert.equal(result.decision, 'needs_human_review');
  assert.deepEqual(result.reasonCodes, ['human_gate_required']);
});

test('rejected HumanGate denies the request', () => {
  const input = base();
  input.requirements.humanGateRequired = true;
  input.resolved.humanGate = { ref: 'aiexe:human-gate:1', state: 'rejected' };
  const result = evaluateExecutionAuthorizationV1(input);
  assert.equal(result.decision, 'deny');
  assert.ok(result.reasonCodes.includes('human_gate_denied'));
});

test('agent capability package without delegation stays unknown', () => {
  const input = agentBase();
  input.resolved.delegation = null;
  const result = evaluateExecutionAuthorizationV1(input);
  assert.equal(result.decision, 'unknown');
  assert.ok(result.reasonCodes.includes('delegation_unknown'));
});

test('agent requires both active grant and active destination-local delegation', () => {
  const result = evaluateExecutionAuthorizationV1(agentBase());
  assert.equal(result.decision, 'allow');
  assert.equal(result.validUntil, '2026-08-11T09:00:00.000Z');
});

test('active revocation denies even when all other prerequisites pass', () => {
  const input = base();
  input.resolved.revocations = [{ ref: 'group:revocation:1', subjectRef: 'group:authority-grant:1', status: 'revoked' }];
  const result = evaluateExecutionAuthorizationV1(input);
  assert.equal(result.decision, 'deny');
  assert.ok(result.reasonCodes.includes('revocation_active'));
});

test('wrong-organization grant denies rather than being repaired from request data', () => {
  const input = base();
  input.resolved.authorityGrant.organizationRef = 'group:org:other';
  const result = evaluateExecutionAuthorizationV1(input);
  assert.equal(result.decision, 'deny');
  assert.ok(result.reasonCodes.includes('authority_grant_denied'));
});

test('missing required evidence fails closed as unknown', () => {
  const input = base();
  input.resolved.evidence = [];
  const result = evaluateExecutionAuthorizationV1(input);
  assert.equal(result.decision, 'unknown');
  assert.ok(result.reasonCodes.includes('required_evidence_unknown'));
});

test('explicit rejected policy denies', () => {
  const input = base();
  input.resolved.policies = [{ ref: 'group:policy:settlement-v1', status: 'rejected' }];
  const result = evaluateExecutionAuthorizationV1(input);
  assert.equal(result.decision, 'deny');
  assert.ok(result.reasonCodes.includes('required_policy_denied'));
});

test('decision digest is deterministic across semantically unordered input arrays', () => {
  const left = base();
  left.resolved.evidence.push({ ref: 'tradeos:evidence:extra', status: 'current' });
  const right = structuredClone(left);
  right.resolved.evidence.reverse();
  const a = evaluateExecutionAuthorizationV1(left);
  const b = evaluateExecutionAuthorizationV1(right);
  assert.equal(a.requestDigest, b.requestDigest);
  assert.equal(a.decisionEvidenceDigest, b.decisionEvidenceDigest);
  assert.equal(a.decisionRef, b.decisionRef);
});

test('input is closed and unknown convenience fields are rejected', () => {
  const input = base();
  input.wallet = '0xabc';
  assert.throws(() => evaluateExecutionAuthorizationV1(input), /unknown field/);
});

test('authorization core has no provider or execution side-effect dependencies', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/authorization/execution-authorization-v1.cjs'), 'utf8');
  assert.doesNotMatch(source, /require\(['"](?:node:fs|fs|node:http|http|node:https|https|node:child_process|child_process)['"]\)/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\.send\s*\(/);
  assert.doesNotMatch(source, /\.invoke\s*\(/);
  assert.doesNotMatch(source, /privateKey|signTransaction|bankAdapter|dexAdapter|settlementAdapter/);
});
