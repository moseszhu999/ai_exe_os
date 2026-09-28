'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildControllerAdoptionReadiness } = require('../src/management/portfolio/controller-adoption-readiness.cjs');
const { parseControllerAttestationEnvelope, sourceDigestFor } = require('../src/management/portfolio/controller-attestation-envelope.cjs');
const { buildControllerProducerReadiness } = require('../src/management/portfolio/controller-producer-readiness.cjs');
const { buildControllerRecurringStructuredProof } = require('../src/management/portfolio/controller-recurrence-proof.cjs');
const { enrichGithubObservationWithExternalAttestation } = require('../src/management/portfolio/external-controller-attestation.cjs');
const { createGithubReadOnlyProjectObservation } = require('../src/management/portfolio/read-only-adapters.cjs');

const producerFixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'management', 'm2-controller-producer-readiness-2026-08-10.json'),
  'utf8',
));
const adoptionCycle = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'management', 'm2-real-external-controller-adoption-cycle-2026-08-10.json'),
  'utf8',
));
const trainingSource = adoptionCycle.sources.find((source) => source.projectId === 'trainingos');

function producerInput(row) {
  const { expectedState: _expectedState, ...input } = row;
  return input;
}

function acceptedCycle({ body, sourceRef, observationHead = trainingSource.headSha, now }) {
  const envelope = parseControllerAttestationEnvelope({
    body,
    sourceKind: trainingSource.sourceKind,
    sourceRef,
    sourceDigest: sourceDigestFor(body),
  });
  const observation = createGithubReadOnlyProjectObservation({
    projectId: trainingSource.projectId,
    repository: trainingSource.repository,
    defaultBranch: 'main',
    headSha: observationHead,
    observedAt: now,
    now,
    openPullRequests: [],
    evidenceRefs: [`github:${trainingSource.repository}:commit:${observationHead}`],
  });
  const enrichedObservation = enrichGithubObservationWithExternalAttestation({
    observation,
    attestation: envelope.attestation,
    now,
  });
  return { envelope, enrichedObservation };
}

function secondTrainingBody() {
  return trainingSource.body
    .replace('TrainingOS v1', 'TrainingOS v2')
    .replace('"observedAt": "2026-08-10T06:47:00Z"', '"observedAt": "2026-08-10T07:47:00Z"');
}

function twoAcceptedCycles() {
  return [
    acceptedCycle({
      body: trainingSource.body,
      sourceRef: trainingSource.sourceRef,
      now: adoptionCycle.capturedAt,
    }),
    acceptedCycle({
      body: secondTrainingBody(),
      sourceRef: 'https://github.com/moseszhu999/training-learning-rails/issues/477#issuecomment-simulated-cycle-2',
      now: '2026-08-10T07:50:00Z',
    }),
  ];
}

test('M2.15 canonical recurrence proof requires two accepted exact-head current cycles with changed bodies', () => {
  const proof = buildControllerRecurringStructuredProof({
    projectId: trainingSource.projectId,
    repository: trainingSource.repository,
    cycles: twoAcceptedCycles(),
  });

  assert.equal(proof.evidenceClass, 'VERIFIED_RECURRING_STRUCTURED_CONTROLLER_SOURCE');
  assert.equal(proof.projectId, 'trainingos');
  assert.equal(proof.cycleCount, 2);
  assert.equal(proof.allCyclesAcceptedExactHeadCurrent, true);
  assert.equal(proof.distinctSourceRefs, true);
  assert.equal(proof.distinctSourceDigests, true);
  assert.equal(proof.strictlyIncreasingObservedAt, true);
  assert.notEqual(proof.sourceDigests[0], proof.sourceDigests[1]);
  assert.equal(proof.readOnly, true);
  assert.equal(proof.writeAuthority, 'none');
  assert.equal(proof.proven, true);
});

test('M2.15 recurrence proof rejects a cycle that was not accepted at the attested exact head', () => {
  const badHead = '1111111111111111111111111111111111111111';
  const cycles = twoAcceptedCycles();
  cycles[1] = acceptedCycle({
    body: secondTrainingBody(),
    sourceRef: 'https://github.com/moseszhu999/training-learning-rails/issues/477#issuecomment-simulated-bad-head',
    observationHead: badHead,
    now: '2026-08-10T07:50:00Z',
  });

  assert.equal(cycles[1].enrichedObservation.domainReceipt.accepted, false);
  assert.throws(() => buildControllerRecurringStructuredProof({
    projectId: trainingSource.projectId,
    repository: trainingSource.repository,
    cycles,
  }), /exact-head current accepted Domain receipt/);
});

test('M2.15 recurrence proof rejects duplicate source refs and non-advancing cycle time', () => {
  const cycles = twoAcceptedCycles();
  const duplicateRef = acceptedCycle({
    body: secondTrainingBody(),
    sourceRef: trainingSource.sourceRef,
    now: '2026-08-10T07:50:00Z',
  });
  assert.throws(() => buildControllerRecurringStructuredProof({
    projectId: trainingSource.projectId,
    repository: trainingSource.repository,
    cycles: [cycles[0], duplicateRef],
  }), /distinct source refs/);

  assert.throws(() => buildControllerRecurringStructuredProof({
    projectId: trainingSource.projectId,
    repository: trainingSource.repository,
    cycles: [cycles[1], cycles[0]],
  }), /strictly increasing/);
});

test('M2.15 producer readiness promotes recurrence only from canonical proof on an enabled observed producer', () => {
  const adoptedProjects = producerFixture.adoptionProjects.map((project) => project.projectId === 'trainingos'
    ? {
        ...project,
        markerSearchMatched: true,
        verifiedCurrentEnvelopeEvidenceRefs: [trainingSource.sourceRef],
      }
    : project);
  const adoptionReadiness = buildControllerAdoptionReadiness({
    observedAt: producerFixture.observedAt,
    projects: adoptedProjects,
  });
  const proof = buildControllerRecurringStructuredProof({
    projectId: trainingSource.projectId,
    repository: trainingSource.repository,
    cycles: twoAcceptedCycles(),
  });

  const readiness = buildControllerProducerReadiness({
    observedAt: '2026-08-10T07:50:00Z',
    adoptionReadiness,
    producers: producerFixture.producers.map((row) => {
      const producer = producerInput(row);
      if (producer.projectId !== 'trainingos') return producer;
      return {
        ...producer,
        structuredProducerContractObserved: true,
        recurringStructuredEvidenceRefs: proof.sourceRefs,
        recurringStructuredProof: proof,
      };
    }),
  });

  const training = readiness.producers.find((producer) => producer.projectId === 'trainingos');
  assert.equal(training.state, 'RECURRING_STRUCTURED_PRODUCER_PROVEN');
  assert.equal(training.recurringStructuredProven, true);
  assert.equal(training.recurringStructuredProof.schema, proof.schema);
  assert.equal(readiness.recurringStructuredProducerCount, 1);
  assert.equal(readiness.recurringStructuredProducerComplete, false);
});

test('M2.15 a disabled producer does not count as current recurring readiness even with historical canonical proof', () => {
  const adoptedProjects = producerFixture.adoptionProjects.map((project) => project.projectId === 'trainingos'
    ? {
        ...project,
        markerSearchMatched: true,
        verifiedCurrentEnvelopeEvidenceRefs: [trainingSource.sourceRef],
      }
    : project);
  const adoptionReadiness = buildControllerAdoptionReadiness({
    observedAt: producerFixture.observedAt,
    projects: adoptedProjects,
  });
  const proof = buildControllerRecurringStructuredProof({
    projectId: trainingSource.projectId,
    repository: trainingSource.repository,
    cycles: twoAcceptedCycles(),
  });

  const readiness = buildControllerProducerReadiness({
    observedAt: '2026-08-10T07:50:00Z',
    adoptionReadiness,
    producers: producerFixture.producers.map((row) => {
      const producer = producerInput(row);
      if (producer.projectId !== 'trainingos') return producer;
      return {
        ...producer,
        schedulerEnabled: false,
        structuredProducerContractObserved: true,
        recurringStructuredProof: proof,
      };
    }),
  });

  const training = readiness.producers.find((producer) => producer.projectId === 'trainingos');
  assert.equal(training.state, 'PRODUCER_DISABLED');
  assert.equal(training.recurringStructuredProven, false);
  assert.equal(readiness.recurringStructuredProducerCount, 0);
});
