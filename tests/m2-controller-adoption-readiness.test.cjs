'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  buildControllerAdoptionReadiness,
} = require('../src/management/portfolio/controller-adoption-readiness.cjs');

const source = JSON.parse(readFileSync(join(
  __dirname,
  '..',
  'fixtures',
  'management',
  'm2-external-controller-adoption-readiness-2026-08-10.json',
), 'utf8'));

function projectInput(row) {
  return {
    projectId: row.projectId,
    repository: row.repository,
    exactHeadSha: row.exactHeadSha,
    groupAdapterEvidenceRefs: row.groupAdapterEvidenceRefs,
    verifiedCurrentEnvelopeEvidenceRefs: row.verifiedCurrentEnvelopeEvidenceRefs,
    markerSearchObserved: row.markerSearchObserved,
    markerSearchMatched: row.markerSearchMatched,
  };
}

test('M2.9 real external audit distinguishes group integration readiness from structured Controller adoption', () => {
  const result = buildControllerAdoptionReadiness({
    observedAt: source.observedAt,
    projects: source.projects.map(projectInput),
  });

  assert.equal(result.schema, 'aiexe.controller-adoption-readiness.v1');
  assert.equal(result.evidenceClass, 'READ_ONLY_EXTERNAL_ADOPTION_READINESS');
  assert.equal(result.externalProjectCount, 3);
  assert.equal(result.structuredAdoptedCount, 0);
  assert.equal(result.groupAdapterReadyCount, 2);
  assert.equal(result.unverifiedMarkerCount, 0);
  assert.equal(result.structuredAdoptionComplete, false);
  assert.equal(result.groupAdapterIsNotControllerAdoption, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.writeAuthority, 'none');
  assert.equal(result.crossRepositoryCredentialRequiredByThisModule, false);
  assert.equal(result.llmFactGenerationAllowed, false);

  for (const expected of source.projects) {
    const actual = result.projects.find((project) => project.projectId === expected.projectId);
    assert.equal(actual.state, expected.expectedState);
    assert.equal(actual.structuredControllerAdopted, false);
    assert.equal(actual.authorityGranted, false);
    assert.equal(actual.domainTruthInferred, false);
  }
});

test('M2.9 a read-only group adapter can never be promoted into Controller adoption by naming alone', () => {
  const result = buildControllerAdoptionReadiness({
    observedAt: '2026-08-09T23:16:39Z',
    projects: [{
      projectId: 'trainingos',
      repository: 'moseszhu999/training-learning-rails',
      exactHeadSha: 'd75d7cb9c0c3ab6c0af3e2df147ac3f8aeecd5fc',
      groupAdapterEvidenceRefs: ['github:trainingos:group-adapter'],
      verifiedCurrentEnvelopeEvidenceRefs: [],
      markerSearchObserved: true,
      markerSearchMatched: false,
    }],
  });
  assert.equal(result.projects[0].groupIntegrationReady, true);
  assert.equal(result.projects[0].state, 'GROUP_ADAPTER_READY_ENVELOPE_MISSING');
  assert.equal(result.projects[0].structuredControllerAdopted, false);
});

test('M2.9 an unverified marker remains unverified and a verified current envelope requires an observed marker', () => {
  const unverified = buildControllerAdoptionReadiness({
    observedAt: '2026-08-09T23:16:39Z',
    projects: [{
      projectId: 'tradeos',
      repository: 'moseszhu999/chaintrace-app',
      exactHeadSha: '355a7169bfe8e48c7f78fa874cc422a394553d56',
      groupAdapterEvidenceRefs: [],
      verifiedCurrentEnvelopeEvidenceRefs: [],
      markerSearchObserved: true,
      markerSearchMatched: true,
    }],
  });
  assert.equal(unverified.projects[0].state, 'UNVERIFIED_CONTROLLER_MARKER_PRESENT');
  assert.equal(unverified.structuredAdoptedCount, 0);

  assert.throws(() => buildControllerAdoptionReadiness({
    observedAt: '2026-08-09T23:16:39Z',
    projects: [{
      projectId: 'tradeos',
      repository: 'moseszhu999/chaintrace-app',
      exactHeadSha: '355a7169bfe8e48c7f78fa874cc422a394553d56',
      groupAdapterEvidenceRefs: [],
      verifiedCurrentEnvelopeEvidenceRefs: ['github:tradeos:verified-envelope'],
      markerSearchObserved: true,
      markerSearchMatched: false,
    }],
  }), /requires an observed marker match/);
});

test('M2.9 only verified current envelope evidence can produce structured adoption', () => {
  const result = buildControllerAdoptionReadiness({
    observedAt: '2026-08-09T23:16:39Z',
    projects: [{
      projectId: 'video-operation-shared-media',
      repository: 'moseszhu999/global-tool-radar',
      exactHeadSha: '9e3391d8d0eea52004026c5643370c72ba0506cb',
      groupAdapterEvidenceRefs: ['github:shared-media:group-adapter'],
      verifiedCurrentEnvelopeEvidenceRefs: ['github:shared-media:verified-current-envelope'],
      markerSearchObserved: true,
      markerSearchMatched: true,
    }],
  });
  assert.equal(result.structuredAdoptedCount, 1);
  assert.equal(result.structuredAdoptionComplete, true);
  assert.equal(result.projects[0].state, 'STRUCTURED_CONTROLLER_ADOPTED');
  assert.equal(result.projects[0].structuredControllerAdopted, true);
  assert.equal(result.projects[0].authorityGranted, false);
});
