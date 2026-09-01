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
  ANTHROPIC_API_VERSION,
  PROVIDER_EXECUTION_RECEIPT_SCHEMA,
  executeProviderAdapterPlan,
  expectedAuthorizationBinding,
} = require('../src/integrations/provider-runtime/executor.cjs');

const AT = '2026-08-11T15:00:00.000Z';
const WINDOW = Object.freeze({
  observedAt: '2026-08-11T00:00:00.000Z',
  validUntil: '2026-09-11T00:00:00.000Z',
  sourceRefs: ['source.anthropic-docs'],
});

function anthropicManifest({ riskClass = 'draft', humanGatePolicy = 'never' } = {}) {
  return {
    schema: PROVIDER_RUNTIME_MANIFEST_SCHEMA,
    providerId: 'anthropic-primary',
    displayName: 'Anthropic Messages provider',
    providerKind: 'model_api',
    protocolFamily: 'anthropic.messages',
    transport: {
      mode: 'https',
      endpointRef: 'endpoint.anthropic-primary',
      credentialRefs: ['credential.anthropic-primary'],
      networkPolicyRef: 'network.internet-egress-models',
    },
    operations: [{
      operationId: 'draft',
      providerOperation: 'messages.create',
      riskClass,
      humanGatePolicy,
      modelRefs: ['claude-fixture-model'],
    }],
    freshness: WINDOW,
    status: 'available',
  };
}

function planFor(overrides = {}) {
  const providerManifest = anthropicManifest(overrides);
  const catalog = createProviderRuntimeCatalog([providerManifest]);
  const route = resolveProviderRuntimeRoute({
    catalog,
    providerId: providerManifest.providerId,
    operationId: 'draft',
    at: AT,
  });
  return compileProviderAdapterPlan({
    route,
    request: {
      schema: 'provider.runtime.request.v1',
      requestId: 'req-anthropic-1',
      providerId: providerManifest.providerId,
      operationId: 'draft',
      modelRef: 'claude-fixture-model',
      system: 'Return a concise draft only.',
      messages: [{ role: 'user', content: 'Draft a short evidence summary.' }],
      maxTokens: 320,
    },
  });
}

function authorizationFor(plan, overrides = {}) {
  const binding = expectedAuthorizationBinding(plan);
  const humanGateRequired = plan.semanticOperation.humanGatePolicy !== 'never';
  const base = {
    schema: 'execution.authorization.request.v1',
    requestRef: 'exec-request-anthropic-1',
    organizationRef: 'org.test',
    actorRef: 'agent.runtime',
    actorKind: 'agent',
    requestedActionRef: 'requested-action.provider-anthropic',
    action: binding.action,
    targetRef: binding.targetRef,
    observedAt: AT,
    requirements: {
      requiredHumanCapabilityRefs: [],
      requiredAgentCapabilityRefs: ['cap.provider-anthropic'],
      requiredEvidenceRefs: ['evidence.provider-anthropic'],
      requiredPolicyRefs: ['policy.provider-egress'],
      humanGateRequired,
    },
    resolved: {
      authorityGrant: {
        ref: 'grant.provider-anthropic',
        status: 'active',
        organizationRef: 'org.test',
        actorRef: 'agent.runtime',
        allowedActions: [binding.action],
        allowedTargets: [binding.targetRef],
        expiresAt: '2026-08-11T16:00:00.000Z',
      },
      delegation: {
        ref: 'delegation.provider-anthropic',
        status: 'active',
        organizationRef: 'org.test',
        actorRef: 'agent.runtime',
        allowedActions: [binding.action],
        allowedTargets: [binding.targetRef],
        expiresAt: '2026-08-11T16:00:00.000Z',
      },
      humanCapabilityCredentials: [],
      agentCapabilityPackages: [{ ref: 'cap.provider-anthropic', status: 'accepted' }],
      evidence: [{ ref: 'evidence.provider-anthropic', status: 'current' }],
      policies: [{ ref: 'policy.provider-egress', status: 'current' }],
      humanGate: humanGateRequired ? { ref: 'gate.provider-anthropic', state: 'approved' } : null,
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

function dependencies(plan, { credentialOverride, endpointOverride, response } = {}) {
  const calls = { endpoint: 0, credential: 0, transport: 0, transportRequest: null, endpointRequest: null, credentialRequest: null };
  return {
    calls,
    endpointResolver: {
      async resolve(request) {
        calls.endpoint += 1;
        calls.endpointRequest = request;
        return endpointOverride || {
          endpointRef: plan.transportBinding.endpointRef,
          networkPolicyRef: plan.transportBinding.networkPolicyRef,
          status: 'approved',
          url: 'https://anthropic.fixture.test/v1/messages',
        };
      },
    },
    credentialResolver: {
      async resolve(request) {
        calls.credential += 1;
        calls.credentialRequest = request;
        return credentialOverride || {
          credentialRef: plan.transportBinding.credentialRefs[0],
          status: 'ready',
          scheme: 'api_key',
          secret: 'anthropic-test-secret-never-returned',
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
          bodyText: JSON.stringify({
            id: 'msg_fixture_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Evidence summary draft.' }],
            stop_reason: 'end_turn',
          }),
          providerRequestId: 'anthropic-request-1',
        };
      },
    },
  };
}

function deterministicClock() {
  const values = ['2026-08-11T15:00:00.100Z', '2026-08-11T15:00:00.200Z'];
  return { now: () => values.shift() || '2026-08-11T15:00:00.200Z' };
}

test('executes authorized Anthropic Messages with executor-owned x-api-key and pinned API version', async () => {
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
  assert.equal(result.receipt.schema, PROVIDER_EXECUTION_RECEIPT_SCHEMA);
  assert.equal(result.receipt.protocolFamily, 'anthropic.messages');
  assert.equal(result.receipt.protocolVersion, ANTHROPIC_API_VERSION);
  assert.equal(result.receipt.protocolOperation, 'messages.create');
  assert.equal(result.receipt.flags.externalActionPerformed, false);
  assert.equal(deps.calls.endpointRequest.protocolVersion, ANTHROPIC_API_VERSION);
  assert.equal(deps.calls.credentialRequest.protocolFamily, 'anthropic.messages');
  assert.equal(deps.calls.transportRequest.protocolVersion, ANTHROPIC_API_VERSION);
  assert.equal(deps.calls.transportRequest.method, 'POST');
  assert.equal(deps.calls.transportRequest.headers['x-api-key'], 'anthropic-test-secret-never-returned');
  assert.equal(deps.calls.transportRequest.headers['anthropic-version'], ANTHROPIC_API_VERSION);
  assert.equal(deps.calls.transportRequest.headers['content-type'], 'application/json');
  assert.equal('authorization' in deps.calls.transportRequest.headers, false);
  const sent = JSON.parse(deps.calls.transportRequest.body);
  assert.equal(sent.model, 'claude-fixture-model');
  assert.equal(sent.max_tokens, 320);
  assert.equal(sent.system, 'Return a concise draft only.');
  assert.equal(sent.messages[0].role, 'user');
  assert.doesNotMatch(JSON.stringify(result.receipt), /anthropic-test-secret-never-returned|https:\/\//);
  assert.equal(Object.isFrozen(result.receipt), true);
});

test('authorization denial fails before Anthropic endpoint credential or transport work', async () => {
  const plan = planFor();
  const deps = dependencies(plan);
  const denied = authorizationFor(plan, {
    resolved: {
      authorityGrant: { ...authorizationFor(plan).resolved.authorityGrant, status: 'revoked' },
    },
  });
  await assert.rejects(() => executeProviderAdapterPlan({ plan, authorizationRequest: denied, ...deps, at: AT }), /authorization denied/);
  assert.equal(deps.calls.endpoint, 0);
  assert.equal(deps.calls.credential, 0);
  assert.equal(deps.calls.transport, 0);
});

test('Anthropic requires exact api_key credential scheme and rejects bearer or secret control characters', async () => {
  const plan = planFor();
  for (const credentialOverride of [
    { credentialRef: plan.transportBinding.credentialRefs[0], status: 'ready', scheme: 'bearer', secret: 'wrong-scheme' },
    { credentialRef: plan.transportBinding.credentialRefs[0], status: 'ready', scheme: 'api_key', secret: 'bad\nsecret' },
    { credentialRef: 'credential.other', status: 'ready', scheme: 'api_key', secret: 'secret' },
  ]) {
    const deps = dependencies(plan, { credentialOverride });
    await assert.rejects(
      () => executeProviderAdapterPlan({ plan, authorizationRequest: authorizationFor(plan), ...deps, at: AT }),
      /api_key|control characters|credentialRef/,
    );
    assert.equal(deps.calls.transport, 0);
  }
});

test('HumanGate semantics remain bound to Anthropic semantic risk rather than HTTP POST', async () => {
  const plan = planFor({ humanGatePolicy: 'task' });
  const deps = dependencies(plan);
  const wrongGate = authorizationFor(plan, { requirements: { humanGateRequired: false } });
  await assert.rejects(
    () => executeProviderAdapterPlan({ plan, authorizationRequest: wrongGate, ...deps, at: AT }),
    /Human Gate requirement does not match/,
  );
  assert.equal(deps.calls.transport, 0);
});

test('Anthropic endpoint remains exact approved HTTPS with no query fragment or embedded credentials', async () => {
  const plan = planFor();
  const cases = [
    { endpointRef: 'endpoint.other', networkPolicyRef: plan.transportBinding.networkPolicyRef, status: 'approved', url: 'https://anthropic.fixture.test/v1/messages' },
    { endpointRef: plan.transportBinding.endpointRef, networkPolicyRef: 'network.other', status: 'approved', url: 'https://anthropic.fixture.test/v1/messages' },
    { endpointRef: plan.transportBinding.endpointRef, networkPolicyRef: plan.transportBinding.networkPolicyRef, status: 'pending', url: 'https://anthropic.fixture.test/v1/messages' },
    { endpointRef: plan.transportBinding.endpointRef, networkPolicyRef: plan.transportBinding.networkPolicyRef, status: 'approved', url: 'http://anthropic.fixture.test/v1/messages' },
    { endpointRef: plan.transportBinding.endpointRef, networkPolicyRef: plan.transportBinding.networkPolicyRef, status: 'approved', url: 'https://anthropic.fixture.test/v1/messages?beta=1' },
    { endpointRef: plan.transportBinding.endpointRef, networkPolicyRef: plan.transportBinding.networkPolicyRef, status: 'approved', url: 'https://user:pass@anthropic.fixture.test/v1/messages' },
  ];
  for (const endpointOverride of cases) {
    const deps = dependencies(plan, { endpointOverride });
    await assert.rejects(
      () => executeProviderAdapterPlan({ plan, authorizationRequest: authorizationFor(plan), ...deps, at: AT }),
      /endpointRef|networkPolicyRef|not approved|https|credentials|query|fragment/,
    );
    assert.equal(deps.calls.transport, 0);
  }
});

test('Anthropic transport response cannot smuggle raw headers and provider errors stay receipt-bounded', async () => {
  const plan = planFor();
  const leaky = dependencies(plan, { response: {
    statusCode: 200,
    contentType: 'application/json',
    bodyText: '{}',
    providerRequestId: 'anthropic-request-leak',
    headers: { 'x-api-key': 'should-never-return' },
  } });
  await assert.rejects(
    () => executeProviderAdapterPlan({ plan, authorizationRequest: authorizationFor(plan), ...leaky, at: AT, clock: deterministicClock() }),
    /unsupported field: headers/,
  );

  const failed = dependencies(plan, { response: {
    statusCode: 429,
    contentType: 'application/json',
    bodyText: JSON.stringify({ error: { message: 'sensitive provider detail not returned' } }),
    providerRequestId: 'anthropic-request-429',
  } });
  const result = await executeProviderAdapterPlan({
    plan,
    authorizationRequest: authorizationFor(plan),
    ...failed,
    at: AT,
    clock: deterministicClock(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.result, null);
  assert.equal(result.receipt.outcome, 'provider_error');
  assert.equal(result.receipt.statusCode, 429);
  assert.doesNotMatch(JSON.stringify(result.receipt), /sensitive provider detail|anthropic-test-secret-never-returned/);
});

test('transport exceptions are sanitized and caller has no Anthropic beta/header injection surface', async () => {
  const plan = planFor();
  const deps = dependencies(plan);
  deps.transport.invoke = async () => {
    throw new Error('x-api-key anthropic-test-secret-never-returned at https://secret.example');
  };
  await assert.rejects(
    () => executeProviderAdapterPlan({ plan, authorizationRequest: authorizationFor(plan), ...deps, at: AT }),
    (error) => {
      assert.equal(error.message, 'provider transport failed');
      return true;
    },
  );
  assert.equal(deps.calls.transport, 0);

  const providerManifest = anthropicManifest();
  const catalog = createProviderRuntimeCatalog([providerManifest]);
  const route = resolveProviderRuntimeRoute({ catalog, providerId: providerManifest.providerId, operationId: 'draft', at: AT });
  assert.throws(() => compileProviderAdapterPlan({
    route,
    request: {
      schema: 'provider.runtime.request.v1',
      requestId: 'req-anthropic-injection',
      providerId: providerManifest.providerId,
      operationId: 'draft',
      modelRef: 'claude-fixture-model',
      messages: [{ role: 'user', content: 'hello' }],
      maxTokens: 10,
      headers: { 'anthropic-beta': 'caller-controlled' },
    },
  }), /unsupported field: headers/);
});
