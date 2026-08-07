'use strict';

const { assertS5ProviderBridge } = require('./bridge-contract.cjs');

class S5ProviderController {
  constructor({ bridge, onState = () => {} }) {
    this.bridge = assertS5ProviderBridge(bridge);
    this.onState = onState;
    this.activeWorkspaceId = null;
    this.selectedBindingId = null;
    this.snapshot = null;
    this.pending = new Map();
  }

  async refresh(workspaceId = this.activeWorkspaceId, bindingId = this.selectedBindingId) {
    this.activeWorkspaceId = workspaceId || null;
    this.selectedBindingId = bindingId || null;
    this.snapshot = await this.bridge.queryState(this.activeWorkspaceId);
    this.onState(this.snapshot, this.activeWorkspaceId, this.selectedBindingId);
    return this.snapshot;
  }

  selectBinding(bindingId) {
    this.selectedBindingId = bindingId || null;
    this.onState(this.snapshot, this.activeWorkspaceId, this.selectedBindingId);
  }

  runOnce(key, command) {
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = Promise.resolve().then(command).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  bindTarget(input) {
    if (!this.activeWorkspaceId) throw new Error('Select a Workspace before binding a provider target');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Provider target binding input must be an object');
    const payload = { ...input, workspaceId: this.activeWorkspaceId };
    return this.runOnce(`s5:bind:${this.activeWorkspaceId}:${payload.id || ''}`, async () => {
      const result = await this.bridge.bindTarget(payload);
      await this.refresh(this.activeWorkspaceId, result?.id || this.selectedBindingId);
      return result;
    });
  }

  observe(bindingId = this.selectedBindingId) {
    if (!this.activeWorkspaceId) throw new Error('Select a Workspace before observing a provider');
    if (!bindingId) throw new Error('Select an approved provider binding before observing');
    return this.runOnce(`s5:observe:${this.activeWorkspaceId}:${bindingId}`, async () => {
      const result = await this.bridge.observe({ workspaceId: this.activeWorkspaceId, bindingId });
      await this.refresh(this.activeWorkspaceId, bindingId);
      return result;
    });
  }
}

module.exports = { S5ProviderController };
