'use strict';

function safeWorkerSummary(worker) {
  if (!worker || typeof worker !== 'object') return null;
  return Object.freeze({
    id: String(worker.id || ''),
    projectId: String(worker.projectId || ''),
    role: String(worker.role || ''),
    browserChannel: String(worker.browserChannel || ''),
    status: String(worker.status || ''),
    activeTaskId: worker.activeTaskId === null || worker.activeTaskId === undefined
      ? null
      : String(worker.activeTaskId),
    lastKnownUrl: worker.lastKnownUrl === null || worker.lastKnownUrl === undefined
      ? null
      : String(worker.lastKnownUrl),
  });
}

class S0BrowserWorkerAdapter {
  constructor({ workerManager }) {
    if (!workerManager?.submitAuthorizedLocalTask) throw new TypeError('S0 BrowserWorkerManager is required');
    this.workerManager = workerManager;
  }

  async execute({ workerId, taskId, capabilityAction, target, payload }) {
    if (capabilityAction !== 'submit_payload') throw new Error('Unsupported local capability action');
    const url = new URL(target);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
      throw new Error('S1 local capability target must be project-owned loopback');
    }
    const execution = await this.workerManager.submitAuthorizedLocalTask({
      workerId: String(workerId),
      taskId: String(taskId),
      payload: String(payload || ''),
    });
    return Object.freeze({
      worker: safeWorkerSummary(execution?.worker),
      result: execution?.result ?? null,
    });
  }
}

module.exports = { S0BrowserWorkerAdapter, safeWorkerSummary };
