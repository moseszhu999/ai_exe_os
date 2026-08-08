'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { compileCapabilityKnowledgeManifest } = require('../src/domain/capability-knowledge-compiler.cjs');
const { attestObserveOnlyMcpRuntime } = require('../src/mcp/runtime-attestation.cjs');

const manifestPath = path.join(
  __dirname,
  '..',
  'examples',
  'capability-manifests',
  'trainingos-course-design-draft-v1.1.json',
);

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function compilerContext(extraTools = []) {
  return {
    agentSkillCatalog: new Set([
      'training-learning-outcomes@1.0.0',
      'training-course-alignment@1.0.0',
      'training-assessment-plan@1.0.0',
    ]),
    sourceCatalog: new Map([
      ['trainingos-agent-skill-pilot-v1', { owner: 'TrainingOS' }],
      ['trainingos-industry-role-pack-foundation-v1', { owner: 'TrainingOS' }],
      ['trainingos-course-design-mcp-read-v1', { owner: 'TrainingOS' }],
    ]),
    sourceStatusById: new Map([
      ['trainingos-agent-skill-pilot-v1', 'ready'],
      ['trainingos-industry-role-pack-foundation-v1', 'ready'],
      ['trainingos-course-design-mcp-read-v1', 'ready'],
    ]),
    mcpCatalog: new Map([
      ['trainingos.mcp', new Set([
        'get_class_learning_structure',
        'get_course_design_context',
        ...extraTools,
      ])],
    ]),
  };
}

function compiledCapability(manifest = readManifest(), context = compilerContext()) {
  return compileCapabilityKnowledgeManifest(manifest, context);
}

function readTool(name, overrides = {}) {
  return {
    name,
    description: `${name} read tool`,
    inputSchema: { type: 'object' },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    ...overrides,
  };
}

function fakeClient({
  serverName = 'trainingos-agent-gateway',
  serverVersion = '1.6.0',
  protocolVersion = '2025-11-25',
  tools,
  nextCursor = null,
  authAt = null,
  serverInfoExtra = {},
} = {}) {
  const advertisedTools = tools || [
    readTool('get_class_learning_structure'),
    readTool('get_course_design_context'),
    {
      name: 'publish_challenge_version',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ];
  const requests = [];
  return {
    requests,
    async request(message) {
      requests.push(structuredClone(message));
      if (authAt === message.method) {
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32001,
            message: 'Authentication required',
            data: { httpStatus: 401 },
          },
        };
      }
      if (message.method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo: {
              name: serverName,
              version: serverVersion,
              ...serverInfoExtra,
            },
          },
        };
      }
      if (message.method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            tools: advertisedTools,
            ...(nextCursor ? { nextCursor } : {}),
          },
        };
      }
      throw new Error(`Unexpected method: ${message.method}`);
    },
  };
}

const attestationInput = (client, compiled = compiledCapability()) => ({
  compiledCapability: compiled,
  client,
  serverId: 'trainingos.mcp',
  expectedServerName: 'trainingos-agent-gateway',
  checkedAt: '2026-08-08T08:00:00.000Z',
});

test('accepts final TrainingOS 1.6.0 runtime above the v1.1 MCP 0.5.2 floor', async () => {
  const client = fakeClient();
  const receipt = await attestObserveOnlyMcpRuntime(attestationInput(client));

  assert.equal(receipt.status, 'verified_discovery');
  assert.equal(receipt.verified, true);
  assert.equal(receipt.serverId, 'trainingos.mcp');
  assert.equal(receipt.observedServerName, 'trainingos-agent-gateway');
  assert.equal(receipt.minimumServerVersion, '0.5.2');
  assert.equal(receipt.observedServerVersion, '1.6.0');
  assert.equal(receipt.protocolVersion, '2025-11-25');
  assert.deepEqual(receipt.requiredObserveTools, [
    'get_class_learning_structure',
    'get_course_design_context',
  ]);
  assert.deepEqual(receipt.observedRequiredTools.map((item) => item.name), receipt.requiredObserveTools);
  assert.match(receipt.discoveryDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(receipt.truthBoundary.installationPerformed, false);
  assert.equal(receipt.truthBoundary.agentGrantPerformed, false);
  assert.equal(receipt.truthBoundary.toolInvocationPerformed, false);
  assert.equal(receipt.truthBoundary.canonicalWritePerformed, false);
  assert.deepEqual(client.requests.map((item) => item.method), ['initialize', 'tools/list']);
});

test('extra write-capable server tools do not become capability grants', async () => {
  const receipt = await attestObserveOnlyMcpRuntime(attestationInput(fakeClient()));
  assert.equal(receipt.requiredObserveTools.includes('publish_challenge_version'), false);
  assert.equal(JSON.stringify(receipt).includes('publish_challenge_version'), false);
});

test('fails closed when the runtime server version is below the manifest floor', async () => {
  await assert.rejects(
    () => attestObserveOnlyMcpRuntime(attestationInput(fakeClient({ serverVersion: '0.5.1' }))),
    /below required 0\.5\.2/,
  );
});

test('fails closed on server identity drift', async () => {
  await assert.rejects(
    () => attestObserveOnlyMcpRuntime(attestationInput(fakeClient({ serverName: 'some-other-mcp' }))),
    /server identity mismatch/,
  );
});

test('fails closed on unexpected MCP protocol negotiation', async () => {
  await assert.rejects(
    () => attestObserveOnlyMcpRuntime(attestationInput(fakeClient({ protocolVersion: '2025-06-18' }))),
    /protocol negotiation mismatch/,
  );
});

test('fails closed when tools/list is paginated because discovery is incomplete in v1', async () => {
  await assert.rejects(
    () => attestObserveOnlyMcpRuntime(attestationInput(fakeClient({ nextCursor: 'page-2' }))),
    /discovery is incomplete/,
  );
});

test('fails closed when a required observe tool is not advertised', async () => {
  const client = fakeClient({ tools: [readTool('get_class_learning_structure')] });
  await assert.rejects(
    () => attestObserveOnlyMcpRuntime(attestationInput(client)),
    /get_course_design_context/,
  );
});

test('fails closed when a required observe tool loses its read-only annotation', async () => {
  const client = fakeClient({ tools: [
    readTool('get_class_learning_structure'),
    readTool('get_course_design_context', {
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    }),
  ] });
  await assert.rejects(
    () => attestObserveOnlyMcpRuntime(attestationInput(client)),
    /not annotated read-only/,
  );
});

test('fails closed on duplicate runtime tool identities', async () => {
  const client = fakeClient({ tools: [
    readTool('get_class_learning_structure'),
    readTool('get_course_design_context'),
    readTool('get_course_design_context'),
  ] });
  await assert.rejects(
    () => attestObserveOnlyMcpRuntime(attestationInput(client)),
    /duplicate tool identity/,
  );
});

test('authentication required during initialize is a bounded non-PASS result', async () => {
  const client = fakeClient({ authAt: 'initialize' });
  const receipt = await attestObserveOnlyMcpRuntime(attestationInput(client));
  assert.equal(receipt.status, 'auth_required');
  assert.equal(receipt.verified, false);
  assert.equal(receipt.phase, 'initialize');
  assert.equal(receipt.truthBoundary.toolInvocationPerformed, false);
  assert.deepEqual(client.requests.map((item) => item.method), ['initialize']);
});

test('authentication required during tools/list does not get upgraded to discovery PASS', async () => {
  const client = fakeClient({ authAt: 'tools/list' });
  const receipt = await attestObserveOnlyMcpRuntime(attestationInput(client));
  assert.equal(receipt.status, 'auth_required');
  assert.equal(receipt.verified, false);
  assert.equal(receipt.phase, 'tools/list');
  assert.deepEqual(client.requests.map((item) => item.method), ['initialize', 'tools/list']);
});

test('S1A refuses capability versions that request draft or write authority', async () => {
  const manifest = readManifest();
  manifest.toolGrants.draft = ['prepare_course_design_draft'];
  const context = compilerContext(['prepare_course_design_draft']);
  const compiled = compiledCapability(manifest, context);
  await assert.rejects(
    () => attestObserveOnlyMcpRuntime(attestationInput(fakeClient(), compiled)),
    /observe-only capability versions/,
  );
});

test('attestation receipt never copies secret-shaped server or tool metadata', async () => {
  const secret = 'Bearer should-never-enter-receipt';
  const client = fakeClient({
    serverInfoExtra: { authorization: secret, token: 'server-secret' },
    tools: [
      readTool('get_class_learning_structure', { credential: 'tool-secret' }),
      readTool('get_course_design_context', { bearer: secret }),
    ],
  });
  const receipt = await attestObserveOnlyMcpRuntime(attestationInput(client));
  const serialized = JSON.stringify(receipt);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes('server-secret'), false);
  assert.equal(serialized.includes('tool-secret'), false);
  assert.equal(serialized.includes('authorization'), false);
  assert.equal(serialized.includes('credential'), false);
  assert.equal(serialized.includes('bearer'), false);
});
