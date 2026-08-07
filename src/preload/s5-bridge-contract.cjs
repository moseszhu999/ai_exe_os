'use strict';

const CHANNELS = Object.freeze({
  queryState: 's5:provider:query-state',
  bindTarget: 's5:provider:bind-target',
  observe: 's5:provider:observe',
});

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('S5 provider command payload must be a plain object');
  return value;
}

function createS5BridgeContract(ipcRenderer) {
  if (!ipcRenderer?.invoke) throw new TypeError('ipcRenderer.invoke is required');
  return Object.freeze({
    queryState(workspaceId) { return ipcRenderer.invoke(CHANNELS.queryState, workspaceId || null); },
    bindTarget(input) { return ipcRenderer.invoke(CHANNELS.bindTarget, plainObject(input)); },
    observe(input) { return ipcRenderer.invoke(CHANNELS.observe, plainObject(input)); },
  });
}

module.exports = { CHANNELS, createS5BridgeContract };
