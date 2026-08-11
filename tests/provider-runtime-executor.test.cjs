'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PROVIDER_RUNTIME_MANIFEST_SCHEMA,
  createProviderRuntimeCatalog,
  resolveProviderRuntimeRoute,
} = require('../src/integrations/provider-runtime/index.cjs');
const { compileProviderAdapterPlan } = require('../src/integrations/provider-runtime/adapter-plan.cjs');
const {
  PROVIDER_EXECUTION_RECEIPT_SCHEMA,
  executeProviderAdapterPlan,
  expectedAuthorizationBinding,
} = require('../src/integrations/provider-runtime/executor.cjs');

const AT = '2026-08-11T13:00:00.000Z';
const WINDOW = Object.freeze({
  observedAt: '2026-08-11T00:00:00.000Z',
  validUntil: '2026-09-11T00:00:00.000Z',
  sourceRefs: ['source.provider-docs'],
});

function manifest({
  providerId = 'openai-primary',
  protocolFamily = 'openai.responses',
  operationId = 'reason',
  providerOperation = 'responses.create',
  modelRefs = ['gpt-5.6-sol'],
  endpointRef = 'endpoint.openai-primary',
  credentialRef = 'credential.openai-primary',
  networkPolicyRef = 'network.internet-egress-models',
  humanGatePolicy = 'never',
  riskClass = 'draft',
} = {}) {
  return {
    schema: PROVIDER_RUNTIME_MANIFEST_SCHEMA,
    providerId,
    displayName: `${providerId} model provider`,
    providerKind: 'model_api',
    protocolFamily,
    transport: {
      mode: 'https',
      endpointRef,
      credentialRefs: [credentialRef],
      ...(networkPolicyRef ? { networkPolicyRef } : {}),
    },
    operations: [{ operationId, providerOperation, riskClass, humanGatePolicy, modelRefs }],
    freshness: WINDOW,
    status: 'available',
  };
}

function planFor(overrides = {}) {
  const providerManifest = manifest(overrides);
  const catalog = createProviderRuntimeCatalog([providerManifest]);
  const route = resolveProviderRuntimeRoute({
    catalog,
    providerId: providerManifest.providerId,
    operationId: providerManifest.operations[0].operationId,
    at: AT,
  });
  const request = providerManifest.protocolFamily === 'openai.responses'
    ? {
      schema: 'provider.runtime.request.v1',
      requestId: 'req-model-1',
      providerId: providerManifest.providerId,
      operationId: providerManifest.operations[0].operationId,
      modelRef: providerManifest.operations[0].modelRefs[0],
      inputText: 'Summarize the supplied evidence.',
      maxTokens: 300,
    }
    : {
      schema: 'provider.runtime.request.v1',
      requestId: 'req-model-1',
      providerId: providerManifest.providerId,
      operationId: providerManifest.operations[0].operationId,
      modelRef: providerManifest.operations[0].modelRefs[0],
      messages: [{ role: 'user', content: 'Summarize the supplied evidence.' }],
      maxTokens: 300,
    };
  return compileProviderAdapterPlan({ route, request });
}

function authorizationFor(plan, overrides = {}) {
  const binding = expectedAuthorizationBinding(plan);
  const humanGateRequired = plan.semanticOperation.humanGatePolicy !== 'never';
  const base = {
    schema: 'execution.authorization.request.v1',
    requestRef: 'exec-request-model-1',
    organizationRef: 'org.test',
    actorRef: 'agent.runtime',
    actorKind: 'agent',
    requestedActionRef: 'requested-action.provider-model',
    action: binding.action,
    targetRef: binding.targetRef,
    observedAt: AT,
    requirements: {
      requiredHumanCapabilityRefs: [],
      requiredAgentCapabilityRefs: ['cap.provider-model'],
      requiredEvidenceRefs: ['evidence.provider-binding'],
      requiredPolicyRefs: ['policy.provider-egress'],
      humanGateRequired,
    },
    resolved: {
      authorityGrant: {
        ref: 'grant.provider-model',
        status: 'active',
        organizationRef: 'org.test',
        actorRef: 'agent.runtime',
        allowedActions: [binding.action],
        allowedTargets: [binding.targetRef],
        expiresAt: '2026-08-11T14:00:00.000Z',
      },
      delegation: {
        ref: 'delegation.provider-model',
        status: 'active',
        organizationRef: 'org.test',
        actorRef: 'agent.runtime',
        allowedActions: [binding.action],
        allowedTargets: [binding.targetRef],
        expiresAt: '2026-08-11T14:00:00.000Z',
      },
      humanCapabilityCredentials: [],
      agentCapabilityPackages: [{ ref: 'cap.provider-model', status: 'accepted' }],
      evidence: [{ ref: 'evidence.provider-binding', status: 'current' }],
      policies: [{ ref: 'policy.provider-egress', status: 'current' }],
      humanGate: humanGateRequired ? { ref: 'gate.provider-model', state: 'approved' } : null,
      revocations: [],
    },
  };
  return {
    ...base,
    ...overrides,
    requirements: { ...base.requirements, ...(overrides.requirements || {}) },
    resolved: { ...base.resolved, ...(overrides.resolved || {}) },
  };
}

function dependencies(plan, { response, endpointOverride, credentialOverride } = {}) {
  const calls = { endpoint: 0, credential: 0, transport: 0, transportRequest: null };
  return {
    calls,
    endpointResolver: {
      async resolve() {
        calls.endpoint += 1;
        return endpointOverride || {
          endpointRef: plan.transportBinding.endpointRef,
          networkPolicyRef: plan.transportBinding.networkPolicyRef,
          status: 'approved',
          url: plan.protocolFamily === 'openai.responses'
            ? 'https://api.example.test/v1/responses'
            : 'https://api.example.test/v1/chat/completions',
        };
      },
    },
    credentialResolver: {
      async resolve() {
        calls.credential += 1;
        return credentialOverride || {
          credentialRef: plan.transportBinding.credentialRefs[0],
          status: 'ready',
          scheme: 'bearer',
          secret: 'test-secret-never-returned',
        };
      },
    },
    transport: {
      async invoke(request) {
        calls.transport += 1;
        calls.transportRequest = request;
        return response || {
          statusCode: 200,
          contentType: 'application/json',
          bodyText: JSON.stringify({ id: 'resp_1', output_text: 'Evidence summary.' }),
          providerRequestId: 'provider-request-1',
        };
      },
    },
  };
}

function deterministicClock() {
  const values = ['2026-08-11T13:00:00.100Z', '2026-08-11T13:00:00.200Z'];
  return { now: () => values.shift() || '2026-08-11T13:00:00.200Z' };
}

test('executes an authorized OpenAI Responses plan and returns a secret-free immutable receipt', async () => {
  const plan = planFor();
  const deps = dependencies(plan);
  const result = await executeProviderAdapterPlan({
    plan,
    authorizationRequest: authorizationFor(plan),
    ...deps,
    at: AT,
    clock: deterministicClock(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.result.output_text, 'Evidence summary.');
  assert.equal(result.receipt.schema, PROVIDER_EXECUTION_RECEIPT_SCHEMA);
  assert.equal(result.receipt.providerId, 'openai-primary');
  assert.equal(result.receipt.protocolOperation, 'responses.create');
  assert.equal(result.receipt.flags.authorizationEvaluated, true);
  assert.equal(result.receipt.flags.credentialResolved, true);
  assert.equal(result.receipt.flags.networkPerformed, true);
  assert.equal(result.receipt.flags.externalActionPerformed, false);
  assert.equal(deps.calls.transportRequest.method, 'POST');
  assert.equal(deps.calls.transportRequest.headers.authorization, 'Bearer test-secret-never-returned');
  assert.doesNotMatch(JSON.stringify(result.receipt), /test-secret-never-returned|https:\/\//);
  assert.equal(Object.isFrozen(result.receipt), true);
});

test('same executor family runs an authorized OpenAI-compatible DeepSeek chat plan', async () => {
  const plan = planFor({
    providerId: 'deepseek-primary',
    protocolFamily: 'openai.chat-completions',
    operationId: 'chat',
    providerOperation: 'chat.completions.create',
    modelRefs: ['deepseek-v4-pro'],
    endpointRef: 'endpoint.deepseek-primary',
    credentialRef: 'credential.deepseek-primary',
    networkPolicyRef: null,
  });
  const deps = dependencies(plan);
  const result = await executeProviderAdapterPlan({ plan, authorizationRequest: authorizationFor(plan), ...deps, at: AT, clock: deterministicClock() });
  assert.equal(result.ok, true);
  assert.equal(result.receipt.providerId, 'deepseek-primary');
  assert.equal(result.receipt.protocolFamily, 'openai.chat-completions');
  const sent = JSON.parse(deps.calls.transportRequest.body);
  assert.equal(sent.model, 'deepseek-v4-pro');
  assert.equal(sent.messages[0].role, 'user');
});

test('authorization denial fails before endpoint, credential, or network resolution', async () => {
  const plan = planFor();
  const deps = dependencies(plan);
  const denied = authorizationFor(plan, {
    resolved: {
      authorityGrant: { ...authorizationFor(plan).resolved.authorityGrant, status: 'revoked' },
    },
  });
  await assert.rejects(() => executeProviderAdapterPlan({ plan, authorizationRequest: denied, ...deps, at: AT }), /authorization denied/);
  assert.deepEqual(deps.calls, { endpoint: 0, credential: 0, transport: 0, transportRequest: null });
});

test('authorization action and target must bind the exact provider operation before evaluation', async () => {
  const plan = planFor();
  const deps = dependencies(plan);
  await assert.rejects(() => executeProviderAdapterPlan({
    plan,
    authorizationRequest: authorizationFor(plan, { action: 'provider.runtime.other.other' }),
    ...deps,
    at: AT,
  }), /action does not match/);
  await assert.rejects(() => executeProviderAdapterPlan({
    plan,
    authorizationRequest: authorizationFor(plan, { targetRef: 'prv.other' }),
    ...deps,
    at: AT,
  }), /target does not match/);
  assert.equal(deps.calls.transport, 0);
});

test('Human Gate requirement must match the exact semantic plan', async () => {
  const plan = planFor({ humanGatePolicy: 'task' });
  const deps = dependencies(plan);
  const request = authorizationFor(plan, { requirements: { humanGateRequired: false } });
  await assert.rejects(() => executeProviderAdapterPlan({ plan, authorizationRequest: request, ...deps, at: AT }), /Human Gate requirement does not match/);
  assert.equal(deps.calls.transport, 0);
});

test('stale authorization observation is rejected before resolver or network work', async () => {
  const plan = planFor();
  const deps = dependencies(plan);
  await assert.rejects(() => executeProviderAdapterPlan({
    plan,
    authorizationRequest: authorizationFor(plan),
    ...deps,
    at: '2026-08-11T13:01:00.000Z',
  }), /too far/);
  assert.equal(deps.calls.endpoint, 0);
});

test('endpoint resolution is exact, approved, HTTPS, and network-policy bound', async () => {
  const plan = planFor();
  for (const endpointOverride of [
    { endpointRef: 'endpoint.other', networkPolicyRef: plan.transportBinding.networkPolicyRef, status: 'approved', url: 'https://api.example.test/v1/responses' },
    { endpointRef: plan.transportBinding.endpointRef, networkPolicyRef: 'network.other', status: 'approved', url: 'https://api.example.test/v1/responses' },
    { endpointRef: plan.transportBinding.endpointRef, networkPolicyRef: plan.transportBinding.networkPolicyRef, status: 'pending', url: 'https://api.example.test/v1/responses' },
    { endpointRef: plan.transportBinding.endpointRef, networkPolicyRef: plan.transportBinding.networkPolicyRef, status: 'approved', url: 'http://api.example.test/v1/responses' },
    { endpointRef: plan.transportBinding.endpointRef, networkPolicyRef: plan.transportBinding.networkPolicyRef, status: 'approved', url: 'https://api.example.test/v1/responses?override=1' },
  ]) {
    const deps = dependencies(plan, { endpointOverride });
    await assert.rejects(() => executeProviderAdapterPlan({ plan, authorizationRequest: authorizationFor(plan), ...deps, at: AT }), /endpointRef|networkPolicyRef|not approved|https|query/);
    assert.equal(deps.calls.transport, 0);
  }
});

test('credential resolution must match exact opaque ref and bearer scheme', async () => {
  const plan = planFor();
  for (const credentialOverride of [
    { credentialRef: 'credential.other', status: 'ready', scheme: 'bearer', secret: 'x' },
    { credentialRef: plan.transportBinding.credentialRefs[0], status: 'disabled', scheme: 'bearer', secret: 'x' },
    { credentialRef: plan.transportBinding.credentialRefs[0], status: 'ready', scheme: 'basic', secret: 'x' },
  ]) {
    const deps = dependencies(plan, { credentialOverride });
    await assert.rejects(() => executeProviderAdapterPlan({ plan, authorizationRequest: authorizationFor(plan), ...deps, at: AT }), /credentialRef|not ready|bearer/);
    assert.equal(deps.calls.transport, 0);
  }
});

test('transport response contract rejects header leakage and non-JSON response bodies', async () => {
  const plan = planFor();
  const withHeaders = dependencies(plan, { response: {
    statusCode: 200,
    contentType: 'application/json',
    bodyText: '{}',
    providerRequestId: 'request-1',
    headers: { authorization: 'secret' },
  } });
  await assert.rejects(() => executeProviderAdapterPlan({ plan, authorizationRequest: authorizationFor(plan), ...withHeaders, at: AT, clock: deterministicClock() }), /unsupported field: headers/);

  const nonJson = dependencies(plan, { response: { statusCode: 200, contentType: 'text/plain', bodyText: 'ok' } });
  await assert.rejects(() => executeProviderAdapterPlan({ plan, authorizationRequest: authorizationFor(plan), ...nonJson, at: AT, clock: deterministicClock() }), /must be JSON/);
});

test('provider non-2xx result returns a bounded failure receipt without returning the provider body', async () => {
  const plan = planFor();
  const deps = dependencies(plan, { response: {
    statusCode: 429,
    contentType: 'application/json',
    bodyText: JSON.stringify({ error: { message: 'quota detail that should not become result' } }),
    providerRequestId: 'request-429',
  } });
  const result = await executeProviderAdapterPlan({ plan, authorizationRequest: authorizationFor(plan), ...deps, at: AT, clock: deterministicClock() });
  assert.equal(result.ok, false);
  assert.equal(result.result, null);
  assert.equal(result.receipt.outcome, 'provider_error');
  assert.equal(result.receipt.statusCode, 429);
  assert.doesNotMatch(JSON.stringify(result.receipt), /quota detail/);
});

test('transport exceptions are sanitized instead of surfacing provider or credential material', async () => {
  const plan = planFor();
  const deps = dependencies(plan);
  deps.transport.invoke = async () => { throw new Error('Bearer test-secret-never-returned at https://secret.example'); };
  await assert.rejects(() => executeProviderAdapterPlan({ plan, authorizationRequest: authorizationFor(plan), ...deps, at: AT }), (error) => {
    assert.equal(error.message, 'provider transport failed');
    assert.doesNotMatch(error.message, /Bearer|https|secret/);
    return true;
  });
});

test('P2 model executor refuses internalWrite/externalAction even if a caller supplies a plan-like object', async () => {
  const plan = planFor();
  for (const riskClass of ['internalWrite', 'externalAction']) {
    const forged = {
      ...plan,
      semanticOperation: { ...plan.semanticOperation, riskClass },
    };
    const deps = dependencies(plan);
    await assert.rejects(() => executeProviderAdapterPlan({ plan: forged, authorizationRequest: authorizationFor(plan), ...deps, at: AT }), /digest mismatch|only permits observe\/draft/);
    assert.equal(deps.calls.transport, 0);
  }
});
