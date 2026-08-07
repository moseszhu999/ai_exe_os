'use strict';

const { assertS4ConsoleBridge } = require('./bridge-contract.cjs');

class S4CockpitController {
  constructor({ bridge, onState = () => {} }) {
    this.bridge = assertS4ConsoleBridge(bridge);
    this.onState = onState;
    this.activeWorkspaceId = null;
    this.selectedWorkerId = null;
    this.pending = new Map();
    this.snapshot = null;
  }

  async refresh(workspaceId = this.activeWorkspaceId, workerId = this.selectedWorkerId) {
    this.activeWorkspaceId = workspaceId || null;
    this.selectedWorkerId = workerId || null;
    this.snapshot = await this.bridge.query(this.activeWorkspaceId);
    this.onState(this.snapshot, this.activeWorkspaceId, this.selectedWorkerId);
    return this.snapshot;
  }

  selectWorker(workerId) {
    this.selectedWorkerId = workerId || null;
    this.onState(this.snapshot, this.activeWorkspaceId, this.selectedWorkerId);
  }

  runOnce(key, command) {
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = Promise.resolve().then(command).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  control(name, workerId = this.selectedWorkerId) {
    if (!this.activeWorkspaceId) throw new Error('Select a Workspace before controlling a Worker');
    if (!workerId) throw new Error('Select a Worker before controlling it');
    if (!['focusWorker', 'stopWorker', 'pauseWorker', 'resumeWorker'].includes(name)) throw new Error(`Unsupported S4 control: ${name}`);
    return this.runOnce(`s4:${name}:${this.activeWorkspaceId}:${workerId}`, async () => {
      const result = await this.bridge[name]({ workspaceId: this.activeWorkspaceId, workerId });
      await this.refresh(this.activeWorkspaceId, workerId);
      return result;
    });
  }

  focusWorker(workerId) { return this.control('focusWorker', workerId); }
  stopWorker(workerId) { return this.control('stopWorker', workerId); }
  pauseWorker(workerId) { return this.control('pauseWorker', workerId); }
  resumeWorker(workerId) { return this.control('resumeWorker', workerId); }
}

module.exports = { S4CockpitController };
