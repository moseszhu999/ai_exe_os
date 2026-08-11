'use strict';

const { createHash } = require('node:crypto');
const { assertSafeIdentifier } = require('../../domain/identifiers.cjs');
const { deepFreeze, requiredText } = require('../../domain/workspace-model.cjs');
const { PROVIDER_RUNTIME_ROUTE_SCHEMA, canonicalize } = require('./index.cjs');

const PROVIDER_RUNTIME_REQUEST_SCHEMA = 'provider.runtime.request.v1';
const PROVIDER_ADAPTER_PLAN_SCHEMA = 'provider.adapter.plan.v1';
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_TEXT_CHARS = 400000;
const MAX_MESSAGES = 256;
const FORBIDDEN_DATA_KEY = /^(authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|credential|credentialRef|credentialRefs|private[_ -]?key|url|uri|endpoint|endpointRef|headers?|method)$/i;
const TOP_LEVEL_KEYS = new Set([
  'schema',
  'requestId',
  'providerId',
  'operationId',
  'modelRef',
  'inputText',
  'instructions',
  'messages',
  'system',
  'maxTokens',
  'toolName',
  'arguments',
  'parameters',
]);

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
  if (value === null || value === undefined) return null;
  const ref = assertSafeIdentifier(value, label);
  if (!ref.startsWith(`${prefix}.`)) throw new Error(`${label} must be an opaque ${prefix}.* reference`);
  return ref;
}

function normalizeJsonValue(value, label, depth = 0) {
  if (depth > 20) throw new Error(`${label} exceeds maximum nesting depth`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => normalizeJsonValue(entry, `${label}[${index}]`, depth + 1));
  if (typeof value === 'object') {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (!/^[A-Za-z0-9_.-]{1,120}$/.test(key)) throw new Error(`${label} contains invalid key: ${key}`);
      if (FORBIDDEN_DATA_KEY.test(key)) throw new Error(`${label} contains forbidden transport/credential field: ${key}`);
      result[key] = normalizeJsonValue(entry, `${label}.${key}`, depth + 1);
    }
    return result;
  }
  throw new TypeError(`${label} must contain only JSON-safe values`);
}

function assertBoundedJson(value, label) {
  const normalized = normalizeJsonValue(value, label);
  const bytes = Buffer.byteLength(JSON.stringify(normalized), 'utf8');
  if (bytes > MAX_JSON_BYTES) throw new Error(`${label} exceeds ${MAX_JSON_BYTES} bytes`);
  return normalized;
}

function normalizeText(value, label, { required = true } = {}) {
  if (value === undefined || value === null) {
    if (!required) return null;
    throw new TypeError(`${label} is required`);
  }
  return requiredText(value, label, MAX_TEXT_CHARS);
}

function normalizeMaxTokens(value, label, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new TypeError(`${label} is required`);
    return null;
  }
  if (!Number.isInteger(value) || value < 1 || value > 200000) {
    throw new RangeError(`${label} must be an integer between 1 and 200000`);
  }
  return value;
}

function normalizeMessages(value, label, roles) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must be a non-empty array`);
  if (value.length > MAX_MESSAGES) throw new Error(`${label} exceeds ${MAX_MESSAGES} messages`);
  const messages = value.map((raw, index) => {
    const message = assertPlainObject(raw, `${label}[${index}]`);
    assertExactKeys(message, new Set(['role', 'content']), `${label}[${index}]`);
    const role = requiredText(message.role, `${label}[${index}].role`, 20);
    if (!roles.has(role)) throw new Error(`${label}[${index}] has unsupported role: ${role}`);
    const content = normalizeText(message.content, `${label}[${index}].content`);
    return deepFreeze({ role, content });
  });
  assertBoundedJson(messages, label);
  return Object.freeze(messages);
}

function normalizeRoute(route) {
  const input = assertPlainObject(route, 'provider runtime route');
  if (input.schema !== PROVIDER_RUNTIME_ROUTE_SCHEMA) throw new Error(`Unsupported provider runtime route schema: ${input.schema}`);
  const providerId = assertSafeIdentifier(input.providerId, 'route provider id');
  const providerContractId = assertSafeIdentifier(input.providerContractId, 'route provider contract id');
  if (providerContractId !== `prv.${providerId}`) throw new Error('route provider contract does not match provider id');
  const providerManifestDigest = assertDigest(input.providerManifestDigest, 'route provider manifest digest');
  const protocolFamily = requiredText(input.protocolFamily, 'route protocol family', 60);
  const operation = assertPlainObject(input.operation, 'route operation');
  const operationId = assertSafeIdentifier(operation.operationId, 'route operation id');
  const providerOperation = requiredText(operation.providerOperation, 'route provider operation', 120);
  const riskClass = requiredText(operation.riskClass, 'route risk class', 40);
  const humanGatePolicy = requiredText(operation.humanGatePolicy, 'route Human Gate policy', 20);
  const transport = assertPlainObject(input.transport, 'route transport');
  const mode = requiredText(transport.mode, 'route transport mode', 40);
  const endpointRef = normalizeOpaqueRef(transport.endpointRef, 'route endpointRef', 'endpoint');
  const launcherRef = normalizeOpaqueRef(transport.launcherRef, 'route launcherRef', 'launcher');
  const credentialRefs = Object.freeze((transport.credentialRefs || []).map((ref) => normalizeOpaqueRef(ref, 'route credentialRef', 'credential')));
  const networkPolicyRef = normalizeOpaqueRef(transport.networkPolicyRef, 'route networkPolicyRef', 'network');
  return deepFreeze({
    providerId,
    providerContractId,
    providerManifestDigest,
    providerKind: requiredText(input.providerKind, 'route provider kind', 40),
    protocolFamily,
    operation: deepFreeze({
      operationId,
      providerOperation,
      riskClass,
      humanGatePolicy,
      targetRef: operation.targetRef || null,
      modelRefs: Object.freeze([...(operation.modelRefs || [])]),
      toolNames: Object.freeze([...(operation.toolNames || [])]),
    }),
    transport: deepFreeze({ mode, endpointRef, launcherRef, credentialRefs, networkPolicyRef }),
  });
}

function normalizeCommonRequest(request, route) {
  const input = assertPlainObject(request, 'provider runtime request');
  assertExactKeys(input, TOP_LEVEL_KEYS, 'provider runtime request');
  if (input.schema !== PROVIDER_RUNTIME_REQUEST_SCHEMA) throw new Error(`Unsupported provider runtime request schema: ${input.schema}`);
  const requestId = assertSafeIdentifier(input.requestId, 'provider runtime request id');
  const providerId = assertSafeIdentifier(input.providerId, 'provider runtime request provider id');
  const operationId = assertSafeIdentifier(input.operationId, 'provider runtime request operation id');
  if (providerId !== route.providerId) throw new Error('provider runtime request provider does not match exact route');
  if (operationId !== route.operation.operationId) throw new Error('provider runtime request operation does not match exact route');
  return { input, requestId, providerId, operationId };
}

function requireAllowedModel(modelRef, route) {
  const model = requiredText(modelRef, 'modelRef', 160);
  if (!route.operation.modelRefs.includes(model)) throw new Error(`modelRef is not allowed by exact provider route: ${model}`);
  return model;
}

function compileResponsesCall(input, route) {
  const model = requireAllowedModel(input.modelRef, route);
  const payload = { model, input: normalizeText(input.inputText, 'inputText') };
  const instructions = normalizeText(input.instructions, 'instructions', { required: false });
  if (instructions !== null) payload.instructions = instructions;
  const maxTokens = normalizeMaxTokens(input.maxTokens, 'maxTokens');
  if (maxTokens !== null) payload.max_output_tokens = maxTokens;
  return deepFreeze({ callKind: 'model', protocolOperation: 'responses.create', payload: deepFreeze(payload) });
}

function compileChatCompletionsCall(input, route) {
  const model = requireAllowedModel(input.modelRef, route);
  const messages = normalizeMessages(input.messages, 'messages', new Set(['system', 'user', 'assistant']));
  const payload = { model, messages };
  const maxTokens = normalizeMaxTokens(input.maxTokens, 'maxTokens');
  if (maxTokens !== null) payload.max_tokens = maxTokens;
  return deepFreeze({ callKind: 'model', protocolOperation: 'chat.completions.create', payload: deepFreeze(payload) });
}

function compileAnthropicMessagesCall(input, route) {
  const model = requireAllowedModel(input.modelRef, route);
  const messages = normalizeMessages(input.messages, 'messages', new Set(['user', 'assistant']));
  const maxTokens = normalizeMaxTokens(input.maxTokens, 'maxTokens', { required: true });
  const payload = { model, max_tokens: maxTokens, messages };
  const system = normalizeText(input.system, 'system', { required: false });
  if (system !== null) payload.system = system;
  return deepFreeze({ callKind: 'model', protocolOperation: 'messages.create', payload: deepFreeze(payload) });
}

function compileMcpCall(input, route) {
  const toolName = assertSafeIdentifier(input.toolName, 'MCP tool name');
  if (!route.operation.toolNames.includes(toolName)) throw new Error(`MCP tool is not allowed by exact provider route: ${toolName}`);
  const args = input.arguments === undefined ? {} : assertPlainObject(input.arguments, 'MCP arguments');
  const normalizedArgs = assertBoundedJson(args, 'MCP arguments');
  return deepFreeze({
    callKind: 'mcp_tool',
    protocolOperation: 'tools/call',
    payload: deepFreeze({ method: 'tools/call', params: deepFreeze({ name: toolName, arguments: normalizedArgs }) }),
  });
}

function compileDomainCall(input, route) {
  if (!route.operation.targetRef) throw new Error('domain_api exact route requires an opaque targetRef');
  const parameters = input.parameters === undefined ? {} : assertPlainObject(input.parameters, 'domain parameters');
  return deepFreeze({
    callKind: 'domain_operation',
    protocolOperation: route.operation.providerOperation,
    payload: deepFreeze({ parameters: assertBoundedJson(parameters, 'domain parameters') }),
  });
}

function assertProtocolSpecificFields(input, protocolFamily) {
  const common = new Set(['schema', 'requestId', 'providerId', 'operationId']);
  const families = {
    'openai.responses': new Set([...common, 'modelRef', 'inputText', 'instructions', 'maxTokens']),
    'openai.chat-completions': new Set([...common, 'modelRef', 'messages', 'maxTokens']),
    'anthropic.messages': new Set([...common, 'modelRef', 'messages', 'system', 'maxTokens']),
    mcp: new Set([...common, 'toolName', 'arguments']),
    'http.json': new Set([...common, 'parameters']),
  };
  const allowed = families[protocolFamily];
  if (!allowed) throw new Error(`No P1 adapter-plan compiler for protocol family: ${protocolFamily}`);
  assertExactKeys(input, allowed, `${protocolFamily} request`);
}

function compileProviderAdapterPlan({ route, request }) {
  const normalizedRoute = normalizeRoute(route);
  const { input, requestId, providerId, operationId } = normalizeCommonRequest(request, normalizedRoute);
  assertProtocolSpecificFields(input, normalizedRoute.protocolFamily);

  let protocolCall;
  switch (normalizedRoute.protocolFamily) {
    case 'openai.responses':
      protocolCall = compileResponsesCall(input, normalizedRoute);
      break;
    case 'openai.chat-completions':
      protocolCall = compileChatCompletionsCall(input, normalizedRoute);
      break;
    case 'anthropic.messages':
      protocolCall = compileAnthropicMessagesCall(input, normalizedRoute);
      break;
    case 'mcp':
      protocolCall = compileMcpCall(input, normalizedRoute);
      break;
    case 'http.json':
      protocolCall = compileDomainCall(input, normalizedRoute);
      break;
    default:
      throw new Error(`Unsupported protocol family: ${normalizedRoute.protocolFamily}`);
  }

  if (protocolCall.protocolOperation !== normalizedRoute.operation.providerOperation) {
    throw new Error('compiled protocol operation drifted from exact provider route');
  }

  const normalizedRequest = deepFreeze({
    schema: PROVIDER_RUNTIME_REQUEST_SCHEMA,
    requestId,
    providerId,
    operationId,
    protocolFamily: normalizedRoute.protocolFamily,
    protocolCall,
  });
  const requestDigest = digest(normalizedRequest);
  const planBase = deepFreeze({
    schema: PROVIDER_ADAPTER_PLAN_SCHEMA,
    requestId,
    requestDigest,
    providerId,
    providerContractId: normalizedRoute.providerContractId,
    providerManifestDigest: normalizedRoute.providerManifestDigest,
    providerKind: normalizedRoute.providerKind,
    protocolFamily: normalizedRoute.protocolFamily,
    semanticOperation: deepFreeze({
      operationId,
      riskClass: normalizedRoute.operation.riskClass,
      humanGatePolicy: normalizedRoute.operation.humanGatePolicy,
      targetRef: normalizedRoute.operation.targetRef || null,
    }),
    transportBinding: normalizedRoute.transport,
    protocolCall,
    flags: deepFreeze({
      authorizationDecisionCreated: false,
      humanGateDecisionCreated: false,
      credentialResolved: false,
      networkPerformed: false,
      externalActionPerformed: false,
    }),
  });
  return deepFreeze({ ...planBase, planDigest: digest(planBase) });
}

module.exports = {
  PROVIDER_ADAPTER_PLAN_SCHEMA,
  PROVIDER_RUNTIME_REQUEST_SCHEMA,
  compileProviderAdapterPlan,
};
