'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyAdmissionToProposal,
  applyCancellationProposal,
  createDelegatedExecutionBinding,
  createDelegationAcceptance,
  createIncomingDelegationProposal,
  evaluateDelegationAdmission,
} = require('../src/delegation/admission/index.cjs');
const { digest } = require('../src/sync/envelope/index.cjs');

const request = Object.freeze({
  id: 'delegation-request-1',
  sourceInstanceId: 'sync-source-a',
  sourceWorkspaceId: 'workspace-a',
  destinationInstanceId: 'sync-source-b',
  destinationWorkspaceId: 'workspace-b',
  peerBindingId: 'peer-a-to-b',
  policyId: 'policy-a-to-b-v1',
  policyVersion: '1.0.0',
  capabilityVersionId: 'local-form-submit-1',
  action: 'submit_payload',
  target: 'http://127.0.0.1:3210/task-form.html',
  requestDigest: 'sha256:request-1',
});

const peerBinding = Object.freeze({
  id: 'peer-a-to-b', status: 'active', sourceInstanceId: 'sync-source-a', sourceWorkspaceId: 'workspace-a',
  destinationInstanceId: 'sync-source-b', destinationWorkspaceId: 'workspace-b',
});

const policy = Object.freeze({
  id: 'policy-a-to-b-v1', version: '1.0.0', peerBindingId: 'peer-a-to-b', destinationWorkspaceId: 'workspace-b',
  status: 'active', allowedCapabilityVersionIds: ['local-form-submit-1'], allowedActions: ['submit_payload'],
  allowedTargets: ['http://127.0.0.1:3210/task-form.html'], maxPendingRequests: 4, maxAcceptedNotStarted: 2,
  expiresAt: '2026-08-09T12:00:00.000Z',
});

const localInstallation = Object.freeze({ id: 'install-b', workspaceId: 'workspace-b', capabilityVersionId: 'local-form-submit-1', status: 'active' });
const localGrant = Object.freeze({ id: 'grant-b', workspaceId: 'workspace-b', installationId: 'install-b', status: 'active', allowedActions: ['submit_payload'], allowedTargets: ['http://127.0.0.1:3210/task-form.html'] });

function proposal(overrides = {}) {
  return createIncomingDelegationProposal({
    id: 'proposal-1', delegationRequestId: request.id, peerBindingId: peerBinding.id, policyId: policy.id,
    workspaceId: 'workspace-b', state: 'received', receivedAt: '2026-08-08T12:10:00.000Z', ...overrides,
  });
}

function admission(overrides = {}) {
  return evaluateDelegationAdmission({
    id: 'admission-1', proposalId: 'proposal-1', request, peerBinding, policy, localInstallation, localGrant,
    resourceState: { status: 'current', digest: 'resource-current' },
    schedulingState: { status: 'current', digest: 'schedule-current' },
    observedAt: '2026-08-08T12:11:00.000Z',
    ...overrides,
  });
}

test('S8 destination admission is explicit and immutable', () => {
  const result = admission();
  assert.equal(result.admissible, true);
  assert.deepEqual(result.reasonCodes, []);
  assert.equal(result.capabilityInstallationId, 'install-b');
  assert.equal(result.agentCapabilityGrantId, 'grant-b');
  assert.equal(result.peerBindingDigest, digest(peerBinding));
  assert.match(result.admissionDigest, /^sha256:/);
  assert.equal(Object.isFrozen(result), true);
});

test('S8 inbound request remains non-runnable before local gate', () => {
  const p = proposal();
  const next = applyAdmissionToProposal(p, admission());
  assert.equal(next.state, 'waiting_human');
  assert.equal(next.reasonCode, 'human_gate_required');
  assert.equal('localTaskId' in next, false);
  assert.equal('workerId' in next, false);
});

test('S8 missing local authority and stale policy fail closed with reason codes', () => {
  const missing = admission({ localInstallation: null, localGrant: null });
  assert.equal(missing.admissible, false);
  assert.ok(missing.reasonCodes.includes('local_installation_missing'));
  assert.ok(missing.reasonCodes.includes('local_grant_missing'));
  const stale = admission({ policy: { ...policy, status: 'superseded' } });
  assert.equal(stale.admissible, false);
  assert.ok(stale.reasonCodes.includes('policy_stale'));
});

test('S8 provider/resource/scheduling constraints remain destination-local admission inputs', () => {
  assert.ok(admission({ providerRequired: true, providerAuthority: null }).reasonCodes.includes('provider_authority_missing'));
  assert.ok(admission({ resourceState: { status: 'blocked' } }).reasonCodes.includes('resource_blocked'));
  assert.ok(admission({ schedulingState: { status: 'over_capacity' } }).reasonCodes.includes('scheduling_capacity_exhausted'));
});

test('S8 local HumanGate rejection creates no execution binding', () => {
  const waiting = applyAdmissionToProposal(proposal(), admission());
  const rejected = createDelegationAcceptance({ id: 'acceptance-reject', proposal: waiting, admission: admission(), humanGateId: 'gate-b', state: 'rejected', decidedAt: '2026-08-08T12:12:00.000Z' });
  assert.equal(rejected.state, 'rejected');
  assert.throws(() => createDelegatedExecutionBinding({ id: 'binding-1', proposal: waiting, acceptance: rejected, admission: admission(), localIdentity: { localTaskId: 'task-b' } }), /accepted destination HumanGate/);
});

test('S8 accepted proposal creates exactly one destination-local binding', () => {
  const currentAdmission = admission();
  const waiting = applyAdmissionToProposal(proposal(), currentAdmission);
  const accepted = createDelegationAcceptance({ id: 'acceptance-1', proposal: waiting, admission: currentAdmission, humanGateId: 'gate-b', state: 'accepted', decidedAt: '2026-08-08T12:12:00.000Z' });
  const binding = createDelegatedExecutionBinding({
    id: 'binding-1', proposal: waiting, acceptance: accepted, admission: currentAdmission,
    localIdentity: { localTaskId: 'task-b', localExecutionRunId: 'run-b' }, createdAt: '2026-08-08T12:13:00.000Z',
  });
  assert.equal(binding.delegationRequestId, request.id);
  assert.equal(binding.localTaskId, 'task-b');
  assert.throws(() => createDelegatedExecutionBinding({
    id: 'binding-2', proposal: waiting, acceptance: accepted, admission: currentAdmission,
    localIdentity: { localTaskId: 'task-b-2' }, existingBinding: binding,
  }), /already bound/);
});

test('S8 acceptance is bound to the exact admission snapshot', () => {
  const first = admission();
  const waiting = applyAdmissionToProposal(proposal(), first);
  const accepted = createDelegationAcceptance({ id: 'acceptance-1', proposal: waiting, admission: first, humanGateId: 'gate-b', state: 'accepted' });
  const newer = admission({ id: 'admission-2', observedAt: '2026-08-08T12:14:00.000Z' });
  assert.throws(() => createDelegatedExecutionBinding({ id: 'binding-1', proposal: waiting, acceptance: accepted, admission: newer, localIdentity: { localTaskId: 'task-b' } }), /snapshot mismatch/);
});

test('S8 cancellation is proposal-only before binding and non-authoritative after binding', () => {
  const p = proposal();
  const pending = applyCancellationProposal({ proposal: p, acceptedLocally: false });
  assert.equal(pending.state, 'received');
  assert.equal(pending.reasonCode, 'cancellation_proposal_pending_local_decision');
  const cancelled = applyCancellationProposal({ proposal: p, acceptedLocally: true, updatedAt: '2026-08-08T12:15:00.000Z' });
  assert.equal(cancelled.state, 'cancelled_before_start');
  const postStart = applyCancellationProposal({ proposal: { ...p, state: 'bound' }, executionBinding: { id: 'binding-1' }, acceptedLocally: true });
  assert.equal(postStart.state, 'bound');
  assert.equal(postStart.reasonCode, 'post_start_remote_cancel_non_authoritative');
});
