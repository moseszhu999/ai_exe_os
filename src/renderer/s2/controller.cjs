'use strict';

class S2MissionController {
  constructor({ bridge, onState = () => {} }) {
    if (!bridge?.queryState) throw new TypeError('S2 Mission bridge is required');
    this.bridge = bridge;
    this.onState = onState;
    this.activeWorkspaceId = null;
    this.selectedMissionId = null;
    this.pending = new Map();
    this.state = null;
  }

  async refresh(workspaceId = this.activeWorkspaceId, missionId = this.selectedMissionId) {
    this.activeWorkspaceId = workspaceId || null;
    this.selectedMissionId = missionId || null;
    this.state = await this.bridge.queryState(this.activeWorkspaceId);
    this.onState(this.state, this.activeWorkspaceId, this.selectedMissionId);
    return this.state;
  }

  runOnce(key, command) {
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = Promise.resolve().then(command).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  command(name, input, key = `${name}:${input.workspaceId}:${input.missionId || input.id || input.runId || ''}`) {
    if (typeof this.bridge[name] !== 'function') throw new Error(`Unsupported S2 Mission command: ${name}`);
    return this.runOnce(key, async () => {
      const result = await this.bridge[name](input);
      await this.refresh(input.workspaceId, input.missionId || this.selectedMissionId || result?.missionId || result?.id);
      return result;
    });
  }

  createMission(input) { return this.command('createMission', input, `mission-create:${input.workspaceId}:${input.id}`); }
  createRevision(input) { return this.command('createRevision', input, `mission-revision:${input.workspaceId}:${input.missionId}:${input.revision}`); }
  startMission(input) { return this.command('startMission', input, `mission-start:${input.runId || input.missionId}`); }
  pauseMission(input) { return this.command('pauseMission', input, `mission-pause:${input.runId}`); }
  resumeMission(input) { return this.command('resumeMission', input, `mission-resume:${input.runId}`); }
  cancelMission(input) { return this.command('cancelMission', input, `mission-cancel:${input.runId}`); }
  retryStepAfterReview(input) { return this.command('retryStepAfterReview', input, `mission-retry:${input.previousAttemptId}`); }
  isPending(key) { return this.pending.has(key); }
}

module.exports = { S2MissionController };
