'use strict';

const QUERY_CHANNELS = Object.freeze({ state: 's1:state' });
const COMMAND_CHANNELS = Object.freeze({
  installCapability: 's1:marketplace:install',
  grantCapability: 's1:agent:grant',
  createTask: 's1:task:create',
  rejectHumanGate: 's1:human-gate:reject',
  approveHumanGate: 's1:human-gate:approve',
});

function createS1Bridge(invoke) {
  if (typeof invoke !== 'function') throw new TypeError('IPC invoke function is required');
  return Object.freeze({
    queryState: (workspaceId) => invoke(QUERY_CHANNELS.state, { workspaceId }),
    installCapability: (input) => invoke(COMMAND_CHANNELS.installCapability, input),
    grantCapability: (input) => invoke(COMMAND_CHANNELS.grantCapability, input),
    createTask: (input) => invoke(COMMAND_CHANNELS.createTask, input),
    rejectHumanGate: (input) => invoke(COMMAND_CHANNELS.rejectHumanGate, input),
    approveHumanGate: (input) => invoke(COMMAND_CHANNELS.approveHumanGate, input),
  });
}

function assertS1Bridge(bridge) {
  for (const name of ['queryState', ...Object.keys(COMMAND_CHANNELS)]) {
    if (typeof bridge?.[name] !== 'function') throw new TypeError(`Missing S1 bridge method: ${name}`);
  }
  return bridge;
}

module.exports = { COMMAND_CHANNELS, QUERY_CHANNELS, assertS1Bridge, createS1Bridge };
