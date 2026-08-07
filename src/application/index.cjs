'use strict';

const base = require('./s1-application-service.cjs');

class S1ApplicationService extends base.S1ApplicationService {
  constructor(options = {}) {
    super(options);
    const targetUrl = new URL(options.localTarget || base.LOCAL_TARGET);
    if (targetUrl.protocol !== 'http:' || targetUrl.hostname !== '127.0.0.1') {
      throw new Error('S1 local target must be project-owned loopback');
    }
    this.localTarget = targetUrl.href;

    const request = this.coordinator.request.bind(this.coordinator);
    this.coordinator.request = (input) => {
      const selectedWorkerId = input.workerId;
      const workerBinding = this.workerBinding.get(selectedWorkerId);
      const liveWorker = this.workerManager.list().find((candidate) => candidate.id === selectedWorkerId) || null;
      const authorizationReady = input.workspace?.status === 'active'
        && input.agent?.status === 'active'
        && input.installation?.status === 'installed'
        && input.grant?.status === 'active'
        && input.grant.allowedActions?.includes(input.task?.capabilityAction)
        && input.grant.allowedTargets?.includes(input.task?.target)
        && input.providerSnapshot?.status === 'accepted'
        && input.dependenciesReady !== false;
      if (authorizationReady && (workerBinding?.workspaceId !== input.workspace.id || liveWorker?.status !== 'idle')) {
        const blockers = Object.freeze([{
          code: 'resource_conflict',
          detail: { reason: 'worker_unavailable', workerId: selectedWorkerId },
        }]);
        const run = this.executionRun.save({
          id: input.executionRunId,
          workspaceId: input.workspace.id,
          taskId: input.task.id,
          workerId: selectedWorkerId,
          state: 'blocked',
          blockers,
          requestedAt: this.clock(),
        }, 'execution.blocked');
        this.events.append({
          type: 'execution.blocked',
          idempotencyKey: `blocked:${run.id}`,
          runId: run.id,
          blockers,
        });
        return Object.freeze({ created: true, run, gate: null });
      }
      return request(input);
    };
  }

  grantCapability(input) {
    return super.grantCapability({
      ...input,
      allowedTargets: input.allowedTargets || [this.localTarget],
    });
  }

  createTask(input) {
    return super.createTask({
      ...input,
      target: input.target || this.localTarget,
    });
  }

  queryState(workspaceId) {
    return Object.freeze({
      ...super.queryState(workspaceId),
      localTarget: this.localTarget,
    });
  }
}

module.exports = {
  ...base,
  S1ApplicationService,
};
