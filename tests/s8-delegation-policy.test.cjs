'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertPolicyAllowsRequest,
  classifyDelegationRequestAppend,
  createDelegationCancellationProposal,
  createDelegationPeerBinding,
  createDelegationPolicySnapshot,
  createDelegationRequest,
} = require('../src/delegation/policy/index.cjs');

function peer(overrides = {}) {
  return createDelegationPeerBinding({
    id: 'peer-a-to-b',
    sourceInstanceId: 'sync-source-a',
    sourceWorkspaceId: 'workspace-a',
    destinationInstanceId: 'sync-source-b',
    destinationWorkspaceId: 'workspace-b',
    status: 'active',
    createdAt: '2026-08-08T12:00:00.000Z',
    ...overrides,
  });
}

function policy(overrides = {}) {
  return createDelegationPolicySnapshot({
    id: 'policy-a-to-b-v1',
    version: '1.0.0',
    peerBindingId: 'peer-a-to-b',
    destinationWorkspaceId: 'workspace-b',
    allowedCapabilityVersionIds: ['local.form-submit-1'],
    allowedActions: ['submit_payload'],
    allowedTargets: ['http://127.0.0.1:3210/task-form.html'],
    maxPendingRequests: 4,
    maxAcceptedNotStarted: 2,
    createdAt: '2026-08-08T12:00:00.000Z',
    expiresAt: '2026-08-09T12:00:00.000Z',
    ...overrides,
  });
}

function request(overrides = {}) {
  return createDelegationRequest({
    id: 'delegation-request-1',
    sourceInstanceId: 'sync-source-a',
    sourceWorkspaceId: 'workspace-a',
    destinationInstanceId: 'sync-source-b',
    destinationWorkspaceId: 'workspace-b',
    peerBindingId: 'peer-a-to-b',
    policyId: 'policy-a-to-b-v1',
    policyVersion: '1.0.0',
    sourceMissionId: 'mission-a',
    sourcePlanStepId: 'step-a',
    capabilityVersionId: 'local.form-submit-1',
    action: 'submit_payload',
    target: 'http://127.0.0.1:3210/task-form.html',
    payloadClass: 'bounded-input',
    payload: { alpha: 1, nested: { beta: 'two' } },
    requestSequence: 1,
    previousRequestDigest: null,
    createdAt: '2026-08-08T12:01:00.000Z',
    ...overrides,
  });
}

test('S8 peer binding is exact and distinct', () => {
  const binding = peer();
  assert.equal(binding.status, 'active');
  assert.throws(() => peer({ destinationInstanceId: 'sync-source-a' }), /distinct source and destination/);
  assert.throws(() => peer({ destinationWorkspaceId: '*' }));
});

test('S8 delegation request digest is deterministic over semantic payload ordering', () => {
  const a = request({ payload: { alpha: 1, nested: { beta: 'two', gamma: 3 } } });
  const b = request({ payload: { nested: { gamma: 3, beta: 'two' }, alpha: 1 } });
  assert.equal(a.payloadDigest, b.payloadDigest);
  assert.equal(a.requestDigest, b.requestDigest);
});

test('S8 delegation request reuses S7 recursive privacy boundary', () => {
  assert.throws(() => request({ payload: { nested: { access_token: 'secret-value' } } }), /forbidden collaboration field/);
  assert.throws(() => request({ payload: { note: 'Bearer abcdefghijklmnopqrstuvwxyz' } }), /sensitive-looking value/);
});

test('S8 exact duplicate is idempotent and conflicting digest diverges', () => {
  const binding = peer();
  const original = request();
  assert.deepEqual(classifyDelegationRequestAppend({ peerBinding: binding, request: original }), {
    state: 'accepted', reasonCode: 'append_current', requestSequence: 1, requestDigest: original.requestDigest,
  });
  assert.deepEqual(classifyDelegationRequestAppend({ peerBinding: binding, existingRequest: original, request: original }), {
    state: 'duplicate', reasonCode: 'exact_duplicate', requestSequence: 1,
  });
  const changed = request({ payload: { alpha: 2 } });
  assert.deepEqual(classifyDelegationRequestAppend({ peerBinding: binding, existingRequest: original, request: changed }), {
    state: 'divergent', reasonCode: 'request_digest_conflict', requestSequence: 1,
  });
});

test('S8 sequence gaps and previous digest mismatches fail closed', () => {
  const binding = peer();
  const first = request();
  const third = request({ id: 'delegation-request-3', requestSequence: 3, previousRequestDigest: first.requestDigest });
  assert.equal(classifyDelegationRequestAppend({ peerBinding: binding, lastSequence: 1, lastRequestDigest: first.requestDigest, request: third }).reasonCode, 'request_sequence_gap');
  const secondWrong = request({ id: 'delegation-request-2', requestSequence: 2, previousRequestDigest: 'sha256:wrong' });
  assert.equal(classifyDelegationRequestAppend({ peerBinding: binding, lastSequence: 1, lastRequestDigest: first.requestDigest, request: secondWrong }).reasonCode, 'previous_request_digest_mismatch');
});

test('S8 peer scope rejects wrong source, destination and workspace', () => {
  const binding = peer();
  assert.equal(classifyDelegationRequestAppend({ peerBinding: binding, request: request({ sourceInstanceId: 'sync-source-x' }) }).reasonCode, 'unknown_source_instance');
  assert.equal(classifyDelegationRequestAppend({ peerBinding: binding, request: request({ destinationInstanceId: 'sync-source-x' }) }).reasonCode, 'wrong_destination_instance');
  assert.equal(classifyDelegationRequestAppend({ peerBinding: binding, request: request({ destinationWorkspaceId: 'workspace-x' }) }).reasonCode, 'cross_workspace');
});

test('S8 policy is a bounded allow-set and expiry/revocation fail closed', () => {
  const req = request();
  assert.equal(assertPolicyAllowsRequest(policy(), req, { observedAt: '2026-08-08T12:02:00.000Z' }).allowed, true);
  assert.equal(assertPolicyAllowsRequest(policy({ allowedActions: ['observe'] }), req).reasonCode, 'action_not_allowed');
  assert.equal(assertPolicyAllowsRequest(policy({ status: 'revoked' }), req).reasonCode, 'policy_revoked');
  assert.equal(assertPolicyAllowsRequest(policy({ expiresAt: '2026-08-08T12:00:30.000Z' }), req, { observedAt: '2026-08-08T12:02:00.000Z' }).reasonCode, 'policy_expired');
});

test('S8 cancellation remains a proposal identity only', () => {
  const cancellation = createDelegationCancellationProposal({
    id: 'cancel-1', delegationRequestId: 'delegation-request-1', reasonClass: 'source_withdrawal', createdAt: '2026-08-08T12:03:00.000Z',
  });
  assert.deepEqual(cancellation, {
    id: 'cancel-1', delegationRequestId: 'delegation-request-1', reasonClass: 'source_withdrawal', createdAt: '2026-08-08T12:03:00.000Z',
  });
});
