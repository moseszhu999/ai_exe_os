'use strict';

const { createHash } = require('node:crypto');
const { evaluateExecutionAuthorizationV1 } = require('../../authorization/execution-authorization-v1.cjs');
const { assertSafeIdentifier } = require('../../domain/identifiers.cjs');
const { deepFreeze, requiredText } = require('../../domain/workspace-model.cjs');
const { canonicalize } = require('./index.cjs');
const { PROVIDER_ADAPTER_PLAN_SCHEMA } = require('./adapter-plan.cjs');

const PROVIDER_EXECUTION_RECEIPT_SCHEMA = 'provider.execution.receipt.v1';
const SUPPORTED_PROTOCOLS = Object.freeze(['openai.responses', 'openai.chat-completions']);
const SUPPORTED_RISK_CLASSES = Object.freeze(['observe', 'draft']);
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_SECRET_CHARS = 8192;
const AUTH_CLOCK_SKEW_MS = 30 * 1000;

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}

function assertDigest(value, label) {
  const text = requiredText(value, label, 80);
  if (!/^sha256:[a-f0-9]{64}$/.test(text)) throw new Error(`${label} must be a sha256 digest`);
  return text;
}

function normalizeOpaqueRef(value, label, prefix) {
  const ref = assertSafeIdentifier(value, label);
  if (!ref.startsWith(`${prefix}.`)) throw new Error(`${label} must be an opaque ${prefix}.* reference`);
  return ref;
}

function iso(value, label) {
  const text = requiredText(value, label, 80);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp) || !text.includes('T')) throw new TypeError(`${label} must be an ISO-8601 instant`);
  return Object.freeze({ text, timestamp });
}

function expectedAuthorizationBinding(plan) {
  const action = `provider.runtime.${plan.providerId}.${plan.semanticOperation.operationId}`;
  if (action.length > 160) throw new Error('provider authorization action exceeds execution.authorization.v1 limit');
  return Object.freeze({
    action,
    targetRef: plan.semanticOperation.targetRef || plan.providerContractId,
  });
}

function normalizePlan(plan) {
  const input = assertPlainObject(plan, 'provider adapter plan');
  if (input.schema !== PROVIDER_ADAPTER_PLAN_SCHEMA) throw new Error(`Unsupported provider adapter plan schema: ${input.schema}`);
  if (!SUPPORTED_PROTOCOLS.includes(input.protocolFamily)) {
    throw new Error(`P2 model executor does not support protocol family: ${input.protocolFamily}`);
  }
  const suppliedPlanDigest = assertDigest(input.planDigest, 'plan digest');
  const planBase = { ...input };
  delete planBase.planDigest;
  if (digest(planBase) !== suppliedPlanDigest) throw new Error('provider adapter plan digest mismatch');
  if (input.providerKind !== 'model_api') throw new Error('P2 model executor requires providerKind=model_api');
  if (!SUPPORTED_RISK_CLASSES.includes(input.semanticOperation?.riskClass)) {
    throw new Error(`P2 model executor only permits observe/draft risk classes: ${input.semanticOperation?.riskClass}`);
  }
  if (input.transportBinding?.mode !== 'https') throw new Error('P2 model executor requires https transport binding');
  const endpointRef = normalizeOpaqueRef(input.transportBinding.endpointRef, 'plan endpointRef', 'endpoint');
  const credentialRefs = input.transportBinding.credentialRefs || [];
  if (!Array.isArray(credentialRefs) || credentialRefs.length !== 1) {
    throw new Error('P2 model executor requires exactly one opaque credential reference');
  }
  const credentialRef = normalizeOpaqueRef(credentialRefs[0], 'plan credentialRef', 'credential');
  const networkPolicyRef = input.transportBinding.networkPolicyRef == null
    ? null
    : normalizeOpaqueRef(input.transportBinding.networkPolicyRef, 'plan networkPolicyRef', 'network');
  const requestId = assertSafeIdentifier(input.requestId, 'plan request id');
  const requestDigest = assertDigest(input.requestDigest, 'plan request digest');
  const planDigest = suppliedPlanDigest;
  const providerId = assertSafeIdentifier(input.providerId, 'plan provider id');
  const providerContractId = assertSafeIdentifier(input.providerContractId, 'plan provider contract id');
  if (providerContractId !== `prv.${providerId}`) throw new Error('plan provider contract does not match provider id');
  const providerManifestDigest = assertDigest(input.providerManifestDigest, 'plan provider manifest digest');
  const operationId = assertSafeIdentifier(input.semanticOperation.operationId, 'plan operation id');
  const humanGatePolicy = requiredText(input.semanticOperation.humanGatePolicy, 'plan Human Gate policy', 20);
  if (!['never', 'task', 'action'].includes(humanGatePolicy)) throw new Error('plan Human Gate policy is unsupported');
  const protocolOperation = requiredText(input.protocolCall?.protocolOperation, 'plan protocol operation', 120);
  const expectedProtocolOperation = input.protocolFamily === 'openai.responses' ? 'responses.create' : 'chat.completions.create';
  if (protocolOperation !== expectedProtocolOperation) throw new Error('plan protocol operation drifted from protocol family');
  const payload = assertPlainObject(input.protocolCall?.payload, 'plan protocol payload');
  const flags = assertPlainObject(input.flags, 'plan flags');
  const allowedFlags = new Set(['authorizationDecisionCreated', 'humanGateDecisionCreated', 'credentialResolved', 'networkPerformed', 'externalActionPerformed']);
  for (const key of Object.keys(flags)) {
    if (!allowedFlags.has(key)) throw new Error(`provider adapter plan contains unsupported flag: ${key}`);
  }
  for (const [key, value] of Object.entries(flags)) {
    if (value !== false) throw new Error(`provider adapter plan is not execution-pristine: flags.${key}`);
  }
  const normalized = deepFreeze({
    schema: input.schema,
    requestId,
    requestDigest,
    planDigest,
    providerId,
    providerContractId,
    providerManifestDigest,
    providerKind: requiredText(input.providerKind, 'plan provider kind', 40),
    protocolFamily: input.protocolFamily,
    semanticOperation: deepFreeze({
      operationId,
      riskClass: input.semanticOperation.riskClass,
      humanGatePolicy,
      targetRef: input.semanticOperation.targetRef || null,
    }),
    transportBinding: deepFreeze({ endpointRef, credentialRef, networkPolicyRef }),
    protocolCall: deepFreeze({ protocolOperation, payload: structuredClone(payload) }),
  });
  return normalized;
}

function assertAuthorization(plan, authorizationRequest, at) {
  const request = assertPlainObject(authorizationRequest, 'execution authorization request');
  const expected = expectedAuthorizationBinding(plan);
  if (request.action !== expected.action) throw new Error('execution authorization action does not match exact provider plan');
  if (request.targetRef !== expected.targetRef) throw new Error('execution authorization target does not match exact provider plan');
  const gateRequired = plan.semanticOperation.humanGatePolicy !== 'never';
  if (request.requirements?.humanGateRequired !== gateRequired) {
    throw new Error('execution authorization Human Gate requirement does not match exact provider plan');
  }
  const observed = iso(request.observedAt, 'authorization observedAt');
  const executionAt = iso(at, 'execution at');
  if (Math.abs(executionAt.timestamp - observed.timestamp) > AUTH_CLOCK_SKEW_MS) {
    throw new Error('execution authorization observation is too far from provider execution time');
  }
  const decision = evaluateExecutionAuthorizationV1(request);
  if (decision.decision !== 'allow') {
    throw new Error(`execution authorization denied provider execution: ${decision.decision}`);
  }
  if (decision.validUntil && executionAt.timestamp >= Date.parse(decision.validUntil)) {
    throw new Error('execution authorization expired before provider execution');
  }
  return decision;
}

async function resolveEndpoint(plan, endpointResolver) {
  if (!endpointResolver || typeof endpointResolver.resolve !== 'function') throw new TypeError('endpointResolver.resolve is required');
  const raw = await endpointResolver.resolve({
    providerId: plan.providerId,
    protocolFamily: plan.protocolFamily,
    endpointRef: plan.transportBinding.endpointRef,
    networkPolicyRef: plan.transportBinding.networkPolicyRef,
  });
  const binding = assertPlainObject(raw, 'resolved endpoint binding');
  if (binding.endpointRef !== plan.transportBinding.endpointRef) throw new Error('resolved endpointRef does not match exact provider plan');
  if ((binding.networkPolicyRef || null) !== plan.transportBinding.networkPolicyRef) {
    throw new Error('resolved networkPolicyRef does not match exact provider plan');
  }
  if (binding.status !== 'approved') throw new Error('resolved endpoint is not approved');
  const urlText = requiredText(binding.url, 'resolved endpoint URL', 2048);
  let url;
  try { url = new URL(urlText); } catch { throw new Error('resolved endpoint URL is invalid'); }
  if (url.protocol !== 'https:') throw new Error('resolved endpoint URL must use https');
  if (url.username || url.password || url.search || url.hash) throw new Error('resolved endpoint URL must not embed credentials, query, or fragment');
  return Object.freeze({ url: url.toString(), endpointRef: binding.endpointRef, networkPolicyRef: binding.networkPolicyRef || null });
}

async function resolveCredential(plan, credentialResolver) {
  if (!credentialResolver || typeof credentialResolver.resolve !== 'function') throw new TypeError('credentialResolver.resolve is required');
  const raw = await credentialResolver.resolve({
    providerId: plan.providerId,
    credentialRef: plan.transportBinding.credentialRef,
  });
  const binding = assertPlainObject(raw, 'resolved credential binding');
  if (binding.credentialRef !== plan.transportBinding.credentialRef) throw new Error('resolved credentialRef does not match exact provider plan');
  if (binding.status !== 'ready') throw new Error('resolved credential is not ready');
  if (binding.scheme !== 'bearer') throw new Error('P2 model executor requires bearer credential scheme');
  const secret = requiredText(binding.secret, 'resolved bearer credential', MAX_SECRET_CHARS);
  if (/\r|\n/.test(secret)) throw new Error('resolved bearer credential contains forbidden control characters');
  return Object.freeze({ credentialRef: binding.credentialRef, scheme: binding.scheme, secret });
}

function normalizeTransportResponse(raw) {
  const response = assertPlainObject(raw, 'provider transport response');
  const allowed = new Set(['statusCode', 'contentType', 'bodyText', 'providerRequestId']);
  for (const key of Object.keys(response)) {
    if (!allowed.has(key)) throw new Error(`provider transport response contains unsupported field: ${key}`);
  }
  if (!Number.isInteger(response.statusCode) || response.statusCode < 100 || response.statusCode > 599) {
    throw new Error('provider transport statusCode is invalid');
  }
  const contentType = requiredText(response.contentType, 'provider transport contentType', 160).toLowerCase();
  if (!contentType.includes('json')) throw new Error('provider transport response must be JSON');
  if (typeof response.bodyText !== 'string') throw new TypeError('provider transport bodyText must be a string');
  const bytes = Buffer.byteLength(response.bodyText, 'utf8');
  if (bytes > MAX_RESPONSE_BYTES) throw new Error(`provider transport response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  let payload;
  try { payload = JSON.parse(response.bodyText); } catch { throw new Error('provider transport response is not valid JSON'); }
  const providerRequestId = response.providerRequestId == null
    ? null
    : requiredText(response.providerRequestId, 'provider request id', 300);
  return Object.freeze({ statusCode: response.statusCode, contentType, payload, bodyText: response.bodyText, providerRequestId });
}

function makeReceipt({ plan, decision, endpoint, response, startedAt, completedAt, outcome }) {
  const responseDigest = response ? digest(response.payload) : null;
  const core = {
    schema: PROVIDER_EXECUTION_RECEIPT_SCHEMA,
    requestId: plan.requestId,
    requestDigest: plan.requestDigest,
    planDigest: plan.planDigest,
    providerId: plan.providerId,
    providerContractId: plan.providerContractId,
    providerManifestDigest: plan.providerManifestDigest,
    protocolFamily: plan.protocolFamily,
    protocolOperation: plan.protocolCall.protocolOperation,
    semanticOperationId: plan.semanticOperation.operationId,
    riskClass: plan.semanticOperation.riskClass,
    authorizationDecisionRef: decision.decisionRef,
    authorizationEvidenceDigest: decision.decisionEvidenceDigest,
    endpointRef: endpoint.endpointRef,
    credentialRefs: [plan.transportBinding.credentialRef],
    networkPolicyRef: endpoint.networkPolicyRef,
    startedAt,
    completedAt,
    outcome,
    statusCode: response?.statusCode || null,
    providerRequestId: response?.providerRequestId || null,
    responseDigest,
    flags: {
      authorizationEvaluated: true,
      humanGateDecisionCreated: false,
      credentialResolved: true,
      networkPerformed: true,
      externalActionPerformed: false,
    },
  };
  const receiptDigest = digest(core);
  return deepFreeze({ ...core, executionRef: `provexec_${receiptDigest.slice(7, 31)}`, receiptDigest });
}

async function executeProviderAdapterPlan({
  plan,
  authorizationRequest,
  endpointResolver,
  credentialResolver,
  transport,
  at = authorizationRequest?.observedAt,
  clock = { now: () => new Date().toISOString() },
}) {
  const normalizedPlan = normalizePlan(plan);
  const executionAt = iso(at, 'execution at').text;
  const decision = assertAuthorization(normalizedPlan, authorizationRequest, executionAt);
  const endpoint = await resolveEndpoint(normalizedPlan, endpointResolver);
  const credential = await resolveCredential(normalizedPlan, credentialResolver);
  if (!transport || typeof transport.invoke !== 'function') throw new TypeError('transport.invoke is required');

  if (!clock || typeof clock.now !== 'function') throw new TypeError('clock.now is required');
  const started = iso(clock.now(), 'startedAt');
  const startedAt = started.text;
  let rawResponse;
  try {
    rawResponse = await transport.invoke({
      providerId: normalizedPlan.providerId,
      protocolFamily: normalizedPlan.protocolFamily,
      url: endpoint.url,
      method: 'POST',
      headers: Object.freeze({
        authorization: `Bearer ${credential.secret}`,
        'content-type': 'application/json',
      }),
      body: JSON.stringify(normalizedPlan.protocolCall.payload),
    });
  } catch {
    throw new Error('provider transport failed');
  }
  const completed = iso(clock.now(), 'completedAt');
  if (completed.timestamp < started.timestamp) throw new Error('completedAt must not be before startedAt');
  const completedAt = completed.text;
  const response = normalizeTransportResponse(rawResponse);
  const outcome = response.statusCode >= 200 && response.statusCode < 300 ? 'success' : 'provider_error';
  const receipt = makeReceipt({ plan: normalizedPlan, decision, endpoint, response, startedAt, completedAt, outcome });
  return deepFreeze({
    ok: outcome === 'success',
    result: outcome === 'success' ? response.payload : null,
    receipt,
  });
}

module.exports = {
  PROVIDER_EXECUTION_RECEIPT_SCHEMA,
  executeProviderAdapterPlan,
  expectedAuthorizationBinding,
};
