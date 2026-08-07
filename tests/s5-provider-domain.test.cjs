'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProviderContractSnapshot } = require('../src/domain/provider-contract-snapshot.cjs');
const {
  assertProviderObservationAllowed,
  assertSafeExternalTarget,
  assertSameWorkspace,
  createProviderAdapterDefinition,
  createProviderObservation,
  createProviderTargetBinding,
  sameBindingIntent,
} = require('../src/provider-adapters/domain/index.cjs');

function adapter() {
  return createProviderAdapterDefinition({
    id: 'vercel.public-deployment', provider: 'vercel', version: '1.0.0', status: 'available',
    actions: [{ id: 'observe_public_deployment', methods: ['GET', 'HEAD'], responseBodyPolicy: 'none', actionClass: 'READ_ONLY' }],
  });
}

function binding() {
  return createProviderTargetBinding({
    id: 'binding-vercel-a', workspaceId: 'workspace-a', provider: 'vercel', adapterId: 'vercel.public-deployment',
    providerContractId: 'provider-vercel-public', action: 'observe_public_deployment', exactTarget: 'https://example.vercel.app/',
  });
}

function snapshot(overrides = {}) {
  return {
    id: 'provider-vercel-public',
    ...createProviderContractSnapshot({
      contractId: 'provider-vercel-public', providerId: 'vercel', surfaceId: 'public-deployment', status: 'accepted',
      reviewedAt: '2026-08-01T00:00:00.000Z', expiresAt: '2030-01-01T00:00:00.000Z',
      governingTermsDigest: `sha256:${'b'.repeat(64)}`, permittedActions: ['observe_public_deployment'], prohibitedActions: [],
      ...overrides,
    }),
  };
}

test('adapter definition is immutable, read-only and body-free', () => {
  const value = adapter();
  assert.equal(value.provider, 'vercel');
  assert.deepEqual(value.actions[0].methods, ['GET', 'HEAD']);
  assert.equal(value.actions[0].actionClass, 'READ_ONLY');
  assert.equal(value.actions[0].responseBodyPolicy, 'none');
  assert.match(value.definitionDigest, /^sha256:[a-f0-9]{64}$/);
  assert.throws(() => createProviderAdapterDefinition({
    id: 'bad', provider: 'vercel', version: '1', actions: [{ id: 'write', methods: ['POST'], responseBodyPolicy: 'none', actionClass: 'READ_ONLY' }],
  }), /GET or HEAD/);
  assert.throws(() => createProviderAdapterDefinition({
    id: 'bad2', provider: 'vercel', version: '1', actions: [{ id: 'observe', methods: ['GET'], responseBodyPolicy: 'json', actionClass: 'READ_ONLY' }],
  }), /body policy/);
});

test('exact external target rejects insecure, credentialed and private destinations', () => {
  assert.equal(assertSafeExternalTarget('https://example.vercel.app/'), 'https://example.vercel.app/');
  for (const target of [
    'http://example.vercel.app/',
    'https://user:pass@example.vercel.app/',
    'https://127.0.0.1/',
    'https://10.0.0.1/',
    'https://169.254.1.1/',
    'https://[::1]/',
    'https://localhost/',
    'https://example.vercel.app/#secret',
    'https://example.vercel.app:444/',
  ]) assert.throws(() => assertSafeExternalTarget(target));
});

test('target binding semantic intent is stable and exact target is canonicalized', () => {
  const first = binding();
  const same = createProviderTargetBinding({ ...first, exactTarget: 'https://example.vercel.app/' });
  const changed = createProviderTargetBinding({ ...first, exactTarget: 'https://other.vercel.app/' });
  assert.equal(first.exactTarget, 'https://example.vercel.app/');
  assert.equal(sameBindingIntent(first, same), true);
  assert.equal(sameBindingIntent(first, changed), false);
});

test('provider observation authorization requires exact accepted contract/action/provider/method/target', () => {
  const allowed = assertProviderObservationAllowed({ binding: binding(), adapter: adapter(), snapshot: snapshot(), method: 'HEAD', now: new Date('2026-08-07T00:00:00Z') });
  assert.equal(allowed.method, 'HEAD');
  assert.equal(allowed.target, 'https://example.vercel.app/');
  assert.throws(() => assertProviderObservationAllowed({ binding: binding(), adapter: adapter(), snapshot: snapshot(), method: 'POST' }), /method/);
  assert.throws(() => assertProviderObservationAllowed({ binding: binding(), adapter: adapter(), snapshot: snapshot(), target: 'https://other.vercel.app/' }), /exact approved/);
  assert.throws(() => assertProviderObservationAllowed({ binding: binding(), adapter: { ...adapter(), provider: 'netlify' }, snapshot: snapshot() }), /Provider does not match/);
  assert.throws(() => assertProviderObservationAllowed({ binding: binding(), adapter: adapter(), snapshot: snapshot({ status: 'blocked' }) }), /unknown or blocked/);
  assert.throws(() => assertProviderObservationAllowed({ binding: binding(), adapter: adapter(), snapshot: snapshot({ expiresAt: '2026-08-01T00:00:00Z' }), now: new Date('2026-08-07T00:00:00Z') }), /expired/);
});

test('provider observation is deterministic, privacy-bounded and body-free', () => {
  const input = {
    id: 'observation-1', workspaceId: 'workspace-a', bindingId: 'binding-vercel-a', adapterId: 'vercel.public-deployment',
    provider: 'vercel', action: 'observe_public_deployment', method: 'GET', exactTarget: 'https://example.vercel.app/',
    state: 'succeeded', observedAt: '2026-08-07T00:00:00.000Z', statusCode: 200,
    normalizedHeaders: { 'content-type': 'text/html', etag: 'abc' }, failureCode: null,
  };
  const first = createProviderObservation(input);
  const second = createProviderObservation({ ...input, normalizedHeaders: { etag: 'abc', 'content-type': 'text/html' } });
  assert.equal(first.evidenceDigest, second.evidenceDigest);
  assert.deepEqual(first.normalizedHeaders, { 'content-type': 'text/html', etag: 'abc' });
  assert.throws(() => createProviderObservation({ ...input, body: '<html>secret</html>' }), /response bodies/);
  assert.throws(() => createProviderObservation({ ...input, normalizedHeaders: { authorization: 'Bearer secret' } }), /Sensitive/);
  assert.doesNotMatch(JSON.stringify(first), /Bearer|password|cookie|profilePath|processId/);
});

test('failed observations carry bounded failure codes and successful ones cannot', () => {
  const base = {
    id: 'observation-failed', workspaceId: 'workspace-a', bindingId: 'binding-vercel-a', adapterId: 'vercel.public-deployment',
    provider: 'vercel', action: 'observe_public_deployment', method: 'GET', exactTarget: 'https://example.vercel.app/',
    observedAt: '2026-08-07T00:00:00.000Z', statusCode: null, normalizedHeaders: {},
  };
  const failed = createProviderObservation({ ...base, state: 'failed', failureCode: 'network_failure' });
  assert.equal(failed.failureCode, 'network_failure');
  assert.throws(() => createProviderObservation({ ...base, state: 'succeeded', failureCode: 'network_failure' }), /cannot include failureCode/);
});

test('Workspace boundary helper fails closed', () => {
  assert.equal(assertSameWorkspace(binding(), 'workspace-a'), true);
  assert.throws(() => assertSameWorkspace(binding(), 'workspace-b'), /crosses Workspace/);
});
