'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { S1SqliteEventStore } = require('../src/storage/index.cjs');
const {
  PROVIDER_RUNTIME_MANIFEST_SCHEMA,
  createProviderRuntimeCatalog,
  resolveProviderRuntimeRoute,
} = require('../src/integrations/provider-runtime/index.cjs');
const { compileProviderAdapterPlan } = require('../src/integrations/provider-runtime/adapter-plan.cjs');
const { expectedAuthorizationBinding } = require('../src/integrations/provider-runtime/executor.cjs');
const {
  ProviderExecutionUncertainError,
  createInitialProviderExecutionAttempt,
  createReviewedProviderRetryAttempt,
} = require('../src/integrations/provider-runtime/execution-outcome.cjs');
const {
  PROVIDER_EXECUTION_CLAIM_SCHEMA,
  RECOVERY_REASON,
  ProviderExecutionAttemptClaimGate,
  executePersistedModelProviderAttempt,
  executePersistedMcpProviderAttempt,
} = require('../src/integrations/provider-runtime/persistent-attempt-claim.cjs');

const AT = '2026-08-11T16:00:00.000Z';
const RETRY_AT = '2026-08-11T16:00:20.000Z';
const WINDOW = Object.freeze({
  observedAt: '2026-08-11T00:00:00.000Z',
  validUntil: '2026-09-11T00:00:00.000Z',
  sourceRefs: ['source.provider-docs'],
});
const MIGRATIONS = join(__dirname, '..', 'migrations');

async function withDatabase(fn) {
  const directory = mkdtempSync(join(tmpdir(), 'ai-exe-provider-claim-'));
  const databasePath = join(directory, 'state.sqlite');
  try { return await fn({ directory, databasePath }); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

function storeAt(databasePath) {
  return new S1SqliteEventStore({ databasePath, migrationsDirectory: MIGRATIONS });
}

function modelPlan() {
  const manifest = {
    schema: PROVIDER_RUNTIME_MANIFEST_SCHEMA,
    providerId: 'openai-persistent-fixture',
    displayName: 'Persistent model fixture',
    providerKind: 'model_api',
    protocolFamily: 'openai.responses',
    transport: {
      mode: 'https',
      endpointRef: 'endpoint.openai-persistent-fixture',
      credentialRefs: ['credential.openai-persistent-fixture'],
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
      requestId: 'req-persistent-model-1',
      providerId: manifest.providerId,
      operationId: 'draft',
      modelRef: 'gpt-fixture',
      inputText: 'Produce a persistent-fixture draft.',
      maxTokens: 120,
    },
  });
}

function mcpPlan() {
  const manifest = {
    schema: PROVIDER_RUNTIME_MANIFEST_SCHEMA,
    providerId: 'shared-media-persistent-fixture',
    displayName: 'Persistent MCP fixture',
    providerKind: 'mcp_server',
    protocolFamily: 'mcp',
    transport: {
      mode: 'mcp_streamable_http',
      endpointRef: 'endpoint.shared-media-persistent-fixture',
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
      requestId: 'req-persistent-mcp-1',
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
      requiredAgentCapabilityRefs: ['cap.provider-persistent'],
      requiredEvidenceRefs: ['evidence.provider-persistent'],
      requiredPolicyRefs: ['policy.provider-persistent'],
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
        expiresAt: '2026-08-11T17:00:00.000Z',
      },
      delegation: {
        ref: `delegation.${plan.requestId}`,
        status: 'active',
        organizationRef: 'org.test',
        actorRef: 'agent.runtime',
        allowedActions: [binding.action],
        allowedTargets: [binding.targetRef],
        expiresAt: '2026-08-11T17:00:00.000Z',
      },
      humanCapabilityCredentials: [],
      agentCapabilityPackages: [{ ref: 'cap.provider-persistent', status: 'accepted' }],
      evidence: [{ ref: 'evidence.provider-persistent', status: 'current' }],
      policies: [{ ref: 'policy.provider-persistent', status: 'current' }],
      humanGate: null,
      revocations: [],
    },
  };
}

function initialAttempt(plan, suffix = '1', createdAt = AT) {
  return createInitialProviderExecutionAttempt({
    plan,
    attemptId: `attempt-persistent-${suffix}`,
    idempotencyKey: `idem.persistent-${suffix}`,
    createdAt,
  });
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
          secret: 'persistent-secret-never-returned',
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
          bodyText: JSON.stringify({ id: 'resp-persistent', output_text: 'persistent draft' }),
          providerRequestId: 'provider-request-persistent',
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
          providerRequestId: 'mcp-request-persistent',
        };
      },
    },
  };
}

function fixedClock(value) { return () => value; }
function fixedOutcomeClock(value) { return { now: () => value }; }

async function firstUncertain({ claimGate, plan, attempt, deps }) {
  let outcome;
  await assert.rejects(
    () => executePersistedModelProviderAttempt({
      claimGate,
      workspaceId: 'workspace-a',
      executionAttempt: attempt,
      plan,
      authorizationRequest: authorizationFor(plan),
      ...deps,
      at: AT,
      outcomeClock: fixedOutcomeClock('2026-08-11T16:00:00.500Z'),
    }),
    (error) => {
      assert.equal(error instanceof ProviderExecutionUncertainError, true);
      outcome = error.outcome;
      assert.equal(error.persistentClaim.status, 'uncertain');
      return true;
    },
  );
  return outcome;
}

test('first persistent initial claim executes exactly one model network effect and persists success', async () => withDatabase(async ({ databasePath }) => {
  const store = storeAt(databasePath);
  try {
    const plan = modelPlan();
    const attempt = initialAttempt(plan);
    const gate = new ProviderExecutionAttemptClaimGate({ store, clock: fixedClock(AT) });
    const deps = modelDeps(plan);
    const result = await executePersistedModelProviderAttempt({
      claimGate: gate,
      workspaceId: 'workspace-a',
      executionAttempt: attempt,
      plan,
      authorizationRequest: authorizationFor(plan),
      ...deps,
      at: AT,
      outcomeClock: fixedOutcomeClock('2026-08-11T16:00:00.500Z'),
    });
    assert.equal(result.ok, true);
    assert.equal(result.persistentDuplicate, false);
    assert.equal(result.persistentClaim.schema, PROVIDER_EXECUTION_CLAIM_SCHEMA);
    assert.equal(result.persistentClaim.status, 'success');
    assert.equal(result.persistentClaim.outcomeDigest, result.executionOutcome.outcomeDigest);
    assert.equal(deps.calls.transport, 1);
  } finally { store.close(); }
}));

test('exact duplicate completed attempt is a persistent no-op and never performs a second network effect', async () => withDatabase(async ({ databasePath }) => {
  const store = storeAt(databasePath);
  try {
    const plan = modelPlan();
    const attempt = initialAttempt(plan);
    const gate = new ProviderExecutionAttemptClaimGate({ store, clock: fixedClock(AT) });
    const first = modelDeps(plan);
    await executePersistedModelProviderAttempt({ claimGate: gate, workspaceId: 'workspace-a', executionAttempt: attempt, plan, authorizationRequest: authorizationFor(plan), ...first, at: AT, outcomeClock: fixedOutcomeClock('2026-08-11T16:00:00.500Z') });
    assert.equal(first.calls.transport, 1);

    const second = modelDeps(plan);
    const duplicate = await executePersistedModelProviderAttempt({ claimGate: gate, workspaceId: 'workspace-a', executionAttempt: attempt, plan, authorizationRequest: authorizationFor(plan), ...second, at: AT });
    assert.equal(duplicate.persistentDuplicate, true);
    assert.equal(duplicate.persistentClaim.status, 'success');
    assert.equal(second.calls.transport, 0);
  } finally { store.close(); }
}));

test('different initial attempt cannot change attemptId to replay the same canonical P1 requestDigest', async () => withDatabase(async ({ databasePath }) => {
  const store = storeAt(databasePath);
  try {
    const plan = modelPlan();
    const gate = new ProviderExecutionAttemptClaimGate({ store, clock: fixedClock(AT) });
    const firstAttempt = initialAttempt(plan, 'first');
    const first = modelDeps(plan);
    await executePersistedModelProviderAttempt({ claimGate: gate, workspaceId: 'workspace-a', executionAttempt: firstAttempt, plan, authorizationRequest: authorizationFor(plan), ...first, at: AT, outcomeClock: fixedOutcomeClock('2026-08-11T16:00:00.500Z') });

    const changedAttempt = initialAttempt(plan, 'changed-attempt-id');
    const second = modelDeps(plan);
    await assert.rejects(
      () => executePersistedModelProviderAttempt({ claimGate: gate, workspaceId: 'workspace-a', executionAttempt: changedAttempt, plan, authorizationRequest: authorizationFor(plan), ...second, at: AT }),
      /persistent claim collision/,
    );
    assert.equal(second.calls.transport, 0);
  } finally { store.close(); }
}));

test('two independent SQLite store connections share one persistent initial claim owner', async () => withDatabase(async ({ databasePath }) => {
  const storeA = storeAt(databasePath);
  const storeB = storeAt(databasePath);
  try {
    const plan = modelPlan();
    const attempt = initialAttempt(plan);
    const gateA = new ProviderExecutionAttemptClaimGate({ store: storeA, clock: fixedClock(AT) });
    const gateB = new ProviderExecutionAttemptClaimGate({ store: storeB, clock: fixedClock(AT) });
    const first = gateA.acquire({ workspaceId: 'workspace-a', attempt, plan });
    const second = gateB.acquire({ workspaceId: 'workspace-a', attempt, plan });
    assert.equal(first.acquired, true);
    assert.equal(second.acquired, false);
    assert.equal(second.duplicate, true);
    assert.equal(second.claim.attemptRef, attempt.attemptRef);
  } finally { storeB.close(); storeA.close(); }
}));

test('claim rejection happens before P3 effect-start classification and is never mislabeled uncertain', async () => withDatabase(async ({ databasePath }) => {
  const store = storeAt(databasePath);
  try {
    const plan = modelPlan();
    const attempt = initialAttempt(plan);
    const gate = new ProviderExecutionAttemptClaimGate({ store, clock: fixedClock(AT) });
    gate.acquire({ workspaceId: 'workspace-a', attempt, plan });
    const deps = modelDeps(plan);
    const duplicate = await executePersistedModelProviderAttempt({ claimGate: gate, workspaceId: 'workspace-a', executionAttempt: attempt, plan, authorizationRequest: authorizationFor(plan), ...deps, at: AT });
    assert.equal(duplicate.persistentDuplicate, true);
    assert.equal(duplicate.executionOutcome, null);
    assert.equal(deps.calls.transport, 0);
  } finally { store.close(); }
}));

test('known provider failure is persistently terminal and never auto-retried', async () => withDatabase(async ({ databasePath }) => {
  const store = storeAt(databasePath);
  try {
    const plan = modelPlan();
    const attempt = initialAttempt(plan);
    const gate = new ProviderExecutionAttemptClaimGate({ store, clock: fixedClock(AT) });
    const deps = modelDeps(plan, async () => ({ statusCode: 503, contentType: 'application/json', bodyText: JSON.stringify({ error: 'known' }) }));
    const result = await executePersistedModelProviderAttempt({ claimGate: gate, workspaceId: 'workspace-a', executionAttempt: attempt, plan, authorizationRequest: authorizationFor(plan), ...deps, at: AT, outcomeClock: fixedOutcomeClock('2026-08-11T16:00:00.500Z') });
    assert.equal(result.executionOutcome.outcome, 'known_failure');
    assert.equal(result.persistentClaim.status, 'known_failure');
    assert.equal(result.persistentClaim.reviewedRetryRequired, false);
    assert.equal(deps.calls.transport, 1);
  } finally { store.close(); }
}));

test('transport uncertainty is persistently recorded and raw transport or credential material is absent', async () => withDatabase(async ({ databasePath }) => {
  const store = storeAt(databasePath);
  try {
    const plan = modelPlan();
    const attempt = initialAttempt(plan);
    const gate = new ProviderExecutionAttemptClaimGate({ store, clock: fixedClock(AT) });
    const deps = modelDeps(plan, async () => { throw new Error('persistent-secret-never-returned https://secret.example reset'); });
    const outcome = await firstUncertain({ claimGate: gate, plan, attempt, deps });
    const claim = gate.get(attempt.attemptRef);
    assert.equal(claim.status, 'uncertain');
    assert.equal(claim.outcomeDigest, outcome.outcomeDigest);
    assert.equal(claim.effectMayHaveOccurred, true);
    assert.equal(claim.reviewedRetryRequired, true);
    assert.equal(deps.calls.transport, 1);
    assert.doesNotMatch(JSON.stringify(gate.list('workspace-a')), /persistent-secret-never-returned|secret\.example|Bearer|authorization/i);
  } finally { store.close(); }
}));

test('one prior uncertain attempt can have only one direct reviewed-retry successor across persistent storage', async () => withDatabase(async ({ databasePath }) => {
  const store = storeAt(databasePath);
  try {
    const plan = modelPlan();
    const original = initialAttempt(plan, 'retry-origin');
    const gate = new ProviderExecutionAttemptClaimGate({ store, clock: fixedClock(AT) });
    const uncertainDeps = modelDeps(plan, async () => { throw new Error('timeout'); });
    const priorOutcome = await firstUncertain({ claimGate: gate, plan, attempt: original, deps: uncertainDeps });

    const retryOne = createReviewedProviderRetryAttempt({ priorOutcome, attemptId: 'attempt-persistent-retry-one', idempotencyKey: 'idem.persistent-retry-one', createdAt: RETRY_AT });
    const successDeps = modelDeps(plan);
    const result = await executePersistedModelProviderAttempt({ claimGate: gate, workspaceId: 'workspace-a', executionAttempt: retryOne, priorOutcome, plan, authorizationRequest: authorizationFor(plan, RETRY_AT), ...successDeps, at: RETRY_AT, outcomeClock: fixedOutcomeClock('2026-08-11T16:00:20.500Z') });
    assert.equal(result.persistentClaim.status, 'success');
    assert.equal(successDeps.calls.transport, 1);

    const retryTwo = createReviewedProviderRetryAttempt({ priorOutcome, attemptId: 'attempt-persistent-retry-two', idempotencyKey: 'idem.persistent-retry-two', createdAt: RETRY_AT });
    const blockedDeps = modelDeps(plan);
    await assert.rejects(
      () => executePersistedModelProviderAttempt({ claimGate: gate, workspaceId: 'workspace-a', executionAttempt: retryTwo, priorOutcome, plan, authorizationRequest: authorizationFor(plan, RETRY_AT), ...blockedDeps, at: RETRY_AT }),
      /persistent claim collision/,
    );
    assert.equal(blockedDeps.calls.transport, 0);
  } finally { store.close(); }
}));

test('persistent MCP execution uses the same claim gate and stores one successful loopback outcome', async () => withDatabase(async ({ databasePath }) => {
  const store = storeAt(databasePath);
  try {
    const plan = mcpPlan();
    const attempt = initialAttempt(plan, 'mcp');
    const gate = new ProviderExecutionAttemptClaimGate({ store, clock: fixedClock(AT) });
    const deps = mcpDeps(plan);
    const result = await executePersistedMcpProviderAttempt({ claimGate: gate, workspaceId: 'workspace-a', executionAttempt: attempt, plan, authorizationRequest: authorizationFor(plan), ...deps, at: AT, outcomeClock: fixedOutcomeClock('2026-08-11T16:00:00.500Z') });
    assert.equal(result.ok, true);
    assert.equal(result.persistentClaim.status, 'success');
    assert.equal(result.executionOutcome.protocolFamily, 'mcp');
    assert.equal(deps.calls.transport, 1);
  } finally { store.close(); }
}));

test('restart rehydrates completed claim and exact duplicate remains a zero-network no-op', async () => withDatabase(async ({ databasePath }) => {
  const plan = modelPlan();
  const attempt = initialAttempt(plan);
  const firstStore = storeAt(databasePath);
  const firstGate = new ProviderExecutionAttemptClaimGate({ store: firstStore, clock: fixedClock(AT) });
  const firstDeps = modelDeps(plan);
  await executePersistedModelProviderAttempt({ claimGate: firstGate, workspaceId: 'workspace-a', executionAttempt: attempt, plan, authorizationRequest: authorizationFor(plan), ...firstDeps, at: AT, outcomeClock: fixedOutcomeClock('2026-08-11T16:00:00.500Z') });
  firstStore.close();

  const secondStore = storeAt(databasePath);
  try {
    const secondGate = new ProviderExecutionAttemptClaimGate({ store: secondStore, clock: fixedClock(RETRY_AT) });
    assert.equal(secondGate.get(attempt.attemptRef).status, 'success');
    const secondDeps = modelDeps(plan);
    const duplicate = await executePersistedModelProviderAttempt({ claimGate: secondGate, workspaceId: 'workspace-a', executionAttempt: attempt, plan, authorizationRequest: authorizationFor(plan, RETRY_AT), ...secondDeps, at: RETRY_AT });
    assert.equal(duplicate.persistentDuplicate, true);
    assert.equal(duplicate.persistentClaim.status, 'success');
    assert.equal(secondDeps.calls.transport, 0);
  } finally { secondStore.close(); }
}));

test('restart converts unfinished claimed attempt into recovery_required without replaying network effect', async () => withDatabase(async ({ databasePath }) => {
  const plan = modelPlan();
  const attempt = initialAttempt(plan, 'crash-window');
  const firstStore = storeAt(databasePath);
  const firstGate = new ProviderExecutionAttemptClaimGate({ store: firstStore, clock: fixedClock(AT) });
  const acquired = firstGate.acquire({ workspaceId: 'workspace-a', attempt, plan });
  assert.equal(acquired.acquired, true);
  assert.equal(acquired.claim.status, 'claimed');
  firstStore.close();

  const secondStore = storeAt(databasePath);
  try {
    const secondGate = new ProviderExecutionAttemptClaimGate({ store: secondStore, clock: fixedClock(RETRY_AT) });
    const recovered = secondGate.recoverUnfinishedClaims({ workspaceId: 'workspace-a' });
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].status, 'recovery_required');
    assert.equal(recovered[0].outcomeClass, 'uncertain');
    assert.equal(recovered[0].effectMayHaveOccurred, true);
    assert.equal(recovered[0].reviewedRetryRequired, true);
    assert.equal(recovered[0].recoveryReason, RECOVERY_REASON);

    const deps = modelDeps(plan);
    const duplicate = await executePersistedModelProviderAttempt({ claimGate: secondGate, workspaceId: 'workspace-a', executionAttempt: attempt, plan, authorizationRequest: authorizationFor(plan, RETRY_AT), ...deps, at: RETRY_AT });
    assert.equal(duplicate.persistentDuplicate, true);
    assert.equal(duplicate.persistentClaim.status, 'recovery_required');
    assert.equal(deps.calls.transport, 0);
  } finally { secondStore.close(); }
}));

test('authorization or resolver failure before effect claim leaves no persistent claim and can be corrected safely', async () => withDatabase(async ({ databasePath }) => {
  const store = storeAt(databasePath);
  try {
    const plan = modelPlan();
    const attempt = initialAttempt(plan);
    const gate = new ProviderExecutionAttemptClaimGate({ store, clock: fixedClock(AT) });
    const deps = modelDeps(plan);
    deps.endpointResolver.resolve = async () => { deps.calls.endpoint += 1; throw new Error('resolver unavailable'); };
    await assert.rejects(
      () => executePersistedModelProviderAttempt({ claimGate: gate, workspaceId: 'workspace-a', executionAttempt: attempt, plan, authorizationRequest: authorizationFor(plan), ...deps, at: AT }),
      /resolver unavailable/,
    );
    assert.equal(gate.get(attempt.attemptRef), null);
    assert.equal(deps.calls.transport, 0);
  } finally { store.close(); }
}));
