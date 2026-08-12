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
const { ProviderExecutionAttemptClaimGate } = require('../src/integrations/provider-runtime/persistent-attempt-claim.cjs');
const {
  DOMAIN_EXTERNAL_ACTION_EXECUTOR_VERSION,
  DOMAIN_EXTERNAL_ACTION_EVIDENCE_SCHEMA,
  executePersistedDomainExternalActionAttempt,
} = require('../src/integrations/provider-runtime/domain-external-action-executor.cjs');

const AT = '2026-08-12T06:00:00.000Z';
const MIGRATIONS = join(__dirname, '..', 'migrations');
const RECEIPT_V1_KEYS = Object.freeze([
  'schema', 'requestId', 'requestDigest', 'planDigest', 'providerId', 'providerContractId',
  'providerManifestDigest', 'protocolFamily', 'protocolVersion', 'protocolOperation',
  'semanticOperationId', 'riskClass', 'authorizationDecisionRef', 'authorizationEvidenceDigest',
  'endpointRef', 'credentialRefs', 'networkPolicyRef', 'startedAt', 'completedAt', 'outcome',
  'statusCode', 'providerRequestId', 'responseDigest', 'flags', 'executionRef', 'receiptDigest',
].sort());

async function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'aiexe-p5-'));
  try { return await fn(join(dir, 'state.sqlite')); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

function store(path) {
  return new S1SqliteEventStore({ databasePath: path, migrationsDirectory: MIGRATIONS });
}

function plan({
  requestId = 'req-p5-001',
  providerId = 'trade-bank-fixture',
  operationId = 'submit-payment',
  providerOperation = 'payments.submit',
  riskClass = 'externalAction',
  humanGatePolicy = 'action',
  targetRef = 'target.trade-payment-fixture',
  parameters = { paymentInstructionRef: 'payment-ref-001', amountMinor: '125000', currency: 'USD' },
} = {}) {
  const catalog = createProviderRuntimeCatalog([{
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
    operations: [{ operationId, providerOperation, riskClass, humanGatePolicy, targetRef, modelRefs: [], toolNames: [] }],
    freshness: {
      observedAt: '2026-08-12T00:00:00.000Z',
      validUntil: '2026-09-12T00:00:00.000Z',
      sourceRefs: ['source.domain-provider-contract'],
    },
    status: 'available',
  }]);
  const route = resolveProviderRuntimeRoute({ catalog, providerId, operationId, at: AT });
  return compileProviderAdapterPlan({
    route,
    request: { schema: 'provider.runtime.request.v1', requestId, providerId, operationId, parameters },
  });
}

function auth(p, patch = {}) {
  const binding = expectedAuthorizationBinding(p);
  const base = {
    schema: 'execution.authorization.request.v1',
    requestRef: 'exec-request-p5-001',
    organizationRef: 'org.test',
    actorRef: 'agent.runtime',
    actorKind: 'agent',
    requestedActionRef: 'requested-action.p5',
    action: binding.action,
    targetRef: binding.targetRef,
    observedAt: AT,
    requirements: {
      requiredHumanCapabilityRefs: [],
      requiredAgentCapabilityRefs: ['cap.p5'],
      requiredEvidenceRefs: ['evidence.p5'],
      requiredPolicyRefs: ['policy.p5'],
      humanGateRequired: true,
    },
    resolved: {
      authorityGrant: {
        ref: 'grant.p5', status: 'active', organizationRef: 'org.test', actorRef: 'agent.runtime',
        allowedActions: [binding.action], allowedTargets: [binding.targetRef], expiresAt: '2026-08-12T07:00:00.000Z',
      },
      delegation: {
        ref: 'delegation.p5', status: 'active', organizationRef: 'org.test', actorRef: 'agent.runtime',
        allowedActions: [binding.action], allowedTargets: [binding.targetRef], expiresAt: '2026-08-12T07:00:00.000Z',
      },
      humanCapabilityCredentials: [],
      agentCapabilityPackages: [{ ref: 'cap.p5', status: 'accepted' }],
      evidence: [{ ref: 'evidence.p5', status: 'current' }],
      policies: [{ ref: 'policy.p5', status: 'current' }],
      humanGate: { ref: 'gate.p5', state: 'approved' },
      revocations: [],
    },
  };
  return {
    ...base,
    ...patch,
    requirements: { ...base.requirements, ...(patch.requirements || {}) },
    resolved: { ...base.resolved, ...(patch.resolved || {}) },
  };
}

function attempt(p, suffix = '001') {
  return createInitialProviderExecutionAttempt({
    plan: p,
    attemptId: `attempt-p5-${suffix}`,
    idempotencyKey: `idem.p5.${suffix}`,
    createdAt: AT,
  });
}

function deps(p, { endpoint = {}, credential = {}, adapter = {}, response, throwAfterStart = false } = {}) {
  const calls = { endpoint: 0, credential: 0, effect: 0, request: null };
  return {
    calls,
    endpointResolver: {
      async resolve() {
        calls.endpoint += 1;
        return {
          providerId: p.providerId,
          operationId: p.semanticOperation.operationId,
          providerOperation: p.protocolCall.protocolOperation,
          targetRef: p.semanticOperation.targetRef,
          endpointRef: p.transportBinding.endpointRef,
          networkPolicyRef: p.transportBinding.networkPolicyRef,
          status: 'approved',
          url: 'https://bank-fixture.example.test/v1/payments',
          ...endpoint,
        };
      },
    },
    credentialResolver: {
      async resolve() {
        calls.credential += 1;
        return {
          credentialRef: p.transportBinding.credentialRefs[0],
          status: 'ready',
          scheme: 'bearer',
          secret: 'fixture-bank-token-never-persisted',
          ...credential,
        };
      },
    },
    domainAdapter: {
      adapterRef: 'adapter.trade-bank-fixture-payments',
      providerId: p.providerId,
      providerContractId: p.providerContractId,
      protocolFamily: 'http.json',
      operationId: p.semanticOperation.operationId,
      providerOperation: p.protocolCall.protocolOperation,
      targetRef: p.semanticOperation.targetRef,
      wireMethod: 'POST',
      credentialScheme: 'bearer',
      providerSideIdempotency: 'not_proven',
      automaticRetry: false,
      businessOutcomeAuthority: false,
      async invokeOperation(request) {
        calls.effect += 1;
        calls.request = request;
        if (throwAfterStart) throw new Error('raw adapter exception fixture-bank-token-never-persisted');
        return response || {
          statusCode: 202,
          contentType: 'application/json',
          bodyText: JSON.stringify({ acceptedForProcessing: true, providerOperationRef: 'operation-fixture-001' }),
          providerRequestId: 'provider-request-fixture-001',
        };
      },
      ...adapter,
    },
  };
}

function clock() {
  const values = ['2026-08-12T06:00:00.100Z', '2026-08-12T06:00:00.200Z'];
  return { now: () => values.shift() || '2026-08-12T06:00:00.200Z' };
}

async function execute(path, p, options = {}) {
  const gate = new ProviderExecutionAttemptClaimGate({ store: store(path), clock: () => '2026-08-12T06:00:00.050Z' });
  const d = options.deps || deps(p);
  const a = options.attempt || attempt(p, options.suffix || '001');
  return {
    gate,
    deps: d,
    promise: executePersistedDomainExternalActionAttempt({
      claimGate: gate,
      workspaceId: options.workspaceId || 'workspace.tradeos.fixture',
      plan: p,
      executionAttempt: a,
      authorizationRequest: options.authorization || auth(p),
      ...d,
      at: options.at || AT,
      clock: options.clock || clock(),
    }),
  };
}

test('success preserves the exact provider.execution.receipt.v1 key set and emits separate domain-action evidence', async () => {
  await withDb(async (path) => {
    const p = plan();
    const run = await execute(path, p);
    const result = await run.promise;
    assert.equal(result.ok, true);
    assert.equal(run.deps.calls.effect, 1);
    assert.deepEqual(Object.keys(result.receipt).sort(), RECEIPT_V1_KEYS);
    assert.equal(Object.hasOwn(result.receipt, 'domainAction'), false);
    assert.equal(result.receipt.flags.externalActionPerformed, true);
    assert.equal(result.domainActionEvidence.schema, DOMAIN_EXTERNAL_ACTION_EVIDENCE_SCHEMA);
    assert.equal(result.domainActionEvidence.executorVersion, DOMAIN_EXTERNAL_ACTION_EXECUTOR_VERSION);
    assert.equal(result.domainActionEvidence.executionRef, result.receipt.executionRef);
    assert.equal(result.domainActionEvidence.receiptDigest, result.receipt.receiptDigest);
    assert.equal(result.domainActionEvidence.attemptRef, result.attempt.attemptRef);
    assert.equal(result.domainActionEvidence.externalActionPerformed, true);
    assert.equal(result.domainActionEvidence.providerSideIdempotencyApplied, false);
    assert.equal(result.domainActionEvidence.automaticRetryPerformed, false);
    assert.equal(result.domainActionEvidence.businessOutcomeInferred, false);
    assert.doesNotMatch(JSON.stringify(result), /fixture-bank-token-never-persisted|bank-fixture\.example\.test/);
  });
});

test('authorization denial and HumanGate rejection perform zero endpoint credential claim or effect work', async () => {
  await withDb(async (path) => {
    const p = plan();
    const denied = [
      auth(p, { resolved: { authorityGrant: { ...auth(p).resolved.authorityGrant, status: 'revoked' } } }),
      auth(p, { resolved: { humanGate: { ref: 'gate.p5', state: 'rejected' } } }),
    ];
    for (let i = 0; i < denied.length; i += 1) {
      const d = deps(p);
      const run = await execute(path, p, { deps: d, authorization: denied[i], suffix: `deny-${i}` });
      await assert.rejects(() => run.promise, /authorization denied/);
      assert.deepEqual(d.calls, { endpoint: 0, credential: 0, effect: 0, request: null });
      assert.equal(run.gate.list().length, 0);
    }
  });
});

test('exact action target HumanGate requirement and fresh authorization are mandatory', async () => {
  await withDb(async (path) => {
    const p = plan();
    const bad = [
      auth(p, { action: 'provider.runtime.other.submit-payment' }),
      auth(p, { targetRef: 'target.other' }),
      auth(p, { requirements: { humanGateRequired: false } }),
      auth(p, { observedAt: '2026-08-12T05:58:00.000Z' }),
    ];
    for (let i = 0; i < bad.length; i += 1) {
      const d = deps(p);
      const run = await execute(path, p, { deps: d, authorization: bad[i], suffix: `auth-${i}` });
      await assert.rejects(() => run.promise, /authorization|Human Gate/);
      assert.equal(d.calls.endpoint, 0);
      assert.equal(d.calls.effect, 0);
    }
  });
});

test('executor scope is domain_api plus http.json plus externalAction plus action HumanGate only', async () => {
  for (const config of [
    { riskClass: 'draft' },
    { humanGatePolicy: 'task' },
  ]) {
    const p = plan(config);
    await withDb(async (path) => {
      const run = await execute(path, p);
      await assert.rejects(() => run.promise, /P5 domain executor/);
      assert.equal(run.deps.calls.endpoint, 0);
    });
  }
});

test('endpoint resolver must preserve exact operation target endpoint network policy and approved HTTPS URL', async () => {
  await withDb(async (path) => {
    const p = plan({ requestId: 'req-p5-endpoint' });
    const patches = [
      { providerId: 'other' }, { operationId: 'other' }, { providerOperation: 'other.submit' },
      { targetRef: 'target.other' }, { endpointRef: 'endpoint.other' }, { networkPolicyRef: 'network.other' },
      { status: 'disabled' }, { url: 'http://bank-fixture.example.test/v1/payments' },
      { url: 'https://bank-fixture.example.test/v1/payments?override=true' },
    ];
    for (let i = 0; i < patches.length; i += 1) {
      const d = deps(p, { endpoint: patches[i] });
      const run = await execute(path, p, { deps: d, suffix: `endpoint-${i}` });
      await assert.rejects(() => run.promise, /resolved domain endpoint/);
      assert.equal(d.calls.credential, 0);
      assert.equal(d.calls.effect, 0);
    }
  });
});

test('credential resolver must return the exact ready bearer credential before claim or effect', async () => {
  await withDb(async (path) => {
    const p = plan({ requestId: 'req-p5-credential' });
    for (const [i, patch] of [
      { credentialRef: 'credential.other' }, { status: 'disabled' }, { scheme: 'api_key' }, { secret: 'bad\r\nheader' },
    ].entries()) {
      const d = deps(p, { credential: patch });
      const run = await execute(path, p, { deps: d, suffix: `credential-${i}` });
      await assert.rejects(() => run.promise, /credential/);
      assert.equal(d.calls.effect, 0);
    }
  });
});

test('adapter is an exact operation port and cannot claim idempotency retry business truth or generic invoke', async () => {
  await withDb(async (path) => {
    const p = plan({ requestId: 'req-p5-adapter' });
    const patches = [
      { providerId: 'other' }, { providerOperation: 'payments.other' }, { targetRef: 'target.other' },
      { wireMethod: 'PUT' }, { credentialScheme: 'api_key' }, { providerSideIdempotency: 'supported' },
      { automaticRetry: true }, { businessOutcomeAuthority: true }, { invoke: async () => ({}) },
    ];
    for (let i = 0; i < patches.length; i += 1) {
      const d = deps(p, { adapter: patches[i] });
      const run = await execute(path, p, { deps: d, suffix: `adapter-${i}` });
      await assert.rejects(() => run.promise, /domain operation adapter/);
      assert.equal(d.calls.effect, 0);
    }
  });
});

test('P1 blocks transport/credential smuggling and P5 separately blocks caller-driven provider idempotency', async () => {
  for (const parameters of [
    { url: 'https://evil.example.test' }, { method: 'DELETE' }, { headers: { x: 'y' } },
    { apiKey: 'secret' }, { credentialRef: 'credential.evil' },
  ]) {
    assert.throws(() => plan({ parameters }), /forbidden transport\/credential field/);
  }
  await withDb(async (path) => {
    const p = plan({ requestId: 'req-p5-idem', parameters: { paymentRef: 'p1', idempotencyKey: 'provider-replay-me' } });
    const run = await execute(path, p, { suffix: 'idem' });
    await assert.rejects(() => run.promise, /forbidden field: idempotencyKey/);
    assert.deepEqual(run.deps.calls, { endpoint: 0, credential: 0, effect: 0, request: null });
  });
});

test('trusted non-2xx response becomes known terminal failure with separate action evidence and no returned provider body', async () => {
  await withDb(async (path) => {
    const p = plan({ requestId: 'req-p5-409' });
    const d = deps(p, { response: {
      statusCode: 409,
      contentType: 'application/json',
      bodyText: JSON.stringify({ code: 'DUPLICATE_PROVIDER_REQUEST', detail: 'bounded fixture detail' }),
      providerRequestId: 'provider-request-409',
    } });
    const result = await (await execute(path, p, { deps: d, suffix: '409' })).promise;
    assert.equal(result.ok, false);
    assert.equal(result.result, null);
    assert.equal(result.receipt.outcome, 'provider_error');
    assert.equal(result.executionOutcome.outcome, 'known_failure');
    assert.equal(result.persistentClaim.status, 'known_failure');
    assert.equal(result.domainActionEvidence.externalActionPerformed, true);
    assert.equal(d.calls.effect, 1);
    assert.doesNotMatch(JSON.stringify(result.receipt), /bounded fixture detail/);
  });
});

test('adapter exception after effect entry becomes persisted uncertain evidence with no automatic replay', async () => {
  await withDb(async (path) => {
    const p = plan({ requestId: 'req-p5-uncertain' });
    const d = deps(p, { throwAfterStart: true });
    const run = await execute(path, p, { deps: d, suffix: 'uncertain' });
    let caught;
    try { await run.promise; } catch (error) { caught = error; }
    assert.equal(caught instanceof ProviderExecutionUncertainError, true);
    assert.equal(caught.outcome.outcome, 'uncertain');
    assert.equal(caught.outcome.uncertainty.effectMayHaveOccurred, true);
    assert.equal(caught.outcome.retry.automaticRetryPerformed, false);
    assert.equal(caught.outcome.retry.reviewedRetryRequired, true);
    assert.equal(caught.persistentClaim.status, 'uncertain');
    assert.equal(d.calls.effect, 1);
    assert.doesNotMatch(JSON.stringify(caught.outcome), /fixture-bank-token-never-persisted|raw adapter exception/);
  });
});

test('each untrusted response uses its own canonical request and becomes uncertain after one effect entry', async () => {
  await withDb(async (path) => {
    const responses = [
      { statusCode: 200, contentType: 'application/json', bodyText: '{}', providerRequestId: 'req-1', headers: { authorization: 'Bearer x' } },
      { statusCode: 200, contentType: 'text/plain', bodyText: '{}', providerRequestId: 'req-2' },
      { statusCode: 200, contentType: 'application/json', bodyText: '{bad-json', providerRequestId: 'req-3' },
      { statusCode: 200, contentType: 'application/json', bodyText: JSON.stringify({ access_token: 'secret' }), providerRequestId: 'req-4' },
    ];
    for (let i = 0; i < responses.length; i += 1) {
      const p = plan({ requestId: `req-p5-bad-response-${i}` });
      const d = deps(p, { response: responses[i] });
      const run = await execute(path, p, { deps: d, suffix: `bad-${i}` });
      await assert.rejects(() => run.promise, ProviderExecutionUncertainError);
      assert.equal(d.calls.effect, 1);
    }
  });
});

test('exact duplicate persistent initial claim returns a no-op and performs zero second external action', async () => {
  await withDb(async (path) => {
    const p = plan({ requestId: 'req-p5-duplicate' });
    const a = attempt(p, 'duplicate');
    const gate = new ProviderExecutionAttemptClaimGate({ store: store(path), clock: () => '2026-08-12T06:00:00.050Z' });
    const firstDeps = deps(p);
    const common = {
      claimGate: gate, workspaceId: 'workspace.tradeos.fixture', plan: p, executionAttempt: a,
      authorizationRequest: auth(p), at: AT, clock: clock(),
    };
    const first = await executePersistedDomainExternalActionAttempt({ ...common, ...firstDeps });
    assert.equal(first.ok, true);
    assert.equal(firstDeps.calls.effect, 1);
    const secondDeps = deps(p);
    const second = await executePersistedDomainExternalActionAttempt({ ...common, ...secondDeps, clock: clock() });
    assert.equal(second.persistentDuplicate, true);
    assert.equal(second.receipt, null);
    assert.equal(second.domainActionEvidence, null);
    assert.equal(secondDeps.calls.effect, 0);
  });
});

test('P5 v1 refuses reviewed external-action retry even after exact prior uncertain evidence', async () => {
  await withDb(async (path) => {
    const p = plan({ requestId: 'req-p5-retry-source' });
    const d = deps(p, { throwAfterStart: true });
    const firstRun = await execute(path, p, { deps: d, suffix: 'retry-source' });
    let prior;
    try { await firstRun.promise; } catch (error) { prior = error.outcome; }
    const retry = createReviewedProviderRetryAttempt({
      priorOutcome: prior,
      attemptId: 'attempt-p5-retry-2',
      idempotencyKey: 'idem.p5.retry-2',
      createdAt: '2026-08-12T06:00:10.000Z',
    });
    const retryDeps = deps(p);
    await assert.rejects(() => executePersistedDomainExternalActionAttempt({
      claimGate: firstRun.gate,
      workspaceId: 'workspace.tradeos.fixture',
      plan: p,
      executionAttempt: retry,
      authorizationRequest: auth(p, { observedAt: '2026-08-12T06:00:10.000Z' }),
      ...retryDeps,
      at: '2026-08-12T06:00:10.000Z',
    }), /does not permit reviewed retry/);
    assert.equal(retryDeps.calls.endpoint, 0);
    assert.equal(retryDeps.calls.effect, 0);
  });
});

test('providerRequestId and provider payload cannot persist secret or session-shaped material', async () => {
  await withDb(async (path) => {
    const responses = [
      { statusCode: 200, contentType: 'application/json', bodyText: JSON.stringify({ ok: true }), providerRequestId: 'Bearer abc.def.ghi' },
      { statusCode: 200, contentType: 'application/json', bodyText: JSON.stringify({ ok: true, session_id: 'session-secret' }), providerRequestId: 'provider-request-ok' },
    ];
    for (let i = 0; i < responses.length; i += 1) {
      const p = plan({ requestId: `req-p5-secret-${i}` });
      const d = deps(p, { response: responses[i] });
      const run = await execute(path, p, { deps: d, suffix: `secret-${i}` });
      await assert.rejects(() => run.promise, ProviderExecutionUncertainError);
      assert.equal(d.calls.effect, 1);
    }
  });
});
