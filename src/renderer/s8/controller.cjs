'use strict';

const METHODS = Object.freeze([
  'queryState',
  'recordPeerBinding',
  'recordDelegationPolicy',
  'createDelegationRequest',
  'pushDelegationRequest',
  'pullDelegationInbox',
  'approveDelegationProposal',
  'rejectDelegationProposal',
  'proposeDelegationCancellation',
  'pullDelegationReceipts',
]);

function assertDelegationBridge(bridge) {
  if (!bridge || typeof bridge !== 'object') throw new TypeError('S8 delegation bridge is required');
  for (const method of METHODS) if (typeof bridge[method] !== 'function') throw new TypeError(`S8 delegation bridge.${method} is required`);
  return bridge;
}

class S8DelegationController {
  constructor({ bridge, onState = () => {} }) {
    this.bridge = assertDelegationBridge(bridge);
    this.onState = onState;
    this.activeWorkspaceId = null;
    this.selectedProposalId = null;
    this.selectedRequestId = null;
    this.snapshot = null;
    this.pending = new Map();
  }

  async refresh(workspaceId = this.activeWorkspaceId) {
    this.activeWorkspaceId = workspaceId || null;
    this.snapshot = await this.bridge.queryState(this.activeWorkspaceId);
    this.onState(this.snapshot, this.activeWorkspaceId, this.selectedProposalId, this.selectedRequestId);
    return this.snapshot;
  }

  selectProposal(proposalId) {
    this.selectedProposalId = proposalId || null;
    this.onState(this.snapshot, this.activeWorkspaceId, this.selectedProposalId, this.selectedRequestId);
  }

  selectRequest(requestId) {
    this.selectedRequestId = requestId || null;
    this.onState(this.snapshot, this.activeWorkspaceId, this.selectedProposalId, this.selectedRequestId);
  }

  runOnce(key, command) {
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = Promise.resolve().then(command).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  scopedInput(input, label) {
    if (!this.activeWorkspaceId) throw new Error(`Select a Workspace before ${label}`);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError(`${label} input must be an object`);
    return { ...input, workspaceId: this.activeWorkspaceId };
  }

  recordPeerBinding(input) {
    const payload = this.scopedInput(input, 'recording delegation peer binding');
    return this.runOnce(`s8:peer:${this.activeWorkspaceId}:${payload.id || ''}`, async () => {
      const result = await this.bridge.recordPeerBinding(payload);
      await this.refresh(this.activeWorkspaceId);
      return result;
    });
  }

  recordDelegationPolicy(input) {
    const payload = this.scopedInput(input, 'recording delegation policy');
    return this.runOnce(`s8:policy:${this.activeWorkspaceId}:${payload.id || ''}`, async () => {
      const result = await this.bridge.recordDelegationPolicy(payload);
      await this.refresh(this.activeWorkspaceId);
      return result;
    });
  }

  createDelegationRequest(input) {
    const payload = this.scopedInput(input, 'creating delegation request');
    return this.runOnce(`s8:create-request:${this.activeWorkspaceId}:${payload.id || ''}`, async () => {
      const result = await this.bridge.createDelegationRequest(payload);
      await this.refresh(this.activeWorkspaceId);
      return result;
    });
  }

  pushDelegationRequest(requestId) {
    if (!this.activeWorkspaceId) throw new Error('Select a Workspace before pushing delegation request');
    const id = requestId || this.selectedRequestId;
    if (!id) throw new Error('Select a delegation request before push');
    return this.runOnce(`s8:push:${this.activeWorkspaceId}:${id}`, async () => {
      const result = await this.bridge.pushDelegationRequest({ workspaceId: this.activeWorkspaceId, requestId: id });
      await this.refresh(this.activeWorkspaceId);
      return result;
    });
  }

  pullDelegationInbox() {
    if (!this.activeWorkspaceId) throw new Error('Select a Workspace before pulling delegation inbox');
    return this.runOnce(`s8:pull-inbox:${this.activeWorkspaceId}`, async () => {
      const result = await this.bridge.pullDelegationInbox({ workspaceId: this.activeWorkspaceId });
      await this.refresh(this.activeWorkspaceId);
      return result;
    });
  }

  approveSelectedProposal() {
    if (!this.activeWorkspaceId || !this.selectedProposalId) throw new Error('Select a local incoming proposal before approval');
    return this.runOnce(`s8:approve-local:${this.activeWorkspaceId}:${this.selectedProposalId}`, async () => {
      const result = await this.bridge.approveDelegationProposal({ workspaceId: this.activeWorkspaceId, proposalId: this.selectedProposalId });
      await this.refresh(this.activeWorkspaceId);
      return result;
    });
  }

  rejectSelectedProposal() {
    if (!this.activeWorkspaceId || !this.selectedProposalId) throw new Error('Select a local incoming proposal before rejection');
    return this.runOnce(`s8:reject-local:${this.activeWorkspaceId}:${this.selectedProposalId}`, async () => {
      const result = await this.bridge.rejectDelegationProposal({ workspaceId: this.activeWorkspaceId, proposalId: this.selectedProposalId });
      await this.refresh(this.activeWorkspaceId);
      return result;
    });
  }

  proposeDelegationCancellation(requestId, reasonClass = 'source_withdrawal') {
    if (!this.activeWorkspaceId) throw new Error('Select a Workspace before proposing delegation cancellation');
    const id = requestId || this.selectedRequestId;
    if (!id) throw new Error('Select a delegation request before cancellation proposal');
    return this.runOnce(`s8:cancel-proposal:${this.activeWorkspaceId}:${id}`, async () => {
      const result = await this.bridge.proposeDelegationCancellation({ workspaceId: this.activeWorkspaceId, requestId: id, reasonClass });
      await this.refresh(this.activeWorkspaceId);
      return result;
    });
  }

  pullDelegationReceipts() {
    if (!this.activeWorkspaceId) throw new Error('Select a Workspace before pulling delegation receipts');
    return this.runOnce(`s8:pull-receipts:${this.activeWorkspaceId}`, async () => {
      const result = await this.bridge.pullDelegationReceipts({ workspaceId: this.activeWorkspaceId });
      await this.refresh(this.activeWorkspaceId);
      return result;
    });
  }
}

module.exports = { METHODS, S8DelegationController, assertDelegationBridge };
