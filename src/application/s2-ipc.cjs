'use strict';

const { CHANNELS } = require('../preload/s2-bridge-contract.cjs');

function safeInputObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Expected an S2 object payload');
  return input;
}

function registerS2Ipc({ ipcMain, assertSender, service }) {
  if (!ipcMain?.handle || typeof assertSender !== 'function' || !service) throw new TypeError('ipcMain, assertSender and S2 service are required');
  ipcMain.handle(CHANNELS.queryState, (event, workspaceId) => {
    assertSender(event);
    return service.queryMissionState(String(workspaceId || 'workspace-a'));
  });
  const command = (channel, method) => {
    ipcMain.handle(channel, async (event, input) => {
      assertSender(event);
      const payload = safeInputObject(input);
      return service[method](payload);
    });
  };
  command(CHANNELS.createMission, 'createMission');
  command(CHANNELS.createRevision, 'createRevision');
  command(CHANNELS.startMission, 'startMission');
  command(CHANNELS.pauseMission, 'pauseMission');
  command(CHANNELS.resumeMission, 'resumeMission');
  command(CHANNELS.cancelMission, 'cancelMission');
  command(CHANNELS.retryStepAfterReview, 'retryStepAfterReview');
  command(CHANNELS.recordCheckpoint, 'recordCheckpoint');
  return CHANNELS;
}

module.exports = { registerS2Ipc, safeInputObject };
