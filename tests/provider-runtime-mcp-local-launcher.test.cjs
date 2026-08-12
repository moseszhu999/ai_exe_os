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
  executeRegisteredLocalMcpProviderAdapterPlan,
} = require('../src/integrations/provider-runtime/mcp-local-launcher-executor.cjs');

const AT = '2026-08-12T06:00:00.000Z';
const WINDOW = Object.freeze({
  observedAt: '2026-08-12T00:00:00.000Z',
  validUntil: '2026-09-12T00:00:00.000Z',
  sourceRefs: ['source.local-mcp-launcher-registry'],
});

function manifest({
  riskClass = 'observe',
  humanGatePolicy = 'never',
  toolName = 'workspace_read_summary',
  launcherRef = 'launcher.codex-local-mcp',
  credentialRefs = [],
  networkPolicyRef,
} = {}) {
  return {
    schema: PROVIDER_RUNTIME_MANIFEST_SCHEMA,
    providerId: 'codex-local',
    displayName: 'Codex Local MCP',
    providerKind: 'mcp_server',
    protocolFamily: 'mcp',
    transport: {
      mode: 'registered_local_launcher',
      launcherRef,
      credentialRefs,
      ...(networkPolicyRef === undefined ? {} : { networkPolicyRef }),
    },
    operations: [{
      operationId: 'workspace-read',
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
    providerId: 'codex-local',
    operationId: 'workspace-read',
    at: AT,
  });
  return compileProviderAdapterPlan({
    route,
    request: {
      schema: 'provider.runtime.request.v1',
      requestId: 'req-local-mcp-1',
      providerId: 'codex-local',
      operationId: 'workspace-read',
      toolName: providerManifest.operations[0].toolNames[0],
      arguments: { workspaceRef: 'workspace.trainingos' },
    },
  });
}

function authorizationFor(plan, overrides = {}) {
  const binding = expectedAuthorizationBinding(plan);
  const humanGateRequired = plan.semanticOperation.humanGatePolicy !== 'never';
  const base = {
    schema: 'execution.authorization.request.v1',
    requestRef: 'exec-request-local-mcp-1',
    organizationRef: 'org.test',
    actorRef: 'agent.runtime',
    actorKind: 'agent',
    requestedActionRef: 'requested-action.provider-local-mcp',
    action: binding.action,
    targetRef: binding.targetRef,
    observedAt: AT,
    requirements: {
      requiredHumanCapabilityRefs: [],
      requiredAgentCapabilityRefs: ['cap.provider-local-mcp'],
      requiredEvidenceRefs: ['evidence.provider-local-mcp-binding'],
      requiredPolicyRefs: ['policy.provider-local-launcher'],
      humanGateRequired,
    },
    resolved: {
      authorityGrant: {
        ref: 'grant.provider-local-mcp',
        status: 'active',
        organizationRef: 'org.test',
        actorRef: 'agent.runtime',
        allowedActions: [binding.action],
        allowedTargets: [binding.targetRef],
        expiresAt: '2026-08-12T07:00:00.000Z',
      },
      delegation: {
        ref: 'delegation.provider-local-mcp',
        status: 'active',
        organizationRef: 'org.test',
        actorRef: 'agent.runtime',
        allowedActions: [binding.action],
        allowedTargets: [binding.targetRef],
        expiresAt: '2026-08-12T07:00:00.000Z',
      },
      humanCapabilityCredentials: [],
      agentCapabilityPackages: [{ ref: 'cap.provider-local-mcp', status: 'accepted' }],
      evidence: [{ ref: 'evidence.provider-local-mcp-binding', status: 'current' }],
      policies: [{ ref: 'policy.provider-local-launcher', status: 'current' }],
      humanGate: humanGateRequired ? { ref: 'gate.provider-local-mcp', state: 'approved' } : null,
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

function dependencies(plan, { launcherOverride, response, throwTransport = false } = {}) {
  const calls = { launcher: 0, transport: 0, transportRequest: null };
  return {
    calls,
    launcherRegistry: {
      async resolve(request) {
        calls.launcher += 1;
        assert.equal(request.launcherRef, plan.transportBinding.launcherRef);
        return launcherOverride || {
          launcherRef: plan.transportBinding.launcherRef,
          status: 'approved',
          protocolFamily: 'mcp',
          transportMode: 'registered_local_launcher',
        };
      },
    },
    localMcpTransport: {
      async invokeTool(request) {
        calls.transport += 1;
        calls.transportRequest = request;
        if (throwTransport) throw new Error('private launcher failure');
        return response || {
          protocolVersion: MCP_STABLE_PROTOCOL_VERSION,
          result: {
            content: [{ type: 'text', text: 'workspace-summary-ready' }],
            isError: false,
          },
          providerRequestId: 'local-mcp-request-1',
        };
      },
    },
  };
}

function deterministicClock() {
  const values = ['2026-08-12T06:00:00.100Z', '2026-08-12T06:00:00.200Z'];
  return { now: () => values.shift() || '2026-08-12T06:00:00.200Z' };
}

test('executes an authorized registered local MCP tool using only the opaque launcher ref', async () => {
  const plan = planFor();
  const deps = dependencies(plan);
  const result = await executeRegisteredLocalMcpProviderAdapterPlan({
    plan,
    authorizationRequest: authorizationFor(plan),
    ...deps,
    at: AT,
    clock: deterministicClock(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.result.content[0].text, 'workspace-summary-ready');
  assert.equal(result.receipt.schema, PROVIDER_EXECUTION_RECEIPT_SCHEMA);
  assert.equal(result.receipt.providerId, 'codex-local');
  assert.equal(result.receipt.protocolFamily, 'mcp');
  assert.equal(result.receipt.protocolVersion, MCP_STABLE_PROTOCOL_VERSION);
  assert.equal(result.receipt.protocolOperation, 'tools/call');
  assert.equal(result.receipt.toolName, 'workspace_read_summary');
  assert.equal(result.receipt.launcherRef, 'launcher.codex-local-mcp');
  assert.equal(result.receipt.endpointRef, null);
  assert.equal(result.receipt.networkPolicyRef, null);
  assert.deepEqual(result.receipt.credentialRefs, []);
  assert.equal(result.receipt.flags.networkPerformed, false);
  assert.equal(result.receipt.flags.credentialResolved, false);
  assert.equal(result.receipt.flags.externalActionPerformed, false);
  assert.equal(result.receipt.flags.automaticRetryPerformed, false);
  assert.equal(deps.calls.launcher, 1);
  assert.equal(deps.calls.transport, 1);
  assert.deepEqual(deps.calls.transportRequest.launcher, { launcherRef: 'launcher.codex-local-mcp' });
  assert.equal(deps.calls.transportRequest.request.method, 'tools/call');
  assert.equal(deps.calls.transportRequest.request.toolName, 'workspace_read_summary');
  assert.deepEqual(deps.calls.transportRequest.request.arguments, { workspaceRef: 'workspace.trainingos' });
  assert.doesNotMatch(JSON.stringify(deps.calls.transportRequest), /command|argv|cwd|process\.env|shell|executable|path/);
  assert.equal(Object.isFrozen(result.receipt), true);
});

test('authorization denial blocks launcher resolution and local effect', async () => {
  const plan = planFor();
  const deps = dependencies(plan);
  const denied = authorizationFor(plan, {
    resolved: { authorityGrant: { ...authorizationFor(plan).resolved.authorityGrant, status: 'revoked' } },
  });
  await assert.rejects(() => executeRegisteredLocalMcpProviderAdapterPlan({
    plan,
    authorizationRequest: denied,
    ...deps,
    at: AT,
  }), /authorization denied/);
  assert.deepEqual(deps.calls, { launcher: 0, transport: 0, transportRequest: null });
});

test('launcher registry must preserve exact approved launcher/protocol/transport identity', async () => {
  const plan = planFor();
  const cases = [
    { launcherRef: 'launcher.other', status: 'approved', protocolFamily: 'mcp', transportMode: 'registered_local_launcher' },
    { launcherRef: plan.transportBinding.launcherRef, status: 'disabled', protocolFamily: 'mcp', transportMode: 'registered_local_launcher' },
    { launcherRef: plan.transportBinding.launcherRef, status: 'approved', protocolFamily: 'http.json', transportMode: 'registered_local_launcher' },
    { launcherRef: plan.transportBinding.launcherRef, status: 'approved', protocolFamily: 'mcp', transportMode: 'shell' },
  ];
  for (const launcherOverride of cases) {
    const deps = dependencies(plan, { launcherOverride });
    await assert.rejects(() => executeRegisteredLocalMcpProviderAdapterPlan({
      plan,
      authorizationRequest: authorizationFor(plan),
      ...deps,
      at: AT,
    }), /launcherRef|not approved|protocolFamily|transport mode/);
    assert.equal(deps.calls.transport, 0);
  }
});

test('launcher registry cannot smuggle command, path, cwd, env, or arbitrary process metadata', async () => {
  const plan = planFor();
  const deps = dependencies(plan, {
    launcherOverride: {
      launcherRef: plan.transportBinding.launcherRef,
      status: 'approved',
      protocolFamily: 'mcp',
      transportMode: 'registered_local_launcher',
      command: '/bin/sh',
    },
  });
  await assert.rejects(() => executeRegisteredLocalMcpProviderAdapterPlan({
    plan,
    authorizationRequest: authorizationFor(plan),
    ...deps,
    at: AT,
  }), /unsupported field: command/);
  assert.equal(deps.calls.transport, 0);
});

test('registered local launcher v1 refuses endpoint, credential, and network-policy widening', async () => {
  for (const config of [
    { credentialRefs: ['credential.local-secret'] },
    { networkPolicyRef: 'network.local-egress' },
  ]) {
    const plan = planFor(config);
    const deps = dependencies(plan);
    await assert.rejects(() => executeRegisteredLocalMcpProviderAdapterPlan({
      plan,
      authorizationRequest: authorizationFor(plan),
      ...deps,
      at: AT,
    }), /must not carry credentialRefs|must not carry networkPolicyRef/);
    assert.equal(deps.calls.launcher, 0);
    assert.equal(deps.calls.transport, 0);
  }
});

test('internalWrite and externalAction remain closed for local launcher MCP', async () => {
  for (const config of [
    { riskClass: 'internalWrite', humanGatePolicy: 'task', toolName: 'workspace_write_file' },
    { riskClass: 'externalAction', humanGatePolicy: 'action', toolName: 'workspace_publish' },
  ]) {
    const plan = planFor(config);
    const deps = dependencies(plan);
    await assert.rejects(() => executeRegisteredLocalMcpProviderAdapterPlan({
      plan,
      authorizationRequest: authorizationFor(plan),
      ...deps,
      at: AT,
    }), /only permits observe\/draft/);
    assert.equal(deps.calls.launcher, 0);
    assert.equal(deps.calls.transport, 0);
  }
});

test('protocol drift and response metadata smuggling fail closed', async () => {
  const plan = planFor();
  const versionDrift = dependencies(plan, {
    response: {
      protocolVersion: '2026-07-28',
      result: { content: [], isError: false },
      providerRequestId: 'drift',
    },
  });
  await assert.rejects(() => executeRegisteredLocalMcpProviderAdapterPlan({
    plan,
    authorizationRequest: authorizationFor(plan),
    ...versionDrift,
    at: AT,
    clock: deterministicClock(),
  }), /protocol version drift/);

  const metadataLeak = dependencies(plan, {
    response: {
      protocolVersion: MCP_STABLE_PROTOCOL_VERSION,
      result: { content: [], isError: false },
      providerRequestId: 'leak',
      sessionId: 'private-session',
    },
  });
  await assert.rejects(() => executeRegisteredLocalMcpProviderAdapterPlan({
    plan,
    authorizationRequest: authorizationFor(plan),
    ...metadataLeak,
    at: AT,
    clock: deterministicClock(),
  }), /unsupported field: sessionId/);
});

test('local transport exception is sanitized and never exposes private launcher error text', async () => {
  const plan = planFor();
  const deps = dependencies(plan, { throwTransport: true });
  await assert.rejects(
    () => executeRegisteredLocalMcpProviderAdapterPlan({
      plan,
      authorizationRequest: authorizationFor(plan),
      ...deps,
      at: AT,
      clock: deterministicClock(),
    }),
    (error) => {
      assert.equal(error.message, 'local MCP transport failed');
      assert.doesNotMatch(error.message, /private launcher failure/);
      return true;
    },
  );
  assert.equal(deps.calls.transport, 1);
});
