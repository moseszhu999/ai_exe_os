'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PROVIDER_RUNTIME_MANIFEST_SCHEMA,
  assertCapabilityProviderContracts,
  compileProviderRuntimeManifest,
  createProviderRuntimeCatalog,
  resolveProviderRuntimeRoute,
} = require('../src/integrations/provider-runtime/index.cjs');

const WINDOW = Object.freeze({
  observedAt: '2026-08-11T00:00:00.000Z',
  validUntil: '2026-09-11T00:00:00.000Z',
  sourceRefs: ['source.provider-docs'],
});

function openAiManifest() {
  return {
    schema: PROVIDER_RUNTIME_MANIFEST_SCHEMA,
    providerId: 'openai-primary',
    displayName: 'OpenAI primary',
    providerKind: 'model_api',
    protocolFamily: 'openai.responses',
    transport: {
      mode: 'https',
      endpointRef: 'endpoint.openai-primary',
      credentialRefs: ['credential.openai-primary'],
      networkPolicyRef: 'network.internet-egress-models',
    },
    operations: [{
      operationId: 'reason',
      providerOperation: 'responses.create',
      riskClass: 'draft',
      humanGatePolicy: 'never',
      modelRefs: ['gpt-5.6-sol', 'gpt-5.6-terra'],
    }],
    freshness: WINDOW,
    status: 'available',
  };
}

function deepSeekManifest() {
  return {
    schema: PROVIDER_RUNTIME_MANIFEST_SCHEMA,
    providerId: 'deepseek-primary',
    displayName: 'DeepSeek primary',
    providerKind: 'model_api',
    protocolFamily: 'openai.chat-completions',
    transport: {
      mode: 'https',
      endpointRef: 'endpoint.deepseek-primary',
      credentialRefs: ['credential.deepseek-primary'],
    },
    operations: [{
      operationId: 'chat',
      providerOperation: 'chat.completions.create',
      riskClass: 'draft',
      humanGatePolicy: 'never',
      modelRefs: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    }],
    freshness: WINDOW,
    status: 'available',
  };
}

function mcpManifest() {
  return {
    schema: PROVIDER_RUNTIME_MANIFEST_SCHEMA,
    providerId: 'shared-media',
    displayName: 'Shared Media MCP',
    providerKind: 'mcp_server',
    protocolFamily: 'mcp',
    transport: {
      mode: 'mcp_streamable_http',
      endpointRef: 'endpoint.shared-media-mcp',
      credentialRefs: ['credential.shared-media-mcp'],
      networkPolicyRef: 'network.shared-media-private',
    },
    operations: [{
      operationId: 'media-read',
      providerOperation: 'tools/call',
      riskClass: 'observe',
      humanGatePolicy: 'never',
      toolNames: ['media_list_workflows', 'media_get_workflow', 'media_get_job', 'media_get_artifact'],
    }, {
      operationId: 'media-generate',
      providerOperation: 'tools/call',
      riskClass: 'internalWrite',
      humanGatePolicy: 'task',
      toolNames: ['media_generate_asset', 'media_cancel_job'],
    }],
    freshness: WINDOW,
    status: 'available',
  };
}

test('compiles model provider manifests by protocol family without product-specific code', () => {
  const openai = compileProviderRuntimeManifest(openAiManifest());
  const deepseek = compileProviderRuntimeManifest(deepSeekManifest());
  assert.equal(openai.providerContractId, 'prv.openai-primary');
  assert.equal(openai.normalizedManifest.protocolFamily, 'openai.responses');
  assert.equal(deepseek.normalizedManifest.protocolFamily, 'openai.chat-completions');
  assert.match(openai.integrityDigest, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(openai.integrityDigest, deepseek.integrityDigest);
});

test('compiles bounded MCP provider and projects exact server/tool ownership for capability compiler', () => {
  const catalog = createProviderRuntimeCatalog([mcpManifest()]);
  const mcpCatalog = catalog.toMcpCatalog();
  assert.deepEqual([...mcpCatalog.keys()], ['shared-media']);
  assert.deepEqual([...mcpCatalog.get('shared-media')].sort(), [
    'media_cancel_job',
    'media_generate_asset',
    'media_get_artifact',
    'media_get_job',
    'media_get_workflow',
    'media_list_workflows',
  ]);
});

test('resolves an exact immutable runtime route with manifest digest and opaque refs', () => {
  const catalog = createProviderRuntimeCatalog([openAiManifest(), deepSeekManifest(), mcpManifest()]);
  const route = resolveProviderRuntimeRoute({
    catalog,
    providerId: 'deepseek-primary',
    operationId: 'chat',
    at: '2026-08-11T12:00:00.000Z',
  });
  assert.equal(route.schema, 'provider.runtime.route.v1');
  assert.equal(route.providerContractId, 'prv.deepseek-primary');
  assert.equal(route.protocolFamily, 'openai.chat-completions');
  assert.equal(route.transport.endpointRef, 'endpoint.deepseek-primary');
  assert.equal(route.transport.credentialRefs[0], 'credential.deepseek-primary');
  assert.equal(route.operation.providerOperation, 'chat.completions.create');
  assert.equal(Object.isFrozen(route), true);
});

test('rejects inline URLs instead of opaque endpoint references', () => {
  const manifest = openAiManifest();
  manifest.transport.endpointRef = 'https://api.openai.com/v1';
  assert.throws(() => compileProviderRuntimeManifest(manifest), /endpointRef/);
});

test('rejects likely inline credential values instead of opaque credential references', () => {
  const manifest = openAiManifest();
  manifest.transport.credentialRefs = ['sk-proj-secret'];
  assert.throws(() => compileProviderRuntimeManifest(manifest), /opaque credential/);
});

test('registered local MCP launchers use opaque launcher refs and cannot inject commands', () => {
  const manifest = mcpManifest();
  manifest.transport = {
    mode: 'registered_local_launcher',
    launcherRef: 'launcher.shared-media-local',
    credentialRefs: [],
  };
  assert.doesNotThrow(() => compileProviderRuntimeManifest(manifest));
  manifest.transport.command = 'npx';
  assert.throws(() => compileProviderRuntimeManifest(manifest), /unsupported field: command/);
});

test('rejects protocol/provider-kind mismatches', () => {
  const manifest = openAiManifest();
  manifest.providerKind = 'mcp_server';
  assert.throws(() => compileProviderRuntimeManifest(manifest), /mcp_server provider requires protocolFamily=mcp|mcp_server providers require/);
});

test('rejects model protocol operation drift', () => {
  const manifest = deepSeekManifest();
  manifest.operations[0].providerOperation = 'responses.create';
  assert.throws(() => compileProviderRuntimeManifest(manifest), /chat.completions.create/);
});

test('rejects duplicate MCP tool ownership inside one provider manifest', () => {
  const manifest = mcpManifest();
  manifest.operations[1].toolNames.push('media_get_job');
  assert.throws(() => compileProviderRuntimeManifest(manifest), /owned by exactly one operation/);
});

test('external actions require action-level Human Gate policy', () => {
  const manifest = {
    schema: PROVIDER_RUNTIME_MANIFEST_SCHEMA,
    providerId: 'erp-connector',
    displayName: 'ERP connector',
    providerKind: 'domain_api',
    protocolFamily: 'http.json',
    transport: {
      mode: 'https',
      endpointRef: 'endpoint.erp-primary',
      credentialRefs: ['credential.erp-primary'],
    },
    operations: [{
      operationId: 'submit-order',
      providerOperation: 'orders.submit',
      riskClass: 'externalAction',
      humanGatePolicy: 'task',
      targetRef: 'target.erp-orders',
    }],
    freshness: WINDOW,
    status: 'available',
  };
  assert.throws(() => compileProviderRuntimeManifest(manifest), /action-level Human Gate/);
});

test('stale, future, degraded, or disabled provider bindings fail closed', () => {
  const staleCatalog = createProviderRuntimeCatalog([openAiManifest()]);
  assert.throws(() => resolveProviderRuntimeRoute({
    catalog: staleCatalog,
    providerId: 'openai-primary',
    operationId: 'reason',
    at: '2026-10-01T00:00:00.000Z',
  }), /stale/);
  assert.throws(() => resolveProviderRuntimeRoute({
    catalog: staleCatalog,
    providerId: 'openai-primary',
    operationId: 'reason',
    at: '2026-07-01T00:00:00.000Z',
  }), /not yet valid/);

  const degraded = openAiManifest();
  degraded.status = 'degraded';
  const degradedCatalog = createProviderRuntimeCatalog([degraded]);
  assert.throws(() => resolveProviderRuntimeRoute({
    catalog: degradedCatalog,
    providerId: 'openai-primary',
    operationId: 'reason',
    at: '2026-08-11T12:00:00.000Z',
  }), /not available/);
});

test('CapabilityVersion providerContractIds can be checked against the same runtime catalog', () => {
  const catalog = createProviderRuntimeCatalog([openAiManifest(), mcpManifest()]);
  const refs = assertCapabilityProviderContracts(
    ['prv.openai-primary', 'prv.shared-media'],
    catalog,
    '2026-08-11T12:00:00.000Z',
  );
  assert.deepEqual(refs, ['prv.openai-primary', 'prv.shared-media']);
  assert.throws(() => assertCapabilityProviderContracts(
    ['prv.missing'],
    catalog,
    '2026-08-11T12:00:00.000Z',
  ), /Unknown provider runtime binding/);
});
