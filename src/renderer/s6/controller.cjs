'use strict';

const METHODS = Object.freeze(['queryState', 'recordPolicy', 'computeDecision', 'revalidateProposal']);

function assertSchedulingBridge(bridge) {
  if (!bridge || typeof bridge !== 'object') throw new TypeError('S6 scheduling bridge is required');
  for (const method of METHODS) if (typeof bridge[method] !== 'function') throw new TypeError(`S6 scheduling bridge.${method} is required`);
  return bridge;
}

class S6SchedulingController {
  constructor({ bridge, onState = () => {} }) {
    this.bridge = assertSchedulingBridge(bridge);
    this.onState = onState;
    this.activeWorkspaceId = null;
    this.selectedProposalId = null;
    this.snapshot = null;
    this.pending = new Map();
  }

  async refresh(workspaceId = this.activeWorkspaceId, selectedProposalId = this.selectedProposalId) {
    this.activeWorkspaceId = workspaceId || null;
    this.selectedProposalId = selectedProposalId || null;
    this.snapshot = await this.bridge.queryState(this.activeWorkspaceId);
    this.onState(this.snapshot, this.activeWorkspaceId, this.selectedProposalId);
    return this.snapshot;
  }

  selectProposal(proposalId) {
    this.selectedProposalId = proposalId || null;
    this.onState(this.snapshot, this.activeWorkspaceId, this.selectedProposalId);
  }

  runOnce(key, command) {
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = Promise.resolve().then(command).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  recordPolicy(input) {
    if (!this.activeWorkspaceId) throw new Error('Select a Workspace before recording scheduling policy');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Scheduling policy input must be an object');
    const payload = { ...input, workspaceId: this.activeWorkspaceId };
    return this.runOnce(`s6:policy:${this.activeWorkspaceId}:${payload.id || ''}`, async () => {
      const result = await this.bridge.recordPolicy(payload);
      await this.refresh(this.activeWorkspaceId, this.selectedProposalId);
      return result;
    });
  }

  computeDecision() {
    if (!this.activeWorkspaceId) throw new Error('Select a Workspace before computing scheduling decision');
    return this.runOnce(`s6:decision:${this.activeWorkspaceId}`, async () => {
      const result = await this.bridge.computeDecision({ workspaceId: this.activeWorkspaceId });
      await this.refresh(this.activeWorkspaceId, this.selectedProposalId);
      return result;
    });
  }

  revalidateProposal(proposalId = this.selectedProposalId) {
    if (!this.activeWorkspaceId) throw new Error('Select a Workspace before revalidating assignment proposal');
    if (!proposalId) throw new Error('Select an assignment proposal before revalidation');
    return this.runOnce(`s6:revalidate:${this.activeWorkspaceId}:${proposalId}`, async () => {
      const result = await this.bridge.revalidateProposal({ workspaceId: this.activeWorkspaceId, proposalId });
      await this.refresh(this.activeWorkspaceId, proposalId);
      return result;
    });
  }
}

module.exports = { METHODS, S6SchedulingController, assertSchedulingBridge };
