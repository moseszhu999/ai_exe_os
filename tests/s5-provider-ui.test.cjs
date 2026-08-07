'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { CHANNELS, createS5BridgeContract } = require('../src/preload/s5-bridge-contract.cjs');
const { S5ProviderController } = require('../src/renderer/s5/controller.cjs');
const { createS5ProviderViewModel, sanitize, SURFACES } = require('../src/renderer/s5/view-model.cjs');

function snapshot() {
  return {
    workspaceId: 'workspace-a', found: true,
    adapters: [
      { id: 'vercel.public-deployment', provider: 'vercel', version: '1.0.0', action: 'observe_public_deployment' },
      { id: 'netlify.public-deployment', provider: 'netlify', version: '1.0.0', action: 'observe_public_deployment' },
    ],
    contracts: [{ id: 'provider-vercel-public', providerId: 'vercel', status: 'accepted', token: 'must-redact' }],
    bindings: [
      { id: 'binding-a', workspaceId: 'workspace-a', provider: 'vercel', providerContractId: 'provider-vercel-public', action: 'observe_public_deployment', exactTarget: 'https://alpha.vercel.app/', status: 'active' },
      { id: 'binding-b', workspaceId: 'workspace-a', provider: 'netlify', providerContractId: 'provider-netlify-public', action: 'observe_public_deployment', exactTarget: 'https://beta.netlify.app/', status: 'active' },
    ],
    observations: [
      { id: 'obs-old', bindingId: 'binding-a', workspaceId: 'workspace-a', state: 'failed', method: 'GET', observedAt: '2026-08-06T00:00:00Z', failureCode: 'network_failure' },
      { id: 'obs-new', bindingId: 'binding-a', workspaceId: 'workspace-a', state: 'succeeded', method: 'HEAD', observedAt: '2026-08-07T00:00:00Z', statusCode: 200, evidenceDigest: 'sha256:abc', body: '<forbidden>' },
    ],
  };
}

test('preload component bridge exposes exactly three explicit provider channels', async () => {
  const calls = [];
  const bridge = createS5BridgeContract({ invoke(channel, payload) { calls.push([channel, payload]); return Promise.resolve(payload); } });
  assert.deepEqual(Object.keys(CHANNELS).sort(), ['bindTarget', 'observe', 'queryState']);
  assert.deepEqual(Object.keys(bridge).sort(), ['bindTarget', 'observe', 'queryState']);
  await bridge.queryState('workspace-a');
  await bridge.bindTarget({ id: 'binding-a' });
  await bridge.observe({ workspaceId: 'workspace-a', bindingId: 'binding-a' });
  assert.deepEqual(calls.map(([channel]) => channel), [
    's5:provider:query-state', 's5:provider:bind-target', 's5:provider:observe',
  ]);
  assert.throws(() => bridge.observe(null), /plain object/);
});

test('view model fails closed for unknown Workspace and exposes all provider surfaces', () => {
  const missing = createS5ProviderViewModel(snapshot(), 'workspace-b');
  assert.equal(missing.found, false);
  assert.deepEqual(missing.bindings, []);
  assert.deepEqual(missing.observations, []);
  assert.deepEqual(missing.surfaces, SURFACES);
});

test('view model redacts credential/body/profile/process fields and selects latest canonical observation', () => {
  const vm = createS5ProviderViewModel(snapshot(), 'workspace-a', 'binding-a');
  assert.equal(vm.found, true);
  assert.equal(vm.selectedBinding.id, 'binding-a');
  assert.equal(vm.latestObservation.id, 'obs-new');
  assert.equal(vm.contracts[0].token, '[redacted]');
  assert.equal(vm.latestObservation.body, '[redacted]');
  const safe = sanitize({ nested: { authorization: 'Bearer abcdefghijklmnop', profilePath: '/secret', pid: 12 }, generic: 'Bearer abcdefghijklmnop' });
  assert.equal(safe.nested.authorization, '[redacted]');
  assert.equal(safe.nested.profilePath, '[redacted]');
  assert.equal(safe.nested.pid, '[redacted]');
  assert.equal(safe.generic, '[redacted]');
});

test('controller collapses repeated observation commands and refreshes authoritative state', async () => {
  let observeCalls = 0;
  let queryCalls = 0;
  let resolveObserve;
  const pending = new Promise((resolve) => { resolveObserve = resolve; });
  const bridge = {
    async queryState(workspaceId) { queryCalls += 1; return { ...snapshot(), workspaceId }; },
    async bindTarget(input) { return input; },
    async observe(input) { observeCalls += 1; await pending; return { ok: true, ...input }; },
  };
  const controller = new S5ProviderController({ bridge });
  await controller.refresh('workspace-a', 'binding-a');
  const first = controller.observe('binding-a');
  const second = controller.observe('binding-a');
  assert.equal(first, second);
  assert.equal(observeCalls, 0);
  await Promise.resolve();
  assert.equal(observeCalls, 1);
  resolveObserve();
  await first;
  assert.equal(observeCalls, 1);
  assert.equal(queryCalls, 2);
});

test('component renderer source is DOM-safe and contains no arbitrary fetch/body/write controls', () => {
  const source = readFileSync(join(__dirname, '..', 'src', 'renderer', 's5', 'render.cjs'), 'utf8');
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(source, /\bfetch\s*\(|node:sqlite|better-sqlite|require\(['"]electron['"]\)/);
  assert.doesNotMatch(source, /deploy|promote|rollback|merge pull request|POST|PUT|PATCH|DELETE/i);
  assert.doesNotMatch(source, /type\s*=\s*['"](?:text|url)['"]/i);
  assert.match(source, /Observe selected approved target/);
});
