'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildControllerAdoptionReadiness } = require('../src/management/portfolio/controller-adoption-readiness.cjs');
const {
  parseControllerAttestationEnvelope,
  sourceDigestFor,
} = require('../src/management/portfolio/controller-attestation-envelope.cjs');
const { buildControllerG3Readiness } = require('../src/management/portfolio/controller-g3-readiness.cjs');
const { buildControllerProducerReadiness } = require('../src/management/portfolio/controller-producer-readiness.cjs');
const { buildControllerRecurringStructuredProof } = require('../src/management/portfolio/controller-recurrence-proof.cjs');
const { enrichGithubObservationWithExternalAttestation } = require('../src/management/portfolio/external-controller-attestation.cjs');
const { createGithubReadOnlyProjectObservation } = require('../src/management/portfolio/read-only-adapters.cjs');

const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'management', 'm2-controller-producer-readiness-2026-08-10.json'),
  'utf8',
));

const domains = [
  { projectId: 'trainingos', repository: 'moseszhu999/training-learning-rails', controllerId: 'trainingos-hourly-controller' },
  { projectId: 'tradeos', repository: 'moseszhu999/chaintrace-app', controllerId: 'tradeos-saas-core-controller' },
  { projectId: 'video-operation-shared-media', repository: 'moseszhu999/global-tool-radar', controllerId: 'shared-media-video-controller' },
];

function producerInput(row) {
  const { expectedState: _expectedState, ...input } = row;
  return input;
}

function bodyFor(domain, cycle, observedAt, headSha) {
  return [
    `## SIMULATED recurrence cycle ${cycle}`,
    '',
    '<!-- aiexe.external-controller-attestation.v1 -->',
    '```json',
    JSON.stringify({
      projectId: domain.projectId,
      controllerId: domain.controllerId,
      repository: domain.repository,
      exactHeadSha: headSha,
      domainStatus: 'active',
      owner: 'moseszhu999',
      milestone: `SIMULATED canonical recurrence cycle ${cycle}`,
      blockerCodes: [],
      evidenceRefs: [`github:${domain.repository}:commit:${headSha}`],
      observedAt,
    }, null, 2),
    '```',
    '<!-- /aiexe.external-controller-attestation.v1 -->',
  ].join('\n');
}

function acceptedCycle(domain, cycle, observedAt, headSha) {
  const body = bodyFor(domain, cycle, observedAt, headSha);
  const sourceRef = `https://github.com/${domain.repository}/issues/999#issuecomment-simulated-${cycle}`;
  const envelope = parseControllerAttestationEnvelope({
    body,
    sourceKind: 'coordinator-issue',
    sourceRef,
    sourceDigest: sourceDigestFor(body),
  });
  const observation = createGithubReadOnlyProjectObservation({
    projectId: domain.projectId,
    repository: domain.repository,
    defaultBranch: 'main',
    headSha,
    observedAt,
    now: observedAt,
    openPullRequests: [],
    evidenceRefs: [`github:${domain.repository}:commit:${headSha}`],
  });
  const enrichedObservation = enrichGithubObservationWithExternalAttestation({
    observation,
    attestation: envelope.attestation,
    now: observedAt,
  });
  assert.equal(enrichedObservation.domainReceipt.accepted, true);
  return { envelope, enrichedObservation };
}

function simulatedCompleteReadiness() {
  const headByProject = new Map([
    ['trainingos', '1111111111111111111111111111111111111111'],
    ['tradeos', '2222222222222222222222222222222222222222'],
    ['video-operation-shared-media', '3333333333333333333333333333333333333333'],
  ]);
  const adoptionReadiness = buildControllerAdoptionReadiness({
    observedAt: '2026-08-10T08:00:00Z',
    projects: domains.map((domain) => ({
      projectId: domain.projectId,
      repository: domain.repository,
      exactHeadSha: headByProject.get(domain.projectId),
      groupAdapterEvidenceRefs: [`github:${domain.repository}:group-adapter`],
      verifiedCurrentEnvelopeEvidenceRefs: [`github:${domain.repository}:structured-current-envelope`],
      markerSearchObserved: true,
      markerSearchMatched: true,
    })),
  });

  const proofByProject = new Map(domains.map((domain) => {
    const headSha = headByProject.get(domain.projectId);
    const proof = buildControllerRecurringStructuredProof({
      projectId: domain.projectId,
      repository: domain.repository,
      cycles: [
        acceptedCycle(domain, 1, '2026-08-10T06:00:00Z', headSha),
        acceptedCycle(domain, 2, '2026-08-10T07:00:00Z', headSha),
      ],
    });
    return [domain.projectId, proof];
  }));

  return buildControllerProducerReadiness({
    observedAt: '2026-08-10T08:00:00Z',
    adoptionReadiness,
    producers: domains.map((domain) => ({
      projectId: domain.projectId,
      schedulerRef: `automation:${domain.projectId}:hourly`,
      schedulerObserved: true,
      schedulerEnabled: true,
      lastRunAt: '2026-08-10T07:00:00Z',
      structuredProducerContractObserved: true,
      outOfBandPersistenceChannelObserved: true,
      recurringStructuredEvidenceRefs: proofByProject.get(domain.projectId).sourceRefs,
      recurringStructuredProof: proofByProject.get(domain.projectId),
      evidenceRefs: [`github:${domain.repository}:controller-topology`],
    })),
  });
}

test('M2.16 current producer topology remains G3 PARTIAL and grants no authority', () => {
  const adoptionReadiness = buildControllerAdoptionReadiness({
    observedAt: fixture.observedAt,
    projects: fixture.adoptionProjects,
  });
  const producerReadiness = buildControllerProducerReadiness({
    observedAt: fixture.observedAt,
    adoptionReadiness,
    producers: fixture.producers.map(producerInput),
  });
  const gate = buildControllerG3Readiness({ producerReadiness });

  assert.equal(gate.requiredProjectCount, 3);
  assert.equal(gate.passingProjectCount, 0);
  assert.equal(gate.failingProjectCount, 3);
  assert.equal(gate.verdict, 'PARTIAL');
  assert.equal(gate.g3Pass, false);
  assert.equal(gate.requiredProjectSetFixed, true);
  assert.equal(gate.callerCanReduceRequiredProjectSet, false);
  assert.equal(gate.m3EntryAuthorized, false);
  assert.equal(gate.a2ExecutionAuthorized, false);
  assert.equal(gate.authorityGranted, false);
});

test('M2.16 fixed three-Domain gate becomes PASS only when every canonical recurring producer is current', () => {
  const producerReadiness = simulatedCompleteReadiness();
  assert.equal(producerReadiness.recurringStructuredProducerCount, 3);
  assert.equal(producerReadiness.recurringStructuredProducerComplete, true);

  const gate = buildControllerG3Readiness({ producerReadiness });
  assert.equal(gate.passingProjectCount, 3);
  assert.equal(gate.failingProjectCount, 0);
  assert.equal(gate.verdict, 'PASS');
  assert.equal(gate.g3Pass, true);
  assert.equal(gate.projects.every((project) => project.pass), true);
  assert.equal(gate.projects.every((project) => project.recurrenceCycleCount === 2), true);
  assert.equal(gate.m3EntryAuthorized, false);
  assert.equal(gate.a2ExecutionAuthorized, false);
});

test('M2.16 caller cannot omit one external Domain and claim a smaller denominator', () => {
  const producerReadiness = simulatedCompleteReadiness();
  const reduced = {
    ...producerReadiness,
    externalProjectCount: 2,
    producers: producerReadiness.producers.slice(0, 2),
  };
  assert.throws(() => buildControllerG3Readiness({ producerReadiness: reduced }), /fixed three-Domain external project set/);
});

test('M2.16 repository substitution in the required Domain set fails closed', () => {
  const producerReadiness = simulatedCompleteReadiness();
  const tampered = {
    ...producerReadiness,
    producers: producerReadiness.producers.map((producer) => producer.projectId === 'tradeos'
      ? { ...producer, repository: 'moseszhu999/not-tradeos' }
      : producer),
  };
  assert.throws(() => buildControllerG3Readiness({ producerReadiness: tampered }), /repository binding mismatch/);
});
