const { assertSafeIdentifier } = require('./identifiers.cjs');
const WORKER_STATUSES = Object.freeze([
  'created', 'starting', 'ready', 'idle', 'active', 'paused',
  'waiting_human', 'blocked', 'stopped', 'failed',
]);

function createWorkerRecord({ id, projectId, role, profilePath, browserChannel = 'chrome' }) {
  assertSafeIdentifier(id, 'worker id');
  assertSafeIdentifier(projectId, 'project id');
  if (!role || !profilePath) throw new TypeError('role and profilePath are required');
  if (!['controller', 'implementation', 'review'].includes(role)) {
    throw new TypeError(`Unsupported worker role: ${role}`);
  }
  if (!['chrome', 'chromium'].includes(browserChannel)) {
    throw new TypeError(`Unsupported browser channel: ${browserChannel}`);
  }
  return {
    id,
    projectId,
    role,
    profilePath,
    browserChannel,
    status: 'created',
    activeTaskId: null,
    lastKnownUrl: null,
    processId: null,
    lastHeartbeatAt: null,
  };
}

function setWorkerStatus(worker, status, updates = {}) {
  if (!WORKER_STATUSES.includes(status)) throw new TypeError(`Unsupported worker status: ${status}`);
  return {
    ...worker,
    ...updates,
    status,
    lastHeartbeatAt: updates.lastHeartbeatAt || new Date().toISOString(),
  };
}

module.exports = { WORKER_STATUSES, createWorkerRecord, setWorkerStatus };
