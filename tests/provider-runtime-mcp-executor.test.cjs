'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PROVIDER_RUNTIME_MANIFEST_SCHEMA,
  createProviderRuntimeCatalog,
  resolveProviderRuntimeRoute,
} = require('../src/integrations/provider-runtime/index.cjs');
const { compileProviderAdapterPlan } = require('../src/integrations/provider-runtime/adapter-plan.cjs');
const { PROVIDER_EXECUTION_RECEIPT_SCHEMA, expectedAuthorizationBinding } = require('../src/integrations/provider-runtime/executor.cjs');
const {
  MCP_STABLE_PROTOCOL_VERSION,
  executeMcpProviderAdapterPlan,
} = require('../src/integrations/provider-runtime/mcp-executor.cjs');

const AT = '2026-08-11T14:00:00.000Z';
const WINDOW = Object.freeze({
  observedAt: '2026-08-11T00:00:00.000Z',
  validUntil: '2026-09-11T00:00:00.000Z',
  sourceRefs: ['source.shared-media-mcp-contract'],
});

function manifest({
  riskClass = 'observe',
  humanGatePolicy = 'never',
  toolName = 'media_get_artifact',
  credentialRefs = ['credential.shared-media-mcp'],
  endpointRef = 'endpoint.shared-media-mcp',
  networkPolicyRef = 'network.shared-media-private',
} = {}) {
  return {
    schema: PROVIDER_RUNTIME_MANIFEST_SCHEMA,
    providerId: 'shared-media',
    displayName: 'Shared Media MCP',
    providerKind: 'mcp_server',
    protocolFamily: 'mcp',
    transport: {
      mode: 'mcp_streamable_http',
      endpointRef,
      credentialRefs,
      networkPolicyRef,
    },
    operations: [{
      operationId: 'media-tool',
      providerOperation: 'tools/call',
      riskClass,
      humanGatePolicy,
      toolNames: [toolName],
    }],
    freshness: WINDOW,
    status: 'available',
  };
}

function planFor(overrides = {}) {
  const providerManifest = manifest(overrides);
  const catalog = createProviderRuntimeCatalog([providerManifest]);
  const route = resolveProviderRuntimeRoute({
    catalog,
    providerId: 'shared-media',
    operationId: 'media-tool',
    at: AT,
  });
  return compileProviderAdapterPlan({
    route,
    request: {
      schema: 'provider.runtime.request.v1',
      requestId: 'req-mcp-1',
      providerId: 'shared-media',
      operationId: 'media-tool',
      toolName: providerManifest.operations[0].toolNames[0],
      arguments: { artifactRef: 'artifact.lesson-video-001' },
    },
  });
}

function authorizationFor(plan, overrides = {}) {
  const binding = expectedAuthorizationBinding(plan);
  const humanGateRequired = plan.semanticOperation.humanGatePolicy !== 'never';
  const base = {
    schema: 'execution.authorization.request.v1',
    requestRef: 'exec-request-mcp-1',
    organizationRef: 'org.test',
    actorRef: 'agent.runtime',
    actorKind: 'agent',
    requestedActionRef: 'requested-action.provider-mcp',
    action: binding.action,
    targetRef: binding.targetRef,
    observedAt: AT,
    requirements: {
      requiredHumanCapabilityRefs: [],
      requiredAgentCapabilityRefs: ['cap.provider-mcp'],
      requiredEvidenceRefs: ['evidence.provider-mcp-binding'],
      requiredPolicyRefs: ['policy.provider-mcp-egress'],
      humanGateRequired,
    },
    resolved: {
      authorityGrant: {
        ref: 'grant.provider-mcp',
        status: 'active',
        organizationRef: 'org.test',
        actorRef: 'agent.runtime',
        allowedActions: [binding.action],
        allowedTargets: [binding.targetRef],
        expiresAt: '2026-08-11T15:00:00.000Z',
      },
      delegation: {
        ref: 'delegation.provider-mcp',
        status: 'active',
        organizationRef: 'org.test',
        actorRef: 'agent.runtime',
        allowedActions: [binding.action],
        allowedTargets: [binding.targetRef],
        expiresAt: '2026-08-11T15:00:00.000Z',
      },
      humanCapabilityCredentials: [],
      agentCapabilityPackages: [{ ref: 'cap.provider-mcp', status: 'accepted' }],
      evidence: [{ ref: 'evidence.provider-mcp-binding', status: 'current' }],
      policies: [{ ref: 'policy.provider-mcp-egress', status: 'current' }],
      humanGate: humanGateRequired ? { ref: 'gate.provider-mcp', state: 'approved' } : null,
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

function dependencies(plan, {
  endpointOverride,
  credentialOverride,
  response,
  loopback = false,
} = {}) {
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
          url: loopback ? 'http://127.0.0.1:3210/mcp' : 'https://media.example.test/mcp',
          ...(loopback ? { allowLoopbackHttp: true } : {}),
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
          secret: 'mcp-test-secret-never-returned',
        };
      },
    },
    mcpTransport: {
      async invokeTool(request) {
        calls.transport += 1;
        calls.transportRequest = request;
        return response || {
          protocolVersion: MCP_STABLE_PROTOCOL_VERSION,
          result: {
            content: [{ type: 'text', text: 'artifact-ready' }],
            isError: false,
          },
          providerRequestId: 'mcp-request-1',
        };
      },
    },
  };
}

function deterministicClock() {
  const values = ['2026-08-11T14:00:00.100Z', '2026-08-11T14:00:00.200Z'];
  return { now: () => values.shift() || '2026-08-11T14:00:00.200Z' };
}

test('executes authorized Shared Media MCP observe tool with exact tools/call binding and secret-free receipt', async () => {
  const plan = planFor();
  const deps = dependencies(plan);
  const result = await executeMcpProviderAdapterPlan({
    plan,
    authorizationRequest: authorizationFor(plan),
    ...deps,
    at: AT,
    clock: deterministicClock(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.result.content[0].text, 'artifact-ready');
  assert.equal(result.receipt.schema, PROVIDER_EXECUTION_RECEIPT_SCHEMA);
  assert.equal(result.receipt.providerId, 'shared-media');
  assert.equal(result.receipt.protocolFamily, 'mcp');
  assert.equal(result.receipt.protocolVersion, MCP_STABLE_PROTOCOL_VERSION);
  assert.equal(result.receipt.protocolOperation, 'tools/call');
  assert.equal(result.receipt.toolName, 'media_get_artifact');
  assert.equal(result.receipt.flags.automaticRetryPerformed, false);
  assert.equal(deps.calls.transport, 1);
  assert.equal(deps.calls.transportRequest.protocolVersion, MCP_STABLE_PROTOCOL_VERSION);
  assert.equal(deps.calls.transportRequest.request.method, 'tools/call');
  assert.equal(deps.calls.transportRequest.request.toolName, 'media_get_artifact');
  assert.deepEqual(deps.calls.transportRequest.request.arguments, { artifactRef: 'artifact.lesson-video-001' });
  assert.equal(deps.calls.transportRequest.credential.secret, 'mcp-test-secret-never-returned');
  assert.doesNotMatch(JSON.stringify(result.receipt), /mcp-test-secret-never-returned|https:\/\/|127\.0\.0\.1/);
  assert.equal(Object.isFrozen(result.receipt), true);
});

test('supports explicitly approved exact loopback HTTP for local MCP without widening to arbitrary HTTP', async () => {
  const plan = planFor();
  const deps = dependencies(plan, { loopback: true });
  const result = await executeMcpProviderAdapterPlan({ plan, authorizationRequest: authorizationFor(plan), ...deps, at: AT, clock: deterministicClock() });
  assert.equal(result.ok, true);
  assert.equal(deps.calls.transportRequest.endpoint.url, 'http://127.0.0.1:3210/mcp');
  assert.equal(result.receipt.endpointRef, 'endpoint.shared-media-mcp');
  assert.doesNotMatch(JSON.stringify(result.receipt), /127\.0\.0\.1/);
});

test('authorization denial blocks endpoint credential and MCP transport before any effect', async () => {
  const plan = planFor();
  const deps = dependencies(plan);
  const denied = authorizationFor(plan, {
    resolved: { authorityGrant: { ...authorizationFor(plan).resolved.authorityGrant, status: 'revoked' } },
  });
  await assert.rejects(() => executeMcpProviderAdapterPlan({ plan, authorizationRequest: denied, ...deps, at: AT }), /authorization denied/);
  assert.deepEqual(deps.calls, { endpoint: 0, credential: 0, transport: 0, transportRequest: null });
});

test('plan digest tampering and exact action/target drift fail before MCP transport', async () => {
  const plan = planFor();
  const tampered = structuredClone(plan);
  tampered.protocolCall.payload.params.name = 'media_generate_asset';
  const deps = dependencies(plan);
  await assert.rejects(() => executeMcpProviderAdapterPlan({ plan: tampered, authorizationRequest: authorizationFor(plan), ...deps, at: AT }), /plan digest mismatch/);
  await assert.rejects(() => executeMcpProviderAdapterPlan({
    plan,
    authorizationRequest: authorizationFor(plan, { action: 'provider.runtime.other.other' }),
    ...deps,
    at: AT,
  }), /action does not match/);
  await assert.rejects(() => executeMcpProviderAdapterPlan({
    plan,
    authorizationRequest: authorizationFor(plan, { targetRef: 'prv.other' }),
    ...deps,
    at: AT,
  }), /target does not match/);
  assert.equal(deps.calls.transport, 0);
});

test('HumanGate requirement stays bound to the semantic MCP plan', async () => {
  const plan = planFor({ riskClass: 'draft', humanGatePolicy: 'task' });
  const deps = dependencies(plan);
  const request = authorizationFor(plan, { requirements: { humanGateRequired: false } });
  await assert.rejects(() => executeMcpProviderAdapterPlan({ plan, authorizationRequest: request, ...deps, at: AT }), /Human Gate requirement does not match/);
  assert.equal(deps.calls.transport, 0);
});

test('internalWrite and externalAction MCP plans remain closed in P2.3 even with HumanGate policies', async () => {
  for (const config of [
    { riskClass: 'internalWrite', humanGatePolicy: 'task', toolName: 'media_generate_asset' },
    { riskClass: 'externalAction', humanGatePolicy: 'action', toolName: 'media_publish_asset' },
  ]) {
    const plan = planFor(config);
    const deps = dependencies(plan);
    await assert.rejects(() => executeMcpProviderAdapterPlan({ plan, authorizationRequest: authorizationFor(plan), ...deps, at: AT }), /only permits observe\/draft/);
    assert.equal(deps.calls.endpoint, 0);
    assert.equal(deps.calls.transport, 0);
  }
});

test('endpoint resolver must preserve exact endpoint/network binding and HTTPS or opted-in exact loopback', async () => {
  const plan = planFor();
  const cases = [
    { endpointRef: 'endpoint.other', networkPolicyRef: plan.transportBinding.networkPolicyRef, status: 'approved', url: 'https://media.example.test/mcp' },
    { endpointRef: plan.transportBinding.endpointRef, networkPolicyRef: 'network.other', status: 'approved', url: 'https://media.example.test/mcp' },
    { endpointRef: plan.transportBinding.endpointRef, networkPolicyRef: plan.transportBinding.networkPolicyRef, status: 'pending', url: 'https://media.example.test/mcp' },
    { endpointRef: plan.transportBinding.endpointRef, networkPolicyRef: plan.transportBinding.networkPolicyRef, status: 'approved', url: 'http://media.example.test/mcp' },
    { endpointRef: plan.transportBinding.endpointRef, networkPolicyRef: plan.transportBinding.networkPolicyRef, status: 'approved', url: 'http://127.0.0.1:3210/mcp' },
    { endpointRef: plan.transportBinding.endpointRef, networkPolicyRef: plan.transportBinding.networkPolicyRef, status: 'approved', url: 'https://media.example.test/mcp?tool=other' },
  ];
  for (const endpointOverride of cases) {
    const deps = dependencies(plan, { endpointOverride });
    await assert.rejects(() => executeMcpProviderAdapterPlan({ plan, authorizationRequest: authorizationFor(plan), ...deps, at: AT }), /endpointRef|networkPolicyRef|not approved|HTTPS|query/);
    assert.equal(deps.calls.transport, 0);
  }
});

test('MCP credential is optional, but when present it must be the exact ready bearer ref', async () => {
  const noCredentialPlan = planFor({ credentialRefs: [] });
  const noCredentialDeps = dependencies(noCredentialPlan);
  noCredentialDeps.credentialResolver.resolve = async () => { throw new Error('must not resolve'); };
  const noCredentialResult = await executeMcpProviderAdapterPlan({
    plan: noCredentialPlan,
    authorizationRequest: authorizationFor(noCredentialPlan),
    ...noCredentialDeps,
    at: AT,
    clock: deterministicClock(),
  });
  assert.equal(noCredentialResult.ok, true);
  assert.equal(noCredentialDeps.calls.credential, 0);
  assert.equal(noCredentialDeps.calls.transportRequest.credential, null);
  assert.deepEqual(noCredentialResult.receipt.credentialRefs, []);

  const plan = planFor();
  for (const credentialOverride of [
    { credentialRef: 'credential.other', status: 'ready', scheme: 'bearer', secret: 'x' },
    { credentialRef: plan.transportBinding.credentialRefs[0], status: 'disabled', scheme: 'bearer', secret: 'x' },
    { credentialRef: plan.transportBinding.credentialRefs[0], status: 'ready', scheme: 'basic', secret: 'x' },
  ]) {
    const deps = dependencies(plan, { credentialOverride });
    await assert.rejects(() => executeMcpProviderAdapterPlan({ plan, authorizationRequest: authorizationFor(plan), ...deps, at: AT }), /credentialRef|not ready|bearer/);
    assert.equal(deps.calls.transport, 0);
  }
});

test('stable MCP protocol version is fail-closed and response metadata cannot smuggle raw headers', async () => {
  const plan = planFor();
  const versionDrift = dependencies(plan, { response: {
    protocolVersion: '2025-06-18',
    result: { content: [], isError: false },
  } });
  await assert.rejects(() => executeMcpProviderAdapterPlan({ plan, authorizationRequest: authorizationFor(plan), ...versionDrift, at: AT, clock: deterministicClock() }), /protocol version drift/);

  const headerLeak = dependencies(plan, { response: {
    protocolVersion: MCP_STABLE_PROTOCOL_VERSION,
    result: { content: [], isError: false },
    headers: { 'mcp-session-id': 'secret-session' },
  } });
  await assert.rejects(() => executeMcpProviderAdapterPlan({ plan, authorizationRequest: authorizationFor(plan), ...headerLeak, at: AT, clock: deterministicClock() }), /unsupported field: headers/);
});

test('tool-level isError is bounded result data, not external-action authority, and receipt stores digest only', async () => {
  const plan = planFor();
  const deps = dependencies(plan, { response: {
    protocolVersion: MCP_STABLE_PROTOCOL_VERSION,
    result: { content: [{ type: 'text', text: 'artifact not found internal detail' }], isError: true },
    providerRequestId: 'mcp-error-1',
  } });
  const result = await executeMcpProviderAdapterPlan({ plan, authorizationRequest: authorizationFor(plan), ...deps, at: AT, clock: deterministicClock() });
  assert.equal(result.ok, false);
  assert.equal(result.result.isError, true);
  assert.equal(result.receipt.outcome, 'tool_error');
  assert.doesNotMatch(JSON.stringify(result.receipt), /artifact not found internal detail/);
  assert.match(result.receipt.responseDigest, /^sha256:[a-f0-9]{64}$/);
});

test('executor accepts only the bounded invokeTool port, never generic invoke/fetch primitives', async () => {
  const plan = planFor();
  const deps = dependencies(plan);
  await assert.rejects(() => executeMcpProviderAdapterPlan({
    plan,
    authorizationRequest: authorizationFor(plan),
    endpointResolver: deps.endpointResolver,
    credentialResolver: deps.credentialResolver,
    mcpTransport: { invoke: async () => ({}) },
    at: AT,
  }), /mcpTransport\.invokeTool is required/);
});

test('transport exceptions are sanitized and never automatically retried', async () => {
  const plan = planFor();
  const deps = dependencies(plan);
  deps.mcpTransport.invokeTool = async () => {
    deps.calls.transport += 1;
    throw new Error('Bearer mcp-test-secret-never-returned at https://private.example/mcp');
  };
  await assert.rejects(() => executeMcpProviderAdapterPlan({ plan, authorizationRequest: authorizationFor(plan), ...deps, at: AT }), (error) => {
    assert.equal(error.message, 'MCP transport failed');
    assert.doesNotMatch(error.message, /Bearer|private\.example|secret/);
    return true;
  });
  assert.equal(deps.calls.transport, 1);
});

test('authorization observation freshness is checked before endpoint or MCP transport work', async () => {
  const plan = planFor();
  const deps = dependencies(plan);
  await assert.rejects(() => executeMcpProviderAdapterPlan({
    plan,
    authorizationRequest: authorizationFor(plan),
    ...deps,
    at: '2026-08-11T14:01:00.000Z',
  }), /too far/);
  assert.equal(deps.calls.endpoint, 0);
  assert.equal(deps.calls.transport, 0);
});
