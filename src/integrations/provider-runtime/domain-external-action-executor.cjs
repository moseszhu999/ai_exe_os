'use strict';

const { createHash } = require('node:crypto');
const { evaluateExecutionAuthorizationV1 } = require('../../authorization/execution-authorization-v1.cjs');
const { assertSafeIdentifier } = require('../../domain/identifiers.cjs');
const { deepFreeze, requiredText } = require('../../domain/workspace-model.cjs');
const { canonicalize } = require('./index.cjs');
const { PROVIDER_ADAPTER_PLAN_SCHEMA } = require('./adapter-plan.cjs');
const {
  PROVIDER_EXECUTION_RECEIPT_SCHEMA,
  expectedAuthorizationBinding,
} = require('./executor.cjs');
const {
  PROVIDER_EXECUTION_OUTCOME_SCHEMA,
  ProviderExecutionUncertainError,
  assertAttemptMatchesPlan,
} = require('./execution-outcome.cjs');
const {
  ProviderExecutionAttemptClaimGate,
} = require('./persistent-attempt-claim.cjs');

const DOMAIN_EXTERNAL_ACTION_EXECUTOR_VERSION = 'provider.domain-external-action-executor.v1';
const AUTH_CLOCK_SKEW_MS = 30 * 1000;
const MAX_SECRET_CHARS = 8192;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const FORBIDDEN_DATA_KEY = /^(authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|credential|credentialRef|credentialRefs|private[_ -]?key|url|uri|endpoint|endpointRef|headers?|method|idempotencyKey)$/i;
const FORBIDDEN_RESPONSE_KEY = /^(authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|credential|private[_ -]?key|session[_-]?id)$/i;
const SENSITIVE_VALUE = /(Bearer\s+[A-Za-z0-9._~+\/-]+|sk-[A-Za-z0-9_-]{8,}|BEGIN [A-Z ]*PRIVATE KEY|session=|api[_-]?key=)/i;

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function assertExactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field: ${key}`);
  }
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}

function assertDigest(value, label) {
  const text = requiredText(value, label, 80);
  if (!/^sha256:[a-f0-9]{64}$/.test(text)) throw new Error(`${label} must be a sha256 digest`);
  return text;
}

function opaqueRef(value, label, prefix) {
  const ref = assertSafeIdentifier(value, label);
  if (!ref.startsWith(`${prefix}.`)) throw new Error(`${label} must be an opaque ${prefix}.* reference`);
  return ref;
}

function instant(value, label) {
  const text = requiredText(value, label, 80);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp) || !text.includes('T')) throw new TypeError(`${label} must be an ISO-8601 instant`);
  return Object.freeze({ text, timestamp });
}

function normalizeJson(value, label, depth = 0, forbidden = FORBIDDEN_DATA_KEY) {
  if (depth > 20) throw new Error(`${label} exceeds maximum nesting depth`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => normalizeJson(entry, `${label}[${index}]`, depth + 1, forbidden));
  if (typeof value === 'object') {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (!/^[A-Za-z0-9_.-]{1,120}$/.test(key)) throw new Error(`${label} contains invalid key: ${key}`);
      if (forbidden.test(key)) throw new Error(`${label} contains forbidden field: ${key}`);
      result[key] = normalizeJson(entry, `${label}.${key}`, depth + 1, forbidden);
    }
    return result;
  }
  throw new TypeError(`${label} must contain only JSON-safe values`);
}

function assertBoundedJson(value, label, maxBytes = 1024 * 1024, forbidden = FORBIDDEN_DATA_KEY) {
  const normalized = normalizeJson(value, label, 0, forbidden);
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > maxBytes) {
    throw new Error(`${label} exceeds ${maxBytes} bytes`);
  }
  return normalized;
}

function assertNoSensitiveResponse(value, label = 'domain provider response', depth = 0) {
  if (depth > 20) throw new Error(`${label} exceeds maximum nesting depth`);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSensitiveResponse(entry, `${label}[${index}]`, depth + 1));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_RESPONSE_KEY.test(key)) throw new Error(`${label} contains sensitive field: ${key}`);
      assertNoSensitiveResponse(entry, `${label}.${key}`, depth + 1);
    }
    return;
  }
  if (typeof value === 'string' && SENSITIVE_VALUE.test(value)) {
    throw new Error(`${label} contains sensitive value`);
  }
}

function normalizePlan(plan) {
  const input = assertPlainObject(plan, 'provider adapter plan');
  if (input.schema !== PROVIDER_ADAPTER_PLAN_SCHEMA) throw new Error(`Unsupported provider adapter plan schema: ${input.schema}`);
  const suppliedPlanDigest = assertDigest(input.planDigest, 'plan digest');
  const base = { ...input };
  delete base.planDigest;
  if (digest(base) !== suppliedPlanDigest) throw new Error('provider adapter plan digest mismatch');
  if (input.providerKind !== 'domain_api') throw new Error('P5 domain executor requires providerKind=domain_api');
  if (input.protocolFamily !== 'http.json') throw new Error('P5 domain executor requires protocolFamily=http.json');
  if (input.semanticOperation?.riskClass !== 'externalAction') {
    throw new Error('P5 domain executor requires riskClass=externalAction');
  }
  if (input.semanticOperation?.humanGatePolicy !== 'action') {
    throw new Error('P5 domain executor requires action-level Human Gate policy');
  }
  const providerId = assertSafeIdentifier(input.providerId, 'plan provider id');
  const providerContractId = assertSafeIdentifier(input.providerContractId, 'plan provider contract id');
  if (providerContractId !== `prv.${providerId}`) throw new Error('plan provider contract does not match provider id');
  const providerManifestDigest = assertDigest(input.providerManifestDigest, 'plan provider manifest digest');
  const requestId = assertSafeIdentifier(input.requestId, 'plan request id');
  const requestDigest = assertDigest(input.requestDigest, 'plan request digest');
  const operationId = assertSafeIdentifier(input.semanticOperation.operationId, 'plan operation id');
  const targetRef = opaqueRef(input.semanticOperation.targetRef, 'plan targetRef', 'target');

  const transport = assertPlainObject(input.transportBinding, 'plan transport binding');
  if (transport.mode !== 'https') throw new Error('P5 domain executor requires https transport binding');
  const endpointRef = opaqueRef(transport.endpointRef, 'plan endpointRef', 'endpoint');
  const networkPolicyRef = opaqueRef(transport.networkPolicyRef, 'plan networkPolicyRef', 'network');
  if (!Array.isArray(transport.credentialRefs) || transport.credentialRefs.length !== 1) {
    throw new Error('P5 domain executor requires exactly one opaque credential reference');
  }
  const credentialRef = opaqueRef(transport.credentialRefs[0], 'plan credentialRef', 'credential');

  const call = assertPlainObject(input.protocolCall, 'plan protocol call');
  assertExactKeys(call, new Set(['callKind', 'protocolOperation', 'payload']), 'plan protocol call');
  if (call.callKind !== 'domain_operation') throw new Error('P5 domain executor requires callKind=domain_operation');
  const protocolOperation = requiredText(call.protocolOperation, 'plan domain provider operation', 120);
  const payload = assertPlainObject(call.payload, 'plan domain payload');
  assertExactKeys(payload, new Set(['parameters']), 'plan domain payload');
  const parameters = assertBoundedJson(assertPlainObject(payload.parameters, 'plan domain parameters'), 'plan domain parameters');

  const flags = assertPlainObject(input.flags, 'plan flags');
  const flagNames = new Set(['authorizationDecisionCreated', 'humanGateDecisionCreated', 'credentialResolved', 'networkPerformed', 'externalActionPerformed']);
  assertExactKeys(flags, flagNames, 'plan flags');
  for (const [key, value] of Object.entries(flags)) {
    if (value !== false) throw new Error(`provider adapter plan is not execution-pristine: flags.${key}`);
  }

  return deepFreeze({
    schema: input.schema,
    requestId,
    requestDigest,
    planDigest: suppliedPlanDigest,
    providerId,
    providerContractId,
    providerManifestDigest,
    providerKind: 'domain_api',
    protocolFamily: 'http.json',
    semanticOperation: deepFreeze({ operationId, riskClass: 'externalAction', humanGatePolicy: 'action', targetRef }),
    transportBinding: deepFreeze({ mode: 'https', endpointRef, credentialRefs: Object.freeze([credentialRef]), networkPolicyRef }),
    protocolCall: deepFreeze({ callKind: 'domain_operation', protocolOperation, payload: deepFreeze({ parameters: deepFreeze(structuredClone(parameters)) }) }),
    flags: deepFreeze({
      authorizationDecisionCreated: false,
      humanGateDecisionCreated: false,
      credentialResolved: false,
      networkPerformed: false,
      externalActionPerformed: false,
    }),
  });
}

function assertAuthorization(plan, authorizationRequest, at) {
  const request = assertPlainObject(authorizationRequest, 'execution authorization request');
  const expected = expectedAuthorizationBinding(plan);
  if (request.action !== expected.action) throw new Error('execution authorization action does not match exact provider plan');
  if (request.targetRef !== expected.targetRef) throw new Error('execution authorization target does not match exact provider plan');
  if (request.requirements?.humanGateRequired !== true) {
    throw new Error('P5 externalAction execution requires Human Gate in authorization request');
  }
  const observed = instant(request.observedAt, 'authorization observedAt');
  const executionAt = instant(at, 'execution at');
  if (Math.abs(executionAt.timestamp - observed.timestamp) > AUTH_CLOCK_SKEW_MS) {
    throw new Error('execution authorization observation is too far from domain action time');
  }
  const decision = evaluateExecutionAuthorizationV1(request);
  if (decision.decision !== 'allow') throw new Error(`execution authorization denied domain external action: ${decision.decision}`);
  if (decision.validUntil && executionAt.timestamp >= Date.parse(decision.validUntil)) {
    throw new Error('execution authorization expired before domain external action');
  }
  return decision;
}

async function resolveEndpoint(plan, endpointResolver) {
  if (!endpointResolver || typeof endpointResolver.resolve !== 'function') throw new TypeError('endpointResolver.resolve is required');
  const raw = await endpointResolver.resolve({
    providerId: plan.providerId,
    providerContractId: plan.providerContractId,
    protocolFamily: plan.protocolFamily,
    operationId: plan.semanticOperation.operationId,
    providerOperation: plan.protocolCall.protocolOperation,
    targetRef: plan.semanticOperation.targetRef,
    endpointRef: plan.transportBinding.endpointRef,
    networkPolicyRef: plan.transportBinding.networkPolicyRef,
  });
  const binding = assertPlainObject(raw, 'resolved domain endpoint binding');
  const expected = {
    providerId: plan.providerId,
    operationId: plan.semanticOperation.operationId,
    providerOperation: plan.protocolCall.protocolOperation,
    targetRef: plan.semanticOperation.targetRef,
    endpointRef: plan.transportBinding.endpointRef,
    networkPolicyRef: plan.transportBinding.networkPolicyRef,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (binding[key] !== value) throw new Error(`resolved domain endpoint ${key} does not match exact plan`);
  }
  if (binding.status !== 'approved') throw new Error('resolved domain endpoint is not approved');
  const urlText = requiredText(binding.url, 'resolved domain endpoint URL', 2048);
  let url;
  try { url = new URL(urlText); } catch { throw new Error('resolved domain endpoint URL is invalid'); }
  if (url.protocol !== 'https:') throw new Error('resolved domain endpoint URL must use https');
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('resolved domain endpoint URL must not embed credentials, query, or fragment');
  }
  return Object.freeze({ url: url.toString(), endpointRef: binding.endpointRef, networkPolicyRef: binding.networkPolicyRef });
}

async function resolveCredential(plan, credentialResolver) {
  if (!credentialResolver || typeof credentialResolver.resolve !== 'function') throw new TypeError('credentialResolver.resolve is required');
  const credentialRef = plan.transportBinding.credentialRefs[0];
  const raw = await credentialResolver.resolve({
    providerId: plan.providerId,
    providerContractId: plan.providerContractId,
    operationId: plan.semanticOperation.operationId,
    targetRef: plan.semanticOperation.targetRef,
    credentialRef,
  });
  const binding = assertPlainObject(raw, 'resolved domain credential binding');
  if (binding.credentialRef !== credentialRef) throw new Error('resolved domain credentialRef does not match exact plan');
  if (binding.status !== 'ready') throw new Error('resolved domain credential is not ready');
  if (binding.scheme !== 'bearer') throw new Error('P5 domain executor v1 requires bearer credential scheme');
  const secret = requiredText(binding.secret, 'resolved domain bearer credential', MAX_SECRET_CHARS);
  if (/\r|\n/.test(secret)) throw new Error('resolved domain credential contains forbidden control characters');
  return Object.freeze({ credentialRef, scheme: 'bearer', secret });
}

function normalizeAdapter(plan, domainAdapter) {
  const adapter = assertPlainObject(domainAdapter, 'domain operation adapter');
  const allowed = new Set([
    'adapterRef', 'providerId', 'providerContractId', 'protocolFamily', 'operationId', 'providerOperation',
    'targetRef', 'wireMethod', 'credentialScheme', 'providerSideIdempotency', 'automaticRetry',
    'businessOutcomeAuthority', 'invokeOperation',
  ]);
  assertExactKeys(adapter, allowed, 'domain operation adapter');
  const adapterRef = opaqueRef(adapter.adapterRef, 'domain adapterRef', 'adapter');
  const expected = {
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
  };
  for (const [key, value] of Object.entries(expected)) {
    if (adapter[key] !== value) throw new Error(`domain operation adapter ${key} does not match P5 exact contract`);
  }
  if (typeof adapter.invokeOperation !== 'function') throw new TypeError('domainAdapter.invokeOperation is required');
  return Object.freeze({ ...expected, adapterRef, invokeOperation: adapter.invokeOperation.bind(adapter) });
}

function normalizeResponse(raw) {
  const response = assertPlainObject(raw, 'domain operation adapter response');
  assertExactKeys(response, new Set(['statusCode', 'contentType', 'bodyText', 'providerRequestId']), 'domain operation adapter response');
  if (!Number.isInteger(response.statusCode) || response.statusCode < 100 || response.statusCode > 599) {
    throw new Error('domain operation response statusCode is invalid');
  }
  const contentType = requiredText(response.contentType, 'domain operation response contentType', 160).toLowerCase();
  if (!contentType.includes('json')) throw new Error('domain operation response must be JSON');
  if (typeof response.bodyText !== 'string') throw new TypeError('domain operation response bodyText must be a string');
  if (Buffer.byteLength(response.bodyText, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new Error(`domain operation response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  let payload;
  try { payload = JSON.parse(response.bodyText); } catch { throw new Error('domain operation response is not valid JSON'); }
  assertBoundedJson(payload, 'domain operation response payload', MAX_RESPONSE_BYTES, FORBIDDEN_RESPONSE_KEY);
  assertNoSensitiveResponse(payload);
  const providerRequestId = response.providerRequestId == null
    ? null
    : requiredText(response.providerRequestId, 'domain provider request id', 300);
  if (providerRequestId && SENSITIVE_VALUE.test(providerRequestId)) {
    throw new Error('domain provider request id contains sensitive value');
  }
  return Object.freeze({ statusCode: response.statusCode, contentType, payload, providerRequestId });
}

function receiptFor({ plan, decision, endpoint, adapter, response, startedAt, completedAt }) {
  const outcome = response.statusCode >= 200 && response.statusCode < 300 ? 'success' : 'provider_error';
  const core = {
    schema: PROVIDER_EXECUTION_RECEIPT_SCHEMA,
    requestId: plan.requestId,
    requestDigest: plan.requestDigest,
    planDigest: plan.planDigest,
    providerId: plan.providerId,
    providerContractId: plan.providerContractId,
    providerManifestDigest: plan.providerManifestDigest,
    protocolFamily: plan.protocolFamily,
    protocolVersion: null,
    protocolOperation: plan.protocolCall.protocolOperation,
    semanticOperationId: plan.semanticOperation.operationId,
    riskClass: plan.semanticOperation.riskClass,
    authorizationDecisionRef: decision.decisionRef,
    authorizationEvidenceDigest: decision.decisionEvidenceDigest,
    endpointRef: endpoint.endpointRef,
    credentialRefs: plan.transportBinding.credentialRefs,
    networkPolicyRef: endpoint.networkPolicyRef,
    startedAt,
    completedAt,
    outcome,
    statusCode: response.statusCode,
    providerRequestId: response.providerRequestId,
    responseDigest: digest(response.payload),
    flags: {
      authorizationEvaluated: true,
      humanGateDecisionCreated: false,
      credentialResolved: true,
      networkPerformed: true,
      externalActionPerformed: true,
    },
    domainAction: {
      executorVersion: DOMAIN_EXTERNAL_ACTION_EXECUTOR_VERSION,
      adapterRef: adapter.adapterRef,
      wireMethod: adapter.wireMethod,
      providerSideIdempotencyApplied: false,
      automaticRetryPerformed: false,
      businessOutcomeInferred: false,
    },
  };
  const receiptDigest = digest(core);
  return deepFreeze({ ...core, executionRef: `provexec_${receiptDigest.slice(7, 31)}`, receiptDigest });
}

function outcomeFor({ attempt, plan, decision, receipt, completedAt, uncertain }) {
  const outcome = uncertain ? 'uncertain' : (receipt.outcome === 'success' ? 'success' : 'known_failure');
  const core = {
    schema: PROVIDER_EXECUTION_OUTCOME_SCHEMA,
    attemptRef: attempt.attemptRef,
    attemptDigest: attempt.attemptDigest,
    requestId: plan.requestId,
    requestDigest: plan.requestDigest,
    planDigest: plan.planDigest,
    providerId: plan.providerId,
    providerContractId: plan.providerContractId,
    protocolFamily: plan.protocolFamily,
    protocolVersion: null,
    protocolOperation: plan.protocolCall.protocolOperation,
    semanticOperationId: plan.semanticOperation.operationId,
    riskClass: plan.semanticOperation.riskClass,
    authorizationDecisionRef: decision.decisionRef,
    authorizationEvidenceDigest: decision.decisionEvidenceDigest,
    endpointRef: plan.transportBinding.endpointRef,
    credentialRefs: plan.transportBinding.credentialRefs,
    networkPolicyRef: plan.transportBinding.networkPolicyRef,
    startedAt: attempt.createdAt,
    completedAt,
    outcome,
    knownFailureKind: uncertain ? null : (receipt.outcome === 'success' ? null : 'provider_error'),
    statusCode: uncertain ? null : receipt.statusCode,
    providerRequestId: uncertain ? null : receipt.providerRequestId,
    responseDigest: uncertain ? null : receipt.responseDigest,
    uncertainty: uncertain ? Object.freeze({
      classification: 'transport_exception_after_effect_port_entry',
      effectMayHaveOccurred: true,
      reasonCode: 'TRANSPORT_RESULT_UNKNOWN',
    }) : null,
    retry: {
      automaticRetryPerformed: false,
      reviewedRetryRequired: uncertain,
      reviewedRetry: false,
      priorAttemptRef: null,
      idempotencyKeyDigest: attempt.idempotencyKeyDigest,
    },
  };
  return deepFreeze({ ...core, outcomeDigest: digest(core) });
}

function completedAt(clock, fallback) {
  try {
    if (!clock || typeof clock.now !== 'function') return fallback;
    const value = instant(clock.now(), 'domain action completedAt');
    return value.timestamp < Date.parse(fallback) ? fallback : value.text;
  } catch {
    return fallback;
  }
}

async function executePersistedDomainExternalActionAttempt({
  claimGate,
  workspaceId,
  plan,
  executionAttempt,
  authorizationRequest,
  endpointResolver,
  credentialResolver,
  domainAdapter,
  at = authorizationRequest?.observedAt,
  clock = { now: () => new Date().toISOString() },
}) {
  if (!(claimGate instanceof ProviderExecutionAttemptClaimGate)) {
    throw new TypeError('claimGate must be ProviderExecutionAttemptClaimGate');
  }
  if (!executionAttempt) throw new TypeError('P5 persistent external action requires explicit executionAttempt');
  const normalizedPlan = normalizePlan(plan);
  const attempt = assertAttemptMatchesPlan(executionAttempt, normalizedPlan);
  if (attempt.reviewedRetry !== false || attempt.priorAttemptRef != null) {
    throw new Error('P5 externalAction v1 does not permit reviewed retry attempts');
  }
  const executionAt = instant(at, 'domain external action at').text;
  const decision = assertAuthorization(normalizedPlan, authorizationRequest, executionAt);
  const endpoint = await resolveEndpoint(normalizedPlan, endpointResolver);
  const credential = await resolveCredential(normalizedPlan, credentialResolver);
  const adapter = normalizeAdapter(normalizedPlan, domainAdapter);
  const claim = claimGate.acquire({ workspaceId, attempt, plan: normalizedPlan });
  if (!claim.acquired) {
    return deepFreeze({
      ok: false,
      result: null,
      receipt: null,
      attempt,
      executionOutcome: null,
      persistentClaim: claim.claim,
      persistentDuplicate: true,
    });
  }

  if (!clock || typeof clock.now !== 'function') throw new TypeError('clock.now is required');
  const startedAt = instant(clock.now(), 'domain external action startedAt').text;
  let effectStarted = false;
  try {
    effectStarted = true;
    const raw = await adapter.invokeOperation({
      providerId: normalizedPlan.providerId,
      providerContractId: normalizedPlan.providerContractId,
      adapterRef: adapter.adapterRef,
      operationId: normalizedPlan.semanticOperation.operationId,
      providerOperation: normalizedPlan.protocolCall.protocolOperation,
      targetRef: normalizedPlan.semanticOperation.targetRef,
      url: endpoint.url,
      bearerToken: credential.secret,
      parameters: structuredClone(normalizedPlan.protocolCall.payload.parameters),
    });
    const response = normalizeResponse(raw);
    const finishedAt = completedAt(clock, startedAt);
    const receipt = receiptFor({
      plan: normalizedPlan,
      decision,
      endpoint,
      adapter,
      response,
      startedAt,
      completedAt: finishedAt,
    });
    const executionOutcome = outcomeFor({
      attempt,
      plan: normalizedPlan,
      decision,
      receipt,
      completedAt: finishedAt,
      uncertain: false,
    });
    const persistentClaim = claimGate.recordOutcome({ workspaceId, attempt, outcome: executionOutcome });
    const ok = receipt.outcome === 'success';
    return deepFreeze({
      ok,
      result: ok ? response.payload : null,
      receipt,
      attempt,
      executionOutcome,
      persistentClaim,
      persistentDuplicate: false,
    });
  } catch (error) {
    if (!effectStarted) throw error;
    const finishedAt = completedAt(clock, startedAt);
    const executionOutcome = outcomeFor({
      attempt,
      plan: normalizedPlan,
      decision,
      receipt: { outcome: 'provider_error' },
      completedAt: finishedAt,
      uncertain: true,
    });
    const persistentClaim = claimGate.recordOutcome({ workspaceId, attempt, outcome: executionOutcome });
    const uncertain = new ProviderExecutionUncertainError('domain external action result unknown', executionOutcome);
    uncertain.persistentClaim = persistentClaim;
    throw uncertain;
  }
}

module.exports = {
  DOMAIN_EXTERNAL_ACTION_EXECUTOR_VERSION,
  executePersistedDomainExternalActionAttempt,
};
