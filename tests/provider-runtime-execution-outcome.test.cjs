'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PROVIDER_RUNTIME_MANIFEST_SCHEMA,
  createProviderRuntimeCatalog,
  resolveProviderRuntimeRoute,
} = require('../src/integrations/provider-runtime/index.cjs');
const { compileProviderAdapterPlan } = require('../src/integrations/provider-runtime/adapter-plan.cjs');
const { expectedAuthorizationBinding } = require('../src/integrations/provider-runtime/executor.cjs');
const {
  PROVIDER_EXECUTION_ATTEMPT_SCHEMA,
  PROVIDER_EXECUTION_OUTCOME_SCHEMA,
  ProviderExecutionUncertainError,
  createInitialProviderExecutionAttempt,
  createReviewedProviderRetryAttempt,
  executeModelProviderAttempt,
  executeMcpProviderAttempt,
} = require('../src/integrations/provider-runtime/execution-outcome.cjs');

const AT = '2026-08-11T15:30:00.000Z';
const RETRY_AT = '2026-08-11T15:30:20.000Z';
const WINDOW = Object.freeze({
  observedAt: '2026-08-11T00:00:00.000Z',
  validUntil: '2026-09-11T00:00:00.000Z',
  sourceRefs: ['source.provider-docs'],
});

function modelPlan() {
  const manifest = {
    schema: PROVIDER_RUNTIME_MANIFEST_SCHEMA,
    providerId: 'openai-p3-fixture',
    displayName: 'P3 model fixture',
    providerKind: 'model_api',
    protocolFamily: 'openai.responses',
    transport: {
      mode: 'https',
      endpointRef: 'endpoint.openai-p3-fixture',
      credentialRefs: ['credential.openai-p3-fixture'],
      networkPolicyRef: 'network.internet-egress-models',
    },
    operations: [{
      operationId: 'draft',
      providerOperation: 'responses.create',
      riskClass: 'draft',
      humanGatePolicy: 'never',
      modelRefs: ['gpt-fixture'],
    }],
    freshness: WINDOW,
    status: 'available',
  };
  const catalog = createProviderRuntimeCatalog([manifest]);
  const route = resolveProviderRuntimeRoute({ catalog, providerId: manifest.providerId, operationId: 'draft', at: AT });
  return compileProviderAdapterPlan({
    route,
    request: {
      schema: 'provider.runtime.request.v1',
      requestId: 'req-p3-model-1',
      providerId: manifest.providerId,
      operationId: 'draft',
      modelRef: 'gpt-fixture',
      inputText: 'Produce a bounded draft.',
      maxTokens: 120,
    },
  });
}

function mcpPlan() {
  const manifest = {
    schema: PROVIDER_RUNTIME_MANIFEST_SCHEMA,
    providerId: 'shared-media-p3-fixture',
    displayName: 'P3 MCP fixture',
    providerKind: 'mcp_server',
    protocolFamily: 'mcp',
    transport: {
      mode: 'mcp_streamable_http',
      endpointRef: 'endpoint.shared-media-p3-fixture',
      credentialRefs: [],
      networkPolicyRef: 'network.loopback-shared-media',
    },
    operations: [{
      operationId: 'inspect',
      providerOperation: 'tools/call',
      riskClass: 'observe',
      humanGatePolicy: 'never',
      toolNames: ['media_inspect'],
    }],
    freshness: WINDOW,
    status: 'available',
  };
  const catalog = createProviderRuntimeCatalog([manifest]);
  const route = resolveProviderRuntimeRoute({ catalog, providerId: manifest.providerId, operationId: 'inspect', at: AT });
  return compileProviderAdapterPlan({
    route,
    request: {
      schema: 'provider.runtime.request.v1',
      requestId: 'req-p3-mcp-1',
      providerId: manifest.providerId,
      operationId: 'inspect',
      toolName: 'media_inspect',
      arguments: { artifactRef: 'artifact.fixture-video' },
    },
  });
}

function authorizationFor(plan, observedAt = AT) {
  const binding = expectedAuthorizationBinding(plan);
  return {
    schema: 'execution.authorization.request.v1',
    requestRef: `exec-${plan.requestId}-${observedAt === AT ? '1' : '2'}`,
    organizationRef: 'org.test',
    actorRef: 'agent.runtime',
    actorKind: 'agent',
    requestedActionRef: `requested-action.${plan.requestId}`,
    action: binding.action,
    targetRef: binding.targetRef,
    observedAt,
    requirements: {
      requiredHumanCapabilityRefs: [],
      requiredAgentCapabilityRefs: ['cap.provider-p3'],
      requiredEvidenceRefs: ['evidence.provider-p3'],
      requiredPolicyRefs: ['policy.provider-p3'],
      humanGateRequired: false,
    },
    resolved: {
      authorityGrant: {
        ref: `grant.${plan.requestId}`,
        status: 'active',
        organizationRef: 'org.test',
        actorRef: 'agent.runtime',
        allowedActions: [binding.action],
        allowedTargets: [binding.targetRef],
        expiresAt: '2026-08-11T16:30:00.000Z',
      },
      delegation: {
        ref: `delegation.${plan.requestId}`,
        status: 'active',
        organizationRef: 'org.test',
        actorRef: 'agent.runtime',
        allowedActions: [binding.action],
        allowedTargets: [binding.targetRef],
        expiresAt: '2026-08-11T16:30:00.000Z',
      },
      humanCapabilityCredentials: [],
      agentCapabilityPackages: [{ ref: 'cap.provider-p3', status: 'accepted' }],
      evidence: [{ ref: 'evidence.provider-p3', status: 'current' }],
      policies: [{ ref: 'policy.provider-p3', status: 'current' }],
      humanGate: null,
      revocations: [],
    },
  };
}

function modelDeps(plan, transportImpl) {
  const calls = { endpoint: 0, credential: 0, transport: 0 };
  return {
    calls,
    endpointResolver: {
      async resolve() {
        calls.endpoint += 1;
        return {
          endpointRef: plan.transportBinding.endpointRef,
          networkPolicyRef: plan.transportBinding.networkPolicyRef,
          status: 'approved',
          url: 'https://provider.fixture.test/v1/responses',
        };
      },
    },
    credentialResolver: {
      async resolve() {
        calls.credential += 1;
        return {
          credentialRef: plan.transportBinding.credentialRefs[0],
          status: 'ready',
          scheme: 'bearer',
          secret: 'fixture-secret-never-returned',
        };
      },
    },
    transport: {
      async invoke(request) {
        calls.transport += 1;
        if (transportImpl) return transportImpl(request);
        return {
          statusCode: 200,
          contentType: 'application/json',
          bodyText: JSON.stringify({ id: 'response-fixture', output_text: 'bounded draft' }),
          providerRequestId: 'provider-request-p3',
        };
      },
    },
  };
}

function mcpDeps(plan, transportImpl) {
  const calls = { endpoint: 0, transport: 0 };
  return {
    calls,
    endpointResolver: {
      async resolve() {
        calls.endpoint += 1;
        return {
          endpointRef: plan.transportBinding.endpointRef,
          networkPolicyRef: plan.transportBinding.networkPolicyRef,
          status: 'approved',
          url: 'http://127.0.0.1:3210/mcp',
          allowLoopbackHttp: true,
        };
      },
    },
    mcpTransport: {
      async invokeTool(request) {
        calls.transport += 1;
        if (transportImpl) return transportImpl(request);
        return {
          protocolVersion: '2025-11-25',
          result: { content: [{ type: 'text', text: 'fixture inspected' }] },
          providerRequestId: 'mcp-request-p3',
        };
      },
    },
  };
}

function fixedOutcomeClock(value) {
  return { now: () => value };
}

test('model success emits provider.execution.attempt.v1 plus known success outcome without retry', async () => {
  const plan = modelPlan();
  const deps = modelDeps(plan);
  const result = await executeModelProviderAttempt({
    plan,
    authorizationRequest: authorizationFor(plan),
    ...deps,
    at: AT,
    outcomeClock: fixedOutcomeClock('2026-08-11T15:30:00.500Z'),
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempt.schema, PROVIDER_EXECUTION_ATTEMPT_SCHEMA);
  assert.match(result.attempt.attemptRef, /^provattempt_[a-f0-9]{24}$/);
  assert.equal(result.executionOutcome.schema, PROVIDER_EXECUTION_OUTCOME_SCHEMA);
  assert.equal(result.executionOutcome.outcome, 'success');
  assert.equal(result.executionOutcome.retry.automaticRetryPerformed, false);
  assert.equal(result.executionOutcome.retry.reviewedRetryRequired, false);
  assert.equal(result.executionOutcome.attemptRef, result.attempt.attemptRef);
  assert.equal(deps.calls.transport, 1);
  assert.doesNotMatch(JSON.stringify(result.executionOutcome), /fixture-secret-never-returned|https:\/\//);
});

test('known HTTP provider error remains known_failure and is never automatically retried', async () => {
  const plan = modelPlan();
  const deps = modelDeps(plan, async () => ({
    statusCode: 429,
    contentType: 'application/json',
    bodyText: JSON.stringify({ error: { message: 'quota detail' } }),
    providerRequestId: 'provider-request-429',
  }));
  const result = await executeModelProviderAttempt({
    plan,
    authorizationRequest: authorizationFor(plan),
    ...deps,
    at: AT,
    outcomeClock: fixedOutcomeClock('2026-08-11T15:30:00.500Z'),
  });
  assert.equal(result.ok, false);
  assert.equal(result.executionOutcome.outcome, 'known_failure');
  assert.equal(result.executionOutcome.knownFailureKind, 'provider_error');
  assert.equal(result.executionOutcome.statusCode, 429);
  assert.equal(result.executionOutcome.retry.automaticRetryPerformed, false);
  assert.equal(result.executionOutcome.retry.reviewedRetryRequired, false);
  assert.equal(deps.calls.transport, 1);
  assert.doesNotMatch(JSON.stringify(result.executionOutcome), /quota detail/);
});

test('model transport exception after effect-port entry becomes bounded uncertain outcome with exactly one invocation', async () => {
  const plan = modelPlan();
  const deps = modelDeps(plan, async () => {
    throw new Error('Bearer fixture-secret-never-returned at https://secret.example socket reset');
  });
  await assert.rejects(
    () => executeModelProviderAttempt({
      plan,
      authorizationRequest: authorizationFor(plan),
      ...deps,
      at: AT,
      outcomeClock: fixedOutcomeClock('2026-08-11T15:30:00.500Z'),
    }),
    (error) => {
      assert.equal(error instanceof ProviderExecutionUncertainError, true);
      assert.equal(error.message, 'provider transport failed');
      assert.equal(error.outcome.schema, PROVIDER_EXECUTION_OUTCOME_SCHEMA);
      assert.equal(error.outcome.outcome, 'uncertain');
      assert.equal(error.outcome.uncertainty.effectMayHaveOccurred, true);
      assert.equal(error.outcome.uncertainty.reasonCode, 'TRANSPORT_RESULT_UNKNOWN');
      assert.equal(error.outcome.retry.automaticRetryPerformed, false);
      assert.equal(error.outcome.retry.reviewedRetryRequired, true);
      assert.doesNotMatch(JSON.stringify(error.outcome), /fixture-secret-never-returned|secret\.example|socket reset/);
      return true;
    },
  );
  assert.equal(deps.calls.transport, 1);
});

test('pre-effect resolver failure is not misclassified as uncertain even if its message resembles transport failure', async () => {
  const plan = modelPlan();
  const deps = modelDeps(plan);
  deps.endpointResolver.resolve = async () => {
    deps.calls.endpoint += 1;
    throw new Error('provider transport failed');
  };
  await assert.rejects(
    () => executeModelProviderAttempt({ plan, authorizationRequest: authorizationFor(plan), ...deps, at: AT }),
    (error) => {
      assert.equal(error instanceof ProviderExecutionUncertainError, false);
      assert.equal(error.message, 'provider transport failed');
      return true;
    },
  );
  assert.equal(deps.calls.transport, 0);
});

test('MCP transport exception uses the same uncertain outcome contract and never retries automatically', async () => {
  const plan = mcpPlan();
  const deps = mcpDeps(plan, async () => {
    throw new Error('session secret and connection reset');
  });
  await assert.rejects(
    () => executeMcpProviderAttempt({
      plan,
      authorizationRequest: authorizationFor(plan),
      ...deps,
      at: AT,
      outcomeClock: fixedOutcomeClock('2026-08-11T15:30:00.500Z'),
    }),
    (error) => {
      assert.equal(error instanceof ProviderExecutionUncertainError, true);
      assert.equal(error.message, 'MCP transport failed');
      assert.equal(error.outcome.outcome, 'uncertain');
      assert.equal(error.outcome.protocolFamily, 'mcp');
      assert.equal(error.outcome.protocolVersion, '2025-11-25');
      assert.equal(error.outcome.retry.automaticRetryPerformed, false);
      assert.doesNotMatch(JSON.stringify(error.outcome), /session secret|connection reset/);
      return true;
    },
  );
  assert.equal(deps.calls.transport, 1);
});

test('reviewed retry requires prior uncertain evidence, a new attempt identity, and a new runtime idempotency key', async () => {
  const plan = modelPlan();
  const deps = modelDeps(plan, async () => { throw new Error('timeout'); });
  let priorOutcome;
  await assert.rejects(
    () => executeModelProviderAttempt({
      plan,
      authorizationRequest: authorizationFor(plan),
      ...deps,
      at: AT,
      outcomeClock: fixedOutcomeClock('2026-08-11T15:30:00.500Z'),
    }),
    (error) => {
      priorOutcome = error.outcome;
      return error instanceof ProviderExecutionUncertainError;
    },
  );

  const retry = createReviewedProviderRetryAttempt({
    priorOutcome,
    attemptId: 'attempt-reviewed-retry-2',
    idempotencyKey: 'idem.reviewed-retry-2',
    createdAt: RETRY_AT,
  });
  assert.equal(retry.reviewedRetry, true);
  assert.equal(retry.priorAttemptRef, priorOutcome.attemptRef);
  assert.notEqual(retry.attemptRef, priorOutcome.attemptRef);
  assert.notEqual(retry.idempotencyKeyDigest, priorOutcome.retry.idempotencyKeyDigest);

  assert.throws(() => createReviewedProviderRetryAttempt({
    priorOutcome,
    attemptId: 'attempt-reviewed-retry-bad-key',
    idempotencyKey: 'idem.' + priorOutcome.retry.idempotencyKeyDigest.slice(7, 39),
    createdAt: RETRY_AT,
  }), /new runtime idempotency key/);
});

test('known failure cannot be silently converted into reviewed uncertain retry', async () => {
  const plan = modelPlan();
  const deps = modelDeps(plan, async () => ({
    statusCode: 503,
    contentType: 'application/json',
    bodyText: JSON.stringify({ error: 'known service error' }),
  }));
  const result = await executeModelProviderAttempt({
    plan,
    authorizationRequest: authorizationFor(plan),
    ...deps,
    at: AT,
    outcomeClock: fixedOutcomeClock('2026-08-11T15:30:00.500Z'),
  });
  assert.throws(() => createReviewedProviderRetryAttempt({
    priorOutcome: result.executionOutcome,
    attemptId: 'attempt-illegal-retry',
    idempotencyKey: 'idem.illegal-retry',
    createdAt: RETRY_AT,
  }), /requires a prior uncertain outcome/);
});

test('reviewed retry executes once with a new attempt and fresh canonical authorization', async () => {
  const plan = modelPlan();
  const first = modelDeps(plan, async () => { throw new Error('unknown network result'); });
  let priorOutcome;
  await assert.rejects(
    () => executeModelProviderAttempt({
      plan,
      authorizationRequest: authorizationFor(plan),
      ...first,
      at: AT,
      outcomeClock: fixedOutcomeClock('2026-08-11T15:30:00.500Z'),
    }),
    (error) => {
      priorOutcome = error.outcome;
      return true;
    },
  );
  assert.equal(first.calls.transport, 1);

  const retryAttempt = createReviewedProviderRetryAttempt({
    priorOutcome,
    attemptId: 'attempt-reviewed-retry-success',
    idempotencyKey: 'idem.reviewed-retry-success',
    createdAt: RETRY_AT,
  });
  const second = modelDeps(plan);
  const result = await executeModelProviderAttempt({
    executionAttempt: retryAttempt,
    plan,
    authorizationRequest: authorizationFor(plan, RETRY_AT),
    ...second,
    at: RETRY_AT,
    outcomeClock: fixedOutcomeClock('2026-08-11T15:30:20.500Z'),
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempt.reviewedRetry, true);
  assert.equal(result.attempt.priorAttemptRef, priorOutcome.attemptRef);
  assert.equal(result.executionOutcome.retry.reviewedRetry, true);
  assert.equal(result.executionOutcome.retry.priorAttemptRef, priorOutcome.attemptRef);
  assert.equal(result.executionOutcome.retry.automaticRetryPerformed, false);
  assert.equal(second.calls.transport, 1);
});

test('attempt/plan drift fails before endpoint credential or network work', async () => {
  const originalPlan = modelPlan();
  const attempt = createInitialProviderExecutionAttempt({
    plan: originalPlan,
    attemptId: 'attempt-exact-plan-1',
    idempotencyKey: 'idem.exact-plan-1',
    createdAt: AT,
  });
  const driftedPlan = { ...originalPlan, requestId: 'req-p3-model-drifted' };
  const deps = modelDeps(originalPlan);
  await assert.rejects(
    () => executeModelProviderAttempt({
      executionAttempt: attempt,
      plan: driftedPlan,
      authorizationRequest: authorizationFor(originalPlan),
      ...deps,
      at: AT,
    }),
    /requestId does not match exact plan/,
  );
  assert.equal(deps.calls.endpoint, 0);
  assert.equal(deps.calls.credential, 0);
  assert.equal(deps.calls.transport, 0);
});

test('reviewed retry with stale authorization is blocked before the effect port and is not mislabeled uncertain', async () => {
  const plan = modelPlan();
  const first = modelDeps(plan, async () => { throw new Error('timeout'); });
  let priorOutcome;
  await assert.rejects(
    () => executeModelProviderAttempt({
      plan,
      authorizationRequest: authorizationFor(plan),
      ...first,
      at: AT,
      outcomeClock: fixedOutcomeClock('2026-08-11T15:30:00.500Z'),
    }),
    (error) => {
      priorOutcome = error.outcome;
      return true;
    },
  );
  const retryAttempt = createReviewedProviderRetryAttempt({
    priorOutcome,
    attemptId: 'attempt-stale-auth-retry',
    idempotencyKey: 'idem.stale-auth-retry',
    createdAt: RETRY_AT,
  });
  const second = modelDeps(plan);
  await assert.rejects(
    () => executeModelProviderAttempt({
      executionAttempt: retryAttempt,
      plan,
      authorizationRequest: authorizationFor(plan, AT),
      ...second,
      at: '2026-08-11T15:31:00.000Z',
    }),
    (error) => {
      assert.equal(error instanceof ProviderExecutionUncertainError, false);
      assert.match(error.message, /too far/);
      return true;
    },
  );
  assert.equal(second.calls.transport, 0);
});
