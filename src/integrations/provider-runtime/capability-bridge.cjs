'use strict';

const {
  compileCapabilityKnowledgeManifest,
} = require('../../domain/capability-knowledge-compiler.cjs');
const {
  assertCapabilityProviderContracts,
} = require('./index.cjs');

function setsEqual(left, right) {
  if (!(left instanceof Set) || !(right instanceof Set) || left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function mergeMcpCatalogs(runtimeCatalog, callerCatalog = null) {
  if (!(runtimeCatalog instanceof Map)) throw new TypeError('runtime MCP catalog must be a Map');
  if (callerCatalog !== null && !(callerCatalog instanceof Map)) throw new TypeError('caller mcpCatalog must be a Map');
  const merged = new Map();
  for (const [serverId, tools] of runtimeCatalog.entries()) merged.set(serverId, new Set(tools));
  if (!callerCatalog) return merged;
  for (const [serverId, tools] of callerCatalog.entries()) {
    if (!(tools instanceof Set)) throw new TypeError(`caller MCP catalog entry must be a Set: ${serverId}`);
    if (merged.has(serverId) && !setsEqual(merged.get(serverId), tools)) {
      throw new Error(`MCP catalog conflict for provider-bound server: ${serverId}`);
    }
    if (!merged.has(serverId)) merged.set(serverId, new Set(tools));
  }
  return merged;
}

function compileCapabilityKnowledgeWithProviderRuntime(
  manifest,
  {
    providerRuntimeCatalog,
    at = new Date().toISOString(),
    ...compilerContext
  } = {},
) {
  if (!providerRuntimeCatalog || typeof providerRuntimeCatalog.toMcpCatalog !== 'function') {
    throw new TypeError('providerRuntimeCatalog is required');
  }

  const providerContractIds = Array.isArray(manifest?.providerContractIds)
    ? manifest.providerContractIds
    : [];
  assertCapabilityProviderContracts(providerContractIds, providerRuntimeCatalog, at);

  const providerContracts = new Set(providerContractIds);
  for (const dependency of manifest?.mcpDependencies || []) {
    const provider = providerRuntimeCatalog.get(dependency.serverId);
    if (!provider) continue;
    if (provider.normalizedManifest?.providerKind !== 'mcp_server') {
      throw new Error(`MCP dependency resolves to non-MCP provider: ${dependency.serverId}`);
    }
    const expectedContractId = provider.providerContractId;
    if (!providerContracts.has(expectedContractId)) {
      throw new Error(`MCP dependency ${dependency.serverId} requires providerContractId ${expectedContractId}`);
    }
  }

  const runtimeMcpCatalog = providerRuntimeCatalog.toMcpCatalog();
  const mcpCatalog = mergeMcpCatalogs(runtimeMcpCatalog, compilerContext.mcpCatalog || null);

  return compileCapabilityKnowledgeManifest(manifest, {
    ...compilerContext,
    mcpCatalog,
  });
}

module.exports = {
  compileCapabilityKnowledgeWithProviderRuntime,
  mergeMcpCatalogs,
};
