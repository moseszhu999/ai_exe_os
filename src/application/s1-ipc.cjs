'use strict';

const S1_CHANNELS = Object.freeze({
  state: 's1:state',
  installCapability: 's1:marketplace:install',
  grantCapability: 's1:agent:grant',
  createTask: 's1:task:create',
  rejectHumanGate: 's1:human-gate:reject',
  approveHumanGate: 's1:human-gate:approve',
});

function safeInputObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Expected an object payload');
  }
  return input;
}

function registerS1Ipc({ ipcMain, assertSender, service }) {
  if (!ipcMain?.handle || typeof assertSender !== 'function' || !service) {
    throw new TypeError('ipcMain, assertSender and service are required');
  }
  ipcMain.handle(S1_CHANNELS.state, (event, input = {}) => {
    assertSender(event);
    const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    return service.queryState(String(value.workspaceId || 'workspace-a'));
  });
  ipcMain.handle(S1_CHANNELS.installCapability, (event, input) => {
    assertSender(event);
    return service.installCapability(safeInputObject(input));
  });
  ipcMain.handle(S1_CHANNELS.grantCapability, (event, input) => {
    assertSender(event);
    return service.grantCapability(safeInputObject(input));
  });
  ipcMain.handle(S1_CHANNELS.createTask, (event, input) => {
    assertSender(event);
    return service.createTask(safeInputObject(input));
  });
  ipcMain.handle(S1_CHANNELS.rejectHumanGate, (event, input) => {
    assertSender(event);
    return service.rejectHumanGate(safeInputObject(input));
  });
  ipcMain.handle(S1_CHANNELS.approveHumanGate, async (event, input) => {
    assertSender(event);
    return service.approveHumanGate(safeInputObject(input));
  });
  return S1_CHANNELS;
}

module.exports = { S1_CHANNELS, registerS1Ipc, safeInputObject };
