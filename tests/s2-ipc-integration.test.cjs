'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CHANNELS } = require('../src/preload/s2-bridge-contract.cjs');
const { registerS2Ipc } = require('../src/application/s2-ipc.cjs');

function harness() {
  const handlers = new Map();
  const calls = [];
  const ipcMain = { handle(channel, handler) { if (handlers.has(channel)) throw new Error(`duplicate ${channel}`); handlers.set(channel, handler); } };
  const service = new Proxy({}, { get(_target, method) { return (input) => { calls.push({ method, input }); return { method, input }; }; } });
  let senderChecks = 0;
  const channels = registerS2Ipc({ ipcMain, assertSender() { senderChecks += 1; }, service });
  return { handlers, calls, channels, get senderChecks() { return senderChecks; } };
}

test('registers exactly nine S2 Mission channels and validates every sender', async () => {
  const h = harness();
  assert.equal(h.handlers.size, 9);
  assert.deepEqual([...h.handlers.keys()].sort(), Object.values(CHANNELS).sort());
  for (const [name, channel] of Object.entries(CHANNELS)) {
    const handler = h.handlers.get(channel);
    if (name === 'queryState') await handler({ sender: {} }, 'workspace-a');
    else await handler({ sender: {} }, { workspaceId: 'workspace-a', id: name });
  }
  assert.equal(h.senderChecks, 9);
  assert.equal(h.calls.length, 9);
  assert.equal(h.calls[0].method, 'queryMissionState');
});

test('command handlers reject null and array payloads before service invocation', async () => {
  const h = harness();
  for (const channel of Object.values(CHANNELS).filter((item) => item !== CHANNELS.queryState)) {
    await assert.rejects(() => h.handlers.get(channel)({ sender: {} }, null), /S2 object payload/);
    await assert.rejects(() => h.handlers.get(channel)({ sender: {} }, []), /S2 object payload/);
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.senderChecks, 16);
});
