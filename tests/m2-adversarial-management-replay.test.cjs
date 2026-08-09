'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createManagedProjectSnapshot } = require('../src/management/portfolio/index.cjs');
const { evaluateProjectAttention, scoreDecisionReplay } = require('../src/management/portfolio/attention-engine.cjs');
const { createGithubReadOnlyProjectObservation } = require('../src/management/portfolio/read-only-adapters.cjs');
const { createExternalControllerAttestation, enrichGithubObservationWithExternalAttestation } = require('../src/management/portfolio/external-controller-attestation.cjs');
const { buildReadOnlyManagementObservationCycle } = require('../src/management/portfolio/observation-cycle.cjs');
const { createManagedWorkstreamSnapshot, rollupProjectWorkstreamAttention } = require('../src/management/portfolio/workstream-attention.cjs');
const { evaluateA2ManagementAction } = require('../src/management/policy/a2-action-policy.cjs');

const fixture = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'management', 'm2-adversarial-management-replay-v1.json'), 'utf8'));
const NOW = fixture.capturedAt;
const OLD_SHA = '1111111111111111111111111111111111111111';
const NEW_SHA = '2222222222222222222222222222222222222222';

function expected(id) {
  const row = fixture.cases.find((candidate) => candidate.id === id);
  assert.ok(row, `missing adversarial case ${id}`);
  return row.expected;
}

function project(overrides = {}) {
  return createManagedProjectSnapshot({
    id: 'adversarial-project',
    name: 'Adversarial Project',
    kind: 'domain-os',
    status: 'active',
    sourceOfTruth: `github:example/adversarial@${NEW_SHA}`,
    owner: 'controller-a',
    milestone: 'bounded replay',
    summary: 'simulated adversarial management replay',
    attentionSignals: [],
    evidenceRefs: [`simulation:adversarial:${NEW_SHA}`],
    observedAt: NOW,
    ...overrides,
  });
}

function githubObservation(headSha = NEW_SHA) {
  return createGithubReadOnlyProjectObservation({
    projectId: 'adversarial-project',
    repository: 'example/adversarial',
    defaultBranch: 'main',
    headSha,
    observedAt: NOW,
    now: NOW,
    openPullRequests: [],
    evidenceRefs: [`simulation:github:example/adversarial@${headSha}`],
  });
}

function attestation(headSha = OLD_SHA, controllerId = 'controller-a') {
  return createExternalControllerAttestation({
    projectId: 'adversarial-project',
    controllerId,
    repository: 'example/adversarial',
    exactHeadSha: headSha,
    domainStatus: 'active',
    owner: controllerId,
    milestone: 'bounded replay',
    blockerCodes: [],
    evidenceRefs: [`simulation:attestation:${controllerId}:${headSha}`],
    observedAt: NOW,
    sourceKind: 'controller-handoff',
    sourceRef: `simulation:controller-handoff:${controllerId}:${headSha}`,
    sourceDigest: `sha256:${controllerId === 'controller-a' ? 'a'.repeat(64) : 'b'.repeat(64)}`,
  });
}

function workstream(id, status, { critical = true, blockerCodes = [] } = {}) {
  return createManagedWorkstreamSnapshot({
    projectId: 'adversarial-project',
    id,
    name: id,
    status,
    owner: 'controller-a',
    milestone: 'bounded replay',
    critical,
    blockerCodes,
    evidenceRefs: [`simulation:workstream:${id}`],
    observedAt: NOW,
  });
}

function rollup(workstreams, decisionScopeComplete) {
  return rollupProjectWorkstreamAttention({
    portfolioId: 'group-portfolio',
    project: project(),
    workstreams,
    evaluatedAt: NOW,
    decisionScopeComplete,
  });
}

function a2(actionType, overrides = {}) {
  return evaluateA2ManagementAction({
    actionId: `adversarial-${actionType}`,
    actionType,
    projectId: 'adversarial-project',
    policyRef: 'policy:aiexe:a2:v1',
    policyPreapproved: true,
    capabilityRef: actionType === 'prepare_non_binding_plan' ? null : 'adversarial.test@1.0.0',
    evidenceRefs: ['simulation:a2:adversarial'],
    requestedAt: NOW,
    ...overrides,
  });
}

test('M2.5 adversarial corpus is explicitly simulated and covers distinct failure dimensions', () => {
  assert.equal(fixture.schema, 'aiexe.management-adversarial-replay.v1');
  assert.equal(fixture.evidenceClass, 'SIMULATED');
  assert.ok(fixture.cases.length >= 10);
  assert.ok(new Set(fixture.cases.map((row) => row.dimension)).size >= 6);
  assert.match(fixture.purpose, /simulation evidence only/i);
});

test('M2.5 owner conflict pauses at project scope instead of continuing optimistically', () => {
  const packet = evaluateProjectAttention({
    portfolioId: 'group-portfolio',
    project: project({ status: 'blocked', attentionSignals: ['blocker:owner_conflict'] }),
    evaluatedAt: NOW,
  });
  assert.equal(packet.proposal.type, expected('owner-conflict'));
  assert.equal(packet.proposal.priority, 'critical');
});

test('M2.5 stale exact-head truth escalates and recovery requires a new exact-head attestation', () => {
  const observation = githubObservation(NEW_SHA);
  const stale = enrichGithubObservationWithExternalAttestation({ observation, attestation: attestation(OLD_SHA), now: NOW });
  const stalePacket = evaluateProjectAttention({ portfolioId: 'group-portfolio', project: stale.snapshot, evaluatedAt: NOW });
  assert.equal(stale.domainReceipt.accepted, false);
  assert.equal(stale.domainReceipt.reason, 'exact_head_mismatch');
  assert.equal(stalePacket.proposal.type, expected('stale-attestation'));

  const recovered = enrichGithubObservationWithExternalAttestation({ observation, attestation: attestation(NEW_SHA), now: NOW });
  const recoveredPacket = evaluateProjectAttention({ portfolioId: 'group-portfolio', project: recovered.snapshot, evaluatedAt: NOW });
  assert.equal(recovered.domainReceipt.accepted, true);
  assert.equal(recoveredPacket.proposal.type, expected('stale-recovery'));
});

test('M2.5 duplicate/conflicting controller attestations fail closed before portfolio construction', () => {
  assert.throws(() => buildReadOnlyManagementObservationCycle({
    portfolioId: 'group-portfolio',
    observedAt: NOW,
    githubObservations: [githubObservation(NEW_SHA)],
    controllerAttestations: [attestation(NEW_SHA, 'controller-a'), attestation(NEW_SHA, 'controller-b')],
  }), /duplicate controller attestation/);
  assert.equal(expected('duplicate-attestation'), 'reject');
});

test('M2.5 workstream adversaries distinguish reprioritize, escalation and justified pause', () => {
  const active = workstream('safe-active', 'active');
  const held = workstream('critical-held', 'blocked', { blockerCodes: ['validation_failed'] });
  const partial = rollup([held, active], false);
  assert.equal(partial.proposal.type, expected('critical-block-with-active'));
  assert.equal(partial.projectWidePause, false);

  const incomplete = rollup([held], false);
  assert.equal(incomplete.proposal.type, expected('held-incomplete-scope'));
  assert.equal(incomplete.projectWidePause, false);

  const complete = rollup([held], true);
  assert.equal(complete.proposal.type, expected('held-complete-scope'));
  assert.equal(complete.projectWidePause, true);

  const unknown = rollup([workstream('unknown-critical', 'unknown')], true);
  assert.equal(unknown.proposal.type, expected('unknown-workstream'));
  assert.equal(unknown.projectWidePause, false);

  const score = scoreDecisionReplay([
    { expectedType: expected('critical-block-with-active'), actualType: partial.proposal.type },
    { expectedType: expected('held-incomplete-scope'), actualType: incomplete.proposal.type },
    { expectedType: expected('held-complete-scope'), actualType: complete.proposal.type },
    { expectedType: expected('unknown-workstream'), actualType: unknown.proposal.type },
  ]);
  assert.equal(score.exactMatches, 4);
  assert.equal(score.falseEscalations, 0);
  assert.equal(score.missedEscalations, 0);
});

test('M2.5 A2 adversaries deny consequential actions and preserve eligible actions as non-binding', () => {
  const forbidden = a2('merge', { capabilityRef: null });
  assert.equal(forbidden.policyEligible, false);
  assert.equal(forbidden.executionAuthorized, false);
  assert.equal(expected('a2-forbidden-merge'), 'deny');

  const eligible = a2('run_approved_test_profile');
  assert.equal(eligible.policyEligible, true);
  assert.equal(eligible.executionAuthorized, false);
  assert.equal(eligible.delegationCreated, false);
  assert.equal(expected('a2-eligible-test'), 'eligible_nonbinding');

  const missingApproval = a2('schedule_preapproved_bounded_work');
  assert.equal(missingApproval.policyEligible, false);
  assert.equal(missingApproval.reason, 'preapproved_work_ref_required');
  assert.equal(expected('a2-schedule-without-approval'), 'deny');
});
