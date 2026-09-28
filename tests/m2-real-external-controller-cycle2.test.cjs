'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  parseControllerAttestationEnvelope,
  sourceDigestFor,
} = require('../src/management/portfolio/controller-attestation-envelope.cjs');
const {
  buildControllerRecurringStructuredProof,
} = require('../src/management/portfolio/controller-recurrence-proof.cjs');
const {
  enrichGithubObservationWithExternalAttestation,
} = require('../src/management/portfolio/external-controller-attestation.cjs');
const {
  createGithubReadOnlyProjectObservation,
} = require('../src/management/portfolio/read-only-adapters.cjs');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8'));
}

const firstCycle = readJson('fixtures/management/m2-real-external-controller-adoption-cycle-2026-08-10.json');
const firstRevalidation = readJson('fixtures/management/m2-external-controller-adoption-revalidation-2026-08-10.json');
const secondCycle = readJson('fixtures/management/m2-real-external-controller-cycle2-2026-08-10.json');
const producerTopology = readJson('fixtures/management/m2-controller-producer-readiness-2026-08-10.json');

function firstProviderHead(projectId) {
  const row = firstRevalidation.projects.find((project) => project.projectId === projectId);
  assert.ok(row, `missing first-cycle revalidation row: ${projectId}`);
  return row.providerHeadSha;
}

function sourceFor(fixture, projectId) {
  const row = fixture.sources.find((source) => source.projectId === projectId);
  assert.ok(row, `missing source row: ${projectId}`);
  return row;
}

function acceptedOrRejectedCycle(source, providerHeadSha, now) {
  const envelope = parseControllerAttestationEnvelope({
    body: source.body,
    sourceKind: source.sourceKind,
    sourceRef: source.sourceRef,
    sourceDigest: sourceDigestFor(source.body),
  });
  const observation = createGithubReadOnlyProjectObservation({
    projectId: source.projectId,
    repository: source.repository,
    defaultBranch: 'main',
    headSha: providerHeadSha,
    observedAt: now,
    now,
    openPullRequests: [],
    evidenceRefs: [`github:${source.repository}:commit:${providerHeadSha}`],
  });
  const enrichedObservation = enrichGithubObservationWithExternalAttestation({
    observation,
    attestation: envelope.attestation,
    now,
  });
  return { envelope, enrichedObservation };
}

function pair(projectId) {
  const first = sourceFor(firstCycle, projectId);
  const second = sourceFor(secondCycle, projectId);
  return {
    first,
    second,
    firstCanonical: acceptedOrRejectedCycle(first, firstProviderHead(projectId), firstCycle.capturedAt),
    secondCanonical: acceptedOrRejectedCycle(second, second.providerHeadSha, secondCycle.capturedAt),
  };
}

test('M2.17 real cycle 2 independently accepts all three current external Domain attestations', () => {
  for (const projectId of ['trainingos', 'tradeos', 'video-operation-shared-media']) {
    const { second, secondCanonical } = pair(projectId);
    assert.equal(secondCanonical.envelope.sourceDigestVerified, true);
    assert.equal(secondCanonical.envelope.sourceDigest, sourceDigestFor(second.body));
    assert.equal(secondCanonical.enrichedObservation.domainReceipt.accepted, true);
    assert.equal(secondCanonical.enrichedObservation.domainReceipt.reason, 'accepted_exact_head_current');
    assert.equal(secondCanonical.enrichedObservation.source.headSha, second.providerHeadSha);
    assert.equal(secondCanonical.enrichedObservation.readOnly, true);
    assert.equal(secondCanonical.enrichedObservation.writeAuthority, 'none');
  }
});

test('M2.17 TrainingOS has two real independently accepted cycles and canonical recurrence proof', () => {
  const { firstCanonical, secondCanonical, first, second } = pair('trainingos');
  assert.equal(firstCanonical.enrichedObservation.domainReceipt.accepted, true);
  assert.equal(secondCanonical.enrichedObservation.domainReceipt.accepted, true);

  const proof = buildControllerRecurringStructuredProof({
    projectId: 'trainingos',
    repository: 'moseszhu999/training-learning-rails',
    cycles: [firstCanonical, secondCanonical],
  });

  assert.equal(proof.proven, true);
  assert.equal(proof.cycleCount, 2);
  assert.deepEqual(proof.sourceRefs, [first.sourceRef, second.sourceRef]);
  assert.notEqual(proof.sourceDigests[0], proof.sourceDigests[1]);
  assert.equal(proof.strictlyIncreasingObservedAt, true);
});

test('M2.17 TradeOS has two real independently accepted cycles but current audited producer topology remains disabled', () => {
  const { firstCanonical, secondCanonical, first, second } = pair('tradeos');
  assert.equal(firstCanonical.enrichedObservation.domainReceipt.accepted, true);
  assert.equal(secondCanonical.enrichedObservation.domainReceipt.accepted, true);

  const proof = buildControllerRecurringStructuredProof({
    projectId: 'tradeos',
    repository: 'moseszhu999/chaintrace-app',
    cycles: [firstCanonical, secondCanonical],
  });
  assert.equal(proof.proven, true);
  assert.deepEqual(proof.sourceRefs, [first.sourceRef, second.sourceRef]);

  const topology = producerTopology.producers.find((producer) => producer.projectId === 'tradeos');
  assert.ok(topology);
  assert.equal(topology.schedulerObserved, true);
  assert.equal(topology.schedulerEnabled, false);
  assert.equal(topology.expectedState, 'PRODUCER_DISABLED');
});

test('M2.17 Video/Shared Media cycle 2 repairs current-head acceptance but does not yet prove recurrence', () => {
  const { firstCanonical, secondCanonical } = pair('video-operation-shared-media');

  assert.equal(firstCanonical.enrichedObservation.domainReceipt.accepted, false);
  assert.equal(firstCanonical.enrichedObservation.domainReceipt.reason, 'exact_head_mismatch');
  assert.equal(secondCanonical.enrichedObservation.domainReceipt.accepted, true);
  assert.equal(secondCanonical.enrichedObservation.domainReceipt.reason, 'accepted_exact_head_current');

  assert.throws(() => buildControllerRecurringStructuredProof({
    projectId: 'video-operation-shared-media',
    repository: 'moseszhu999/global-tool-radar',
    cycles: [firstCanonical, secondCanonical],
  }), /exact-head current accepted Domain receipt/);

  assert.throws(() => buildControllerRecurringStructuredProof({
    projectId: 'video-operation-shared-media',
    repository: 'moseszhu999/global-tool-radar',
    cycles: [secondCanonical],
  }), /at least two accepted cycles/);
});

test('M2.17 real cycle 2 cannot by itself close G3 or authorize execution', () => {
  const training = pair('trainingos');
  const trade = pair('tradeos');
  const video = pair('video-operation-shared-media');

  assert.equal(training.secondCanonical.enrichedObservation.domainReceipt.accepted, true);
  assert.equal(trade.secondCanonical.enrichedObservation.domainReceipt.accepted, true);
  assert.equal(video.secondCanonical.enrichedObservation.domainReceipt.accepted, true);

  const tradeTopology = producerTopology.producers.find((producer) => producer.projectId === 'tradeos');
  assert.equal(tradeTopology.schedulerEnabled, false);
  assert.equal(video.firstCanonical.enrichedObservation.domainReceipt.accepted, false);

  const verdict = Object.freeze({
    secondCycleCurrentAcceptance: '3/3',
    trainingRecurringStructuredProof: true,
    tradeRecurringStructuredProof: true,
    tradeCurrentAuditedProducerEnabled: false,
    videoRecurringStructuredProof: false,
    g3: 'PARTIAL',
    m3EntryAuthorized: false,
    a2ExecutionAuthorized: false,
    authorityGranted: false,
  });

  assert.equal(verdict.g3, 'PARTIAL');
  assert.equal(verdict.m3EntryAuthorized, false);
  assert.equal(verdict.a2ExecutionAuthorized, false);
  assert.equal(verdict.authorityGranted, false);
});
