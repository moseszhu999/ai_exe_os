'use strict';

const { createHash } = require('node:crypto');
const {
  createCapabilityPackage,
  publishCapabilityVersion,
} = require('./capability-model.cjs');
const { assertSafeIdentifier } = require('./identifiers.cjs');
const { deepFreeze, requiredText } = require('./workspace-model.cjs');

const MANIFEST_SCHEMA = 'capability.knowledge.manifest.v1';
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SKILL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KNOWLEDGE_POLICIES = new Set([
  'monitor-high',
  'review-quarterly',
  'review-release',
  'review-annually',
  'manual',
]);
const TOOL_CLASSES = Object.freeze(['observe', 'draft', 'internalWrite', 'externalAction']);
const TOP_LEVEL_KEYS = new Set([
  'schema',
  'package',
  'version',
  'roleRefs',
  'skillRefs',
  'mcpDependencies',
  'toolGrants',
  'knowledge',
  'humanGates',
  'evidenceRequirements',
  'resourceRequirements',
  'providerContractIds',
  'uiResources',
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

function normalizeStringArray(values, label, { identifiers = false, minItems = 0 } = {}) {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  const normalized = values.map((value) => identifiers
    ? assertSafeIdentifier(value, label)
    : requiredText(value, label, 500));
  if (normalized.length < minItems) throw new Error(`${label} requires at least ${minItems} item(s)`);
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must not contain duplicates`);
  return normalized;
}

function normalizePackage(value) {
  const input = assertPlainObject(value, 'package');
  assertExactKeys(input, new Set(['id', 'name', 'publisher', 'description']), 'package');
  return createCapabilityPackage(input);
}

function normalizeVersion(value) {
  const input = assertPlainObject(value, 'version');
  assertExactKeys(input, new Set(['semver', 'inputSchema', 'outputSchema', 'humanGatePolicy', 'status']), 'version');
  const semver = requiredText(input.semver, 'capability version', 80);
  if (!VERSION_PATTERN.test(semver)) throw new Error('Capability knowledge version must be semver');
  if (!input.inputSchema || typeof input.inputSchema !== 'object' || Array.isArray(input.inputSchema)) {
    throw new TypeError('version.inputSchema must be an object');
  }
  if (!input.outputSchema || typeof input.outputSchema !== 'object' || Array.isArray(input.outputSchema)) {
    throw new TypeError('version.outputSchema must be an object');
  }
  return Object.freeze({
    semver,
    inputSchema: structuredClone(input.inputSchema),
    outputSchema: structuredClone(input.outputSchema),
    humanGatePolicy: requiredText(input.humanGatePolicy, 'human gate policy', 20),
    status: input.status || 'available',
  });
}

function normalizeSkillRefs(values, context) {
  if (!Array.isArray(values) || values.length === 0) throw new Error('skillRefs requires at least one skill');
  const seen = new Set();
  return values.map((entry) => {
    const input = assertPlainObject(entry, 'skillRef');
    assertExactKeys(input, new Set(['skillId', 'version']), 'skillRef');
    const skillId = requiredText(input.skillId, 'skill id', 64);
    if (!SKILL_ID_PATTERN.test(skillId)) throw new Error(`Invalid skill id: ${skillId}`);
    const version = requiredText(input.version, 'skill version', 80);
    if (!VERSION_PATTERN.test(version)) throw new Error(`Invalid skill version for ${skillId}`);
    const key = `${skillId}@${version}`;
    if (seen.has(key)) throw new Error(`Duplicate skill ref: ${key}`);
    seen.add(key);
    if (context.skillCatalog && context.skillCatalog.has(key) === false) {
      throw new Error(`Unknown skill ref: ${key}`);
    }
    return Object.freeze({ skillId, version });
  });
}

function normalizeMcpDependencies(values, context) {
  if (!Array.isArray(values)) throw new TypeError('mcpDependencies must be an array');
  const seen = new Set();
  return values.map((entry) => {
    const input = assertPlainObject(entry, 'mcpDependency');
    assertExactKeys(input, new Set(['serverId', 'minVersion', 'required']), 'mcpDependency');
    const serverId = assertSafeIdentifier(input.serverId, 'MCP server id');
    const minVersion = requiredText(input.minVersion, 'MCP minimum version', 80);
    if (!VERSION_PATTERN.test(minVersion)) throw new Error(`Invalid MCP minimum version for ${serverId}`);
    if (seen.has(serverId)) throw new Error(`Duplicate MCP dependency: ${serverId}`);
    seen.add(serverId);
    if (context.mcpCatalog && context.mcpCatalog.has(serverId) === false) {
      throw new Error(`Unknown MCP dependency: ${serverId}`);
    }
    return Object.freeze({ serverId, minVersion, required: input.required !== false });
  });
}

function normalizeToolGrants(value, dependencies, context) {
  const input = assertPlainObject(value, 'toolGrants');
  assertExactKeys(input, new Set(TOOL_CLASSES), 'toolGrants');
  const dependencyIds = new Set(dependencies.map((item) => item.serverId));
  const claimed = new Map();
  const output = {};

  for (const toolClass of TOOL_CLASSES) {
    const tools = normalizeStringArray(input[toolClass] || [], `toolGrants.${toolClass}`, { identifiers: true });
    for (const tool of tools) {
      if (claimed.has(tool)) throw new Error(`Tool ${tool} appears in multiple risk classes`);
      claimed.set(tool, toolClass);
      if (context.mcpCatalog) {
        const owningServers = [...dependencyIds].filter((serverId) => context.mcpCatalog.get(serverId)?.has(tool));
        if (owningServers.length === 0) throw new Error(`Tool ${tool} is not exposed by a declared MCP dependency`);
        if (owningServers.length > 1) throw new Error(`Tool ${tool} is ambiguous across MCP dependencies`);
      }
    }
    output[toolClass] = Object.freeze(tools);
  }
  return deepFreeze(output);
}

function normalizeKnowledge(value, sourceRefs, context) {
  const input = assertPlainObject(value, 'knowledge');
  assertExactKeys(input, new Set(['sourceRefs', 'freshnessPolicy', 'blockWhenReviewRequired']), 'knowledge');
  const refs = normalizeStringArray(input.sourceRefs, 'knowledge.sourceRefs', { identifiers: true, minItems: 1 });
  const freshnessPolicy = requiredText(input.freshnessPolicy, 'knowledge freshness policy', 40);
  if (!KNOWLEDGE_POLICIES.has(freshnessPolicy)) throw new Error(`Unsupported knowledge freshness policy: ${freshnessPolicy}`);
  const blockWhenReviewRequired = input.blockWhenReviewRequired === true;

  if (sourceRefs) {
    for (const ref of refs) {
      if (!sourceRefs.has(ref)) throw new Error(`Unknown knowledge source ref: ${ref}`);
    }
  }
  if (blockWhenReviewRequired) {
    for (const ref of refs) {
      const status = context.sourceStatusById?.get(ref);
      if (!status || ['review-required', 'stale', 'retired'].includes(status)) {
        throw new Error(`Knowledge source ${ref} is not execution-ready`);
      }
    }
  }

  return Object.freeze({ sourceRefs: refs, freshnessPolicy, blockWhenReviewRequired });
}

function normalizeHumanGates(values) {
  if (!Array.isArray(values)) throw new TypeError('humanGates must be an array');
  return values.map((entry) => {
    const input = assertPlainObject(entry, 'humanGate');
    assertExactKeys(input, new Set(['beforeAction', 'policyId', 'reason']), 'humanGate');
    return Object.freeze({
      beforeAction: assertSafeIdentifier(input.beforeAction, 'Human Gate action'),
      policyId: assertSafeIdentifier(input.policyId, 'Human Gate policy id'),
      reason: input.reason ? requiredText(input.reason, 'Human Gate reason', 600) : '',
    });
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function digestManifest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}

function compileCapabilityKnowledgeManifest(manifest, context = {}) {
  const input = assertPlainObject(manifest, 'capability knowledge manifest');
  assertExactKeys(input, TOP_LEVEL_KEYS, 'capability knowledge manifest');
  if (input.schema !== MANIFEST_SCHEMA) throw new Error(`Unsupported capability knowledge manifest schema: ${input.schema}`);

  const packageModel = normalizePackage(input.package);
  const sourceCatalog = context.sourceCatalog || null;
  const sourceRefs = sourceCatalog ? new Set(sourceCatalog.keys()) : null;
  const versionInput = normalizeVersion(input.version);
  const roleRefs = normalizeStringArray(input.roleRefs, 'roleRefs', { identifiers: true, minItems: 1 });
  const skillRefs = normalizeSkillRefs(input.skillRefs, context);
  const mcpDependencies = normalizeMcpDependencies(input.mcpDependencies, context);
  const toolGrants = normalizeToolGrants(input.toolGrants, mcpDependencies, context);
  const knowledge = normalizeKnowledge(input.knowledge, sourceRefs, context);
  const humanGates = normalizeHumanGates(input.humanGates);
  const evidenceRequirements = normalizeStringArray(input.evidenceRequirements || [], 'evidenceRequirements');
  const resourceRequirements = normalizeStringArray(input.resourceRequirements || [], 'resourceRequirements');
  const providerContractIds = normalizeStringArray(input.providerContractIds || [], 'providerContractIds', { identifiers: true });
  const uiResources = normalizeStringArray(input.uiResources || [], 'uiResources', { identifiers: true });

  if (toolGrants.externalAction.length > 0 && versionInput.humanGatePolicy !== 'action') {
    throw new Error('External actions require action-level Human Gate policy');
  }

  const normalizedManifest = deepFreeze({
    schema: MANIFEST_SCHEMA,
    package: packageModel,
    version: versionInput,
    roleRefs,
    skillRefs,
    mcpDependencies,
    toolGrants,
    knowledge,
    humanGates,
    evidenceRequirements,
    resourceRequirements,
    providerContractIds,
    uiResources,
  });
  const integrityDigest = digestManifest(normalizedManifest);
  const capabilityVersion = publishCapabilityVersion({
    packageId: packageModel.id,
    version: versionInput.semver,
    integrityDigest,
    inputSchema: versionInput.inputSchema,
    outputSchema: versionInput.outputSchema,
    evidenceRequirements,
    resourceRequirements,
    providerContractIds,
    humanGatePolicy: versionInput.humanGatePolicy,
    status: versionInput.status,
  });

  const recommendedGrantActions = Object.freeze([
    ...toolGrants.observe,
    ...toolGrants.draft,
    ...toolGrants.internalWrite,
  ]);

  return deepFreeze({
    package: packageModel,
    version: capabilityVersion,
    metadata: {
      roleRefs,
      skillRefs,
      mcpDependencies,
      toolGrants,
      knowledge,
      humanGates,
      uiResources,
    },
    normalizedManifest,
    integrityDigest,
    recommendedGrantActions,
    externalActionCandidates: toolGrants.externalAction,
  });
}

module.exports = {
  MANIFEST_SCHEMA,
  TOOL_CLASSES,
  canonicalize,
  compileCapabilityKnowledgeManifest,
  digestManifest,
};
