'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { S5ApplicationService } = require('../src/application/s5-index.cjs');

class FakeWorkerManager {
  list() { return []; }
  async focus() { throw new Error('unused'); }
  async stop() { throw new Error('unused'); }
  pause() { throw new Error('unused'); }
  resume() { throw new Error('unused'); }
  async submitAuthorizedLocalTask() { throw new Error('unused'); }
}

class FakeProviderTransport {
  constructor() { this.calls = []; this.audit = []; }
  methodAudit() { return this.audit.map((item) => ({ ...item })); }
  async observe({ approvedTarget, method }) {
    this.calls.push({ approvedTarget, method });
    this.audit.push({ target: approvedTarget, method });
    return Object.freeze({
      state: 'succeeded', method, target: approvedTarget, finalTarget: approvedTarget,
      statusCode: method === 'HEAD' ? 204 : 200,
      headers: Object.freeze({ 'content-type': 'text/html', etag: `${method.toLowerCase()}-etag` }),
      redirects: Object.freeze([]), observedAt: '2026-08-07T10:00:00.000Z', failureCode: null,
    });
  }
}

function createService({ databasePath = ':memory:', transport = new FakeProviderTransport(), clock = () => '2026-08-07T10:00:00.000Z' } = {}) {
  const service = new S5ApplicationService({ databasePath, workerManager: new FakeWorkerManager(), providerTransport: transport, clock });
  return { service, transport };
}

function bind(service, provider = 'vercel', workspaceId = 'workspace-a') {
  const isVercel = provider === 'vercel';
  return service.bindProviderTarget({
    id: `binding-${provider}-${workspaceId}`,
    workspaceId,
    provider,
    adapterId: isVercel ? 'vercel.public-deployment' : 'netlify.public-deployment',
    providerContractId: isVercel ? 'provider-vercel-public' : 'provider-netlify-public',
    action: 'observe_public_deployment',
    exactTarget: isVercel ? 'https://example.vercel.app/' : 'https://example.netlify.app/',
  });
}

test('S5 seeds accepted Vercel/Netlify read-only provider authority and exact Workspace bindings', () => {
  const { service } = createService();
  const state = service.queryProviderState('workspace-a');
  assert.deepEqual(state.adapters.map((item) => item.id).sort(), ['netlify.public-deployment', 'vercel.public-deployment']);
  assert.deepEqual(state.contracts.map((item) => item.id).sort(), ['provider-netlify-public', 'provider-vercel-public']);
  const vercel = bind(service, 'vercel');
  const netlify = bind(service, 'netlify');
  assert.equal(vercel.exactTarget, 'https://example.vercel.app/');
  assert.equal(netlify.exactTarget, 'https://example.netlify.app/');
  assert.deepEqual(service.queryProviderState('workspace-b').bindings, []);
  assert.throws(() => service.requireS5Binding('workspace-b', vercel.id), /Cross-Workspace/);
  service.close();
});

test('provider and exact-target mismatch fail before provider transport', () => {
  const { service, transport } = createService();
  assert.throws(() => service.bindProviderTarget({
    id: 'bad-adapter', workspaceId: 'workspace-a', provider: 'vercel', adapterId: 'netlify.public-deployment',
    providerContractId: 'provider-vercel-public', exactTarget: 'https://example.vercel.app/',
  }), /mismatched/);
  assert.throws(() => service.bindProviderTarget({
    id: 'bad-target', workspaceId: 'workspace-a', provider: 'vercel', adapterId: 'vercel.public-deployment',
    providerContractId: 'provider-vercel-public', exactTarget: 'https://example.netlify.app/',
  }), /Vercel/);
  assert.equal(transport.calls.length, 0);
  service.close();
});

test('same completed observation id returns canonical evidence without second network request', async () => {
  const { service, transport } = createService();
  const binding = bind(service, 'vercel');
  const first = await service.observeProvider({ id: 'provider-observation-1', workspaceId: 'workspace-a', bindingId: binding.id, method: 'HEAD' });
  const second = await service.observeProvider({ id: 'provider-observation-1', workspaceId: 'workspace-a', bindingId: binding.id, method: 'HEAD' });
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(transport.calls.length, 1);
  assert.equal(first.observation.evidenceDigest, second.observation.evidenceDigest);
  assert.throws(() => service.observeProvider({ id: 'provider-observation-1', workspaceId: 'workspace-a', bindingId: binding.id, method: 'GET' }), /idempotency collision/);
  assert.equal(transport.calls.length, 1);
  service.close();
});

test('canonical provider evidence is body-free and visible through S4 cockpit composition', async () => {
  const { service } = createService();
  const binding = bind(service, 'netlify');
  const result = await service.observeProvider({ id: 'provider-observation-2', workspaceId: 'workspace-a', bindingId: binding.id });
  const state = service.queryProviderState('workspace-a');
  assert.equal(state.observations.length, 1);
  assert.equal(state.methodAudit.length, 1);
  const cockpit = service.queryOperatorCockpit('workspace-a');
  assert.equal(cockpit.providerAdapters.observations[0].id, result.observation.id);
  const raw = JSON.stringify(cockpit.providerAdapters);
  assert.doesNotMatch(raw, /responseBody|Bearer|Set-Cookie|password|profilePath|processId/);
  const eventTypes = service.store.listEvents().map((item) => item.eventType);
  assert.ok(eventTypes.includes('provider.target_bound'));
  assert.ok(eventTypes.includes('provider.observation_requested'));
  assert.ok(eventTypes.includes('provider.observation_recorded'));
  service.close();
});

test('SQLite restart rehydrates provider state and same observation id with zero network replay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ai-exe-s5-'));
  const databasePath = join(root, 'state.sqlite');
  try {
    const firstTransport = new FakeProviderTransport();
    const first = createService({ databasePath, transport: firstTransport }).service;
    const binding = bind(first, 'vercel');
    await first.observeProvider({ id: 'restart-observation', workspaceId: 'workspace-a', bindingId: binding.id });
    assert.equal(firstTransport.calls.length, 1);
    const digest = first.store.projectionDigest({ workspaceId: 'workspace-a' });
    first.close();

    const secondTransport = new FakeProviderTransport();
    const second = createService({ databasePath, transport: secondTransport, clock: () => '2026-08-07T10:01:00.000Z' }).service;
    assert.equal(second.queryProviderState('workspace-a').observations.length, 1);
    assert.equal(secondTransport.calls.length, 0);
    const replay = await second.observeProvider({ id: 'restart-observation', workspaceId: 'workspace-a', bindingId: binding.id });
    assert.equal(replay.replayed, true);
    assert.equal(secondTransport.calls.length, 0);
    assert.equal(second.store.projectionDigest({ workspaceId: 'workspace-a' }), digest);
    second.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unknown Workspace is fail-closed in provider state and inherited cockpit', () => {
  const { service } = createService();
  assert.equal(service.queryProviderState('workspace-missing').found, false);
  const cockpit = service.queryOperatorCockpit('workspace-missing');
  assert.equal(cockpit.found, false);
  assert.equal(cockpit.providerAdapters.found, false);
  service.close();
});
