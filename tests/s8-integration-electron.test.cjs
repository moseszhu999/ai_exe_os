'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { S7ApplicationService } = require('../src/application/s7-index.cjs');
const { S8ApplicationService } = require('../src/application/s8-index.cjs');
const { CHANNELS, registerS8Ipc } = require('../src/application/s8-ipc.cjs');

function source(path) { return readFileSync(join(__dirname, '..', path), 'utf8'); }

class FakeIpcMain {
  constructor() { this.handlers = new Map(); }
  handle(channel, fn) { if (this.handlers.has(channel)) throw new Error(`duplicate ${channel}`); this.handlers.set(channel, fn); }
}

test('S8 application preserves the accepted S7 service chain', () => {
  assert.equal(S8ApplicationService.prototype instanceof S7ApplicationService, true);
});

test('S8 IPC exposes only bounded delegation operations', async () => {
  const ipcMain = new FakeIpcMain();
  const calls = [];
  const service = {
    queryDelegationState: (workspaceId) => ({ workspaceId }),
    recordPeerBinding: (input) => calls.push(['peer', input]),
    recordDelegationPolicy: (input) => calls.push(['policy', input]),
    createDelegationRequest: (input) => calls.push(['request', input]),
    pushDelegationRequest: async (input) => calls.push(['push', input]),
    pullDelegationInbox: async (input) => calls.push(['inbox', input]),
    approveDelegationProposal: (input) => calls.push(['approve-local', input]),
    rejectDelegationProposal: (input) => calls.push(['reject-local', input]),
    proposeDelegationCancellation: async (input) => calls.push(['cancel', input]),
    resolveDelegationCancellation: (input) => calls.push(['resolve-cancel-local', input]),
    pullDelegationReceipts: async (input) => calls.push(['receipts', input]),
    consumeDelegationReceipt: (input) => calls.push(['consume-local', input]),
  };
  registerS8Ipc({ ipcMain, assertSender: () => true, service });
  assert.deepEqual([...ipcMain.handlers.keys()], [...CHANNELS]);
  assert.equal(CHANNELS.some((channel) => /worker:(start|stop|focus|pause|resume)|human-gate:(approve|reject)|provider:write/i.test(channel)), false);
  const event = {};
  await ipcMain.handlers.get('s8:delegation:proposal:approve-local')(event, { workspaceId: 'workspace-a', proposalId: 'proposal-1' });
  assert.deepEqual(calls.at(-1), ['approve-local', { workspaceId: 'workspace-a', proposalId: 'proposal-1' }]);
});

test('S8 preload bridge is bounded and contains no remote Worker or generic fetch surface', () => {
  const preload = source('src/preload/index.cjs');
  assert.match(preload, /s8:\s*Object\.freeze\(\{ delegation: s8Delegation \}\)/);
  for (const method of ['queryState','recordPeerBinding','recordDelegationPolicy','createDelegationRequest','pushDelegationRequest','pullDelegationInbox','approveDelegationProposal','rejectDelegationProposal','proposeDelegationCancellation','resolveDelegationCancellation','pullDelegationReceipts','consumeDelegationReceipt']) {
    assert.match(preload, new RegExp(`${method}:`));
  }
  const block = preload.slice(preload.indexOf('const s8Delegation'), preload.indexOf("contextBridge.exposeInMainWorld"));
  assert.doesNotMatch(block, /startWorker|stopWorker|focusWorker|pauseWorker|resumeWorker|approveHumanGate|rejectHumanGate|fetch\(|arbitrary/i);
  assert.doesNotMatch(block, /Authorization|Cookie|profilePath|userDataDir|processId|pid/);
});

test('S8 main composition configures delegation endpoint outside renderer and preserves all prior services', () => {
  const main = source('src/main/main.cjs');
  assert.match(main, /S8ApplicationService: S1ApplicationService/);
  assert.match(main, /registerS8Ipc/);
  assert.match(main, /AI_EXE_OS_DELEGATION_ENDPOINT/);
  assert.match(main, /AI_EXE_OS_DELEGATION_ALLOW_LOOPBACK/);
  assert.match(main, /delegationEndpoint: delegation\.endpoint/);
  assert.match(main, /delegationTransport: delegation\.transport/);
  assert.match(main, /S8 application service must preserve the accepted S7 public service chain/);
});

test('S8 integrated renderer explains destination sovereignty and exposes no remote Worker controls', () => {
  const renderer = source('src/renderer/s8-integrated.js');
  assert.doesNotMatch(renderer, /innerHTML\s*=|outerHTML\s*=|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(renderer, /bridge\.(startWorker|stopWorker|focusWorker|pauseWorker|resumeWorker|approveHumanGate|rejectHumanGate)/);
  assert.match(renderer, /destination remains sovereign/);
  assert.match(renderer, /Remote source cannot decide this gate/);
  assert.match(renderer, /Actual execution remains under this destination instance’s S6\/S2\/S1 scheduler/);
  assert.match(renderer, /Post-start remote cancellation is non-authoritative/);
  assert.match(renderer, /consumeDelegationReceipt/);
});
