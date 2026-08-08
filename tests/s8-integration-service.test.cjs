'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { S8ApplicationService } = require('../src/application/s8-index.cjs');

class FakeWorkerManager {
  constructor() {
    this.workers = [
      { id: 's1-worker-chrome', projectId: 's1-local-project', role: 'implementation', status: 'idle', browserChannel: 'chrome' },
      { id: 's1-worker-chromium', projectId: 's1-local-project', role: 'review', status: 'idle', browserChannel: 'chromium' },
    ];
    this.submissions = [];
  }
  list() { return this.workers.map((item) => ({ ...item })); }
  async submitAuthorizedLocalTask(input) {
    this.submissions.push({ ...input });
    return { result: { text: `delegated:${input.payload}`, submissionCount: this.submissions.length } };
  }
  async start() { throw new Error('S8 integration must not directly start Worker'); }
  async stop() { throw new Error('unused'); }
  async focus() { throw new Error('unused'); }
  pause() { throw new Error('unused'); }
  resume() { throw new Error('unused'); }
}

class SharedDelegationExchange {
  constructor() {
    this.requests = [];
    this.receipts = [];
    this.cancellations = [];
    this.calls = [];
  }
  async submitRequest(request) {
    this.calls.push('submitRequest');
    const existing = this.requests.find((item) => item.id === request.id);
    if (existing) return { state: existing.requestDigest === request.requestDigest ? 'duplicate' : 'divergent', reasonCode: existing.requestDigest === request.requestDigest ? 'exact_duplicate' : 'request_digest_conflict' };
    this.requests.push(structuredClone(request));
    return { state: 'accepted', reasonCode: 'stored' };
  }
  async readInbox({ destinationInstanceId, destinationWorkspaceId }) {
    this.calls.push('readInbox');
    return this.requests.filter((item) => item.destinationInstanceId === destinationInstanceId && item.destinationWorkspaceId === destinationWorkspaceId).map((item) => structuredClone(item));
  }
  async acknowledgeRequest(input) { this.calls.push('acknowledgeRequest'); return { ...input }; }
  async submitReceipt(receipt) {
    this.calls.push('submitReceipt');
    const existing = this.receipts.find((item) => item.delegationRequestId === receipt.delegationRequestId && item.receiptRevision === receipt.receiptRevision);
    if (!existing) this.receipts.push(structuredClone(receipt));
    return { state: existing ? 'duplicate' : 'accepted' };
  }
  async readReceipts({ sourceInstanceId, sourceWorkspaceId }) {
    this.calls.push('readReceipts');
    return this.receipts.filter((item) => item.sourceInstanceId === sourceInstanceId && item.sourceWorkspaceId === sourceWorkspaceId).map((item) => structuredClone(item));
  }
  async submitCancellation(cancellationProposal) {
    this.calls.push('submitCancellation');
    const request = this.requests.find((item) => item.id === cancellationProposal.delegationRequestId);
    if (!request) throw new Error('unknown_request');
    if (!this.cancellations.some((item) => item.id === cancellationProposal.id)) this.cancellations.push({ ...structuredClone(cancellationProposal), destinationInstanceId: request.destinationInstanceId, destinationWorkspaceId: request.destinationWorkspaceId, requestSequence: request.requestSequence });
    return { state: 'accepted' };
  }
  async readCancellations({ destinationInstanceId, destinationWorkspaceId }) {
    this.calls.push('readCancellations');
    return this.cancellations.filter((item) => item.destinationInstanceId === destinationInstanceId && item.destinationWorkspaceId === destinationWorkspaceId).map((item) => structuredClone(item));
  }
}

function makeService({ databasePath = ':memory:', transport, workerManager = new FakeWorkerManager() } = {}) {
  return new S8ApplicationService({
    databasePath,
    workerManager,
    localTarget: 'http://127.0.0.1:43119/task-form.html',
    delegationEndpoint: { id: 'delegation-test-endpoint', status: 'active' },
    delegationTransport: transport,
    clock: (() => {
      let tick = 0;
      return () => new Date(Date.parse('2026-08-08T12:00:00.000Z') + (tick++ * 1000)).toISOString();
    })(),
  });
}

function prepareBilateral(source, destination) {
  const sourceInstanceId = source.activeSourceInstance().id;
  const destinationInstanceId = destination.activeSourceInstance().id;
  const peer = {
    id: 'peer-a-to-b', sourceInstanceId, sourceWorkspaceId: 'workspace-a', destinationInstanceId, destinationWorkspaceId: 'workspace-a',
    status: 'active', createdAt: '2026-08-08T12:10:00.000Z', updatedAt: '2026-08-08T12:10:00.000Z',
  };
  source.recordPeerBinding({ ...peer, workspaceId: 'workspace-a' });
  destination.recordPeerBinding({ ...peer, workspaceId: 'workspace-a' });
  const install = destination.installCapability({ workspaceId: 'workspace-a', packageId: 'local.form-submit', version: '1.0.0' });
  destination.grantCapability({ workspaceId: 'workspace-a', agentId: 'agent-a', installationId: install.id, allowedActions: ['submit_payload'], allowedTargets: [destination.localTarget] });
  destination.recordDelegationPolicy({
    id: 'policy-a-to-b-v1', version: '1.0.0', peerBindingId: peer.id, destinationWorkspaceId: 'workspace-a', workspaceId: 'workspace-a', status: 'active',
    allowedCapabilityVersionIds: ['local.form-submit@1.0.0'], allowedActions: ['submit_payload'], allowedTargets: [destination.localTarget],
    maxPendingRequests: 8, maxAcceptedNotStarted: 2, createdAt: '2026-08-08T12:10:01.000Z', expiresAt: '2026-08-09T12:10:01.000Z',
  });
  return { peer, sourceInstanceId, destinationInstanceId };
}

async function createAndDeliver(source, destination) {
  const request = source.createDelegationRequest({
    workspaceId: 'workspace-a', peerBindingId: 'peer-a-to-b', policyId: 'policy-a-to-b-v1', policyVersion: '1.0.0',
    capabilityVersionId: 'local.form-submit@1.0.0', action: 'submit_payload', target: source.localTarget,
    payloadClass: 'bounded-input', payload: { message: 'hello delegated execution' },
  });
  await source.pushDelegationRequest({ workspaceId: 'workspace-a', requestId: request.id });
  await destination.pullDelegationInbox({ workspaceId: 'workspace-a' });
  const proposal = destination.queryDelegationState('workspace-a').incomingProposals.find((item) => item.delegationRequestId === request.id);
  return { request, proposal };
}

test('S8 inbound request is only a proposal before destination-local delegation HumanGate', async () => {
  const exchange = new SharedDelegationExchange();
  const source = makeService({ transport: exchange });
  const destination = makeService({ transport: exchange });
  try {
    prepareBilateral(source, destination);
    const { proposal } = await createAndDeliver(source, destination);
    assert.equal(proposal.state, 'waiting_human');
    assert.ok(proposal.humanGateId);
    assert.equal(destination.delegatedExecutionBinding.list().length, 0);
    assert.equal(destination.mission.list().filter((item) => item.title.startsWith('Delegated request')).length, 0);
    assert.equal(destination.workerManager.submissions.length, 0);
    assert.equal(destination.queryDelegationState('workspace-a').humanGates.find((item) => item.id === proposal.humanGateId).state, 'requested');
  } finally { source.close(); destination.close(); }
});

test('S8 local rejection creates zero local execution identity', async () => {
  const exchange = new SharedDelegationExchange();
  const source = makeService({ transport: exchange });
  const destination = makeService({ transport: exchange });
  try {
    prepareBilateral(source, destination);
    const { proposal } = await createAndDeliver(source, destination);
    const rejected = destination.rejectDelegationProposal({ workspaceId: 'workspace-a', proposalId: proposal.id });
    assert.equal(rejected.proposal.state, 'rejected');
    assert.equal(destination.delegatedExecutionBinding.list().length, 0);
    assert.equal(destination.workerManager.submissions.length, 0);
  } finally { source.close(); destination.close(); }
});

test('S8 local acceptance creates exactly one destination Mission and preserves action HumanGate', async () => {
  const exchange = new SharedDelegationExchange();
  const source = makeService({ transport: exchange });
  const destination = makeService({ transport: exchange });
  try {
    prepareBilateral(source, destination);
    const { request, proposal } = await createAndDeliver(source, destination);
    const accepted = destination.approveDelegationProposal({ workspaceId: 'workspace-a', proposalId: proposal.id });
    assert.equal(accepted.proposal.state, 'bound');
    assert.equal(destination.delegatedExecutionBinding.list().length, 1);
    assert.equal(accepted.binding.delegationRequestId, request.id);
    assert.ok(accepted.binding.localMissionId);
    assert.ok(accepted.binding.localStepAttemptId);
    assert.ok(accepted.binding.localExecutionRunId);
    const actionGate = destination.humanGate.list().find((item) => item.executionRunId === accepted.binding.localExecutionRunId);
    assert.ok(actionGate, 'existing S1 action HumanGate must still exist');
    assert.equal(actionGate.state, 'requested');
    assert.equal(destination.workerManager.submissions.length, 0);
    const repeated = destination.approveDelegationProposal({ workspaceId: 'workspace-a', proposalId: proposal.id });
    assert.equal(repeated.binding.id, accepted.binding.id);
    assert.equal(destination.delegatedExecutionBinding.list().length, 1);
  } finally { source.close(); destination.close(); }
});

test('S8 completed destination action publishes bounded receipt; source pull alone does not mutate S2 canonical truth', async () => {
  const exchange = new SharedDelegationExchange();
  const source = makeService({ transport: exchange });
  const destination = makeService({ transport: exchange });
  try {
    prepareBilateral(source, destination);
    const { request, proposal } = await createAndDeliver(source, destination);
    const accepted = destination.approveDelegationProposal({ workspaceId: 'workspace-a', proposalId: proposal.id });
    const actionGate = destination.humanGate.list().find((item) => item.executionRunId === accepted.binding.localExecutionRunId);
    const result = await destination.approveHumanGate({ gateId: actionGate.id });
    assert.equal(destination.workerManager.submissions.length, 1);
    assert.equal(result.delegationReceipt.state, 'completed');
    assert.equal(exchange.receipts.length, 1);
    const missionBefore = JSON.stringify(source.queryMissionState('workspace-a'));
    const pull = await source.pullDelegationReceipts({ workspaceId: 'workspace-a' });
    assert.equal(pull.accepted, 1);
    assert.equal(JSON.stringify(source.queryMissionState('workspace-a')), missionBefore);
    const mirrored = source.queryDelegationState('workspace-a').receipts.find((item) => item.direction === 'inbound' && item.delegationRequestId === request.id);
    assert.ok(mirrored);
    const consumed = source.consumeDelegationReceipt({ workspaceId: 'workspace-a', receiptMirrorId: mirrored.id });
    const repeated = source.consumeDelegationReceipt({ workspaceId: 'workspace-a', receiptMirrorId: mirrored.id });
    assert.equal(consumed.id, repeated.id);
    assert.equal(source.delegationReceiptConsumption.list().length, 1);
  } finally { source.close(); destination.close(); }
});

test('S8 cancellation remains local-decision proposal before binding and non-authoritative after binding', async () => {
  const exchange = new SharedDelegationExchange();
  const source = makeService({ transport: exchange });
  const destination = makeService({ transport: exchange });
  try {
    prepareBilateral(source, destination);
    const first = await createAndDeliver(source, destination);
    await source.proposeDelegationCancellation({ workspaceId: 'workspace-a', requestId: first.request.id });
    await destination.pullDelegationInbox({ workspaceId: 'workspace-a' });
    const inbound = destination.queryDelegationState('workspace-a').cancellationProposals.find((item) => item.direction === 'inbound');
    assert.equal(inbound.state, 'pending_local_decision');
    const resolved = destination.resolveDelegationCancellation({ workspaceId: 'workspace-a', cancellationId: inbound.id, acceptedLocally: true });
    assert.equal(resolved.state, 'accepted_locally');
    assert.equal(destination.delegatedExecutionBinding.list().length, 0);

    const secondRequest = source.createDelegationRequest({
      workspaceId: 'workspace-a', peerBindingId: 'peer-a-to-b', policyId: 'policy-a-to-b-v1', policyVersion: '1.0.0',
      capabilityVersionId: 'local.form-submit@1.0.0', action: 'submit_payload', target: source.localTarget,
      payloadClass: 'bounded-input', payload: { message: 'second request' },
    });
    await source.pushDelegationRequest({ workspaceId: 'workspace-a', requestId: secondRequest.id });
    await destination.pullDelegationInbox({ workspaceId: 'workspace-a' });
    const secondProposal = destination.queryDelegationState('workspace-a').incomingProposals.find((item) => item.delegationRequestId === secondRequest.id);
    destination.approveDelegationProposal({ workspaceId: 'workspace-a', proposalId: secondProposal.id });
    await source.proposeDelegationCancellation({ workspaceId: 'workspace-a', requestId: secondRequest.id });
    await destination.pullDelegationInbox({ workspaceId: 'workspace-a' });
    const secondCancel = destination.queryDelegationState('workspace-a').cancellationProposals.filter((item) => item.direction === 'inbound').find((item) => item.delegationRequestId === secondRequest.id);
    const nonAuthority = destination.resolveDelegationCancellation({ workspaceId: 'workspace-a', cancellationId: secondCancel.id, acceptedLocally: true });
    assert.equal(nonAuthority.state, 'non_authoritative_after_start');
    assert.equal(nonAuthority.reasonCode, 'post_start_remote_cancel_non_authoritative');
    assert.equal(destination.delegatedExecutionBinding.list().length, 1);
  } finally { source.close(); destination.close(); }
});

test('S8 restart rehydrates requests/gates/bindings without network replay or duplicate execution identity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ai-exe-os-s8-integration-'));
  const databasePath = join(root, 'state.sqlite');
  const exchange = new SharedDelegationExchange();
  const workerManager = new FakeWorkerManager();
  let destination = makeService({ databasePath, transport: exchange, workerManager });
  const source = makeService({ transport: exchange });
  try {
    prepareBilateral(source, destination);
    const { proposal } = await createAndDeliver(source, destination);
    const accepted = destination.approveDelegationProposal({ workspaceId: 'workspace-a', proposalId: proposal.id });
    const callsBefore = exchange.calls.length;
    const bindingId = accepted.binding.id;
    const projectionBefore = destination.store.projectionDigest({ workspaceId: 'workspace-a' });
    destination.close();
    destination = makeService({ databasePath, transport: exchange, workerManager });
    assert.equal(exchange.calls.length, callsBefore, 'constructor/restart must not replay delegation network');
    assert.equal(destination.store.projectionDigest({ workspaceId: 'workspace-a' }), projectionBefore);
    assert.equal(destination.delegatedExecutionBinding.list().length, 1);
    assert.equal(destination.delegatedExecutionBinding.list()[0].id, bindingId);
    assert.equal(workerManager.submissions.length, 0);
  } finally {
    source.close(); destination.close(); rmSync(root, { recursive: true, force: true });
  }
});
