'use strict';

const { createHash } = require('node:crypto');

const MCP_RUNTIME_ATTESTATION_SCHEMA = 'ai-execution-os.mcp-runtime-attestation.v1';
const CORE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireText(value, label, maxLength = 300) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  if (normalized.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters`);
  return normalized;
}

function parseCoreSemver(value, label) {
  const normalized = requireText(value, label, 80);
  const match = CORE_SEMVER.exec(normalized);
  if (!match) throw new Error(`${label} must be a stable core semver (major.minor.patch)`);
  return Object.freeze({
    text: normalized,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  });
}

function compareCoreSemver(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return 0;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`;
}

function normalizedManifest(compiledCapability) {
  const compiled = requireObject(compiledCapability, 'compiledCapability');
  return requireObject(compiled.normalizedManifest, 'compiledCapability.normalizedManifest');
}

function capabilityIdentity(compiledCapability, manifest) {
  const packageId = requireText(compiledCapability?.package?.id || manifest?.package?.id, 'capability package id');
  const version = requireText(compiledCapability?.version?.version || manifest?.version?.semver, 'capability version');
  const integrityDigest = requireText(
    compiledCapability?.integrityDigest || compiledCapability?.version?.integrityDigest,
    'capability integrity digest',
    100,
  );
  return { packageId, version, integrityDigest };
}

function dependencyFor(manifest, serverId) {
  const dependencies = Array.isArray(manifest.mcpDependencies) ? manifest.mcpDependencies : [];
  const matches = dependencies.filter((item) => item?.serverId === serverId);
  if (matches.length !== 1) throw new Error(`Exactly one MCP dependency is required for ${serverId}`);
  const dependency = requireObject(matches[0], `MCP dependency ${serverId}`);
  return {
    serverId,
    minVersion: parseCoreSemver(dependency.minVersion, `${serverId} minVersion`),
    required: dependency.required === true,
  };
}

function observeOnlyTools(manifest) {
  const grants = requireObject(manifest.toolGrants, 'manifest.toolGrants');
  for (const riskClass of ['draft', 'internalWrite', 'externalAction']) {
    const values = Array.isArray(grants[riskClass]) ? grants[riskClass] : [];
    if (values.length) throw new Error(`S1A runtime attestation accepts observe-only capability versions; ${riskClass} must be empty`);
  }
  const observe = Array.isArray(grants.observe) ? grants.observe.map((value) => requireText(value, 'observe tool')) : [];
  if (!observe.length) throw new Error('S1A runtime attestation requires at least one observe tool');
  if (new Set(observe).size !== observe.length) throw new Error('Observe tool grants must not contain duplicates');
  return Object.freeze([...observe]);
}

function authRequired(response) {
  return Boolean(
    response?.error
    && (response.error.code === -32001 || response.error.data?.httpStatus === 401),
  );
}

async function rpc(client, method, params) {
  if (!client || typeof client.request !== 'function') throw new TypeError('client.request is required');
  const response = await client.request({
    jsonrpc: '2.0',
    id: `${method}:attestation`,
    method,
    params,
  });
  if (authRequired(response)) return { authRequired: true, response };
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error(`MCP ${method} returned an invalid JSON-RPC envelope`);
  }
  if (response.error) {
    const code = Number.isFinite(response.error.code) ? response.error.code : 'unknown';
    throw new Error(`MCP ${method} failed with JSON-RPC code ${code}`);
  }
  if (!response.result || typeof response.result !== 'object' || Array.isArray(response.result)) {
    throw new Error(`MCP ${method} returned no result object`);
  }
  return { authRequired: false, result: response.result };
}

function authReceipt({ identity, serverId, phase, checkedAt }) {
  return Object.freeze({
    schemaVersion: MCP_RUNTIME_ATTESTATION_SCHEMA,
    status: 'auth_required',
    verified: false,
    phase,
    packageId: identity.packageId,
    capabilityVersion: identity.version,
    capabilityIntegrityDigest: identity.integrityDigest,
    serverId,
    checkedAt,
    truthBoundary: Object.freeze({
      installationPerformed: false,
      agentGrantPerformed: false,
      toolInvocationPerformed: false,
      canonicalWritePerformed: false,
      humanApprovalInferred: false,
    }),
  });
}

function toolSummary(tool, requiredName) {
  const item = requireObject(tool, `MCP tool ${requiredName}`);
  if (item.name !== requiredName) throw new Error(`MCP tool identity mismatch for ${requiredName}`);
  const annotations = requireObject(item.annotations, `MCP tool ${requiredName} annotations`);
  if (annotations.readOnlyHint !== true) throw new Error(`Required observe tool ${requiredName} is not annotated read-only`);
  if (annotations.destructiveHint !== false) throw new Error(`Required observe tool ${requiredName} is not explicitly non-destructive`);
  return Object.freeze({
    name: requiredName,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: annotations.idempotentHint === true,
    openWorldHint: annotations.openWorldHint === true,
  });
}

async function attestObserveOnlyMcpRuntime({
  compiledCapability,
  client,
  serverId,
  expectedServerName,
  protocolVersion = '2025-11-25',
  checkedAt = new Date().toISOString(),
} = {}) {
  const manifest = normalizedManifest(compiledCapability);
  const identity = capabilityIdentity(compiledCapability, manifest);
  const normalizedServerId = requireText(serverId, 'serverId');
  const normalizedServerName = requireText(expectedServerName, 'expectedServerName');
  const dependency = dependencyFor(manifest, normalizedServerId);
  if (!dependency.required) throw new Error(`S1A runtime attestation requires ${normalizedServerId} to be a required dependency`);
  const requiredTools = observeOnlyTools(manifest);

  const initialized = await rpc(client, 'initialize', {
    protocolVersion,
    capabilities: {},
    clientInfo: {
      name: 'ai-execution-os-runtime-attestation',
      version: '1.0.0',
    },
  });
  if (initialized.authRequired) {
    return authReceipt({ identity, serverId: normalizedServerId, phase: 'initialize', checkedAt });
  }

  const serverInfo = requireObject(initialized.result.serverInfo, 'MCP initialize serverInfo');
  const observedServerName = requireText(serverInfo.name, 'MCP server name');
  if (observedServerName !== normalizedServerName) {
    throw new Error(`MCP server identity mismatch: expected ${normalizedServerName}, observed ${observedServerName}`);
  }
  const observedVersion = parseCoreSemver(serverInfo.version, 'MCP server version');
  if (compareCoreSemver(observedVersion, dependency.minVersion) < 0) {
    throw new Error(`MCP server version ${observedVersion.text} is below required ${dependency.minVersion.text}`);
  }

  const listed = await rpc(client, 'tools/list', {});
  if (listed.authRequired) {
    return authReceipt({ identity, serverId: normalizedServerId, phase: 'tools/list', checkedAt });
  }
  const tools = Array.isArray(listed.result.tools) ? listed.result.tools : [];
  const byName = new Map();
  for (const tool of tools) {
    const name = requireText(tool?.name, 'MCP tool name');
    if (byName.has(name)) throw new Error(`MCP tools/list contains duplicate tool identity: ${name}`);
    byName.set(name, tool);
  }

  const observedRequiredTools = requiredTools.map((name) => {
    const tool = byName.get(name);
    if (!tool) throw new Error(`Required observe tool is not advertised by MCP runtime: ${name}`);
    return toolSummary(tool, name);
  });

  const evidenceShape = {
    serverId: normalizedServerId,
    serverName: observedServerName,
    serverVersion: observedVersion.text,
    minimumVersion: dependency.minVersion.text,
    protocolVersion: requireText(initialized.result.protocolVersion || protocolVersion, 'MCP protocol version'),
    requiredTools: observedRequiredTools,
  };

  return Object.freeze({
    schemaVersion: MCP_RUNTIME_ATTESTATION_SCHEMA,
    status: 'verified_discovery',
    verified: true,
    packageId: identity.packageId,
    capabilityVersion: identity.version,
    capabilityIntegrityDigest: identity.integrityDigest,
    serverId: normalizedServerId,
    expectedServerName: normalizedServerName,
    observedServerName,
    minimumServerVersion: dependency.minVersion.text,
    observedServerVersion: observedVersion.text,
    protocolVersion: evidenceShape.protocolVersion,
    requiredObserveTools: Object.freeze([...requiredTools]),
    observedRequiredTools: Object.freeze(observedRequiredTools),
    discoveryDigest: sha256(evidenceShape),
    checkedAt,
    truthBoundary: Object.freeze({
      installationPerformed: false,
      agentGrantPerformed: false,
      toolInvocationPerformed: false,
      canonicalWritePerformed: false,
      humanApprovalInferred: false,
    }),
  });
}

module.exports = {
  MCP_RUNTIME_ATTESTATION_SCHEMA,
  attestObserveOnlyMcpRuntime,
  compareCoreSemver,
  parseCoreSemver,
};
