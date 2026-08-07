'use strict';

const { CHANNELS } = require('../preload/s3-github-bridge-contract.cjs');

function safeInputObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Expected an S3 GitHub delivery object payload');
  return input;
}

function registerS3Ipc({ ipcMain, assertSender, service }) {
  if (!ipcMain?.handle || typeof assertSender !== 'function' || !service) throw new TypeError('ipcMain, assertSender and S3 service are required');
  ipcMain.handle(CHANNELS.queryState, (event, workspaceId) => {
    assertSender(event);
    return service.queryGitHubDeliveryState(String(workspaceId || 'workspace-a'));
  });
  const command = (channel, method) => {
    ipcMain.handle(channel, async (event, input) => {
      assertSender(event);
      return service[method](safeInputObject(input));
    });
  };
  command(CHANNELS.registerRepository, 'registerRepository');
  command(CHANNELS.reserveBranch, 'reserveBranch');
  command(CHANNELS.claimPaths, 'claimPaths');
  command(CHANNELS.bindPullRequest, 'bindPullRequest');
  command(CHANNELS.observeDelivery, 'observeDelivery');
  command(CHANNELS.createRepairProposal, 'createRepairProposal');
  return CHANNELS;
}

module.exports = { registerS3Ipc, safeInputObject };
