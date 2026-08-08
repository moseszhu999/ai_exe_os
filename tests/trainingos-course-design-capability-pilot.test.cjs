'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compileCapabilityKnowledgeManifest,
} = require('../src/domain/capability-knowledge-compiler.cjs');

const manifestPath = path.join(
  __dirname,
  '..',
  'examples',
  'capability-manifests',
  'trainingos-course-design-draft-v1.json',
);

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function currentTruthContext() {
  return {
    agentSkillCatalog: new Set([
      'training-learning-outcomes@1.0.0',
      'training-course-alignment@1.0.0',
      'training-assessment-plan@1.0.0',
    ]),
    sourceCatalog: new Map([
      ['trainingos-agent-skill-pilot-v1', { owner: 'TrainingOS' }],
      ['trainingos-industry-role-pack-foundation-v1', { owner: 'TrainingOS' }],
    ]),
    sourceStatusById: new Map([
      ['trainingos-agent-skill-pilot-v1', 'ready'],
      ['trainingos-industry-role-pack-foundation-v1', 'ready'],
    ]),
    mcpCatalog: new Map([
      ['trainingos.mcp', new Set([
        'get_class_learning_structure',
      ])],
    ]),
  };
}

test('compiles the truthful current-main TrainingOS course-design draft capability', () => {
  const compiled = compileCapabilityKnowledgeManifest(readManifest(), currentTruthContext());

  assert.equal(compiled.package.id, 'training.course-design-draft');
  assert.equal(compiled.version.version, '1.0.0');
  assert.equal(compiled.version.status, 'draft');
  assert.equal(compiled.version.humanGatePolicy, 'never');
  assert.deepEqual(compiled.metadata.agentSkillRefs, [
    { skillId: 'training-learning-outcomes', version: '1.0.0' },
    { skillId: 'training-course-alignment', version: '1.0.0' },
    { skillId: 'training-assessment-plan', version: '1.0.0' },
  ]);
  assert.deepEqual(compiled.recommendedGrantActions, ['get_class_learning_structure']);
  assert.deepEqual(compiled.externalActionCandidates, []);
});

test('draft capability contains no MCP write or external action grant', () => {
  const manifest = readManifest();
  assert.deepEqual(manifest.toolGrants.draft, []);
  assert.deepEqual(manifest.toolGrants.internalWrite, []);
  assert.deepEqual(manifest.toolGrants.externalAction, []);
  assert.deepEqual(manifest.toolGrants.observe, ['get_class_learning_structure']);
});

test('manifest cannot claim pending Course Design MCP read before owning runtime merges it', () => {
  const manifest = readManifest();
  manifest.toolGrants.observe.push('get_course_design_context');

  assert.throws(
    () => compileCapabilityKnowledgeManifest(manifest, currentTruthContext()),
    /get_course_design_context is not exposed by a declared MCP dependency/,
  );
});

test('manifest cannot silently upgrade itself to install-ready availability', () => {
  const manifest = readManifest();
  assert.equal(manifest.version.status, 'draft');
  assert.equal(manifest.package.publisher, 'project-owned');
  assert.equal(manifest.version.outputSchema.properties.canonicalWritePerformed.const, false);
});

test('all three references are AgentSkill identities, not LearningSkill ids', () => {
  const manifest = readManifest();
  assert.deepEqual(
    manifest.agentSkillRefs.map((item) => item.skillId),
    [
      'training-learning-outcomes',
      'training-course-alignment',
      'training-assessment-plan',
    ],
  );
  assert.equal(Object.hasOwn(manifest, 'skillRefs'), false);
  assert.equal(JSON.stringify(manifest).includes('competencies.id'), false);
});

test('knowledge freshness can block compilation without changing runtime authority', () => {
  const context = currentTruthContext();
  context.sourceStatusById.set('trainingos-industry-role-pack-foundation-v1', 'review-required');

  assert.throws(
    () => compileCapabilityKnowledgeManifest(readManifest(), context),
    /is not execution-ready/,
  );
});

test('manifest uses the currently proven TrainingOS MCP version floor and no provider contract', () => {
  const manifest = readManifest();
  assert.deepEqual(manifest.mcpDependencies, [
    { serverId: 'trainingos.mcp', minVersion: '0.5.1', required: true },
  ]);
  assert.deepEqual(manifest.providerContractIds, []);
  assert.deepEqual(manifest.uiResources, []);
});
