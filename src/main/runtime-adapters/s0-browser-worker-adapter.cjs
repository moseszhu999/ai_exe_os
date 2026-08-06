'use strict';

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
    return this.workerManager.submitAuthorizedLocalTask({
      workerId: String(workerId),
      taskId: String(taskId),
      payload: String(payload || ''),
    });
  }
}

module.exports = { S0BrowserWorkerAdapter };
