'use strict';

class S3GitHubDeliveryController {
  constructor({ bridge, onState = () => {} }) {
    if (!bridge?.queryState) throw new TypeError('S3 GitHub delivery bridge is required');
    this.bridge = bridge;
    this.onState = onState;
    this.activeWorkspaceId = null;
    this.selectedPullRequestBindingId = null;
    this.pending = new Map();
    this.state = null;
  }

  async refresh(workspaceId = this.activeWorkspaceId, pullRequestBindingId = this.selectedPullRequestBindingId) {
    this.activeWorkspaceId = workspaceId || null;
    this.selectedPullRequestBindingId = pullRequestBindingId || null;
    this.state = await this.bridge.queryState(this.activeWorkspaceId);
    this.onState(this.state, this.activeWorkspaceId, this.selectedPullRequestBindingId);
    return this.state;
  }

  runOnce(key, command) {
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = Promise.resolve().then(command).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  command(name, input, key) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('S3 command input must be an object');
    if (typeof this.bridge[name] !== 'function') throw new Error(`Unsupported S3 GitHub delivery command: ${name}`);
    return this.runOnce(key, async () => {
      const result = await this.bridge[name](input);
      await this.refresh(input.workspaceId, input.pullRequestBindingId || this.selectedPullRequestBindingId || result?.pullRequestBindingId || result?.id);
      return result;
    });
  }

  registerRepository(input) {
    return this.command('registerRepository', input, `s3-repository:${input.workspaceId}:${input.id || input.repository}`);
  }

  reserveBranch(input) {
    return this.command('reserveBranch', input, `s3-branch:${input.workspaceId}:${input.repositoryRegistrationId}:${input.branch}`);
  }

  claimPaths(input) {
    return this.command('claimPaths', input, `s3-paths:${input.workspaceId}:${input.branchReservationId}:${(input.paths || []).join('|')}`);
  }

  bindPullRequest(input) {
    return this.command('bindPullRequest', input, `s3-pr-bind:${input.workspaceId}:${input.repositoryRegistrationId}:${input.number}:${input.expectedHeadSha}`);
  }

  observeDelivery(input) {
    return this.command('observeDelivery', input, `s3-observe:${input.workspaceId}:${input.pullRequestBindingId}`);
  }

  createRepairProposal(input) {
    return this.command('createRepairProposal', input, `s3-repair-proposal:${input.workspaceId}:${input.pullRequestBindingId}:${input.reasonCode || ''}`);
  }

  isPending(key) {
    return this.pending.has(key);
  }
}

module.exports = { S3GitHubDeliveryController };
