'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { METHODS, S6SchedulingController, assertSchedulingBridge } = require('../src/renderer/s6/controller.cjs');
const { SURFACES, createS6SchedulingViewModel, sanitize } = require('../src/renderer/s6/view-model.cjs');

function snapshot() {
  return {
    workspaceId: 'workspace-a',
    found: true,
    policy: {
      id: 'policy-a', version: '1.0.0', globalMaxActive: 4, workspaceMaxActive: 2, sessionReuse: 'compatible-only',
      token: 'must-redact',
    },
    capacity: { globalActive: 1, workspaceActive: 1 },
    eligibleQueue: [
      { id: 'candidate-a', priority: 'high', readySince: '2026-08-08T00:00:00Z' },
      { id: 'candidate-b', priority: 'normal', readySince: '2026-08-08T00:01:00Z' },
    ],
    deferred: [{ candidateId: 'candidate-b', reasonCodes: ['workspace_capacity_exhausted'] }],
    workers: [{ workerId: 'worker-a', status: 'eligible', browserChannel: 'chrome', profilePath: '/forbidden' }],
    providerCapacity: [{ providerId: 'vercel', action: 'observe', status: 'current', activeObserved: 0, maxActive: 1 }],
    decisions: [{
      id: 'decision-a', evaluatedAt: '2026-08-08T00:05:00Z', selectedCandidateId: 'candidate-a', selectedWorkerId: 'worker-a',
      inputDigest: 'sha256:input', decisionDigest: 'sha256:decision', reasonCodes: ['selected'],
    }],
    proposals: [{ id: 'proposal-a', candidateId: 'candidate-a', workerId: 'worker-a', state: 'proposed' }],
  };
}

test('S6 view exposes all required explanation surfaces and fails closed on Workspace mismatch', () => {
  assert.deepEqual(SURFACES, [
    'Policy', 'Capacity', 'Eligible Queue', 'Selected Assignment', 'Deferred Reasons', 'Worker Compatibility', 'Provider Capacity', 'Decision Evidence',
  ]);
  const value = createS6SchedulingViewModel(snapshot(), 'workspace-a');
  assert.equal(value.found, true);
  assert.equal(value.selectedAssignment.candidateId, 'candidate-a');
  assert.equal(value.selectedProposal.id, 'proposal-a');
  const mismatch = createS6SchedulingViewModel(snapshot(), 'workspace-b');
  assert.equal(mismatch.found, false);
  assert.equal(mismatch.selectedAssignment, null);
  assert.deepEqual(mismatch.eligibleQueue, []);
});

test('scheduling view recursively redacts credentials, profile/process fields and sensitive strings', () => {
  const safe = sanitize({
    token: 'secret',
    nested: { cookie: 'session=abc', profilePath: '/Users/me/profile', pid: 1234 },
    header: 'Bearer abcdefghijklmnopqrstuvwxyz',
    normal: 'visible',
  });
  assert.equal(safe.token, '[redacted]');
  assert.equal(safe.nested.cookie, '[redacted]');
  assert.equal(safe.nested.profilePath, '[redacted]');
  assert.equal(safe.nested.pid, '[redacted]');
  assert.equal(safe.header, '[redacted]');
  assert.equal(safe.normal, 'visible');
  const vm = createS6SchedulingViewModel(snapshot(), 'workspace-a');
  assert.equal(vm.policy.token, '[redacted]');
  assert.equal(vm.workers[0].profilePath, '[redacted]');
});

test('renderer bridge contract contains bounded policy/decision/revalidation methods and no execution authority', () => {
  assert.deepEqual(METHODS, ['queryState', 'recordPolicy', 'computeDecision', 'revalidateProposal']);
  assert.throws(() => assertSchedulingBridge({ queryState() {}, recordPolicy() {}, computeDecision() {} }), /revalidateProposal/);
  const bridge = Object.fromEntries(METHODS.map((method) => [method, () => Promise.resolve({})]));
  assert.equal(assertSchedulingBridge(bridge), bridge);
  for (const forbidden of ['startWorker', 'execute', 'approveHumanGate', 'providerCall', 'retryFailed']) {
    assert.equal(Object.prototype.hasOwnProperty.call(bridge, forbidden), false);
  }
});

test('controller scopes every command to selected Workspace and collapses duplicate pending commands', async () => {
  const calls = [];
  let resolveDecision;
  const bridge = {
    queryState(workspaceId) { calls.push(['queryState', workspaceId]); return Promise.resolve(snapshot()); },
    recordPolicy(input) { calls.push(['recordPolicy', input]); return Promise.resolve({ id: input.id }); },
    computeDecision(input) {
      calls.push(['computeDecision', input]);
      return new Promise((resolve) => { resolveDecision = resolve; });
    },
    revalidateProposal(input) { calls.push(['revalidateProposal', input]); return Promise.resolve({ state: 'accepted' }); },
  };
  const controller = new S6SchedulingController({ bridge });
  await controller.refresh('workspace-a');
  await controller.recordPolicy({ id: 'policy-a', workspaceId: 'workspace-other' });
  assert.equal(calls.find(([name]) => name === 'recordPolicy')[1].workspaceId, 'workspace-a');

  const first = controller.computeDecision();
  const second = controller.computeDecision();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(typeof resolveDecision, 'function');
  resolveDecision({ id: 'decision-a' });
  await first;
  assert.equal(calls.filter(([name]) => name === 'computeDecision').length, 1);

  controller.selectProposal('proposal-a');
  await controller.revalidateProposal();
  assert.deepEqual(calls.find(([name]) => name === 'revalidateProposal')[1], { workspaceId: 'workspace-a', proposalId: 'proposal-a' });
});

test('DOM renderer is component-only and does not use unsafe innerHTML or direct execution controls', () => {
  const source = readFileSync(join(__dirname, '..', 'src', 'renderer', 's6', 'render.cjs'), 'utf8');
  assert.doesNotMatch(source, /innerHTML\s*=/);
  assert.doesNotMatch(source, /startWorker|approveHumanGate|retryFailed|providerCall/);
  assert.match(source, /compute-scheduling-decision/);
  assert.match(source, /revalidate-assignment-proposal/);
});
