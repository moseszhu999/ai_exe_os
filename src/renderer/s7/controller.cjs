'use strict';

const METHODS = Object.freeze(['queryState', 'configureSync', 'pushPending', 'pullMirror', 'recordMembership']);

function assertSyncBridge(bridge) {
  if (!bridge || typeof bridge !== 'object') throw new TypeError('S7 sync bridge is required');
  for (const method of METHODS) if (typeof bridge[method] !== 'function') throw new TypeError(`S7 sync bridge.${method} is required`);
  return bridge;
}

class S7SyncController {
  constructor({ bridge, onState = () => {} }) {
    this.bridge = assertSyncBridge(bridge);
    this.onState = onState;
    this.activeWorkspaceId = null;
    this.selectedRemoteSourceId = null;
    this.selectedMembershipId = null;
    this.snapshot = null;
    this.pending = new Map();
  }

  async refresh(workspaceId = this.activeWorkspaceId) {
    this.activeWorkspaceId = workspaceId || null;
    this.snapshot = await this.bridge.queryState(this.activeWorkspaceId);
    this.onState(this.snapshot, this.activeWorkspaceId, this.selectedRemoteSourceId, this.selectedMembershipId);
    return this.snapshot;
  }

  selectRemoteSource(sourceInstanceId) {
    this.selectedRemoteSourceId = sourceInstanceId || null;
    this.onState(this.snapshot, this.activeWorkspaceId, this.selectedRemoteSourceId, this.selectedMembershipId);
  }

  selectMembership(membershipId) {
    this.selectedMembershipId = membershipId || null;
    this.onState(this.snapshot, this.activeWorkspaceId, this.selectedRemoteSourceId, this.selectedMembershipId);
  }

  runOnce(key, command) {
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = Promise.resolve().then(command).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  configureSync(input) {
    if (!this.activeWorkspaceId) throw new Error('Select a Workspace before configuring sync');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Sync configuration input must be an object');
    const payload = { ...input, workspaceId: this.activeWorkspaceId };
    return this.runOnce(`s7:configure:${this.activeWorkspaceId}`, async () => {
      const result = await this.bridge.configureSync(payload);
      await this.refresh(this.activeWorkspaceId);
      return result;
    });
  }

  pushPending() {
    if (!this.activeWorkspaceId) throw new Error('Select a Workspace before pushing sync envelopes');
    return this.runOnce(`s7:push:${this.activeWorkspaceId}`, async () => {
      const result = await this.bridge.pushPending({ workspaceId: this.activeWorkspaceId });
      await this.refresh(this.activeWorkspaceId);
      return result;
    });
  }

  pullMirror() {
    if (!this.activeWorkspaceId) throw new Error('Select a Workspace before pulling shared mirror');
    return this.runOnce(`s7:pull:${this.activeWorkspaceId}`, async () => {
      const result = await this.bridge.pullMirror({ workspaceId: this.activeWorkspaceId });
      await this.refresh(this.activeWorkspaceId);
      return result;
    });
  }

  recordMembership(input) {
    if (!this.activeWorkspaceId) throw new Error('Select a Workspace before recording membership');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Membership input must be an object');
    const payload = { ...input, workspaceId: this.activeWorkspaceId };
    return this.runOnce(`s7:membership:${this.activeWorkspaceId}:${payload.id || ''}`, async () => {
      const result = await this.bridge.recordMembership(payload);
      await this.refresh(this.activeWorkspaceId);
      return result;
    });
  }
}

module.exports = { METHODS, S7SyncController, assertSyncBridge };
