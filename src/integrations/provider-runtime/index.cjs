'use strict';

const { createHash } = require('node:crypto');
const { assertSafeIdentifier } = require('../../domain/identifiers.cjs');
const { deepFreeze, requiredText } = require('../../domain/workspace-model.cjs');

const PROVIDER_RUNTIME_MANIFEST_SCHEMA = 'provider.runtime.manifest.v1';
const PROVIDER_RUNTIME_ROUTE_SCHEMA = 'provider.runtime.route.v1';
const RISK_CLASSES = Object.freeze(['observe', 'draft', 'internalWrite', 'externalAction']);
const HUMAN_GATE_POLICIES = Object.freeze(['never', 'task', 'action']);
const PROVIDER_KINDS = Object.freeze(['model_api', 'mcp_server', 'domain_api']);
const PROTOCOL_FAMILIES = Object.freeze([
  'openai.responses',
  'openai.chat-completions',
  'anthropic.messages',
  'mcp',
  'http.json',
]);
const TRANSPORT_MODES = Object.freeze(['https', 'mcp_streamable_http', 'registered_local_launcher']);
const STATUSES = Object.freeze(['available', 'degraded', 'disabled']);
const MODEL_PROTOCOLS = new Set(['openai.responses', 'openai.chat-completions', 'anthropic.messages']);
const MCP_TRANSPORTS = new Set(['mcp_streamable_http', 'registered_local_launcher']);
const TOP_LEVEL_KEYS = new Set([
  'schema',
  'providerId',
  'displayName',
  'providerKind',
  'protocolFamily',
  'transport',
  'operations',
  'freshness',
  'status',
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

function normalizeIdentifierArray(values, label, { minItems = 0 } = {}) {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  const normalized = values.map((value) => assertSafeIdentifier(value, label));
  if (normalized.length < minItems) throw new Error(`${label} requires at least ${minItems} item(s)`);
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must not contain duplicates`);
  return Object.freeze(normalized);
}

function normalizeTextArray(values, label, { minItems = 0, maxLength = 120 } = {}) {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  const normalized = values.map((value) => requiredText(value, label, maxLength));
  if (normalized.length < minItems) throw new Error(`${label} requires at least ${minItems} item(s)`);
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must not contain duplicates`);
  return Object.freeze(normalized);
}

function requireOpaqueRef(value, label, prefix) {
  const ref = assertSafeIdentifier(value, label);
  if (!ref.startsWith(`${prefix}.`)) {
    throw new Error(`${label} must be an opaque ${prefix}.* reference; inline values are forbidden`);
  }
  return ref;
}

function requireIsoInstant(value, label) {
  const text = requiredText(value, label, 80);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp) || !text.includes('T')) throw new TypeError(`${label} must be an ISO-8601 instant`);
  return Object.freeze({ text, timestamp });
}

function normalizeTransport(value, providerKind, protocolFamily) {
  const input = assertPlainObject(value, 'transport');
  assertExactKeys(input, new Set(['mode', 'endpointRef', 'launcherRef', 'credentialRefs', 'networkPolicyRef']), 'transport');
  const mode = requiredText(input.mode, 'transport mode', 40);
  if (!TRANSPORT_MODES.includes(mode)) throw new Error(`Unsupported transport mode: ${mode}`);

  let endpointRef = null;
  let launcherRef = null;
  if (mode === 'registered_local_launcher') {
    if (input.endpointRef !== undefined) throw new Error('Local launcher transport must not declare endpointRef');
    launcherRef = requireOpaqueRef(input.launcherRef, 'launcherRef', 'launcher');
  } else {
    if (input.launcherRef !== undefined) throw new Error('Remote transport must not declare launcherRef');
    endpointRef = requireOpaqueRef(input.endpointRef, 'endpointRef', 'endpoint');
  }

  const credentialRefs = normalizeIdentifierArray(input.credentialRefs || [], 'credentialRef')
    .map((ref) => requireOpaqueRef(ref, 'credentialRef', 'credential'));
  const networkPolicyRef = input.networkPolicyRef === undefined
    ? null
    : requireOpaqueRef(input.networkPolicyRef, 'networkPolicyRef', 'network');

  if (providerKind === 'model_api' && mode !== 'https') {
    throw new Error('model_api providers require https transport');
  }
  if (providerKind === 'domain_api' && mode !== 'https') {
    throw new Error('domain_api providers require https transport');
  }
  if (providerKind === 'mcp_server' && !MCP_TRANSPORTS.has(mode)) {
    throw new Error('mcp_server providers require mcp_streamable_http or registered_local_launcher transport');
  }
  if (protocolFamily === 'mcp' && providerKind !== 'mcp_server') {
    throw new Error('mcp protocol requires providerKind=mcp_server');
  }
  if (providerKind === 'mcp_server' && protocolFamily !== 'mcp') {
    throw new Error('mcp_server provider requires protocolFamily=mcp');
  }
  if (MODEL_PROTOCOLS.has(protocolFamily) && providerKind !== 'model_api') {
    throw new Error(`${protocolFamily} requires providerKind=model_api`);
  }
  if (protocolFamily === 'http.json' && providerKind !== 'domain_api') {
    throw new Error('http.json requires providerKind=domain_api');
  }

  return deepFreeze({ mode, endpointRef, launcherRef, credentialRefs, networkPolicyRef });
}

function normalizeOperation(value, providerKind, protocolFamily) {
  const input = assertPlainObject(value, 'operation');
  assertExactKeys(input, new Set([
    'operationId',
    'providerOperation',
    'riskClass',
    'humanGatePolicy',
    'targetRef',
    'modelRefs',
    'toolNames',
  ]), 'operation');

  const operationId = assertSafeIdentifier(input.operationId, 'operation id');
  const providerOperation = requiredText(input.providerOperation, 'provider operation', 120);
  const riskClass = requiredText(input.riskClass, 'risk class', 40);
  if (!RISK_CLASSES.includes(riskClass)) throw new Error(`Unsupported risk class: ${riskClass}`);
  const humanGatePolicy = requiredText(input.humanGatePolicy, 'human gate policy', 20);
  if (!HUMAN_GATE_POLICIES.includes(humanGatePolicy)) throw new Error(`Unsupported Human Gate policy: ${humanGatePolicy}`);
  if (riskClass === 'internalWrite' && humanGatePolicy === 'never') {
    throw new Error(`Operation ${operationId}: internalWrite requires task- or action-level Human Gate`);
  }
  if (riskClass === 'externalAction' && humanGatePolicy !== 'action') {
    throw new Error(`Operation ${operationId}: externalAction requires action-level Human Gate`);
  }

  const targetRef = input.targetRef === undefined ? null : requireOpaqueRef(input.targetRef, 'targetRef', 'target');
  const modelRefs = normalizeTextArray(input.modelRefs || [], `operation ${operationId} modelRefs`);
  const toolNames = normalizeIdentifierArray(input.toolNames || [], `operation ${operationId} toolNames`);

  if (providerKind === 'model_api') {
    if (modelRefs.length === 0) throw new Error(`Operation ${operationId}: model_api requires modelRefs`);
    if (toolNames.length > 0) throw new Error(`Operation ${operationId}: model_api must not declare MCP toolNames`);
  }
  if (providerKind === 'mcp_server') {
    if (toolNames.length === 0) throw new Error(`Operation ${operationId}: mcp_server requires toolNames allowlist`);
    if (modelRefs.length > 0) throw new Error(`Operation ${operationId}: mcp_server must not declare modelRefs`);
    if (providerOperation !== 'tools/call') throw new Error(`Operation ${operationId}: MCP v1 only supports providerOperation=tools/call`);
  }
  if (providerKind === 'domain_api' && (modelRefs.length > 0 || toolNames.length > 0)) {
    throw new Error(`Operation ${operationId}: domain_api must not declare modelRefs or toolNames`);
  }

  if (protocolFamily === 'openai.responses' && providerOperation !== 'responses.create') {
    throw new Error(`Operation ${operationId}: openai.responses requires providerOperation=responses.create`);
  }
  if (protocolFamily === 'openai.chat-completions' && providerOperation !== 'chat.completions.create') {
    throw new Error(`Operation ${operationId}: openai.chat-completions requires providerOperation=chat.completions.create`);
  }
  if (protocolFamily === 'anthropic.messages' && providerOperation !== 'messages.create') {
    throw new Error(`Operation ${operationId}: anthropic.messages requires providerOperation=messages.create`);
  }

  return deepFreeze({
    operationId,
    providerOperation,
    riskClass,
    humanGatePolicy,
    targetRef,
    modelRefs,
    toolNames,
  });
}

function normalizeFreshness(value) {
  const input = assertPlainObject(value, 'freshness');
  assertExactKeys(input, new Set(['observedAt', 'validUntil', 'sourceRefs']), 'freshness');
  const observedAt = requireIsoInstant(input.observedAt, 'freshness.observedAt');
  const validUntil = requireIsoInstant(input.validUntil, 'freshness.validUntil');
  if (validUntil.timestamp <= observedAt.timestamp) throw new Error('freshness.validUntil must be after observedAt');
  const sourceRefs = normalizeIdentifierArray(input.sourceRefs, 'freshness sourceRef', { minItems: 1 })
    .map((ref) => requireOpaqueRef(ref, 'freshness sourceRef', 'source'));
  return deepFreeze({ observedAt: observedAt.text, validUntil: validUntil.text, sourceRefs });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function digestProviderRuntimeManifest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}

function compileProviderRuntimeManifest(manifest) {
  const input = assertPlainObject(manifest, 'provider runtime manifest');
  assertExactKeys(input, TOP_LEVEL_KEYS, 'provider runtime manifest');
  if (input.schema !== PROVIDER_RUNTIME_MANIFEST_SCHEMA) {
    throw new Error(`Unsupported provider runtime manifest schema: ${input.schema}`);
  }

  const providerId = assertSafeIdentifier(input.providerId, 'provider id');
  const providerContractId = `prv.${providerId}`;
  assertSafeIdentifier(providerContractId, 'provider contract id');
  const displayName = requiredText(input.displayName, 'provider display name', 160);
  const providerKind = requiredText(input.providerKind, 'provider kind', 40);
  if (!PROVIDER_KINDS.includes(providerKind)) throw new Error(`Unsupported provider kind: ${providerKind}`);
  const protocolFamily = requiredText(input.protocolFamily, 'protocol family', 60);
  if (!PROTOCOL_FAMILIES.includes(protocolFamily)) throw new Error(`Unsupported protocol family: ${protocolFamily}`);
  const transport = normalizeTransport(input.transport, providerKind, protocolFamily);
  if (!Array.isArray(input.operations) || input.operations.length === 0) {
    throw new Error('operations requires at least one operation');
  }
  const operations = input.operations.map((entry) => normalizeOperation(entry, providerKind, protocolFamily));
  const operationIds = operations.map((entry) => entry.operationId);
  if (new Set(operationIds).size !== operationIds.length) throw new Error('operationId values must be unique');
  const allTools = operations.flatMap((entry) => entry.toolNames);
  if (providerKind === 'mcp_server' && new Set(allTools).size !== allTools.length) {
    throw new Error('MCP toolNames must be owned by exactly one operation in a provider manifest');
  }
  const freshness = normalizeFreshness(input.freshness);
  const status = input.status === undefined ? 'available' : requiredText(input.status, 'provider status', 20);
  if (!STATUSES.includes(status)) throw new Error(`Unsupported provider status: ${status}`);

  const normalizedManifest = deepFreeze({
    schema: PROVIDER_RUNTIME_MANIFEST_SCHEMA,
    providerId,
    displayName,
    providerKind,
    protocolFamily,
    transport,
    operations,
    freshness,
    status,
  });
  const integrityDigest = digestProviderRuntimeManifest(normalizedManifest);

  return deepFreeze({
    providerId,
    providerContractId,
    integrityDigest,
    normalizedManifest,
  });
}

function createProviderRuntimeCatalog(manifests) {
  if (!Array.isArray(manifests)) throw new TypeError('provider runtime manifests must be an array');
  const byProviderId = new Map();
  const byContractId = new Map();
  for (const raw of manifests) {
    const compiled = raw?.normalizedManifest && raw?.integrityDigest
      ? raw
      : compileProviderRuntimeManifest(raw);
    if (byProviderId.has(compiled.providerId)) throw new Error(`Duplicate provider id: ${compiled.providerId}`);
    if (byContractId.has(compiled.providerContractId)) throw new Error(`Duplicate provider contract id: ${compiled.providerContractId}`);
    byProviderId.set(compiled.providerId, compiled);
    byContractId.set(compiled.providerContractId, compiled);
  }

  function list() {
    return Object.freeze([...byProviderId.values()]);
  }

  function get(providerId) {
    return byProviderId.get(providerId) || null;
  }

  function getByContractId(providerContractId) {
    return byContractId.get(providerContractId) || null;
  }

  function toMcpCatalog() {
    const output = new Map();
    for (const compiled of byProviderId.values()) {
      const manifest = compiled.normalizedManifest;
      if (manifest.providerKind !== 'mcp_server') continue;
      output.set(manifest.providerId, new Set(manifest.operations.flatMap((entry) => entry.toolNames)));
    }
    return output;
  }

  return Object.freeze({ list, get, getByContractId, toMcpCatalog });
}

function assertProviderReady(compiled, at = new Date().toISOString()) {
  if (!compiled) throw new Error('Unknown provider runtime binding');
  const manifest = compiled.normalizedManifest;
  if (manifest.status !== 'available') throw new Error(`Provider is not available: ${manifest.providerId}`);
  const atTimestamp = Date.parse(at);
  if (!Number.isFinite(atTimestamp)) throw new TypeError('at must be an ISO-8601 instant');
  if (atTimestamp > Date.parse(manifest.freshness.validUntil)) {
    throw new Error(`Provider runtime evidence is stale: ${manifest.providerId}`);
  }
  if (atTimestamp < Date.parse(manifest.freshness.observedAt)) {
    throw new Error(`Provider runtime evidence is not yet valid: ${manifest.providerId}`);
  }
  return compiled;
}

function resolveProviderRuntimeRoute({ catalog, providerId, operationId, at = new Date().toISOString() }) {
  if (!catalog || typeof catalog.get !== 'function') throw new TypeError('catalog is required');
  const id = assertSafeIdentifier(providerId, 'provider id');
  const operation = assertSafeIdentifier(operationId, 'operation id');
  const compiled = assertProviderReady(catalog.get(id), at);
  const manifest = compiled.normalizedManifest;
  const resolved = manifest.operations.find((entry) => entry.operationId === operation);
  if (!resolved) throw new Error(`Unknown provider operation: ${id}/${operation}`);
  return deepFreeze({
    schema: PROVIDER_RUNTIME_ROUTE_SCHEMA,
    providerId: id,
    providerContractId: compiled.providerContractId,
    providerManifestDigest: compiled.integrityDigest,
    providerKind: manifest.providerKind,
    protocolFamily: manifest.protocolFamily,
    transport: manifest.transport,
    operation: resolved,
    freshness: manifest.freshness,
  });
}

function assertCapabilityProviderContracts(providerContractIds, catalog, at = new Date().toISOString()) {
  if (!Array.isArray(providerContractIds)) throw new TypeError('providerContractIds must be an array');
  if (!catalog || typeof catalog.getByContractId !== 'function') throw new TypeError('catalog is required');
  const seen = new Set();
  return Object.freeze(providerContractIds.map((value) => {
    const contractId = assertSafeIdentifier(value, 'provider contract id');
    if (seen.has(contractId)) throw new Error(`Duplicate provider contract id: ${contractId}`);
    seen.add(contractId);
    return assertProviderReady(catalog.getByContractId(contractId), at).providerContractId;
  }));
}

module.exports = {
  HUMAN_GATE_POLICIES,
  PROTOCOL_FAMILIES,
  PROVIDER_KINDS,
  PROVIDER_RUNTIME_MANIFEST_SCHEMA,
  PROVIDER_RUNTIME_ROUTE_SCHEMA,
  RISK_CLASSES,
  TRANSPORT_MODES,
  assertCapabilityProviderContracts,
  canonicalize,
  compileProviderRuntimeManifest,
  createProviderRuntimeCatalog,
  digestProviderRuntimeManifest,
  resolveProviderRuntimeRoute,
};
