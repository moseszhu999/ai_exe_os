'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createManagedProjectSnapshot } = require('../src/management/portfolio/index.cjs');
const { evaluateProjectAttention, scoreDecisionReplay } = require('../src/management/portfolio/attention-engine.cjs');

const corpus = JSON.parse(readFileSync(join(
  __dirname, '..', 'fixtures', 'management', 'm2-real-transition-replay-2026-08-10.json'
), 'utf8'));

const expectedCategories = new Set([
  'stale_evidence',
  'recovery_after_stale',
  'policy_block',
  'recovery_after_policy_block',
  'owner_conflict',
  'recovery_after_owner_conflict',
  'false_pause_avoidance_and_escalation',
  'stale_current_attestation',
]);

test('M2.12 transition replay is real-evidence labelled and covers missing recovery classes', () => {
  assert.equal(corpus.schema, 'aiexe.real-transition-replay.v1');
  assert.equal(corpus.evidenceClass, 'REAL_HISTORICAL_AND_PROVIDER_TRANSITION');
  assert.match(corpus.labelPolicy, /No case is generated from simulation/);
  assert.equal(corpus.cases.length, corpus.expected.realCaseCount);
  assert.equal(corpus.expected.realCaseCount, 10);

  const categories = new Set(corpus.cases.map((row) => row.category));
  for (const category of expectedCategories) assert.ok(categories.has(category), category);

  assert.equal(corpus.cases.filter((row) => row.category === 'stale_evidence').length, 1);
  assert.equal(corpus.cases.filter((row) => row.category === 'recovery_after_stale').length, 1);
  assert.equal(corpus.cases.filter((row) => row.category === 'policy_block').length, 1);
  assert.equal(corpus.cases.filter((row) => row.category === 'recovery_after_policy_block').length, 1);
  assert.equal(corpus.cases.filter((row) => row.category === 'owner_conflict').length, 1);
  assert.equal(corpus.cases.filter((row) => row.category === 'recovery_after_owner_conflict').length, 1);
  assert.equal(corpus.cases.filter((row) => row.category === 'false_pause_avoidance_and_escalation').length, 3);
  assert.equal(corpus.cases.filter((row) => row.category === 'stale_current_attestation').length, 1);

  for (const row of corpus.cases) {
    assert.ok(row.project.evidenceRefs.length >= 1, row.id);
    assert.ok(row.labelEvidence.length >= 40, row.id);
    assert.ok(['continue', 'pause', 'escalate'].includes(row.expectedType), row.id);
    assert.ok(['automatic', 'blocked', 'needs_attention'].includes(row.expectedBucket), row.id);
  }
});

test('M2.12 deterministic attention reproduces ten real transition labels with no false or missed escalation', () => {
  const rows = [];
  for (const replay of corpus.cases) {
    const project = createManagedProjectSnapshot(replay.project);
    const packet = evaluateProjectAttention({
      portfolioId: 'group-portfolio',
      project,
      evaluatedAt: '2026-08-10T05:31:00Z',
    });
    assert.equal(packet.proposal.type, replay.expectedType, replay.id);
    assert.equal(packet.bucket, replay.expectedBucket, replay.id);
    rows.push({ expectedType: replay.expectedType, actualType: packet.proposal.type });
  }

  const score = scoreDecisionReplay(rows);
  assert.equal(score.total, 10);
  assert.equal(score.exactMatches, 10);
  assert.equal(score.exactRate, 1);
  assert.equal(score.falseEscalations, corpus.expected.falseEscalations);
  assert.equal(score.missedEscalations, corpus.expected.missedEscalations);
});

test('M2.12 real recovery pairs change the proposal from hold/escalate to continue instead of remaining sticky', () => {
  const pairs = [
    ['trainingos-pr576-repaired-head-stale-evidence', 'trainingos-pr576-repaired-head-recovered'],
    ['tradeos-pr647-production-autodeploy-policy-block', 'tradeos-pr647-release-decoupled-recovered'],
    ['trainingos-pr476-route-owner-conflict', 'trainingos-pr480-owner-safe-rebuild-recovered'],
  ];
  const byId = new Map(corpus.cases.map((row) => [row.id, row]));

  for (const [blockedId, recoveredId] of pairs) {
    const blocked = byId.get(blockedId);
    const recovered = byId.get(recoveredId);
    assert.ok(blocked && recovered);
    assert.notEqual(blocked.expectedType, 'continue');
    assert.equal(recovered.expectedType, 'continue');
  }
});

test('M2.12 provider churn cases escalate unknown truth without inventing a project-wide pause', () => {
  const churn = corpus.cases.filter((row) => row.category === 'false_pause_avoidance_and_escalation');
  assert.equal(churn.length, 3);
  for (const row of churn) {
    assert.equal(row.project.status, 'unknown');
    assert.ok(row.project.attentionSignals.includes('domain_status_unknown'));
    assert.equal(row.expectedType, 'escalate');
    assert.notEqual(row.expectedType, 'pause');
  }
});
