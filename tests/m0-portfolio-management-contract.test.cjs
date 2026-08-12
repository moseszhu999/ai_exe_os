'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FORBIDDEN_MANAGEMENT_ACTIONS,
  buildPortfolioSnapshot,
  createManagedProjectSnapshot,
  createManagementProposal,
} = require('../src/management/portfolio/index.cjs');

function project(overrides = {}) {
  return {
    id: 'trainingos',
    name: 'TrainingOS',
    kind: 'domain-os',
    status: 'active',
    sourceOfTruth: 'github:moseszhu999/training-learning-rails',
    owner: 'trainingos-controller',
    milestone: 'enterprise capability loop',
    summary: 'Domain truth remains TrainingOS-owned.',
    attentionSignals: [],
    evidenceRefs: ['repo:main'],
    observedAt: '2026-08-09T08:00:00.000Z',
    ...overrides,
  };
}

test('M0 managed project snapshots are read-only management projections', () => {
  const snapshot = createManagedProjectSnapshot(project());
  assert.equal(snapshot.managementAuthority, 'observe-and-propose');
  assert.equal(snapshot.domainTruthAuthority, 'external-source-of-truth');
  assert.equal(Object.isFrozen(snapshot), true);
  assert.throws(() => createManagedProjectSnapshot(project({ kind: 'unknown' })), /project kind/);
  assert.throws(() => createManagedProjectSnapshot({ ...project(), domainMutation: true }), /unsupported field/);
  assert.throws(() => createManagedProjectSnapshot({ ...snapshot, managementAuthority: 'domain-write' }), /cannot widen management authority/);
  assert.throws(() => createManagedProjectSnapshot({ ...snapshot, domainTruthAuthority: 'aiexe-owned' }), /cannot claim domain truth authority/);
});

test('M0 portfolio snapshot composes canonical project snapshots and explicit attention evidence', () => {
  const training = createManagedProjectSnapshot(project());
  const trade = createManagedProjectSnapshot(project({
    id: 'tradeos',
    name: 'TradeOS',
    status: 'blocked',
    sourceOfTruth: 'github:moseszhu999/chaintrace-app',
    attentionSignals: ['owner conflict'],
    evidenceRefs: ['issue:645'],
  }));
  const snapshot = buildPortfolioSnapshot({
    portfolioId: 'group-portfolio',
    observedAt: '2026-08-09T08:01:00.000Z',
    projects: [training, trade],
  });
  assert.equal(snapshot.projectCount, 2);
  assert.equal(snapshot.statusCounts.active, 1);
  assert.equal(snapshot.statusCounts.blocked, 1);
  assert.deepEqual(snapshot.attention.map((item) => item.projectId), ['tradeos']);
  assert.equal(snapshot.managementAuthority, 'observe-and-propose');
});

test('M0 unknown project state is visible in the attention projection', () => {
  const unknown = createManagedProjectSnapshot(project({
    status: 'unknown',
    attentionSignals: ['domain_status_unknown'],
  }));
  const snapshot = buildPortfolioSnapshot({
    portfolioId: 'group-portfolio',
    observedAt: '2026-08-09T08:01:00.000Z',
    projects: [unknown],
  });
  assert.equal(snapshot.statusCounts.unknown, 1);
  assert.deepEqual(snapshot.attention.map((item) => item.projectId), ['trainingos']);
});

test('M0 management proposals are non-binding and evidence-backed', () => {
  const proposal = createManagementProposal({
    id: 'proposal-pause-tradeos',
    portfolioId: 'group-portfolio',
    projectId: 'tradeos',
    type: 'pause',
    rationale: 'A current owner conflict requires bounded review before more implementation.',
    evidenceRefs: ['issue:645', 'pr:646'],
    requestedAt: '2026-08-09T08:02:00.000Z',
    priority: 'high',
  });
  assert.equal(proposal.binding, false);
  assert.equal(proposal.requiresHumanApproval, true);
  assert.equal(proposal.allowedEffect, 'proposal-only');
  for (const action of FORBIDDEN_MANAGEMENT_ACTIONS) {
    assert.equal(proposal.forbiddenActions.includes(action), true);
  }
  assert.throws(() => createManagementProposal({
    id: 'proposal-without-evidence',
    portfolioId: 'group-portfolio',
    projectId: 'tradeos',
    type: 'pause',
    rationale: 'No evidence.',
    evidenceRefs: [],
    requestedAt: '2026-08-09T08:02:00.000Z',
  }), /requires evidence refs/);
});

test('M0 continue proposals remain advisory without introducing domain authority', () => {
  const proposal = createManagementProposal({
    id: 'proposal-continue-trainingos',
    portfolioId: 'group-portfolio',
    projectId: 'trainingos',
    type: 'continue',
    rationale: 'No blocking signal is present in the observed project evidence.',
    evidenceRefs: ['repo:main'],
    requestedAt: '2026-08-09T08:03:00.000Z',
  });
  assert.equal(proposal.requiresHumanApproval, false);
  assert.equal(proposal.binding, false);
  assert.equal(proposal.allowedEffect, 'proposal-only');
});
