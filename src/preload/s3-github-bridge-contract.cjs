'use strict';

const CHANNELS = Object.freeze({
  queryState: 's3:github:query-state',
  registerRepository: 's3:github:repository:register',
  reserveBranch: 's3:github:branch:reserve',
  claimPaths: 's3:github:paths:claim',
  bindPullRequest: 's3:github:pr:bind',
  observeDelivery: 's3:github:delivery:observe',
  createRepairProposal: 's3:github:repair:propose',
});

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('S3 GitHub delivery command payload must be a plain object');
  }
  return value;
}

function createS3GitHubBridgeContract(ipcRenderer) {
  if (!ipcRenderer?.invoke) throw new TypeError('ipcRenderer.invoke is required');
  return Object.freeze({
    queryState(workspaceId) {
      return ipcRenderer.invoke(CHANNELS.queryState, workspaceId || null);
    },
    registerRepository(input) {
      return ipcRenderer.invoke(CHANNELS.registerRepository, plainObject(input));
    },
    reserveBranch(input) {
      return ipcRenderer.invoke(CHANNELS.reserveBranch, plainObject(input));
    },
    claimPaths(input) {
      return ipcRenderer.invoke(CHANNELS.claimPaths, plainObject(input));
    },
    bindPullRequest(input) {
      return ipcRenderer.invoke(CHANNELS.bindPullRequest, plainObject(input));
    },
    observeDelivery(input) {
      return ipcRenderer.invoke(CHANNELS.observeDelivery, plainObject(input));
    },
    createRepairProposal(input) {
      return ipcRenderer.invoke(CHANNELS.createRepairProposal, plainObject(input));
    },
  });
}

module.exports = { CHANNELS, createS3GitHubBridgeContract, plainObject };
