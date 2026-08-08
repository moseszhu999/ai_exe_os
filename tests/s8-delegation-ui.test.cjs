'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { METHODS, S8DelegationController, assertDelegationBridge } = require('../src/renderer/s8/controller.cjs');
const { SURFACES, createS8DelegationViewModel, sanitize } = require('../src/renderer/s8/view-model.cjs');

function snapshot() {
  return {
    workspaceId: 'workspace-b',
    found: true,
    peerBindings: [{
      id: 'peer-a-to-b', status: 'active', sourceInstanceId: 'sync-source-a', sourceWorkspaceId: 'workspace-a',
      destinationInstanceId: 'sync-source-b', destinationWorkspaceId: 'workspace-b', profilePath: '/forbidden',
    }],
    policies: [{
      id: 'policy-a-to-b-v1', version: '1.0.0', status: 'active', peerBindingId: 'peer-a-to-b',
      allowedActions: ['submit_payload'], allowedTargets: ['http://127.0.0.1:3210/task-form.html'],
    }],
    outboundRequests: [{
      id: 'request-1', action: 'submit_payload', target: 'http://127.0.0.1:3210/task-form.html',
      destinationInstanceId: 'sync-source-b', destinationWorkspaceId: 'workspace-b', policyId: 'policy-a-to-b-v1',
      requestDigest: 'sha256:request-1',
    }],
    incomingProposals: [{
      id: 'proposal-1', delegationRequestId: 'request-1', state: 'waiting_human', reasonCode: 'human_gate_required',
    }],
    admissionSnapshots: [{
      id: 'admission-1', proposalId: 'proposal-1', admissible: true, admissionDigest: 'sha256:admission-1',
      capabilityInstallationId: 'install-b', agentCapabilityGrantId: 'grant-b', reasonCodes: [],
    }],
    acceptances: [],
    executionBindings: [],
    receipts: [{
      id: 'receipt-1', delegationRequestId: 'request-1', state: 'completed', receiptDigest: 'sha256:receipt-1',
      evidenceDigests: ['sha256:evidence-1'], token: 'forbidden-token',
    }],
    cancellationProposals: [{ id: 'cancel-1', delegationRequestId: 'request-1', reasonClass: 'source_withdrawal' }],
    divergences: [{ requestId: 'request-x', state: 'rejected', reasonCode: 'request_digest_conflict' }],
  };
}

test('S8 view model exposes the required delegation explanation surfaces', () => {
  assert.deepEqual(SURFACES, [
    'Delegation / Overview', 'Peer Bindings', 'Policies', 'Outbound Requests', 'Incoming Proposals',
    'Admission Evidence', 'Local HumanGate', 'Local Execution Binding', 'Receipts / Evidence',
    'Cancellation Proposal', 'Divergence / Replay / Rejection Reasons',
  ]);
  const value = createS8DelegationViewModel(snapshot(), 'workspace-b');
  assert.equal(value.found, true);
  assert.equal(value.selectedProposal.id, 'proposal-1');
  assert.equal(value.selectedRequest.id, 'request-1');
  assert.equal(value.selectedAdmission.id, 'admission-1');
  assert.equal(value.selectedReceipt.id, 'receipt-1');
});

test('S8 Workspace mismatch fails closed and exposes no delegation state', () => {
  const value = createS8DelegationViewModel(snapshot(), 'workspace-other');
  assert.equal(value.found, false);
  assert.deepEqual(value.peerBindings, []);
  assert.deepEqual(value.outboundRequests, []);
  assert.deepEqual(value.incomingProposals, []);
  assert.deepEqual(value.executionBindings, []);
  assert.deepEqual(value.receipts, []);
});

test('S8 view model recursively redacts credential/profile/process fields and sensitive strings', () => {
  const safe = sanitize({
    token: 'secret',
    nested: { cookie: 'session=abc', profilePath: '/private/profile', pid: 1234 },
    header: 'Bearer abcdefghijklmnopqrstuvwxyz',
    normal: 'visible',
  });
  assert.equal(safe.token, '[redacted]');
  assert.equal(safe.nested.cookie, '[redacted]');
  assert.equal(safe.nested.profilePath, '[redacted]');
  assert.equal(safe.nested.pid, '[redacted]');
  assert.equal(safe.header, '[redacted]');
  assert.equal(safe.normal, 'visible');
  const value = createS8DelegationViewModel(snapshot(), 'workspace-b');
  assert.equal(value.peerBindings[0].profilePath, '[redacted]');
  assert.equal(value.receipts[0].token, '[redacted]');
});

test('S8 bridge is bounded and contains no remote Worker control methods', () => {
  assert.deepEqual(METHODS, [
    'queryState', 'recordPeerBinding', 'recordDelegationPolicy', 'createDelegationRequest', 'pushDelegationRequest',
    'pullDelegationInbox', 'approveDelegationProposal', 'rejectDelegationProposal', 'proposeDelegationCancellation', 'pullDelegationReceipts',
  ]);
  const bridge = Object.fromEntries(METHODS.map((method) => [method, () => Promise.resolve({})]));
  assert.equal(assertDelegationBridge(bridge), bridge);
  assert.throws(() => assertDelegationBridge({ ...bridge, pullDelegationReceipts: undefined }), /pullDelegationReceipts/);
  for (const forbidden of ['startWorker', 'stopWorker', 'focusWorker', 'pauseWorker', 'resumeWorker', 'approveHumanGate', 'rejectHumanGate', 'retryFailed', 'providerWrite']) {
    assert.equal(Object.prototype.hasOwnProperty.call(bridge, forbidden), false);
  }
});

test('S8 controller scopes actions to the selected local Workspace and deduplicates pushes', async () => {
  const calls = [];
  let resolvePush;
  const bridge = Object.fromEntries(METHODS.map((method) => [method, (input) => {
    calls.push([method, input]);
    if (method === 'queryState') return Promise.resolve(snapshot());
    if (method === 'pushDelegationRequest') return new Promise((resolve) => { resolvePush = resolve; });
    return Promise.resolve(input || {});
  }]));
  const controller = new S8DelegationController({ bridge });
  await controller.refresh('workspace-b');
  controller.selectRequest('request-1');
  controller.selectProposal('proposal-1');
  await controller.recordPeerBinding({ id: 'peer-a-to-b', workspaceId: 'workspace-other' });
  assert.equal(calls.find(([name]) => name === 'recordPeerBinding')[1].workspaceId, 'workspace-b');
  await controller.recordDelegationPolicy({ id: 'policy-a-to-b-v1', workspaceId: 'workspace-other' });
  assert.equal(calls.find(([name]) => name === 'recordDelegationPolicy')[1].workspaceId, 'workspace-b');
  await controller.createDelegationRequest({ id: 'request-2', workspaceId: 'workspace-other' });
  assert.equal(calls.find(([name]) => name === 'createDelegationRequest')[1].workspaceId, 'workspace-b');

  const first = controller.pushDelegationRequest();
  const second = controller.pushDelegationRequest();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(typeof resolvePush, 'function');
  resolvePush({ accepted: true });
  await first;
  assert.equal(calls.filter(([name]) => name === 'pushDelegationRequest').length, 1);

  await controller.pullDelegationInbox();
  await controller.approveSelectedProposal();
  await controller.rejectSelectedProposal();
  await controller.proposeDelegationCancellation();
  await controller.pullDelegationReceipts();
  for (const [name, input] of calls.filter(([name]) => !['queryState', 'pushDelegationRequest'].includes(name))) {
    if (input && Object.prototype.hasOwnProperty.call(input, 'workspaceId')) assert.equal(input.workspaceId, 'workspace-b', name);
  }
  assert.deepEqual(calls.find(([name]) => name === 'approveDelegationProposal')[1], { workspaceId: 'workspace-b', proposalId: 'proposal-1' });
  assert.deepEqual(calls.find(([name]) => name === 'rejectDelegationProposal')[1], { workspaceId: 'workspace-b', proposalId: 'proposal-1' });
});

test('S8 renderer is DOM-safe and explains destination-local authority without remote controls', () => {
  const source = readFileSync(join(__dirname, '..', 'src', 'renderer', 's8', 'render.cjs'), 'utf8');
  assert.doesNotMatch(source, /innerHTML\s*=|outerHTML\s*=|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(source, /startWorker|stopWorker|focusWorker|pauseWorker|resumeWorker|providerWrite/);
  assert.match(source, /approve-local-delegation/);
  assert.match(source, /reject-local-delegation/);
  assert.match(source, /Only the destination-local operator may decide this delegation gate/);
  assert.match(source, /does not bypass any existing action HumanGate/);
  assert.match(source, /Remote cancellation is proposal-only before local binding and non-authoritative after execution starts/);
  assert.match(source, /Execution remains governed by this destination instance’s S6\/S2\/S1 scheduler/);
});
