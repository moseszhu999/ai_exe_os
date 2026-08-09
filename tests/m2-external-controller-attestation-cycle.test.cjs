'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGithubReadOnlyProjectObservation,
} = require('../src/management/portfolio/read-only-adapters.cjs');
const {
  createExternalControllerAttestation,
  enrichGithubObservationWithExternalAttestation,
} = require('../src/management/portfolio/external-controller-attestation.cjs');
const {
  buildReadOnlyManagementObservationCycle,
} = require('../src/management/portfolio/observation-cycle.cjs');

const NOW = '2026-08-09T09:30:00.000Z';
const TRAINING_SHA = '987afdbeeb8fe996813fbca7180d2c848c798bb9';
const TRADE_SHA = 'd2bba1b34590f8f04aed9f0e9b4ab717f2e06f27';

function githubObservation(projectId, repository, headSha, overrides = {}) {
  return createGithubReadOnlyProjectObservation({
    projectId,
    repository,
    defaultBranch: 'main',
    headSha,
    observedAt: NOW,
    now: NOW,
    openPullRequests: [],
    evidenceRefs: [`github:${repository}:main@${headSha}`],
    ...overrides,
  });
}

function trainingAttestation(overrides = {}) {
  return createExternalControllerAttestation({
    projectId: 'trainingos',
    controllerId: 'trainingos-controller',
    repository: 'moseszhu999/training-learning-rails',
    exactHeadSha: TRAINING_SHA,
    domainStatus: 'active',
    owner: 'trainingos-controller',
    milestone: 'continue bounded enterprise-learning and shared-capability work',
    blockerCodes: [],
    evidenceRefs: ['github:moseszhu999/training-learning-rails:AGENTS.md'],
    observedAt: NOW,
    sourceKind: 'controller-handoff',
    sourceRef: 'controller-handoff:trainingos:2026-08-09T09:30:00Z',
    sourceDigest: `sha256:${'a'.repeat(64)}`,
    ...overrides,
  });
}

test('M2.1 external controller attestation remains read-only and becomes canonical receipt', () => {
  const attestation = trainingAttestation();
  assert.equal(attestation.schema, 'aiexe.external-controller-attestation.v1');
  assert.equal(attestation.readOnly, true);
  assert.equal(attestation.writeAuthority, 'none');
  assert.equal(attestation.domainRepositoryMutationRequired, false);
  assert.equal(attestation.llmFactGenerationAllowed, false);
  assert.equal(attestation.canonicalReceipt.schema, 'aiexe.domain-controller-receipt.v1');
  assert.equal(attestation.canonicalReceipt.exactHeadSha, TRAINING_SHA);
  assert.equal(attestation.canonicalReceipt.evidenceRefs.includes(attestation.sourceRef), true);
});

test('M2.1 external attestation rejects unsupported inferred fields and malformed source digest', () => {
  assert.throws(() => trainingAttestation({ inferredHealthy: true }), /unsupported field/);
  assert.throws(() => trainingAttestation({ sourceDigest: 'sha256:not-a-digest' }), /source digest/);
});

test('M2.1 exact-head current attestation enriches GitHub observation with domain truth', () => {
  const observation = githubObservation('trainingos', 'moseszhu999/training-learning-rails', TRAINING_SHA);
  const enriched = enrichGithubObservationWithExternalAttestation({
    observation,
    attestation: trainingAttestation(),
    now: NOW,
  });
  assert.equal(enriched.domainReceipt.accepted, true);
  assert.equal(enriched.snapshot.status, 'active');
  assert.equal(enriched.snapshot.owner, 'trainingos-controller');
  assert.equal(enriched.snapshot.attentionSignals.includes('domain_status_unknown'), false);
});

test('M2.1 exact-head mismatch fails visibly back to unknown', () => {
  const newerHead = '42e3b35948b4ff0fc19bdb72af175a730ece1496';
  const observation = githubObservation('trainingos', 'moseszhu999/training-learning-rails', newerHead);
  const enriched = enrichGithubObservationWithExternalAttestation({
    observation,
    attestation: trainingAttestation(),
    now: NOW,
  });
  assert.equal(enriched.domainReceipt.accepted, false);
  assert.equal(enriched.domainReceipt.reason, 'exact_head_mismatch');
  assert.equal(enriched.snapshot.status, 'unknown');
  assert.equal(enriched.snapshot.attentionSignals.includes('domain_receipt_head_mismatch'), true);
});

test('M2.1 observation cycle turns only explicitly attested project into automatic bucket', () => {
  const training = githubObservation('trainingos', 'moseszhu999/training-learning-rails', TRAINING_SHA);
  const trade = githubObservation('tradeos', 'moseszhu999/chaintrace-app', TRADE_SHA);
  const cycle = buildReadOnlyManagementObservationCycle({
    portfolioId: 'group-portfolio',
    observedAt: NOW,
    githubObservations: [training, trade],
    controllerAttestations: [trainingAttestation()],
  });

  assert.equal(cycle.readOnly, true);
  assert.equal(cycle.writeAuthority, 'none');
  assert.equal(cycle.providerFetchPerformed, false);
  assert.equal(cycle.scheduledRuntimeStarted, false);
  assert.deepEqual(cycle.unresolvedProjectIds, ['tradeos']);
  assert.equal(cycle.cockpit.counts.automatic, 1);
  assert.equal(cycle.cockpit.counts.needsAttention, 1);
  assert.equal(cycle.cockpit.counts.blocked, 0);
  assert.equal(cycle.cockpit.automatic[0].projectId, 'trainingos');
  assert.equal(cycle.cockpit.needsAttention[0].projectId, 'tradeos');
});

test('M2.1 live management cycle refuses inline domain facts without controller attestation', () => {
  const inline = githubObservation('trainingos', 'moseszhu999/training-learning-rails', TRAINING_SHA, {
    domainStatus: 'active',
    owner: 'inline-owner',
    milestone: 'inline milestone',
  });
  assert.throws(() => buildReadOnlyManagementObservationCycle({
    portfolioId: 'group-portfolio',
    observedAt: NOW,
    githubObservations: [inline],
    controllerAttestations: [],
  }), /requires an external controller attestation/);
});
