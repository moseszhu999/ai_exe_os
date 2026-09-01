'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROVIDER_RUNTIME_MANIFEST_SCHEMA,
  createProviderRuntimeCatalog,
} = require('../src/integrations/provider-runtime/index.cjs');
const {
  compileCapabilityKnowledgeWithProviderRuntime,
  mergeMcpCatalogs,
} = require('../src/integrations/provider-runtime/capability-bridge.cjs');

function providerManifest() {
  return {
    schema: PROVIDER_RUNTIME_MANIFEST_SCHEMA,
    providerId: 'shared-media',
    displayName: 'Shared Media MCP',
    providerKind: 'mcp_server',
    protocolFamily: 'mcp',
    transport: {
      mode: 'mcp_streamable_http',
      endpointRef: 'endpoint.shared-media-mcp',
      credentialRefs: ['credential.shared-media-mcp'],
      networkPolicyRef: 'network.shared-media-private',
    },
    operations: [{
      operationId: 'media-read',
      providerOperation: 'tools/call',
      riskClass: 'observe',
      humanGatePolicy: 'never',
      toolNames: ['media_get_job', 'media_get_artifact'],
    }],
    freshness: {
      observedAt: '2026-08-11T00:00:00.000Z',
      validUntil: '2026-09-11T00:00:00.000Z',
      sourceRefs: ['source.shared-media-contract'],
    },
    status: 'available',
  };
}

function capabilityManifest(overrides = {}) {
  return {
    schema: 'capability.knowledge.manifest.v1',
    package: {
      id: 'training.course-video-inspect',
      name: 'Course Video Inspect',
      publisher: 'project-owned',
      description: 'Inspect a Shared Media course-video job through the shared runtime.',
    },
    version: {
      semver: '1.0.0',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      humanGatePolicy: 'never',
      status: 'available',
    },
    roleRefs: ['training.instructor'],
    agentSkillRefs: [{ skillId: 'course-video-inspect', version: '1.0.0' }],
    mcpDependencies: [{ serverId: 'shared-media', minVersion: '0.1.0', required: true }],
    toolGrants: {
      observe: ['media_get_job', 'media_get_artifact'],
      draft: [],
      internalWrite: [],
      externalAction: [],
    },
    knowledge: {
      sourceRefs: ['shared-media-contract'],
      freshnessPolicy: 'review-release',
      blockWhenReviewRequired: true,
    },
    humanGates: [],
    evidenceRequirements: ['shared-media-job-evidence'],
    resourceRequirements: ['shared-media-job'],
    providerContractIds: ['prv.shared-media'],
    uiResources: [],
    ...overrides,
  };
}

function compilerContext() {
  return {
    agentSkillCatalog: new Set(['course-video-inspect@1.0.0']),
    sourceCatalog: new Map([['shared-media-contract', {}]]),
    sourceStatusById: new Map([['shared-media-contract', 'ready']]),
  };
}

test('compiles CapabilityVersion with MCP ownership and provider contract checked by one runtime catalog', () => {
  const providerRuntimeCatalog = createProviderRuntimeCatalog([providerManifest()]);
  const compiled = compileCapabilityKnowledgeWithProviderRuntime(capabilityManifest(), {
    providerRuntimeCatalog,
    at: '2026-08-11T12:00:00.000Z',
    ...compilerContext(),
  });
  assert.deepEqual(compiled.version.providerContractIds, ['prv.shared-media']);
  assert.deepEqual(compiled.recommendedGrantActions, ['media_get_job', 'media_get_artifact']);
});

test('provider-bound MCP dependency must declare its exact provider contract id', () => {
  const providerRuntimeCatalog = createProviderRuntimeCatalog([providerManifest()]);
  assert.throws(() => compileCapabilityKnowledgeWithProviderRuntime(
    capabilityManifest({ providerContractIds: [] }),
    {
      providerRuntimeCatalog,
      at: '2026-08-11T12:00:00.000Z',
      ...compilerContext(),
    },
  ), /requires providerContractId prv.shared-media/);
});

test('unknown provider contract fails before capability publication', () => {
  const providerRuntimeCatalog = createProviderRuntimeCatalog([providerManifest()]);
  assert.throws(() => compileCapabilityKnowledgeWithProviderRuntime(
    capabilityManifest({ providerContractIds: ['prv.missing'] }),
    {
      providerRuntimeCatalog,
      at: '2026-08-11T12:00:00.000Z',
      ...compilerContext(),
    },
  ), /Unknown provider runtime binding/);
});

test('caller MCP metadata cannot silently drift from provider-bound MCP ownership', () => {
  const providerRuntimeCatalog = createProviderRuntimeCatalog([providerManifest()]);
  assert.throws(() => compileCapabilityKnowledgeWithProviderRuntime(capabilityManifest(), {
    providerRuntimeCatalog,
    at: '2026-08-11T12:00:00.000Z',
    ...compilerContext(),
    mcpCatalog: new Map([['shared-media', new Set(['media_get_job'])]]),
  }), /MCP catalog conflict/);
});

test('non-overlapping caller MCP catalog entries remain composable', () => {
  const runtime = new Map([['shared-media', new Set(['media_get_job'])]]);
  const caller = new Map([['training-read', new Set(['training_get_course'])]]);
  const merged = mergeMcpCatalogs(runtime, caller);
  assert.deepEqual([...merged.keys()], ['shared-media', 'training-read']);
});
