'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const third = JSON.parse(readFileSync(join(
  __dirname, '..', 'fixtures', 'management', 'm2-live-github-observation-capture-2026-08-10-cycle3.json'
), 'utf8'));
const fourth = JSON.parse(readFileSync(join(
  __dirname, '..', 'fixtures', 'management', 'm2-live-provider-observation-summary-2026-08-10-cycle4.json'
), 'utf8'));

function heads(rows) {
  return Object.fromEntries(rows.map((row) => [row.projectId, row.headSha]));
}

test('M2.10 fourth live provider summary preserves a moving read-window boundary without fabricating per-PR exact metadata', () => {
  assert.equal(fourth.schema, 'aiexe.live-provider-observation-summary.v1');
  assert.equal(fourth.evidenceClass, 'REAL_PROVIDER_OBSERVATION_SUMMARY');
  assert.equal(fourth.expected.projectCount, 4);
  assert.equal(fourth.expected.fullCanonicalCaptureProduced, false);
  assert.match(fourth.expected.reasonFullCanonicalCaptureNotProduced, /sources moved during the read window/);
  assert.match(fourth.captureMethod, /does not claim one single-instant snapshot/);

  for (const row of fourth.observations) {
    assert.equal(row.openPullRequestCount, row.openPullRequestNumbers.length);
    assert.equal(new Set(row.openPullRequestNumbers).size, row.openPullRequestNumbers.length);
    assert.equal(row.defaultBranch, 'main');
  }
  assert.deepEqual(fourth.expected.openPullRequestCounts, {
    aiexe: 1,
    trainingos: 8,
    tradeos: 14,
    'video-operation-shared-media': 1,
  });
});

test('M2.10 cycle3 to cycle4 head summary detects AIEXE, TrainingOS and TradeOS movement while Shared Media stays stable', () => {
  const before = heads(third.observations);
  const after = heads(fourth.observations);
  const changed = Object.keys(after).filter((projectId) => before[projectId] !== after[projectId]).sort();
  assert.deepEqual(changed, ['aiexe', 'tradeos', 'trainingos']);
  assert.deepEqual(fourth.expected.headTransitionProjectIds, ['aiexe', 'trainingos', 'tradeos']);
  assert.equal(before['video-operation-shared-media'], after['video-operation-shared-media']);
  assert.equal(after.aiexe, 'dce842e6874e6842b461cd4b5958df577608da94');
  assert.equal(after.trainingos, '39932eb934961bfddee61fe92dc6582afc6b1e26');
  assert.equal(after.tradeos, 'c51b766aefecb5fcc49c27c3c51bd982c13a30e0');
});
