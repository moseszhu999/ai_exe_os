'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { compileCapabilityKnowledgeManifest } = require('../src/domain/capability-knowledge-compiler.cjs');

const v1Path = path.join(__dirname, '..', 'examples', 'capability-manifests', 'trainingos-course-design-draft-v1.json');
const v11Path = path.join(__dirname, '..', 'examples', 'capability-manifests', 'trainingos-course-design-draft-v1.1.json');

function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function contextV11() {
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
      ])],
    ]),
  };
}

test('v1.1 compiles both currently proven TrainingOS read tools', () => {
  const compiled = compileCapabilityKnowledgeManifest(read(v11Path), contextV11());
  assert.equal(compiled.package.id, 'training.course-design-draft');
  assert.equal(compiled.version.version, '1.1.0');
  assert.equal(compiled.version.status, 'draft');
  assert.deepEqual(compiled.recommendedGrantActions, [
    'get_class_learning_structure',
    'get_course_design_context',
  ]);
  assert.deepEqual(compiled.externalActionCandidates, []);
});

test('v1.1 remains observe-only and non-install-ready', () => {
  const manifest = read(v11Path);
  assert.equal(manifest.version.status, 'draft');
  assert.equal(manifest.version.humanGatePolicy, 'never');
  assert.deepEqual(manifest.toolGrants.draft, []);
  assert.deepEqual(manifest.toolGrants.internalWrite, []);
  assert.deepEqual(manifest.toolGrants.externalAction, []);
  assert.equal(manifest.version.outputSchema.properties.canonicalWritePerformed.const, false);
});

test('v1 remains immutable at MCP 0.5.1 with one observe tool', () => {
  const v1 = read(v1Path);
  assert.equal(v1.version.semver, '1.0.0');
  assert.deepEqual(v1.mcpDependencies, [
    { serverId: 'trainingos.mcp', minVersion: '0.5.1', required: true },
  ]);
  assert.deepEqual(v1.toolGrants.observe, ['get_class_learning_structure']);
  assert.equal(JSON.stringify(v1).includes('get_course_design_context'), false);
});

test('v1.1 requires the new MCP tool to be actually present in the supplied catalog', () => {
  const context = contextV11();
  context.mcpCatalog.set('trainingos.mcp', new Set(['get_class_learning_structure']));
  assert.throws(
    () => compileCapabilityKnowledgeManifest(read(v11Path), context),
    /get_course_design_context is not exposed by a declared MCP dependency/,
  );
});

test('v1.1 uses the canonical MCP 0.5.2 floor and new source provenance', () => {
  const manifest = read(v11Path);
  assert.deepEqual(manifest.mcpDependencies, [
    { serverId: 'trainingos.mcp', minVersion: '0.5.2', required: true },
  ]);
  assert.ok(manifest.knowledge.sourceRefs.includes('trainingos-course-design-mcp-read-v1'));
  assert.ok(manifest.evidenceRequirements.includes('trainingos-course-design-context-snapshot'));
});

test('review-required course-design MCP knowledge blocks compilation', () => {
  const context = contextV11();
  context.sourceStatusById.set('trainingos-course-design-mcp-read-v1', 'review-required');
  assert.throws(
    () => compileCapabilityKnowledgeManifest(read(v11Path), context),
    /is not execution-ready/,
  );
});

test('v1.1 still claims no provider or review UI runtime', () => {
  const manifest = read(v11Path);
  assert.deepEqual(manifest.providerContractIds, []);
  assert.deepEqual(manifest.uiResources, []);
});
