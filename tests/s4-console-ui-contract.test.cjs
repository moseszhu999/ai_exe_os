'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { S4_CONSOLE_METHODS, assertS4ConsoleBridge } = require('../src/renderer/s4/bridge-contract.cjs');
const { createS4CockpitViewModel, SURFACES } = require('../src/renderer/s4/view-model.cjs');
const { S4CockpitController } = require('../src/renderer/s4/controller.cjs');

function snapshot() {
  return {
    workspaceId: 'workspace-a', found: true, workspace: { id: 'workspace-a' },
    missions: [{ runId: 'run-a', title: 'Mission A', state: 'running' }],
    workers: [{ workerId: 'worker-a', status: 'idle', browserChannel: 'chrome', profilePath: '/secret/profile', processId: 123, controls: { canFocus: true, canStop: true, canPause: true, canResume: false } }],
    humanGates: [{ id: 'gate-a', state: 'requested', token: 'secret-token' }],
    attention: [{ id: 'attention-a', code: 'waiting_human', aggregateId: 'attempt-a', provenanceAvailable: false }],
    github: { repositories: [], pullRequests: [], deliveryGates: [{ id: 'delivery-a', state: 'blocked' }], deliveryEvidence: [] },
    evidence: [{ id: 'evidence-a', type: 'local' }], events: [], projects: [], agents: [], installations: [], providerSnapshots: [],
  };
}

test('component bridge contract has exactly five bounded local methods', () => {
  assert.deepEqual(S4_CONSOLE_METHODS, ['query', 'focusWorker', 'stopWorker', 'pauseWorker', 'resumeWorker']);
  const bridge = Object.fromEntries(S4_CONSOLE_METHODS.map((name) => [name, async () => null]));
  assert.equal(assertS4ConsoleBridge(bridge), bridge);
  assert.throws(() => assertS4ConsoleBridge({ query() {} }), /missing focusWorker/);
});

test('view model fails closed for unknown explicit Workspace and exposes all nine surfaces', () => {
  const missing = createS4CockpitViewModel(snapshot(), 'workspace-b');
  assert.equal(missing.found, false);
  assert.deepEqual(missing.workers, []);
  assert.equal(SURFACES.length, 9);
  for (const name of ['Cockpit / Overview', 'Workers & Sessions', 'Human Gate Inbox', 'GitHub Delivery', 'Evidence & Event Lineage']) assert.ok(SURFACES.includes(name));
});

test('view model recursively redacts secret/profile/process fields and derives selected-worker controls', () => {
  const vm = createS4CockpitViewModel(snapshot(), 'workspace-a', 'worker-a');
  assert.equal(vm.found, true);
  assert.equal(vm.selectedWorker.workerId, 'worker-a');
  assert.equal(vm.selectedWorker.profilePath, '[redacted]');
  assert.equal(vm.selectedWorker.processId, '[redacted]');
  assert.equal(vm.humanGates[0].token, '[redacted]');
  assert.equal(vm.controls.canStop, true);
  assert.equal(vm.controls.canResume, false);
});

test('controller collapses repeated selected-worker control while pending and refreshes authoritative state', async () => {
  const calls = [];
  let queryCount = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const bridge = {
    async query(workspaceId) { queryCount += 1; return { ...snapshot(), workspaceId }; },
    async focusWorker(input) { calls.push(['focusWorker', input]); return {}; },
    async stopWorker(input) { calls.push(['stopWorker', input]); await gate; return {}; },
    async pauseWorker(input) { calls.push(['pauseWorker', input]); return {}; },
    async resumeWorker(input) { calls.push(['resumeWorker', input]); return {}; },
  };
  const controller = new S4CockpitController({ bridge });
  await controller.refresh('workspace-a', 'worker-a');
  const first = controller.stopWorker();
  const second = controller.stopWorker();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls.filter(([name]) => name === 'stopWorker').length, 1);
  release();
  await first;
  assert.equal(queryCount, 2);
});

test('component renderer is DOM-safe, Node-free, SQLite-free and contains no provider-write controls', () => {
  const source = readFileSync(join(__dirname, '..', 'src/renderer/s4/render.cjs'), 'utf8');
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|document\.write|node:sqlite|DatabaseSync|state\.sqlite/);
  assert.doesNotMatch(source, /mergePullRequest|createComment|submitReview|workflowDispatch|deleteBranch|updatePullRequest/);
  assert.match(source, /textContent/);
  assert.match(source, /Stop selected Worker/);
  assert.match(source, /GitHub provider mode: READ-ONLY/);
});
