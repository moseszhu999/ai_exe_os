'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compileCapabilityKnowledgeManifest,
  digestManifest,
} = require('../src/domain/capability-knowledge-compiler.cjs');

function manifest(overrides = {}) {
  return {
    schema: 'capability.knowledge.manifest.v1',
    package: {
      id: 'training.course-alignment',
      name: 'TrainingOS Course Alignment',
      publisher: 'project-owned',
      description: 'Source-backed course alignment drafting.',
    },
    version: {
      semver: '1.0.0',
      inputSchema: { type: 'object', required: ['courseId'], properties: { courseId: { type: 'string' } } },
      outputSchema: { type: 'object', required: ['status'], properties: { status: { const: 'draft' } } },
      humanGatePolicy: 'action',
      status: 'available',
    },
    roleRefs: ['training.instructional-designer'],
    skillRefs: [{ skillId: 'training-course-alignment', version: '1.0.0' }],
    mcpDependencies: [{ serverId: 'training.mcp', minVersion: '1.0.0', required: true }],
    toolGrants: {
      observe: ['training_get_course_map'],
      draft: ['training_create_alignment_draft'],
      internalWrite: [],
      externalAction: [],
    },
    knowledge: {
      sourceRefs: ['cornell-course-design', 'uic-backward-design'],
      freshnessPolicy: 'review-annually',
      blockWhenReviewRequired: false,
    },
    humanGates: [{
      beforeAction: 'canonical-course-update',
      policyId: 'course-owner-review',
      reason: 'Course owner approval required.',
    }],
    evidenceRequirements: ['course-map-snapshot', 'alignment-diff', 'source-provenance'],
    resourceRequirements: ['trainingos-course'],
    providerContractIds: [],
    uiResources: ['course-alignment-review'],
    ...overrides,
  };
}

function context() {
  return {
    skillCatalog: new Set(['training-course-alignment@1.0.0']),
    sourceCatalog: new Map([
      ['cornell-course-design', {}],
      ['uic-backward-design', {}],
    ]),
    sourceStatusById: new Map([
      ['cornell-course-design', 'ready'],
      ['uic-backward-design', 'ready'],
    ]),
    mcpCatalog: new Map([
      ['training.mcp', new Set([
        'training_get_course_map',
        'training_create_alignment_draft',
        'training_publish_course',
      ])],
    ]),
  };
}

test('compiles knowledge metadata into the existing capability package/version model', () => {
  const compiled = compileCapabilityKnowledgeManifest(manifest(), context());

  assert.equal(compiled.package.id, 'training.course-alignment');
  assert.equal(compiled.version.packageId, 'training.course-alignment');
  assert.equal(compiled.version.version, '1.0.0');
  assert.equal(compiled.version.integrityDigest, compiled.integrityDigest);
  assert.deepEqual(compiled.version.evidenceRequirements, [
    'course-map-snapshot',
    'alignment-diff',
    'source-provenance',
  ]);
  assert.deepEqual(compiled.recommendedGrantActions, [
    'training_get_course_map',
    'training_create_alignment_draft',
  ]);
  assert.deepEqual(compiled.externalActionCandidates, []);
  assert.equal(compiled.metadata.skillRefs[0].skillId, 'training-course-alignment');
  assert.ok(Object.isFrozen(compiled));
  assert.ok(Object.isFrozen(compiled.metadata));
});

test('manifest digest is deterministic across object key ordering', () => {
  const first = manifest();
  const second = {
    uiResources: first.uiResources,
    providerContractIds: first.providerContractIds,
    resourceRequirements: first.resourceRequirements,
    evidenceRequirements: first.evidenceRequirements,
    humanGates: first.humanGates,
    knowledge: first.knowledge,
    toolGrants: first.toolGrants,
    mcpDependencies: first.mcpDependencies,
    skillRefs: first.skillRefs,
    roleRefs: first.roleRefs,
    version: first.version,
    package: first.package,
    schema: first.schema,
  };

  assert.equal(digestManifest(first), digestManifest(second));
  assert.equal(
    compileCapabilityKnowledgeManifest(first, context()).integrityDigest,
    compileCapabilityKnowledgeManifest(second, context()).integrityDigest,
  );
});

test('rejects a tool assigned to more than one risk class', () => {
  const input = manifest({
    toolGrants: {
      observe: ['training_get_course_map'],
      draft: ['training_get_course_map'],
      internalWrite: [],
      externalAction: [],
    },
  });
  assert.throws(
    () => compileCapabilityKnowledgeManifest(input, context()),
    /appears in multiple risk classes/,
  );
});

test('rejects tools not exposed by declared MCP dependencies', () => {
  const input = manifest({
    toolGrants: {
      observe: ['training_get_course_map'],
      draft: ['training_unknown_tool'],
      internalWrite: [],
      externalAction: [],
    },
  });
  assert.throws(
    () => compileCapabilityKnowledgeManifest(input, context()),
    /is not exposed by a declared MCP dependency/,
  );
});

test('never includes external actions in the recommended Agent grant', () => {
  const input = manifest({
    toolGrants: {
      observe: ['training_get_course_map'],
      draft: ['training_create_alignment_draft'],
      internalWrite: [],
      externalAction: ['training_publish_course'],
    },
  });
  const compiled = compileCapabilityKnowledgeManifest(input, context());
  assert.deepEqual(compiled.recommendedGrantActions, [
    'training_get_course_map',
    'training_create_alignment_draft',
  ]);
  assert.deepEqual(compiled.externalActionCandidates, ['training_publish_course']);
});

test('external action candidates require action-level Human Gate policy', () => {
  const input = manifest({
    version: {
      ...manifest().version,
      humanGatePolicy: 'task',
    },
    toolGrants: {
      observe: ['training_get_course_map'],
      draft: [],
      internalWrite: [],
      externalAction: ['training_publish_course'],
    },
  });
  assert.throws(
    () => compileCapabilityKnowledgeManifest(input, context()),
    /External actions require action-level Human Gate policy/,
  );
});

test('blocks execution-ready compilation when a required source needs review', () => {
  const input = manifest({
    knowledge: {
      ...manifest().knowledge,
      blockWhenReviewRequired: true,
    },
  });
  const blockedContext = context();
  blockedContext.sourceStatusById.set('uic-backward-design', 'review-required');
  assert.throws(
    () => compileCapabilityKnowledgeManifest(input, blockedContext),
    /Knowledge source uic-backward-design is not execution-ready/,
  );
});

test('rejects unknown Skill versions and unsupported manifest fields', () => {
  const wrongSkill = manifest({
    skillRefs: [{ skillId: 'training-course-alignment', version: '2.0.0' }],
  });
  assert.throws(
    () => compileCapabilityKnowledgeManifest(wrongSkill, context()),
    /Unknown skill ref/,
  );

  const withRuntimeAuthority = manifest();
  withRuntimeAuthority.allowedTargets = ['production'];
  assert.throws(
    () => compileCapabilityKnowledgeManifest(withRuntimeAuthority, context()),
    /unsupported field: allowedTargets/,
  );
});
