'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildControllerAdoptionReadiness,
  revalidateControllerAdoptionReadiness,
} = require('../src/management/portfolio/controller-adoption-readiness.cjs');
const { buildControllerProducerReadiness } = require('../src/management/portfolio/controller-producer-readiness.cjs');
const { buildControllerG3Readiness } = require('../src/management/portfolio/controller-g3-readiness.cjs');

const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'management', 'm2-controller-currentness-revalidation-2026-08-10.json'),
  'utf8',
));

function providerInput(row) {
  const { comparisonFromAttestedHead: _comparison, ...input } = row;
  return input;
}

function producerInput(projectId) {
  const topology = fixture.schedulerTopology[projectId];
  return {
    projectId,
    schedulerRef: `chatgpt-native-task:${projectId}:hourly-controlled-progress`,
    schedulerObserved: true,
    schedulerEnabled: topology.enabled,
    lastRunAt: topology.lastRunAt,
    structuredProducerContractObserved: topology.structuredProducerContractObserved,
    outOfBandPersistenceChannelObserved: true,
    recurringStructuredEvidenceRefs: [],
    evidenceRefs: [`runtime-observation:${projectId}:${fixture.observedAt}`],
  };
}

test('M2.19 independently revalidates external Controller adoption against current provider heads', () => {
  assert.equal(fixture.evidenceClass, 'REAL_EXTERNAL_CONTROLLER_CURRENTNESS_REVALIDATION_POST_M2_18');
  assert.equal(fixture.readOnly, true);
  assert.equal(fixture.writeAuthority, 'none');

  const prior = buildControllerAdoptionReadiness({
    observedAt: fixture.priorAdoptionObservedAt,
    projects: fixture.adoptionProjects,
  });
  assert.equal(prior.structuredAdoptedCount, 3);
  assert.equal(prior.structuredAdoptionComplete, true);

  const current = revalidateControllerAdoptionReadiness({
    observedAt: fixture.observedAt,
    adoptionReadiness: prior,
    providerHeads: fixture.providerHeads.map(providerInput),
  });

  assert.equal(current.evidenceClass, 'READ_ONLY_EXTERNAL_ADOPTION_REVALIDATION');
  assert.equal(current.revalidatedAgainstIndependentProviderHeads, true);
  assert.equal(current.providerFetchPerformedByThisModule, false);
  assert.equal(current.structuredAdoptedCount, fixture.expected.currentStructuredAdoptedCount);
  assert.equal(current.staleAttestationCount, fixture.expected.staleAttestationCount);
  assert.equal(current.structuredAdoptionComplete, fixture.expected.currentStructuredAdoptionComplete);

  const byId = new Map(current.projects.map((project) => [project.projectId, project]));
  const currentIds = current.projects.filter((project) => project.structuredControllerAdopted).map((project) => project.projectId);
  const staleIds = current.projects.filter((project) => project.state === 'STRUCTURED_CONTROLLER_ATTESTATION_STALE').map((project) => project.projectId);
  assert.deepEqual(currentIds, fixture.expected.currentProjectIds);
  assert.deepEqual(staleIds, fixture.expected.staleProjectIds);

  for (const projectId of ['trainingos', 'tradeos']) {
    const project = byId.get(projectId);
    assert.equal(project.attestationCurrent, false);
    assert.equal(project.structuredControllerAdopted, false);
    assert.equal(project.state, 'STRUCTURED_CONTROLLER_ATTESTATION_STALE');
    assert.equal(project.verifiedCurrentEnvelopeEvidenceRefs.length, 0);
    assert.notEqual(project.attestedHeadSha, project.providerHeadSha);
    assert.equal(project.exactHeadSha, project.providerHeadSha);
  }

  const video = byId.get('video-operation-shared-media');
  assert.equal(video.attestationCurrent, true);
  assert.equal(video.structuredControllerAdopted, true);
  assert.equal(video.state, 'STRUCTURED_CONTROLLER_ADOPTED');
  assert.equal(video.attestedHeadSha, video.providerHeadSha);
  assert.equal(video.verifiedCurrentEnvelopeEvidenceRefs.length, 1);
  assert.equal(fixture.videoRecurrenceEvidence.secondCycleCurrentAtObservation, true);
  assert.equal(fixture.videoRecurrenceEvidence.nativeProducerContractStillUnproven, true);
});

test('M2.19 stale external Controller heads propagate fail-closed into G3 instead of preserving old 3/3 currentness', () => {
  const prior = buildControllerAdoptionReadiness({
    observedAt: fixture.priorAdoptionObservedAt,
    projects: fixture.adoptionProjects,
  });
  const current = revalidateControllerAdoptionReadiness({
    observedAt: fixture.observedAt,
    adoptionReadiness: prior,
    providerHeads: fixture.providerHeads.map(providerInput),
  });
  const producerReadiness = buildControllerProducerReadiness({
    observedAt: fixture.observedAt,
    adoptionReadiness: current,
    producers: current.projects.map((project) => producerInput(project.projectId)),
  });
  const g3 = buildControllerG3Readiness({ producerReadiness });

  assert.equal(g3.verdict, fixture.expected.g3State);
  assert.equal(g3.g3Pass, false);
  assert.equal(g3.m3EntryAuthorized, false);
  assert.equal(g3.a2ExecutionAuthorized, false);
  assert.equal(g3.passingProjectCount, 0);

  const byId = new Map(g3.projects.map((project) => [project.projectId, project]));
  assert.equal(byId.get('trainingos').blockers.includes('structured_controller_not_current'), true);
  assert.equal(byId.get('tradeos').blockers.includes('structured_controller_not_current'), true);
  assert.equal(byId.get('video-operation-shared-media').blockers.includes('structured_controller_not_current'), false);
  assert.equal(byId.get('video-operation-shared-media').blockers.includes('structured_producer_contract_unobserved'), true);
  assert.equal(byId.get('tradeos').blockers.includes('producer_disabled'), true);

  assert.equal(fixture.g4Dependency.authorizationOwnerPr, 139);
  assert.equal(fixture.g4Dependency.authorizationOwnerCiConclusion, 'success');
  assert.equal(fixture.g4Dependency.managementPlaneMustNotDuplicateAuthorizationCore, true);
});

test('M2.19 provider revalidation rejects incomplete or substituted provider truth', () => {
  const prior = buildControllerAdoptionReadiness({
    observedAt: fixture.priorAdoptionObservedAt,
    projects: fixture.adoptionProjects,
  });

  assert.throws(() => revalidateControllerAdoptionReadiness({
    observedAt: fixture.observedAt,
    adoptionReadiness: prior,
    providerHeads: fixture.providerHeads.slice(0, 2).map(providerInput),
  }), /same project set/);

  const substituted = fixture.providerHeads.map(providerInput);
  substituted[0] = { ...substituted[0], repository: 'moseszhu999/not-trainingos' };
  assert.throws(() => revalidateControllerAdoptionReadiness({
    observedAt: fixture.observedAt,
    adoptionReadiness: prior,
    providerHeads: substituted,
  }), /provider repository mismatch/);
});
