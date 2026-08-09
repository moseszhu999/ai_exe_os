'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createManagedProjectSnapshot } = require('../src/management/portfolio/index.cjs');
const {
  createManagedWorkstreamSnapshot,
  evaluateWorkstreamAttention,
  rollupProjectWorkstreamAttention,
} = require('../src/management/portfolio/workstream-attention.cjs');

const fixture = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'management', 'm2-real-workstream-replay-2026-08-09.json'), 'utf8'));

function loadCase(projectId) {
  const row = fixture.projects.find((candidate) => candidate.project.id === projectId);
  assert.ok(row, `missing fixture project ${projectId}`);
  const project = createManagedProjectSnapshot(row.project);
  const workstreams = row.workstreams.map(createManagedWorkstreamSnapshot);
  return { row, project, workstreams };
}

test('M2.3 real workstream replay is evidence-linked and cross-project', () => {
  assert.equal(fixture.schema, 'aiexe.real-workstream-replay.v1');
  assert.match(fixture.labelPolicy, /must not be promoted into a project-wide pause/);
  assert.deepEqual(fixture.projects.map((row) => row.project.id).sort(), [
    'tradeos',
    'trainingos',
    'video-operation-shared-media',
  ]);
  for (const row of fixture.projects) {
    assert.ok(row.project.evidenceRefs.length >= 1);
    assert.ok(row.workstreams.length >= 2);
    for (const workstream of row.workstreams) assert.ok(workstream.evidenceRefs.length >= 1);
  }
});

test('M2.3 a blocked workstream has no project-wide authority by itself', () => {
  const { workstreams } = loadCase('trainingos');
  const blocked = workstreams.find((workstream) => workstream.status === 'blocked');
  const packet = evaluateWorkstreamAttention({
    portfolioId: 'group-portfolio',
    workstream: blocked,
    evaluatedAt: fixture.capturedAt,
  });
  assert.equal(packet.bucket, 'blocked');
  assert.equal(packet.proposal.type, 'pause');
  assert.equal(packet.projectWideAuthority, false);
});

test('M2.3 TrainingOS contains blockers and continues independent safe work', () => {
  const { row, project, workstreams } = loadCase('trainingos');
  const rollup = rollupProjectWorkstreamAttention({
    portfolioId: 'group-portfolio', project, workstreams, evaluatedAt: fixture.capturedAt,
  });
  assert.equal(rollup.proposal.type, row.expected.type);
  assert.equal(rollup.bucket, row.expected.bucket);
  assert.equal(rollup.projectWidePause, false);
  assert.deepEqual(rollup.continueEligibleWorkstreamIds, row.expected.continueEligibleWorkstreamIds);
  assert.deepEqual(rollup.heldWorkstreamIds, row.expected.heldWorkstreamIds);
});

test('M2.3 TradeOS contains N2 without pausing independent P1/P2 work', () => {
  const { row, project, workstreams } = loadCase('tradeos');
  const rollup = rollupProjectWorkstreamAttention({
    portfolioId: 'group-portfolio', project, workstreams, evaluatedAt: fixture.capturedAt,
  });
  assert.equal(rollup.proposal.type, 'reprioritize');
  assert.equal(rollup.bucket, 'needs_attention');
  assert.equal(rollup.projectWidePause, false);
  assert.deepEqual(rollup.continueEligibleWorkstreamIds, row.expected.continueEligibleWorkstreamIds);
  assert.deepEqual(rollup.heldWorkstreamIds, row.expected.heldWorkstreamIds);
});

test('M2.3 Video Operation pauses project-level advance when all critical work is held', () => {
  const { row, project, workstreams } = loadCase('video-operation-shared-media');
  const rollup = rollupProjectWorkstreamAttention({
    portfolioId: 'group-portfolio', project, workstreams, evaluatedAt: fixture.capturedAt,
  });
  assert.equal(rollup.proposal.type, row.expected.type);
  assert.equal(rollup.bucket, row.expected.bucket);
  assert.equal(rollup.projectWidePause, true);
  assert.deepEqual(rollup.continueEligibleWorkstreamIds, []);
  assert.deepEqual(rollup.heldWorkstreamIds, row.expected.heldWorkstreamIds);
});

test('M2.3 explicit project blocked status still dominates workstream partial progress', () => {
  const { project, workstreams } = loadCase('trainingos');
  const blockedProject = createManagedProjectSnapshot({ ...project, status: 'blocked' });
  const rollup = rollupProjectWorkstreamAttention({
    portfolioId: 'group-portfolio', project: blockedProject, workstreams, evaluatedAt: fixture.capturedAt,
  });
  assert.equal(rollup.proposal.type, 'pause');
  assert.equal(rollup.bucket, 'blocked');
  assert.equal(rollup.projectWidePause, true);
  assert.equal(rollup.primaryReason, 'project_status_blocked');
});

test('M2.3 unknown workstream truth escalates instead of being guessed clear', () => {
  const { project, workstreams } = loadCase('tradeos');
  const unknown = createManagedWorkstreamSnapshot({
    projectId: 'tradeos',
    id: 'future-workstream',
    name: 'Future workstream',
    status: 'unknown',
    owner: null,
    milestone: null,
    critical: true,
    blockerCodes: [],
    evidenceRefs: ['github:moseszhu999/chaintrace-app:issue:567'],
    observedAt: fixture.capturedAt,
  });
  const rollup = rollupProjectWorkstreamAttention({
    portfolioId: 'group-portfolio', project, workstreams: [...workstreams, unknown], evaluatedAt: fixture.capturedAt,
  });
  assert.equal(rollup.proposal.type, 'escalate');
  assert.equal(rollup.bucket, 'needs_attention');
  assert.deepEqual(rollup.unresolvedWorkstreamIds, ['future-workstream']);
});
