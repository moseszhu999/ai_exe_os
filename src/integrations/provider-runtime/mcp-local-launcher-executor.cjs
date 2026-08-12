'use strict';

const { createHash } = require('node:crypto');
const { evaluateExecutionAuthorizationV1 } = require('../../authorization/execution-authorization-v1.cjs');
const { assertSafeIdentifier } = require('../../domain/identifiers.cjs');
const { deepFreeze, requiredText } = require('../../domain/workspace-model.cjs');
const { canonicalize } = require('./index.cjs');
const { PROVIDER_ADAPTER_PLAN_SCHEMA } = require('./adapter-plan.cjs');
const { PROVIDER_EXECUTION_RECEIPT_SCHEMA, expectedAuthorizationBinding } = require('./executor.cjs');
const { MCP_STABLE_PROTOCOL_VERSION } = require('./mcp-executor.cjs');

const SUPPORTED_RISK_CLASSES = Object.freeze(['observe', 'draft']);
const MAX_RESULT_BYTES = 4 * 1024 * 1024;
const MAX_JSON_DEPTH = 24;
const AUTH_CLOCK_SKEW_MS = 30 * 1000;

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

function normalizeJson(value, label, depth = 0) {
  if (depth > MAX_JSON_DEPTH) throw new Error(`${label} exceeds maximum nesting depth`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => normalizeJson(entry, `${label}[${index}]`, depth + 1));
  if (typeof value === 'object') {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof key !== 'string' || key.length === 0 || key.length > 200) throw new Error(`${label} contains an invalid key`);
      output[key] = normalizeJson(entry, `${label}.${key}`, depth + 1);
    }
    return output;
  }
  throw new TypeError(`${label} must contain only JSON-safe values`);
}

function boundedJson(value, label) {
  const normalized = normalizeJson(value, label);
  const bytes = Buffer.byteLength(JSON.stringify(normalized), 'utf8');
  if (bytes > MAX_RESULT_BYTES) throw new Error(`${label} exceeds ${MAX_RESULT_BYTES} bytes`);
  return normalized;
}

function normalizePlan(plan) {
  const input = assertPlainObject(plan, 'provider adapter plan');
  if (input.schema !== PROVIDER_ADAPTER_PLAN_SCHEMA) throw new Error(`Unsupported provider adapter plan schema: ${input.schema}`);
  const suppliedPlanDigest = assertDigest(input.planDigest, 'plan digest');
  const planBase = { ...input };
  delete planBase.planDigest;
  if (digest(planBase) !== suppliedPlanDigest) throw new Error('provider adapter plan digest mismatch');

  if (input.providerKind !== 'mcp_server') throw new Error('local launcher MCP executor requires providerKind=mcp_server');
  if (input.protocolFamily !== 'mcp') throw new Error('local launcher MCP executor requires protocolFamily=mcp');
  if (!SUPPORTED_RISK_CLASSES.includes(input.semanticOperation?.riskClass)) {
    throw new Error(`local launcher MCP executor only permits observe/draft risk classes: ${input.semanticOperation?.riskClass}`);
  }

  const transport = assertPlainObject(input.transportBinding, 'plan transport binding');
  if (transport.mode !== 'registered_local_launcher') {
    throw new Error('local launcher MCP executor requires registered_local_launcher transport binding');
  }
  if (transport.endpointRef != null) throw new Error('registered local launcher must not carry endpointRef');
  if (transport.networkPolicyRef != null) throw new Error('registered local launcher v1 must not carry networkPolicyRef');
  if (!Array.isArray(transport.credentialRefs) || transport.credentialRefs.length !== 0) {
    throw new Error('registered local launcher v1 must not carry credentialRefs');
  }
  const launcherRef = normalizeOpaqueRef(transport.launcherRef, 'plan launcherRef', 'launcher');

  const requestId = assertSafeIdentifier(input.requestId, 'plan request id');
  const requestDigest = assertDigest(input.requestDigest, 'plan request digest');
  const providerId = assertSafeIdentifier(input.providerId, 'plan provider id');
  const providerContractId = assertSafeIdentifier(input.providerContractId, 'plan provider contract id');
  if (providerContractId !== `prv.${providerId}`) throw new Error('plan provider contract does not match provider id');
  const providerManifestDigest = assertDigest(input.providerManifestDigest, 'plan provider manifest digest');
  const operationId = assertSafeIdentifier(input.semanticOperation.operationId, 'plan operation id');
  const humanGatePolicy = requiredText(input.semanticOperation.humanGatePolicy, 'plan Human Gate policy', 20);
  if (!['never', 'task', 'action'].includes(humanGatePolicy)) throw new Error('plan Human Gate policy is unsupported');

  const protocolCall = assertPlainObject(input.protocolCall, 'plan protocol call');
  assertExactKeys(protocolCall, new Set(['callKind', 'protocolOperation', 'payload']), 'plan protocol call');
  if (protocolCall.callKind !== 'mcp_tool') throw new Error('local launcher MCP executor requires callKind=mcp_tool');
  if (protocolCall.protocolOperation !== 'tools/call') throw new Error('local launcher MCP executor only supports protocolOperation=tools/call');
  const payload = assertPlainObject(protocolCall.payload, 'plan MCP payload');
  assertExactKeys(payload, new Set(['method', 'params']), 'plan MCP payload');
  if (payload.method !== 'tools/call') throw new Error('plan MCP method must be tools/call');
  const params = assertPlainObject(payload.params, 'plan MCP params');
  assertExactKeys(params, new Set(['name', 'arguments']), 'plan MCP params');
  const toolName = assertSafeIdentifier(params.name, 'plan MCP tool name');
  const args = boundedJson(assertPlainObject(params.arguments || {}, 'plan MCP arguments'), 'plan MCP arguments');

  const flags = assertPlainObject(input.flags, 'plan flags');
  const allowedFlags = new Set(['authorizationDecisionCreated', 'humanGateDecisionCreated', 'credentialResolved', 'networkPerformed', 'externalActionPerformed']);
  assertExactKeys(flags, allowedFlags, 'plan flags');
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
    providerKind: input.providerKind,
    protocolFamily: input.protocolFamily,
    protocolVersion: MCP_STABLE_PROTOCOL_VERSION,
    semanticOperation: deepFreeze({
      operationId,
      riskClass: input.semanticOperation.riskClass,
      humanGatePolicy,
      targetRef: input.semanticOperation.targetRef || null,
    }),
    transportBinding: deepFreeze({
      mode: 'registered_local_launcher',
      launcherRef,
      endpointRef: null,
      credentialRefs: Object.freeze([]),
      networkPolicyRef: null,
    }),
    protocolCall: deepFreeze({
      callKind: 'mcp_tool',
      protocolOperation: 'tools/call',
      toolName,
      arguments: structuredClone(args),
    }),
  });
}

function assertAuthorization(plan, authorizationRequest, at) {
  const request = assertPlainObject(authorizationRequest, 'execution authorization request');
  const expected = expectedAuthorizationBinding(plan);
  if (request.action !== expected.action) throw new Error('execution authorization action does not match exact local MCP provider plan');
  if (request.targetRef !== expected.targetRef) throw new Error('execution authorization target does not match exact local MCP provider plan');
  const gateRequired = plan.semanticOperation.humanGatePolicy !== 'never';
  if (request.requirements?.humanGateRequired !== gateRequired) {
    throw new Error('execution authorization Human Gate requirement does not match exact local MCP provider plan');
  }
  const observed = iso(request.observedAt, 'authorization observedAt');
  const executionAt = iso(at, 'execution at');
  if (Math.abs(executionAt.timestamp - observed.timestamp) > AUTH_CLOCK_SKEW_MS) {
    throw new Error('execution authorization observation is too far from local MCP execution time');
  }
  const decision = evaluateExecutionAuthorizationV1(request);
  if (decision.decision !== 'allow') throw new Error(`execution authorization denied local MCP execution: ${decision.decision}`);
  if (decision.validUntil && executionAt.timestamp >= Date.parse(decision.validUntil)) {
    throw new Error('execution authorization expired before local MCP execution');
  }
  return decision;
}

async function resolveLauncher(plan, launcherRegistry) {
  if (!launcherRegistry || typeof launcherRegistry.resolve !== 'function') {
    throw new TypeError('launcherRegistry.resolve is required');
  }
  const raw = await launcherRegistry.resolve({
    providerId: plan.providerId,
    protocolFamily: 'mcp',
    protocolVersion: plan.protocolVersion,
    launcherRef: plan.transportBinding.launcherRef,
  });
  const binding = assertPlainObject(raw, 'resolved local launcher binding');
  assertExactKeys(binding, new Set(['launcherRef', 'status', 'protocolFamily', 'transportMode']), 'resolved local launcher binding');
  if (binding.launcherRef !== plan.transportBinding.launcherRef) throw new Error('resolved launcherRef does not match exact provider plan');
  if (binding.status !== 'approved') throw new Error('resolved local launcher is not approved');
  if (binding.protocolFamily !== 'mcp') throw new Error('resolved local launcher protocolFamily must be mcp');
  if (binding.transportMode !== 'registered_local_launcher') throw new Error('resolved local launcher transport mode mismatch');
  return deepFreeze({ launcherRef: binding.launcherRef });
}

function normalizeMcpResponse(raw) {
  const response = assertPlainObject(raw, 'local MCP transport response');
  assertExactKeys(response, new Set(['protocolVersion', 'result', 'providerRequestId']), 'local MCP transport response');
  if (response.protocolVersion !== MCP_STABLE_PROTOCOL_VERSION) {
    throw new Error(`MCP protocol version drift: expected ${MCP_STABLE_PROTOCOL_VERSION}`);
  }
  const result = boundedJson(assertPlainObject(response.result, 'MCP tools/call result'), 'MCP tools/call result');
  const providerRequestId = response.providerRequestId == null
    ? null
    : requiredText(response.providerRequestId, 'MCP provider request id', 300);
  return Object.freeze({
    protocolVersion: response.protocolVersion,
    result,
    providerRequestId,
    isError: response.result.isError === true,
  });
}

function makeReceipt({ plan, decision, launcher, response, startedAt, completedAt }) {
  const outcome = response.isError ? 'tool_error' : 'success';
  const core = {
    schema: PROVIDER_EXECUTION_RECEIPT_SCHEMA,
    requestId: plan.requestId,
    requestDigest: plan.requestDigest,
    planDigest: plan.planDigest,
    providerId: plan.providerId,
    providerContractId: plan.providerContractId,
    providerManifestDigest: plan.providerManifestDigest,
    protocolFamily: 'mcp',
    protocolVersion: plan.protocolVersion,
    protocolOperation: 'tools/call',
    semanticOperationId: plan.semanticOperation.operationId,
    toolName: plan.protocolCall.toolName,
    riskClass: plan.semanticOperation.riskClass,
    authorizationDecisionRef: decision.decisionRef,
    authorizationEvidenceDigest: decision.decisionEvidenceDigest,
    endpointRef: null,
    launcherRef: launcher.launcherRef,
    credentialRefs: [],
    networkPolicyRef: null,
    startedAt,
    completedAt,
    outcome,
    providerRequestId: response.providerRequestId,
    responseDigest: digest(response.result),
    flags: {
      authorizationEvaluated: true,
      humanGateDecisionCreated: false,
      credentialResolved: false,
      networkPerformed: false,
      externalActionPerformed: false,
      automaticRetryPerformed: false,
    },
  };
  const receiptDigest = digest(core);
  return deepFreeze({ ...core, executionRef: `provexec_${receiptDigest.slice(7, 31)}`, receiptDigest });
}

async function executeRegisteredLocalMcpProviderAdapterPlan({
  plan,
  authorizationRequest,
  launcherRegistry,
  localMcpTransport,
  at = authorizationRequest?.observedAt,
  clock = { now: () => new Date().toISOString() },
}) {
  const normalizedPlan = normalizePlan(plan);
  const executionAt = iso(at, 'execution at').text;
  const decision = assertAuthorization(normalizedPlan, authorizationRequest, executionAt);
  const launcher = await resolveLauncher(normalizedPlan, launcherRegistry);
  if (!localMcpTransport || typeof localMcpTransport.invokeTool !== 'function') {
    throw new TypeError('localMcpTransport.invokeTool is required');
  }
  if (!clock || typeof clock.now !== 'function') throw new TypeError('clock.now is required');

  const started = iso(clock.now(), 'startedAt');
  let rawResponse;
  try {
    rawResponse = await localMcpTransport.invokeTool({
      providerId: normalizedPlan.providerId,
      protocolVersion: normalizedPlan.protocolVersion,
      launcher: deepFreeze({ launcherRef: launcher.launcherRef }),
      request: deepFreeze({
        requestId: normalizedPlan.requestId,
        method: 'tools/call',
        toolName: normalizedPlan.protocolCall.toolName,
        arguments: structuredClone(normalizedPlan.protocolCall.arguments),
      }),
    });
  } catch {
    throw new Error('local MCP transport failed');
  }
  const completed = iso(clock.now(), 'completedAt');
  if (completed.timestamp < started.timestamp) throw new Error('completedAt must not be before startedAt');
  const response = normalizeMcpResponse(rawResponse);
  const receipt = makeReceipt({
    plan: normalizedPlan,
    decision,
    launcher,
    response,
    startedAt: started.text,
    completedAt: completed.text,
  });
  return deepFreeze({ ok: !response.isError, result: response.result, receipt });
}

module.exports = {
  MCP_STABLE_PROTOCOL_VERSION,
  executeRegisteredLocalMcpProviderAdapterPlan,
};
