'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { S1_CHANNELS, registerS1Ipc } = require('../src/application/s1-ipc.cjs');

function harness() {
  const handlers = new Map();
  const calls = [];
  const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
  const service = {
    queryState(workspaceId) { calls.push(['query', workspaceId]); return { activeWorkspaceId: workspaceId }; },
    installCapability(input) { calls.push(['install', input]); return input; },
    grantCapability(input) { calls.push(['grant', input]); return input; },
    createTask(input) { calls.push(['task', input]); return input; },
    rejectHumanGate(input) { calls.push(['reject', input]); return input; },
    approveHumanGate(input) { calls.push(['approve', input]); return input; },
  };
  let senderChecks = 0;
  registerS1Ipc({ ipcMain, service, assertSender() { senderChecks += 1; } });
  return { handlers, calls, get senderChecks() { return senderChecks; } };
}

test('registers the exact six S1 IPC channels and validates every sender', async () => {
  const h = harness();
  assert.deepEqual([...h.handlers.keys()].sort(), Object.values(S1_CHANNELS).sort());
  await h.handlers.get(S1_CHANNELS.state)({}, { workspaceId: 'workspace-b' });
  await h.handlers.get(S1_CHANNELS.installCapability)({}, { workspaceId: 'workspace-a' });
  await h.handlers.get(S1_CHANNELS.grantCapability)({}, { workspaceId: 'workspace-a' });
  await h.handlers.get(S1_CHANNELS.createTask)({}, { id: 'task-a' });
  await h.handlers.get(S1_CHANNELS.rejectHumanGate)({}, { gateId: 'gate-a' });
  await h.handlers.get(S1_CHANNELS.approveHumanGate)({}, { gateId: 'gate-a' });
  assert.equal(h.senderChecks, 6);
  assert.deepEqual(h.calls.map((entry) => entry[0]), ['query', 'install', 'grant', 'task', 'reject', 'approve']);
});

test('rejects array/null command payloads before application service', () => {
  const h = harness();
  assert.throws(() => h.handlers.get(S1_CHANNELS.createTask)({}, []), /Expected an object payload/);
  assert.throws(() => h.handlers.get(S1_CHANNELS.installCapability)({}, null), /Expected an object payload/);
  assert.equal(h.calls.length, 0);
});
