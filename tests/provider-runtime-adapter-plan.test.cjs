'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PROVIDER_ADAPTER_PLAN_SCHEMA,
  PROVIDER_RUNTIME_REQUEST_SCHEMA,
  compileProviderAdapterPlan,
} = require('../src/integrations/provider-runtime/adapter-plan.cjs');

const SHA = `sha256:${'a'.repeat(64)}`;

function route(overrides = {}) {
  const protocolFamily = overrides.protocolFamily || 'openai.responses';
  const defaults = {
    'openai.responses': {
      providerId: 'openai-primary', providerKind: 'model_api', providerOperation: 'responses.create',
      operationId: 'reason', riskClass: 'draft', humanGatePolicy: 'never', modelRefs: ['gpt-5.6-sol'], toolNames: [],
    },
    'openai.chat-completions': {
      providerId: 'deepseek-primary', providerKind: 'model_api', providerOperation: 'chat.completions.create',
      operationId: 'chat', riskClass: 'draft', humanGatePolicy: 'never', modelRefs: ['deepseek-v4-pro', 'deepseek-v4-flash'], toolNames: [],
    },
    'anthropic.messages': {
      providerId: 'deepseek-anthropic', providerKind: 'model_api', providerOperation: 'messages.create',
      operationId: 'message', riskClass: 'draft', humanGatePolicy: 'never', modelRefs: ['deepseek-v4-pro'], toolNames: [],
    },
    mcp: {
      providerId: 'shared-media', providerKind: 'mcp_server', providerOperation: 'tools/call',
      operationId: 'media-read', riskClass: 'observe', humanGatePolicy: 'never', modelRefs: [], toolNames: ['media_get_job', 'media_get_artifact'],
    },
    'http.json': {
      providerId: 'trade-oracle', providerKind: 'domain_api', providerOperation: 'shipment.lookup',
      operationId: 'shipment-lookup', riskClass: 'observe', humanGatePolicy: 'never', modelRefs: [], toolNames: [], targetRef: 'target.trade-oracle-shipment',
    },
  }[protocolFamily];
  const providerId = overrides.providerId || defaults.providerId;
  const mode = protocolFamily === 'mcp' ? 'mcp_streamable_http' : 'https';
  return {
    schema: 'provider.runtime.route.v1',
    providerId,
    providerContractId: `prv.${providerId}`,
    providerManifestDigest: SHA,
    providerKind: overrides.providerKind || defaults.providerKind,
    protocolFamily,
    transport: {
      mode,
      endpointRef: `endpoint.${providerId}`,
      launcherRef: null,
      credentialRefs: [`credential.${providerId}`],
      networkPolicyRef: 'network.shared-egress',
    },
    operation: {
      operationId: overrides.operationId || defaults.operationId,
      providerOperation: overrides.providerOperation || defaults.providerOperation,
      riskClass: overrides.riskClass || defaults.riskClass,
      humanGatePolicy: overrides.humanGatePolicy || defaults.humanGatePolicy,
      targetRef: overrides.targetRef === undefined ? (defaults.targetRef || null) : overrides.targetRef,
      modelRefs: overrides.modelRefs || defaults.modelRefs,
      toolNames: overrides.toolNames || defaults.toolNames,
    },
    freshness: {
      observedAt: '2026-08-11T00:00:00.000Z',
      validUntil: '2026-09-11T00:00:00.000Z',
      sourceRefs: ['source.provider-docs'],
    },
  };
}

function baseRequest(providerId, operationId, extra = {}) {
  return {
    schema: PROVIDER_RUNTIME_REQUEST_SCHEMA,
    requestId: 'req-001',
    providerId,
    operationId,
    ...extra,
  };
}

test('compiles bounded OpenAI Responses plan without resolving credentials or performing network', () => {
  const plan = compileProviderAdapterPlan({
    route: route(),
    request: baseRequest('openai-primary', 'reason', {
      modelRef: 'gpt-5.6-sol',
      inputText: 'Explain the customs exception in plain language.',
      instructions: 'Return a concise draft.',
      maxTokens: 800,
    }),
  });
  assert.equal(plan.schema, PROVIDER_ADAPTER_PLAN_SCHEMA);
  assert.equal(plan.protocolFamily, 'openai.responses');
  assert.equal(plan.protocolCall.protocolOperation, 'responses.create');
  assert.deepEqual(plan.protocolCall.payload, {
    model: 'gpt-5.6-sol',
    input: 'Explain the customs exception in plain language.',
    instructions: 'Return a concise draft.',
    max_output_tokens: 800,
  });
  assert.equal(plan.semanticOperation.riskClass, 'draft');
  assert.equal(plan.transportBinding.endpointRef, 'endpoint.openai-primary');
  assert.equal(plan.flags.credentialResolved, false);
  assert.equal(plan.flags.networkPerformed, false);
  assert.match(plan.planDigest, /^sha256:[a-f0-9]{64}$/);
});

test('compiles DeepSeek through the OpenAI-compatible Chat Completions protocol family', () => {
  const plan = compileProviderAdapterPlan({
    route: route({ protocolFamily: 'openai.chat-completions' }),
    request: baseRequest('deepseek-primary', 'chat', {
      modelRef: 'deepseek-v4-pro',
      messages: [
        { role: 'system', content: 'You are a procurement analyst.' },
        { role: 'user', content: 'Draft three supplier due-diligence questions.' },
      ],
      maxTokens: 600,
    }),
  });
  assert.equal(plan.protocolCall.protocolOperation, 'chat.completions.create');
  assert.equal(plan.protocolCall.payload.model, 'deepseek-v4-pro');
  assert.equal(plan.protocolCall.payload.max_tokens, 600);
  assert.equal(plan.protocolCall.payload.messages.length, 2);
});

test('compiles Anthropic Messages shape with explicit max_tokens', () => {
  const plan = compileProviderAdapterPlan({
    route: route({ protocolFamily: 'anthropic.messages' }),
    request: baseRequest('deepseek-anthropic', 'message', {
      modelRef: 'deepseek-v4-pro',
      system: 'You are a training coach.',
      messages: [{ role: 'user', content: 'Create one OJT reflection question.' }],
      maxTokens: 256,
    }),
  });
  assert.equal(plan.protocolCall.protocolOperation, 'messages.create');
  assert.deepEqual(plan.protocolCall.payload, {
    model: 'deepseek-v4-pro',
    max_tokens: 256,
    messages: [{ role: 'user', content: 'Create one OJT reflection question.' }],
    system: 'You are a training coach.',
  });
});

test('compiles exact MCP tools/call plan and preserves semantic observe risk', () => {
  const plan = compileProviderAdapterPlan({
    route: route({ protocolFamily: 'mcp' }),
    request: baseRequest('shared-media', 'media-read', {
      toolName: 'media_get_job',
      arguments: { jobId: 'job-123' },
    }),
  });
  assert.equal(plan.protocolCall.callKind, 'mcp_tool');
  assert.deepEqual(plan.protocolCall.payload, {
    method: 'tools/call',
    params: { name: 'media_get_job', arguments: { jobId: 'job-123' } },
  });
  assert.equal(plan.semanticOperation.riskClass, 'observe');
  assert.equal(plan.flags.externalActionPerformed, false);
});

test('domain HTTP/JSON plan stays semantic and contains no arbitrary HTTP primitive', () => {
  const plan = compileProviderAdapterPlan({
    route: route({ protocolFamily: 'http.json' }),
    request: baseRequest('trade-oracle', 'shipment-lookup', {
      parameters: { shipmentId: 'SHP-1001', includeMilestones: true },
    }),
  });
  assert.equal(plan.protocolCall.callKind, 'domain_operation');
  assert.equal(plan.protocolCall.protocolOperation, 'shipment.lookup');
  assert.equal(plan.semanticOperation.targetRef, 'target.trade-oracle-shipment');
  assert.equal(Object.hasOwn(plan.transportBinding, 'method'), false);
  assert.equal(Object.hasOwn(plan.transportBinding, 'headers'), false);
  assert.equal(Object.hasOwn(plan.transportBinding, 'url'), false);
});

test('HTTP transport verb is not used as the business-effect risk classifier', () => {
  const plan = compileProviderAdapterPlan({
    route: route(),
    request: baseRequest('openai-primary', 'reason', {
      modelRef: 'gpt-5.6-sol',
      inputText: 'Draft a lesson title.',
    }),
  });
  assert.equal(plan.semanticOperation.riskClass, 'draft');
  assert.equal(plan.protocolCall.protocolOperation, 'responses.create');
  assert.equal(Object.hasOwn(plan, 'httpMethod'), false);
  assert.equal(Object.hasOwn(plan.transportBinding, 'method'), false);
});

test('rejects provider and operation drift from the exact route', () => {
  assert.throws(() => compileProviderAdapterPlan({
    route: route(),
    request: baseRequest('deepseek-primary', 'reason', { modelRef: 'gpt-5.6-sol', inputText: 'x' }),
  }), /provider does not match exact route/);
  assert.throws(() => compileProviderAdapterPlan({
    route: route(),
    request: baseRequest('openai-primary', 'other', { modelRef: 'gpt-5.6-sol', inputText: 'x' }),
  }), /operation does not match exact route/);
});

test('rejects a model not allowlisted by the exact route', () => {
  assert.throws(() => compileProviderAdapterPlan({
    route: route(),
    request: baseRequest('openai-primary', 'reason', { modelRef: 'gpt-unknown', inputText: 'x' }),
  }), /modelRef is not allowed/);
});

test('rejects an MCP tool not allowlisted by the exact route', () => {
  assert.throws(() => compileProviderAdapterPlan({
    route: route({ protocolFamily: 'mcp' }),
    request: baseRequest('shared-media', 'media-read', {
      toolName: 'media_generate_asset',
      arguments: {},
    }),
  }), /MCP tool is not allowed/);
});

test('rejects top-level arbitrary transport primitives and credential material', () => {
  assert.throws(() => compileProviderAdapterPlan({
    route: route(),
    request: {
      ...baseRequest('openai-primary', 'reason', { modelRef: 'gpt-5.6-sol', inputText: 'x' }),
      url: 'https://example.invalid/v1',
    },
  }), /unsupported field: url/);
  assert.throws(() => compileProviderAdapterPlan({
    route: route({ protocolFamily: 'mcp' }),
    request: baseRequest('shared-media', 'media-read', {
      toolName: 'media_get_job',
      arguments: { apiKey: 'secret-value' },
    }),
  }), /forbidden transport\/credential field: apiKey/);
});

test('rejects protocol-family field smuggling', () => {
  assert.throws(() => compileProviderAdapterPlan({
    route: route(),
    request: baseRequest('openai-primary', 'reason', {
      modelRef: 'gpt-5.6-sol',
      inputText: 'x',
      toolName: 'media_get_job',
    }),
  }), /openai\.responses request contains unsupported field: toolName/);
});

test('plan digests are deterministic and change when semantic input changes', () => {
  const exactRoute = route({ protocolFamily: 'mcp' });
  const first = compileProviderAdapterPlan({
    route: exactRoute,
    request: baseRequest('shared-media', 'media-read', { toolName: 'media_get_job', arguments: { jobId: 'job-1' } }),
  });
  const second = compileProviderAdapterPlan({
    route: exactRoute,
    request: baseRequest('shared-media', 'media-read', { toolName: 'media_get_job', arguments: { jobId: 'job-1' } }),
  });
  const changed = compileProviderAdapterPlan({
    route: exactRoute,
    request: baseRequest('shared-media', 'media-read', { toolName: 'media_get_job', arguments: { jobId: 'job-2' } }),
  });
  assert.equal(first.planDigest, second.planDigest);
  assert.equal(first.requestDigest, second.requestDigest);
  assert.notEqual(first.planDigest, changed.planDigest);
});

test('adapter plan remains non-authoritative even for an externalAction route', () => {
  const plan = compileProviderAdapterPlan({
    route: route({
      protocolFamily: 'http.json',
      operationId: 'submit-order',
      providerOperation: 'orders.submit',
      riskClass: 'externalAction',
      humanGatePolicy: 'action',
      targetRef: 'target.erp-orders',
    }),
    request: baseRequest('trade-oracle', 'submit-order', { parameters: { orderId: 'PO-100' } }),
  });
  assert.equal(plan.semanticOperation.riskClass, 'externalAction');
  assert.equal(plan.semanticOperation.humanGatePolicy, 'action');
  assert.deepEqual(plan.flags, {
    authorizationDecisionCreated: false,
    humanGateDecisionCreated: false,
    credentialResolved: false,
    networkPerformed: false,
    externalActionPerformed: false,
  });
});
