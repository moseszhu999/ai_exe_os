'use strict';

class S1UiController {
  constructor({ bridge, onState = () => {} }) {
    if (!bridge?.queryState) throw new TypeError('S1 bridge is required');
    this.bridge = bridge;
    this.onState = onState;
    this.activeWorkspaceId = null;
    this.pending = new Map();
    this.state = null;
  }

  async refresh(workspaceId = this.activeWorkspaceId) {
    this.activeWorkspaceId = workspaceId || null;
    this.state = await this.bridge.queryState(this.activeWorkspaceId);
    this.onState(this.state, this.activeWorkspaceId);
    return this.state;
  }

  runOnce(key, command) {
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = Promise.resolve().then(command).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  installCapability(input) {
    return this.runOnce(`install:${input.workspaceId}:${input.packageId}:${input.version}`, async () => {
      const result = await this.bridge.installCapability(input);
      await this.refresh(input.workspaceId);
      return result;
    });
  }

  grantCapability(input) {
    return this.runOnce(`grant:${input.workspaceId}:${input.agentId}:${input.installationId}`, async () => {
      const result = await this.bridge.grantCapability(input);
      await this.refresh(input.workspaceId);
      return result;
    });
  }

  createTask(input) {
    return this.runOnce(`task:${input.workspaceId}:${input.id}`, async () => {
      const result = await this.bridge.createTask(input);
      await this.refresh(input.workspaceId);
      return result;
    });
  }

  rejectHumanGate(input) {
    return this.runOnce(`gate-reject:${input.gateId}`, async () => {
      const result = await this.bridge.rejectHumanGate(input);
      await this.refresh(input.workspaceId);
      return result;
    });
  }

  approveHumanGate(input) {
    return this.runOnce(`gate-approve:${input.gateId}`, async () => {
      const result = await this.bridge.approveHumanGate(input);
      await this.refresh(input.workspaceId);
      return result;
    });
  }

  isPending(key) {
    return this.pending.has(key);
  }
}

module.exports = { S1UiController };
