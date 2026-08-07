'use strict';

const CHANNELS = Object.freeze({
  queryState: 's2:mission:query-state',
  createMission: 's2:mission:create',
  createRevision: 's2:mission:create-revision',
  startMission: 's2:mission:start',
  pauseMission: 's2:mission:pause',
  resumeMission: 's2:mission:resume',
  cancelMission: 's2:mission:cancel',
  retryStepAfterReview: 's2:mission:retry-step-after-review',
});

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('S2 command payload must be a plain object');
  return value;
}

function createS2BridgeContract(ipcRenderer) {
  if (!ipcRenderer?.invoke) throw new TypeError('ipcRenderer.invoke is required');
  return Object.freeze({
    queryState(workspaceId) { return ipcRenderer.invoke(CHANNELS.queryState, workspaceId || null); },
    createMission(input) { return ipcRenderer.invoke(CHANNELS.createMission, plainObject(input)); },
    createRevision(input) { return ipcRenderer.invoke(CHANNELS.createRevision, plainObject(input)); },
    startMission(input) { return ipcRenderer.invoke(CHANNELS.startMission, plainObject(input)); },
    pauseMission(input) { return ipcRenderer.invoke(CHANNELS.pauseMission, plainObject(input)); },
    resumeMission(input) { return ipcRenderer.invoke(CHANNELS.resumeMission, plainObject(input)); },
    cancelMission(input) { return ipcRenderer.invoke(CHANNELS.cancelMission, plainObject(input)); },
    retryStepAfterReview(input) { return ipcRenderer.invoke(CHANNELS.retryStepAfterReview, plainObject(input)); },
  });
}

module.exports = { CHANNELS, createS2BridgeContract };
