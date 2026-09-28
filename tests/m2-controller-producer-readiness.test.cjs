'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildControllerAdoptionReadiness } = require('../src/management/portfolio/controller-adoption-readiness.cjs');
const { buildControllerProducerReadiness } = require('../src/management/portfolio/controller-producer-readiness.cjs');

const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'management', 'm2-controller-producer-readiness-2026-08-10.json'),
  'utf8',
));

function producerInput(row) {
  const { expectedState: _expectedState, ...input } = row;
  return input;
}

function adoptionFor(projects = fixture.adoptionProjects) {
  return buildControllerAdoptionReadiness({
    observedAt: fixture.observedAt,
    projects,
  });
}

test('M2.13 real producer topology separates active missing-contract and disabled-producer blockers without inferring Domain truth', () => {
  assert.equal(fixture.evidenceClass, 'REAL_CONTROLLER_PRODUCER_TOPOLOGY_READ_ONLY_AUDIT');
  const adoptionReadiness = adoptionFor();
  const readiness = buildControllerProducerReadiness({
    observedAt: fixture.observedAt,
    adoptionReadiness,
    producers: fixture.producers.map(producerInput),
  });

  assert.equal(adoptionReadiness.structuredAdoptedCount, fixture.expected.structuredAdoptedCount);
  assert.equal(adoptionReadiness.groupAdapterReadyCount, fixture.expected.groupAdapterReadyCount);
  assert.equal(readiness.externalProjectCount, fixture.expected.externalProjectCount);
  assert.equal(readiness.enabledProducerCount, fixture.expected.enabledProducerCount);
  assert.equal(readiness.disabledProducerCount, fixture.expected.disabledProducerCount);
  assert.equal(readiness.contractMissingCount, fixture.expected.contractMissingCount);
  assert.equal(readiness.persistenceMissingCount, fixture.expected.persistenceMissingCount);
  assert.equal(readiness.recurringStructuredProducerCount, fixture.expected.recurringStructuredProducerCount);
  assert.equal(readiness.recurringStructuredProducerComplete, fixture.expected.recurringStructuredProducerComplete);
  assert.equal(readiness.arbitraryEvidenceRefsCannotProveRecurrence, true);
  assert.equal(readiness.recurrenceProofRecomputedFromEmbeddedCycles, true);
  assert.equal(readiness.readOnly, true);
  assert.equal(readiness.writeAuthority, 'none');
  assert.equal(readiness.llmFactGenerationAllowed, false);
  assert.equal(readiness.schedulerStateIsNotDomainTruth, true);
  assert.equal(readiness.promptPresenceIsNotDomainTruth, true);

  const byId = new Map(readiness.producers.map((producer) => [producer.projectId, producer]));
  for (const row of fixture.producers) {
    assert.equal(byId.get(row.projectId).state, row.expectedState);
    assert.equal(byId.get(row.projectId).domainTruthInferred, false);
    assert.equal(byId.get(row.projectId).authorityGranted, false);
  }
});

test('M2.13 producer readiness rejects scheduler spoofing and recurring evidence without structured adoption', () => {
  const adoptionReadiness = adoptionFor();

  assert.throws(() => buildControllerProducerReadiness({
    observedAt: fixture.observedAt,
    adoptionReadiness,
    producers: fixture.producers.map((row) => {
      const producer = producerInput(row);
      return producer.projectId === 'trainingos'
        ? { ...producer, schedulerObserved: false, schedulerEnabled: true }
        : producer;
    }),
  }), /scheduler cannot be enabled/);

  assert.throws(() => buildControllerProducerReadiness({
    observedAt: fixture.observedAt,
    adoptionReadiness,
    producers: fixture.producers.map((row) => {
      const producer = producerInput(row);
      return producer.projectId === 'trainingos'
        ? { ...producer, recurringStructuredEvidenceRefs: ['receipt:a', 'receipt:b'] }
        : producer;
    }),
  }), /requires structured Controller adoption/);
});

test('M2.15 arbitrary recurring evidence refs remain audit hints and cannot prove recurrence', () => {
  const adoptedProjects = fixture.adoptionProjects.map((project) => project.projectId === 'trainingos'
    ? {
        ...project,
        markerSearchMatched: true,
        verifiedCurrentEnvelopeEvidenceRefs: ['github:example:structured-current-envelope'],
      }
    : project);
  const adoptionReadiness = adoptionFor(adoptedProjects);
  const readiness = buildControllerProducerReadiness({
    observedAt: fixture.observedAt,
    adoptionReadiness,
    producers: fixture.producers.map((row) => {
      const producer = producerInput(row);
      if (producer.projectId !== 'trainingos') return producer;
      return {
        ...producer,
        structuredProducerContractObserved: true,
        recurringStructuredEvidenceRefs: ['github:example:structured-run-1', 'github:example:structured-run-2'],
      };
    }),
  });

  const training = readiness.producers.find((producer) => producer.projectId === 'trainingos');
  assert.equal(training.state, 'STRUCTURED_SOURCE_PRESENT_RECURRENCE_UNPROVEN');
  assert.equal(training.recurringStructuredProven, false);
  assert.equal(training.recurringStructuredProof, null);
  assert.deepEqual(training.recurringStructuredEvidenceRefs, [
    'github:example:structured-run-1',
    'github:example:structured-run-2',
  ]);
  assert.equal(readiness.recurringStructuredProducerCount, 0);
  assert.equal(readiness.recurringStructuredProducerComplete, false);
});

test('M2.15 disabled scheduler remains an explicit producer blocker after first structured adoption', () => {
  const adoptedProjects = fixture.adoptionProjects.map((project) => project.projectId === 'tradeos'
    ? {
        ...project,
        markerSearchMatched: true,
        verifiedCurrentEnvelopeEvidenceRefs: ['github:example:tradeos-structured-current-envelope'],
      }
    : project);
  const adoptionReadiness = adoptionFor(adoptedProjects);
  const readiness = buildControllerProducerReadiness({
    observedAt: fixture.observedAt,
    adoptionReadiness,
    producers: fixture.producers.map(producerInput),
  });

  const tradeos = readiness.producers.find((producer) => producer.projectId === 'tradeos');
  assert.equal(tradeos.state, 'PRODUCER_DISABLED');
  assert.equal(tradeos.recurringStructuredProven, false);
});

test('M2.16 proof-shaped booleans without embedded canonical cycles cannot spoof recurring readiness', () => {
  const adoptedProjects = fixture.adoptionProjects.map((project) => project.projectId === 'trainingos'
    ? {
        ...project,
        markerSearchMatched: true,
        verifiedCurrentEnvelopeEvidenceRefs: ['github:example:structured-current-envelope'],
      }
    : project);
  const adoptionReadiness = adoptionFor(adoptedProjects);
  const forgedProof = {
    schema: 'aiexe.controller-recurring-structured-proof.v1',
    evidenceClass: 'VERIFIED_RECURRING_STRUCTURED_CONTROLLER_SOURCE',
    projectId: 'trainingos',
    repository: 'moseszhu999/training-learning-rails',
    cycleCount: 2,
    firstObservedAt: '2026-08-10T06:47:00Z',
    lastObservedAt: '2026-08-10T07:47:00Z',
    sourceRefs: ['github:fake:1', 'github:fake:2'],
    sourceDigests: [
      `sha256:${'1'.repeat(64)}`,
      `sha256:${'2'.repeat(64)}`,
    ],
    exactHeadShas: [
      '1111111111111111111111111111111111111111',
      '2222222222222222222222222222222222222222',
    ],
    allCyclesAcceptedExactHeadCurrent: true,
    distinctSourceRefs: true,
    distinctSourceDigests: true,
    strictlyIncreasingObservedAt: true,
    readOnly: true,
    writeAuthority: 'none',
    proven: true,
  };

  assert.throws(() => buildControllerProducerReadiness({
    observedAt: '2026-08-10T07:50:00Z',
    adoptionReadiness,
    producers: fixture.producers.map((row) => {
      const producer = producerInput(row);
      if (producer.projectId !== 'trainingos') return producer;
      return {
        ...producer,
        structuredProducerContractObserved: true,
        recurringStructuredProof: forgedProof,
      };
    }),
  }), /embedded canonical cycle summaries/);
});
