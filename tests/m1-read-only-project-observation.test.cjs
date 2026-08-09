'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CORE_PORTFOLIO_PROJECTS,
  buildObservedPortfolio,
  classifyFreshness,
  createGithubReadOnlyProjectObservation,
} = require('../src/management/portfolio/read-only-adapters.cjs');

function observation(overrides = {}) {
  return createGithubReadOnlyProjectObservation({
    projectId: 'aiexe',
    repository: 'moseszhu999/ai_exe_os',
    defaultBranch: 'main',
    headSha: '81dbfcb20e46684213f79fa9e0720c3b6daa395a',
    observedAt: '2026-08-09T09:00:00.000Z',
    now: '2026-08-09T09:30:00.000Z',
    domainStatus: 'active',
    owner: 'group-management-plane',
    milestone: 'M1 read-only portfolio adapters',
    openPullRequests: [{
      number: 125,
      title: 'M0/M1 management plane',
      headSha: '367856e1e8fb91146e72f8b888dc3e9cb77b4068',
      draft: true,
      updatedAt: '2026-08-09T08:47:39.000Z',
      ownerScope: 'management-plane',
    }],
    ...overrides,
  });
}

test('M1 core catalog binds the four initial portfolio sources', () => {
  assert.deepEqual(CORE_PORTFOLIO_PROJECTS.map((project) => project.repository), [
    'moseszhu999/ai_exe_os',
    'moseszhu999/training-learning-rails',
    'moseszhu999/chaintrace-app',
    'moseszhu999/global-tool-radar',
  ]);
});

test('M1 GitHub adapter is read-only, revision-bound and evidence-backed', () => {
  const current = observation();
  assert.equal(current.readOnly, true);
  assert.equal(current.writeAuthority, 'none');
  assert.equal(current.source.headSha, '81dbfcb20e46684213f79fa9e0720c3b6daa395a');
  assert.equal(current.source.freshness.state, 'current');
  assert.equal(current.snapshot.status, 'active');
  assert.ok(current.snapshot.evidenceRefs.includes('github:moseszhu999/ai_exe_os:commit:81dbfcb20e46684213f79fa9e0720c3b6daa395a'));
  assert.ok(current.snapshot.evidenceRefs.some((ref) => ref.includes(':pr:125@')));
});

test('M1 unknown domain truth and stale source fail visibly instead of being guessed healthy', () => {
  const current = observation({
    domainStatus: undefined,
    owner: undefined,
    observedAt: '2026-08-09T04:00:00.000Z',
    now: '2026-08-09T09:30:00.000Z',
  });
  assert.equal(current.snapshot.status, 'unknown');
  assert.equal(current.source.freshness.state, 'stale');
  assert.ok(current.snapshot.attentionSignals.includes('domain_status_unknown'));
  assert.ok(current.snapshot.attentionSignals.includes('owner_unknown'));
  assert.ok(current.snapshot.attentionSignals.includes('source_stale'));
});

test('M1 adapter rejects repository substitution and write-shaped fields', () => {
  assert.throws(() => observation({ repository: 'moseszhu999/chaintrace-app' }), /repository mismatch/);
  assert.throws(() => createGithubReadOnlyProjectObservation({
    projectId: 'aiexe',
    repository: 'moseszhu999/ai_exe_os',
    headSha: '81dbfcb20e46684213f79fa9e0720c3b6daa395a',
    observedAt: '2026-08-09T09:00:00.000Z',
    write: true,
  }), /unsupported field/);
});

test('M1 observed portfolio aggregates freshness without acquiring source authority', () => {
  const aiexe = observation();
  const training = createGithubReadOnlyProjectObservation({
    projectId: 'trainingos',
    repository: 'moseszhu999/training-learning-rails',
    headSha: '987afdbeeb8fe996813fbca7180d2c848c798bb9',
    observedAt: '2026-08-09T09:00:00.000Z',
    now: '2026-08-09T09:30:00.000Z',
    domainStatus: 'active',
    owner: 'trainingos-controller',
    milestone: 'course video shared-media adapter',
    openPullRequests: [],
  });
  const result = buildObservedPortfolio({
    portfolioId: 'group-portfolio',
    observedAt: '2026-08-09T09:30:00.000Z',
    observations: [aiexe, training],
  });
  assert.equal(result.readOnly, true);
  assert.equal(result.writeAuthority, 'none');
  assert.equal(result.sourceTruthAuthority, 'external');
  assert.equal(result.portfolio.projectCount, 2);
  assert.equal(result.freshnessCounts.current, 2);
});

test('M1 freshness detects stale and future observations explicitly', () => {
  assert.equal(classifyFreshness({ observedAt: '2026-08-09T05:00:00Z', now: '2026-08-09T09:00:00Z' }).state, 'stale');
  assert.equal(classifyFreshness({ observedAt: '2026-08-09T10:00:00Z', now: '2026-08-09T09:00:00Z' }).state, 'unknown');
});
