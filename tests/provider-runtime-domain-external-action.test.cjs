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
  ProviderExecutionAttemptClaimGate,
} = require('../src/integrations/provider-runtime/persistent-attempt-claim.cjs');
const {
  DOMAIN_EXTERNAL_ACTION_EXECUTOR_VERSION,
  executePersistedDomainExternalActionAttempt,
} = require('../src/integrations/provider-runtime/domain-external-action-executor.cjs');

const AT = '2026-08-12T06:00:00.000Z';
const WINDOW = Object.freeze({
  observedAt: '2026-08-12T00:00:00.000Z',
  validUntil: '2026-09-12T00:00:00.000Z',
  sourceRefs: ['source.domain-provider-contract'],
});
const MIGRATIONS = join(__dirname, '..', 'migrations');

async function withDatabase(fn) {
  const directory = mkdtempSync(join(tmpdir(), 'ai-exe-domain-action-'));
  const databasePath = join(directory, 'state.sqlite');
  try { return await fn(databasePath); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

function storeAt(databasePath) {
  return new S1SqliteEventStore({ databasePath, migrationsDirectory: MIGRATIONS });
}

function domainPlan({
  providerId = 'trade-bank-fixture',
  operationId = 'submit-payment',
  providerOperation = 'payments.submit',
  riskClass = 'externalAction',
  humanGatePolicy = 'action',
  targetRef = 'target.trade-payment-fixture',
  parameters = { paymentInstructionRef: 'payment-ref-001', amountMinor: '125000', currency: 'USD' },
} = {}) {
  const manifest = {
    schema: PROVIDER_RUNTIME_MANIFEST_SCHEMA,
    providerId,
    displayName: 'Trade bank fixture',
    providerKind: 'domain_api',
    protocolFamily: 'http.json',
    transport: {
      mode: 'https',
      endpointRef: `endpoint.${providerId}`,
      credentialRefs: [`credential.${providerId}`],
      networkPolicyRef: 'network.domain-financial-egress',
    },
    operations: [{
      operationId,
      providerOperation,
      riskClass,
      humanGatePolicy,
      targetRef,
      modelRefs: [],
      toolNames: [],
    }],
    freshness: WINDOW,
    status: 'available',
  };
  const catalog = createProviderRuntimeCatalog([manifest]);
  const route = resolveProviderRuntimeRoute({ catalog, providerId, operationId, at: AT });
  return compileProviderAdapterPlan({
    route,
    request: {
      schema: 'provider.runtime.request.v1',
      requestId: 'req-domain-payment-001',
      providerId,
      operationId,
      parameters,
    },
  });
}

function authorizationFor(plan, overrides = {}) {
  const binding = expectedAuthorizationBinding(plan);
  const base = {
    schema: 'execution.authorization.request.v1',
    requestRef: 'exec-request-domain-payment-001',
    organizationRef: 'org.test',
    actorRef: 'agent.runtime',
    actorKind: 'agent',
    requestedActionRef: 'requested-action.domain-payment',
    action: binding.action,
    targetRef: binding.targetRef,
    observedAt: AT,
    requirements: {
      requiredHumanCapabilityRefs: [],
      requiredAgentCapabilityRefs: ['cap.domain-payment'],
      requiredEvidenceRefs: ['evidence.domain-payment'],
      requiredPolicyRefs: ['policy.domain-payment'],
      humanGateRequired: true,
    },
    resolved: {
      authorityGrant: {
        ref: 'grant.domain-payment',
        status: 'active',
        organizationRef: 'org.test',
        actorRef: 'agent.runtime',
        allowedActions: [binding.action],
        allowedTargets: [binding.targetRef],
        expiresAt: '2026-08-12T07:00:00.000Z',
      },
      delegation: {
        ref: 'delegation.domain-payment',
        status: 'active',
        organizationRef: 'org.test',
        actorRef: 'agent.runtime',
        allowedActions: [binding.action],
        allowedTargets: [binding.targetRef],
        expiresAt: '2026-08-12T07:00:00.000Z',
      },
      humanCapabilityCredentials: [],
      agentCapabilityPackages: [{ ref: 'cap.domain-payment', status: 'accepted' }],
      evidence: [{ ref: 'evidence.domain-payment', status: 'current' }],
      policies: [{ ref: 'policy.domain-payment', status: 'current' }],
      humanGate: { ref: 'gate.domain-payment', state: 'approved' },
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

function initialAttempt(plan, suffix = '1') {
  return createInitialProviderExecutionAttempt({
    plan,
    attemptId: `attempt-domain-payment-${suffix}`,
    idempotencyKey: `idem.domain-payment-${suffix}`,
    createdAt: AT,
  });
}

function dependencies(plan, {
  response,
  adapterThrow,
  endpointPatch,
  credentialPatch,
  adapterPatch,
} = {}) {
  const calls = { endpoint: 0, credential: 0, adapter: 0, adapterRequest: null };
  const endpointResolver = {
    async resolve() {
      calls.endpoint += 1;
      return {
        providerId: plan.providerId,
        operationId: plan.semanticOperation.operationId,
        providerOperation: plan.protocolCall.protocolOperation,
        targetRef: plan.semanticOperation.targetRef,
        endpointRef: plan.transportBinding.endpointRef,
        networkPolicyRef: plan.transportBinding.networkPolicyRef,
        status: 'approved',
        url: 'https://bank-fixture.example.test/v1/payments',
        ...(endpointPatch || {}),
      };
    },
  };
  const credentialResolver = {
    async resolve() {
      calls.credential += 1;
      return {
        credentialRef: plan.transportBinding.credentialRefs[0],
        status: 'ready',
        scheme: 'bearer',
        secret: 'fixture-bank-token-never-persisted',
        ...(credentialPatch || {}),
      };
    },
  };
  const adapter = {
    adapterRef: 'adapter.trade-bank-fixture-payments',
    providerId: plan.providerId,
    providerContractId: plan.providerContractId,
    protocolFamily: 'http.json',
    operationId: plan.semanticOperation.operationId,
    providerOperation: plan.protocolCall.protocolOperation,
    targetRef: plan.semanticOperation.targetRef,
    wireMethod: 'POST',
    credentialScheme: 'bearer',
    providerSideIdempotency: 'not_proven',
    automaticRetry: false,
    businessOutcomeAuthority: false,
    async invokeOperation(request) {
      calls.adapter += 1;
      calls.adapterRequest = request;
      if (adapterThrow) throw new Error('raw adapter exception with fixture-bank-token-never-persisted');
      return response || {
        statusCode: 202,
        contentType: 'application/json',
        bodyText: JSON.stringify({ acceptedForProcessing: true, providerOperationRef: 'operation-fixture-001' }),
        providerRequestId: 'provider-request-fixture-001',
      };
    },
    ...(adapterPatch || {}),
  };
  return { calls, endpointResolver, credentialResolver, domainAdapter: adapter };
}

function deterministicClock() {
  const values = ['2026-08-12T06:00:00.100Z', '2026-08-12T06:00:00.200Z'];
  return { now: () => values.shift() || '2026-08-12T06:00:00.200Z' };
}

async function execute({ databasePath, plan = domainPlan(), attempt = null, auth = null, deps = null } = {}) {
  const store = storeAt(databasePath);
  const claimGate = new ProviderExecutionAttemptClaimGate({ store, clock: () => '2026-08-12T06:00:00.050Z' });
  const executionAttempt = attempt || initialAttempt(plan);
  const actualDeps = deps || dependencies(plan);
  return {
    store,
    claimGate,
    executionAttempt,
    deps: actualDeps,
    promise: executePersistedDomainExternalActionAttempt({
      claimGate,
      workspaceId: 'workspace.tradeos.fixture',
      plan,
      executionAttempt,
      authorizationRequest: auth || authorizationFor(plan),
      ...actualDeps,
      at: AT,
      clock: deterministicClock(),
    }),
  };
}

test('authorized action-gated domain operation executes exactly once and persists a secret-free success receipt', async () => {
  await withDatabase(async (databasePath) => {
    const plan = domainPlan();
    const run = await execute({ databasePath, plan });
    const result = await run.promise;
    assert.equal(result.ok, true);
    assert.equal(result.persistentDuplicate, false);
    assert.equal(result.persistentClaim.status, 'success');
    assert.equal(run.deps.calls.adapter, 1);
    assert.equal(result.receipt.schema, 'provider.execution.receipt.v1');
    assert.equal(result.receipt.riskClass, 'externalAction');
    assert.equal(result.receipt.flags.externalActionPerformed, true);
    assert.equal(result.receipt.domainAction.executorVersion, DOMAIN_EXTERNAL_ACTION_EXECUTOR_VERSION);
    assert.equal(result.receipt.domainAction.businessOutcomeInferred, false);
    assert.equal(result.receipt.domainAction.providerSideIdempotencyApplied, false);
    assert.equal(result.receipt.domainAction.automaticRetryPerformed, false);
    assert.equal(result.executionOutcome.outcome, 'success');
    assert.equal(Object.hasOwn(run.deps.calls.adapterRequest, 'idempotencyKey'), false);
    assert.equal(Object.hasOwn(run.deps.calls.adapterRequest, 'headers'), false);
    assert.equal(run.deps.calls.adapterRequest.bearerToken, 'fixture-bank-token-never-persisted');
    assert.doesNotMatch(JSON.stringify(result.receipt), /fixture-bank-token-never-persisted|bank-fixture\.example\.test/);
    assert.doesNotMatch(JSON.stringify(result.executionOutcome), /fixture-bank-token-never-persisted|bank-fixture\.example\.test/);
  });
});

test('authorization denial or rejected HumanGate blocks before endpoint credential claim or effect', async () => {
  await withDatabase(async (databasePath) => {
    const plan = domainPlan();
    for (const auth of [
      authorizationFor(plan, { resolved: { authorityGrant: { ...authorizationFor(plan).resolved.authorityGrant, status: 'revoked' } } }),
      authorizationFor(plan, { resolved: { humanGate: { ref: 'gate.domain-payment', state: 'rejected' } } }),
    ]) {
      const deps = dependencies(plan);
      const store = storeAt(databasePath);
      const claimGate = new ProviderExecutionAttemptClaimGate({ store, clock: () => AT });
      await assert.rejects(() => executePersistedDomainExternalActionAttempt({
        claimGate,
        workspaceId: 'workspace.tradeos.fixture',
        plan,
        executionAttempt: initialAttempt(plan, String(Math.random()).slice(2, 7)),
        authorizationRequest: auth,
        ...deps,
        at: AT,
      }), /authorization denied/);
      assert.deepEqual(deps.calls, { endpoint: 0, credential: 0, adapter: 0, adapterRequest: null });
      assert.equal(claimGate.list().length, 0);
    }
  });
});

test('exact action target HumanGate requirement and fresh authorization are mandatory before effect work', async () => {
  await withDatabase(async (databasePath) => {
    const plan = domainPlan();
    const cases = [
      authorizationFor(plan, { action: 'provider.runtime.other.submit-payment' }),
      authorizationFor(plan, { targetRef: 'target.other' }),
      authorizationFor(plan, { requirements: { humanGateRequired: false } }),
      authorizationFor(plan, { observedAt: '2026-08-12T05:58:00.000Z' }),
    ];
    for (let index = 0; index < cases.length; index += 1) {
      const deps = dependencies(plan);
      const store = storeAt(databasePath);
      const claimGate = new ProviderExecutionAttemptClaimGate({ store, clock: () => AT });
      await assert.rejects(() => executePersistedDomainExternalActionAttempt({
        claimGate,
        workspaceId: 'workspace.tradeos.fixture',
        plan,
        executionAttempt: initialAttempt(plan, `binding-${index}`),
        authorizationRequest: cases[index],
        ...deps,
        at: AT,
      }), /authorization|Human Gate/);
      assert.deepEqual(deps.calls, { endpoint: 0, credential: 0, adapter: 0, adapterRequest: null });
    }
  });
});

test('executor refuses non-domain non-http-json non-externalAction or non-action-gated plans', async () => {
  await withDatabase(async (databasePath) => {
    const valid = domainPlan();
    const mutations = [
      { providerKind: 'model_api' },
      { protocolFamily: 'openai.responses' },
      { semanticOperation: { ...valid.semanticOperation, riskClass: 'draft' } },
      { semanticOperation: { ...valid.semanticOperation, humanGatePolicy: 'task' } },
    ];
    for (const mutation of mutations) {
      const base = { ...valid, ...mutation };
      delete base.planDigest;
      const crypto = require('node:crypto');
      const { canonicalize } = require('../src/integrations/provider-runtime/index.cjs');
      const planDigest = `sha256:${crypto.createHash('sha256').update(JSON.stringify(canonicalize(base))).digest('hex')}`;
      const forged = Object.freeze({ ...base, planDigest });
      const store = storeAt(databasePath);
      const claimGate = new ProviderExecutionAttemptClaimGate({ store, clock: () => AT });
      await assert.rejects(() => executePersistedDomainExternalActionAttempt({
        claimGate,
        workspaceId: 'workspace.tradeos.fixture',
        plan: forged,
        executionAttempt: initialAttempt(valid, `scope-${Math.random().toString(16).slice(2, 8)}`),
        authorizationRequest: authorizationFor(valid),
        ...dependencies(valid),
        at: AT,
      }), /P5 domain executor/);
    }
  });
});

test('endpoint must echo exact provider operation target endpoint network policy and approved HTTPS URL', async () => {
  await withDatabase(async (databasePath) => {
    const plan = domainPlan();
    const patches = [
      { providerId: 'other' },
      { operationId: 'other' },
      { providerOperation: 'other.submit' },
      { targetRef: 'target.other' },
      { endpointRef: 'endpoint.other' },
      { networkPolicyRef: 'network.other' },
      { status: 'disabled' },
      { url: 'http://bank-fixture.example.test/v1/payments' },
      { url: 'https://bank-fixture.example.test/v1/payments?override=true' },
    ];
    for (let index = 0; index < patches.length; index += 1) {
      const deps = dependencies(plan, { endpointPatch: patches[index] });
      const store = storeAt(databasePath);
      const claimGate = new ProviderExecutionAttemptClaimGate({ store, clock: () => AT });
      await assert.rejects(() => executePersistedDomainExternalActionAttempt({
        claimGate,
        workspaceId: 'workspace.tradeos.fixture',
        plan,
        executionAttempt: initialAttempt(plan, `endpoint-${index}`),
        authorizationRequest: authorizationFor(plan),
        ...deps,
        at: AT,
      }), /resolved domain endpoint/);
      assert.equal(deps.calls.credential, 0);
      assert.equal(deps.calls.adapter, 0);
      assert.equal(claimGate.list().length, 0);
    }
  });
});

test('credential must be exact ready bearer and control-character free before claim or effect', async () => {
  await withDatabase(async (databasePath) => {
    const plan = domainPlan();
    const patches = [
      { credentialRef: 'credential.other' },
      { status: 'disabled' },
      { scheme: 'api_key' },
      { secret: 'bad\r\nheader' },
    ];
    for (let index = 0; index < patches.length; index += 1) {
      const deps = dependencies(plan, { credentialPatch: patches[index] });
      const store = storeAt(databasePath);
      const claimGate = new ProviderExecutionAttemptClaimGate({ store, clock: () => AT });
      await assert.rejects(() => executePersistedDomainExternalActionAttempt({
        claimGate,
        workspaceId: 'workspace.tradeos.fixture',
        plan,
        executionAttempt: initialAttempt(plan, `credential-${index}`),
        authorizationRequest: authorizationFor(plan),
        ...deps,
        at: AT,
      }), /credential/);
      assert.equal(deps.calls.adapter, 0);
      assert.equal(claimGate.list().length, 0);
    }
  });
});

test('adapter is exact operation-only and cannot claim provider idempotency automatic retry or business outcome authority', async () => {
  await withDatabase(async (databasePath) => {
    const plan = domainPlan();
    const patches = [
      { providerId: 'other' },
      { providerOperation: 'payments.other' },
      { targetRef: 'target.other' },
      { wireMethod: 'PUT' },
      { credentialScheme: 'api_key' },
      { providerSideIdempotency: 'supported' },
      { automaticRetry: true },
      { businessOutcomeAuthority: true },
      { invoke: async () => ({}) },
    ];
    for (let index = 0; index < patches.length; index += 1) {
      const deps = dependencies(plan, { adapterPatch: patches[index] });
      const store = storeAt(databasePath);
      const claimGate = new ProviderExecutionAttemptClaimGate({ store, clock: () => AT });
      await assert.rejects(() => executePersistedDomainExternalActionAttempt({
        claimGate,
        workspaceId: 'workspace.tradeos.fixture',
        plan,
        executionAttempt: initialAttempt(plan, `adapter-${index}`),
        authorizationRequest: authorizationFor(plan),
        ...deps,
        at: AT,
      }), /domain operation adapter/);
      assert.equal(deps.calls.adapter, 0);
      assert.equal(claimGate.list().length, 0);
    }
  });
});

test('P1 domain parameters cannot smuggle URL method headers credentials or runtime idempotency key', () => {
  const bad = [
    { url: 'https://evil.example.test' },
    { method: 'DELETE' },
    { headers: { x: 'y' } },
    { apiKey: 'secret' },
    { credentialRef: 'credential.evil' },
    { idempotencyKey: 'provider-replay-me' },
  ];
  for (const parameters of bad) {
    assert.throws(() => domainPlan({ parameters }), /forbidden transport\/credential field/);
  }
});

test('non-2xx provider response is a known terminal failure with one external action attempt and no provider body return', async () => {
  await withDatabase(async (databasePath) => {
    const plan = domainPlan();
    const deps = dependencies(plan, {
      response: {
        statusCode: 409,
        contentType: 'application/json',
        bodyText: JSON.stringify({ code: 'DUPLICATE_PROVIDER_REQUEST', detail: 'bounded fixture detail' }),
        providerRequestId: 'provider-request-fixture-409',
      },
    });
    const run = await execute({ databasePath, plan, deps });
    const result = await run.promise;
    assert.equal(result.ok, false);
    assert.equal(result.result, null);
    assert.equal(result.receipt.outcome, 'provider_error');
    assert.equal(result.receipt.flags.externalActionPerformed, true);
    assert.equal(result.executionOutcome.outcome, 'known_failure');
    assert.equal(result.executionOutcome.retry.automaticRetryPerformed, false);
    assert.equal(result.executionOutcome.retry.reviewedRetryRequired, false);
    assert.equal(result.persistentClaim.status, 'known_failure');
    assert.equal(deps.calls.adapter, 1);
    assert.doesNotMatch(JSON.stringify(result.receipt), /bounded fixture detail/);
  });
});

test('adapter exception after effect-port entry becomes persisted uncertain evidence with zero automatic replay', async () => {
  await withDatabase(async (databasePath) => {
    const plan = domainPlan();
    const deps = dependencies(plan, { adapterThrow: true });
    const store = storeAt(databasePath);
    const claimGate = new ProviderExecutionAttemptClaimGate({ store, clock: () => '2026-08-12T06:00:00.050Z' });
    const attempt = initialAttempt(plan, 'uncertain');
    let caught;
    try {
      await executePersistedDomainExternalActionAttempt({
        claimGate,
        workspaceId: 'workspace.tradeos.fixture',
        plan,
        executionAttempt: attempt,
        authorizationRequest: authorizationFor(plan),
        ...deps,
        at: AT,
        clock: deterministicClock(),
      });
    } catch (error) { caught = error; }
    assert.equal(caught instanceof ProviderExecutionUncertainError, true);
    assert.equal(caught.outcome.outcome, 'uncertain');
    assert.equal(caught.outcome.uncertainty.effectMayHaveOccurred, true);
    assert.equal(caught.outcome.retry.automaticRetryPerformed, false);
    assert.equal(caught.outcome.retry.reviewedRetryRequired, true);
    assert.equal(caught.persistentClaim.status, 'uncertain');
    assert.equal(deps.calls.adapter, 1);
    assert.doesNotMatch(JSON.stringify(caught.outcome), /fixture-bank-token-never-persisted|raw adapter exception/);
  });
});

test('untrusted response shape JSON or sensitive payload after effect entry is uncertain rather than trustworthy failure evidence', async () => {
  await withDatabase(async (databasePath) => {
    const plan = domainPlan();
    const responses = [
      { statusCode: 200, contentType: 'application/json', bodyText: '{}', providerRequestId: 'req-1', headers: { authorization: 'Bearer x' } },
      { statusCode: 200, contentType: 'text/plain', bodyText: '{}', providerRequestId: 'req-2' },
      { statusCode: 200, contentType: 'application/json', bodyText: '{bad-json', providerRequestId: 'req-3' },
      { statusCode: 200, contentType: 'application/json', bodyText: JSON.stringify({ access_token: 'secret' }), providerRequestId: 'req-4' },
    ];
    for (let index = 0; index < responses.length; index += 1) {
      const deps = dependencies(plan, { response: responses[index] });
      const store = storeAt(databasePath);
      const claimGate = new ProviderExecutionAttemptClaimGate({ store, clock: () => `2026-08-12T06:00:0${index}.050Z` });
      await assert.rejects(() => executePersistedDomainExternalActionAttempt({
        claimGate,
        workspaceId: 'workspace.tradeos.fixture',
        plan,
        executionAttempt: initialAttempt(plan, `response-${index}`),
        authorizationRequest: authorizationFor(plan),
        ...deps,
        at: AT,
        clock: deterministicClock(),
      }), ProviderExecutionUncertainError);
      assert.equal(deps.calls.adapter, 1);
    }
  });
});

test('exact duplicate persistent initial claim never invokes the external action a second time', async () => {
  await withDatabase(async (databasePath) => {
    const plan = domainPlan();
    const attempt = initialAttempt(plan, 'duplicate');
    const store = storeAt(databasePath);
    const claimGate = new ProviderExecutionAttemptClaimGate({ store, clock: () => '2026-08-12T06:00:00.050Z' });
    const firstDeps = dependencies(plan);
    const first = await executePersistedDomainExternalActionAttempt({
      claimGate,
      workspaceId: 'workspace.tradeos.fixture',
      plan,
      executionAttempt: attempt,
      authorizationRequest: authorizationFor(plan),
      ...firstDeps,
      at: AT,
      clock: deterministicClock(),
    });
    assert.equal(first.ok, true);
    assert.equal(firstDeps.calls.adapter, 1);

    const secondDeps = dependencies(plan);
    const second = await executePersistedDomainExternalActionAttempt({
      claimGate,
      workspaceId: 'workspace.tradeos.fixture',
      plan,
      executionAttempt: attempt,
      authorizationRequest: authorizationFor(plan),
      ...secondDeps,
      at: AT,
      clock: deterministicClock(),
    });
    assert.equal(second.persistentDuplicate, true);
    assert.equal(secondDeps.calls.adapter, 0);
  });
});

test('P5 v1 refuses reviewed external-action retry even after an exact prior uncertain outcome', async () => {
  await withDatabase(async (databasePath) => {
    const plan = domainPlan();
    const deps = dependencies(plan, { adapterThrow: true });
    const store = storeAt(databasePath);
    const claimGate = new ProviderExecutionAttemptClaimGate({ store, clock: () => '2026-08-12T06:00:00.050Z' });
    const firstAttempt = initialAttempt(plan, 'retry-source');
    let priorOutcome;
    try {
      await executePersistedDomainExternalActionAttempt({
        claimGate,
        workspaceId: 'workspace.tradeos.fixture',
        plan,
        executionAttempt: firstAttempt,
        authorizationRequest: authorizationFor(plan),
        ...deps,
        at: AT,
        clock: deterministicClock(),
      });
    } catch (error) { priorOutcome = error.outcome; }
    const retryAttempt = createReviewedProviderRetryAttempt({
      priorOutcome,
      attemptId: 'attempt-domain-payment-retry-2',
      idempotencyKey: 'idem.domain-payment-retry-2',
      createdAt: '2026-08-12T06:00:10.000Z',
    });
    const retryDeps = dependencies(plan);
    await assert.rejects(() => executePersistedDomainExternalActionAttempt({
      claimGate,
      workspaceId: 'workspace.tradeos.fixture',
      plan,
      executionAttempt: retryAttempt,
      authorizationRequest: authorizationFor(plan, { observedAt: '2026-08-12T06:00:10.000Z' }),
      ...retryDeps,
      at: '2026-08-12T06:00:10.000Z',
    }), /does not permit reviewed retry/);
    assert.deepEqual(retryDeps.calls, { endpoint: 0, credential: 0, adapter: 0, adapterRequest: null });
  });
});

test('providerRequestId and result payload cannot persist secret or session-shaped material', async () => {
  await withDatabase(async (databasePath) => {
    const plan = domainPlan();
    const responses = [
      { statusCode: 200, contentType: 'application/json', bodyText: JSON.stringify({ ok: true }), providerRequestId: 'Bearer abc.def.ghi' },
      { statusCode: 200, contentType: 'application/json', bodyText: JSON.stringify({ ok: true, session_id: 'session-secret' }), providerRequestId: 'provider-request-ok' },
    ];
    for (let index = 0; index < responses.length; index += 1) {
      const deps = dependencies(plan, { response: responses[index] });
      const store = storeAt(databasePath);
      const claimGate = new ProviderExecutionAttemptClaimGate({ store, clock: () => `2026-08-12T06:00:1${index}.050Z` });
      await assert.rejects(() => executePersistedDomainExternalActionAttempt({
        claimGate,
        workspaceId: 'workspace.tradeos.fixture',
        plan,
        executionAttempt: initialAttempt(plan, `secret-${index}`),
        authorizationRequest: authorizationFor(plan),
        ...deps,
        at: AT,
        clock: deterministicClock(),
      }), ProviderExecutionUncertainError);
    }
  });
});
