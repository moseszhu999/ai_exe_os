'use strict';

function safeWorker(worker, workspaceId) {
  if (!worker) return null;
  return Object.freeze({
    workerId: worker.id,
    projectId: worker.projectId || null,
    workspaceId,
    role: worker.role || null,
    browserChannel: worker.browserChannel || null,
    status: worker.status || 'unknown',
    activeTaskId: worker.activeTaskId || null,
    lastKnownUrl: worker.lastKnownUrl || null,
  });
}

class WorkerSessionControlAdapter {
  constructor({ workerManager, resolveWorkspaceId }) {
    if (!workerManager || typeof workerManager.list !== 'function') throw new TypeError('workerManager is required');
    if (typeof resolveWorkspaceId !== 'function') throw new TypeError('resolveWorkspaceId is required');
    this.workerManager = workerManager;
    this.resolveWorkspaceId = resolveWorkspaceId;
  }

  requireScopedWorker({ workspaceId, workerId }) {
    if (typeof workspaceId !== 'string' || !workspaceId) throw new TypeError('workspaceId is required');
    if (typeof workerId !== 'string' || !workerId) throw new TypeError('workerId is required');
    const worker = this.workerManager.list().find((item) => item.id === workerId);
    if (!worker) throw new Error(`Unknown worker: ${workerId}`);
    const actualWorkspaceId = this.resolveWorkspaceId(workerId, worker);
    if (!actualWorkspaceId || actualWorkspaceId !== workspaceId) throw new Error('Cross-Workspace Worker control denied');
    return { worker, workspaceId: actualWorkspaceId };
  }

  capability({ workspaceId, workerId }) {
    const { worker } = this.requireScopedWorker({ workspaceId, workerId });
    return Object.freeze({
      canFocus: typeof this.workerManager.focus === 'function' && !['created', 'stopped', 'failed'].includes(worker.status),
      canStop: typeof this.workerManager.stop === 'function' && !['stopped', 'failed'].includes(worker.status),
      canPause: typeof this.workerManager.pause === 'function' && ['idle', 'active', 'waiting_human'].includes(worker.status),
      canResume: typeof this.workerManager.resume === 'function' && worker.status === 'paused',
    });
  }

  async execute(action, input) {
    const { worker, workspaceId } = this.requireScopedWorker(input || {});
    const allowed = this.capability({ workspaceId, workerId: worker.id });
    const map = {
      focus: ['canFocus', 'focus'],
      stop: ['canStop', 'stop'],
      pause: ['canPause', 'pause'],
      resume: ['canResume', 'resume'],
    };
    const selected = map[action];
    if (!selected) throw new Error(`Unsupported Worker control: ${action}`);
    const [capabilityKey, methodName] = selected;
    if (!allowed[capabilityKey] || typeof this.workerManager[methodName] !== 'function') {
      return Object.freeze({ ok: false, unavailable: true, action, worker: safeWorker(worker, workspaceId) });
    }
    await this.workerManager[methodName](worker.id);
    const fresh = this.workerManager.list().find((item) => item.id === worker.id);
    if (!fresh) throw new Error(`Worker disappeared after ${action}: ${worker.id}`);
    return Object.freeze({ ok: true, unavailable: false, action, worker: safeWorker(fresh, workspaceId) });
  }

  focus(input) { return this.execute('focus', input); }
  stop(input) { return this.execute('stop', input); }
  pause(input) { return this.execute('pause', input); }
  resume(input) { return this.execute('resume', input); }
}

module.exports = { WorkerSessionControlAdapter, safeWorker };
