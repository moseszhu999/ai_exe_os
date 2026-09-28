'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPortfolioSnapshot,
  createManagedProjectSnapshot,
} = require('../src/management/portfolio/index.cjs');
const {
  buildAttentionQueue,
  buildManagementCockpit,
  evaluateProjectAttention,
  scoreDecisionReplay,
} = require('../src/management/portfolio/attention-engine.cjs');

function project(overrides = {}) {
  return createManagedProjectSnapshot({
    id: 'tradeos',
    name: 'TradeOS',
    kind: 'domain-os',
    status: 'active',
    sourceOfTruth: 'github:moseszhu999/chaintrace-app@main',
    owner: 'tradeos-controller',
    milestone: 'N1/N2',
    summary: 'exact-head domain state',
    attentionSignals: [],
    evidenceRefs: ['github:moseszhu999/chaintrace-app:commit:02985010fbd91277df94d97984401af913a7922a'],
    observedAt: '2026-08-09T09:20:00Z',
    ...overrides,
  });
}

test('M2 clean active project yields advisory continue only', () => {
  const packet = evaluateProjectAttention({
    portfolioId: 'group-portfolio',
    project: project(),
    evaluatedAt: '2026-08-09T09:30:00Z',
  });
  assert.equal(packet.bucket, 'automatic');
  assert.equal(packet.proposal.type, 'continue');
  assert.equal(packet.proposal.binding, false);
  assert.equal(packet.llmFactGenerationAllowed, false);
});

test('M2 unknown or stale truth escalates instead of inventing health', () => {
  const packet = evaluateProjectAttention({
    portfolioId: 'group-portfolio',
    project: project({
      status: 'unknown',
      owner: null,
      milestone: null,
      attentionSignals: ['domain_status_unknown', 'source_stale'],
    }),
    evaluatedAt: '2026-08-09T09:30:00Z',
  });
  assert.equal(packet.bucket, 'needs_attention');
  assert.equal(packet.proposal.type, 'escalate');
});

test('M2 explicit owner conflict pauses with critical priority', () => {
  const packet = evaluateProjectAttention({
    portfolioId: 'group-portfolio',
    project: project({ status: 'blocked', attentionSignals: ['blocker:owner_conflict'] }),
    evaluatedAt: '2026-08-09T09:30:00Z',
  });
  assert.equal(packet.bucket, 'blocked');
  assert.equal(packet.proposal.type, 'pause');
  assert.equal(packet.proposal.priority, 'critical');
});

test('M2 unknown blocker codes fail conservative into pause', () => {
  const packet = evaluateProjectAttention({
    portfolioId: 'group-portfolio',
    project: project({ attentionSignals: ['blocker:new_unclassified_gate'] }),
    evaluatedAt: '2026-08-09T09:30:00Z',
  });
  assert.equal(packet.bucket, 'blocked');
  assert.equal(packet.proposal.type, 'pause');
});

test('M2 cockpit separates automatic attention and blocked projects', () => {
  const aiexe = project({
    id: 'aiexe',
    name: 'AIEXE',
    kind: 'platform',
    sourceOfTruth: 'github:moseszhu999/ai_exe_os@main',
    evidenceRefs: ['github:moseszhu999/ai_exe_os:commit:81dbfcb20e46684213f79fa9e0720c3b6daa395a'],
  });
  const training = project({
    id: 'trainingos',
    name: 'TrainingOS',
    sourceOfTruth: 'github:moseszhu999/training-learning-rails@main',
    status: 'unknown',
    attentionSignals: ['domain_status_unknown'],
    evidenceRefs: ['github:moseszhu999/training-learning-rails:commit:987afdbeeb8fe996813fbca7180d2c848c798bb9'],
  });
  const trade = project({ status: 'blocked', attentionSignals: ['blocker:validation_failed'] });
  const portfolio = buildPortfolioSnapshot({
    portfolioId: 'group-portfolio',
    observedAt: '2026-08-09T09:30:00Z',
    projects: [aiexe, training, trade],
  });
  const packets = buildAttentionQueue({ portfolio, evaluatedAt: '2026-08-09T09:31:00Z' });
  const cockpit = buildManagementCockpit({ portfolio, packets, observedAt: '2026-08-09T09:31:00Z' });
  assert.deepEqual(cockpit.counts, { automatic: 1, needsAttention: 1, blocked: 1 });
  assert.equal(cockpit.writeAuthority, 'none');
});

test('M2 replay scoring exposes false and missed escalations separately', () => {
  const score = scoreDecisionReplay([
    { expectedType: 'continue', actualType: 'continue' },
    { expectedType: 'continue', actualType: 'escalate' },
    { expectedType: 'pause', actualType: 'continue' },
    { expectedType: 'pause', actualType: 'pause' },
  ]);
  assert.equal(score.total, 4);
  assert.equal(score.exactMatches, 2);
  assert.equal(score.falseEscalations, 1);
  assert.equal(score.missedEscalations, 1);
});
