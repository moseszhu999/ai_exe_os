'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { buildExternalProviderManagementCycle } = require('../src/management/portfolio/live-provider-cycle.cjs');

const capture = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'management', 'm2-live-github-observation-capture-2026-08-09.json'), 'utf8'));
const sample = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'management', 'm2-out-of-band-controller-attestation-aiexe-2026-08-09.json'), 'utf8'));

function sourceFromSample() {
  return {
    body: sample.body,
    sourceKind: sample.sourceKind,
    sourceRef: sample.sourceRef,
    sourceDigest: sample.sourceDigest,
  };
}

test('M2.7 real external provider cycle promotes only the project with a verified current out-of-band attestation', () => {
  const result = buildExternalProviderManagementCycle({
    capture,
    attestationSources: [sourceFromSample()],
    evaluatedAt: '2026-08-09T15:56:00Z',
  });

  assert.equal(result.evidenceClass, 'REAL_PROVIDER_OBSERVATION_PLUS_CONTROLLER_ATTESTATION');
  assert.equal(result.providerTransport, 'external-read-only-connector');
  assert.equal(result.providerObservationSupplied, true);
  assert.equal(result.providerFetchPerformedInProcess, false);
  assert.equal(result.crossRepositoryCredentialRequiredByThisModule, false);
  assert.equal(result.scheduledRuntimeStarted, false);
  assert.equal(result.recurringIngestionProven, false);
  assert.equal(result.writeAuthority, 'none');
  assert.equal(result.llmFactGenerationAllowed, false);
  assert.equal(result.parsedAttestationCount, 1);
  assert.equal(result.sourceDigestVerifiedCount, 1);

  assert.equal(result.cycle.projectCount, 4);
  assert.equal(result.cycle.attestedProjectCount, 1);
  assert.deepEqual(result.cycle.unresolvedProjectIds, ['tradeos', 'trainingos', 'video-operation-shared-media']);
  const aiexe = result.cycle.portfolio.projects.find((project) => project.id === 'aiexe');
  assert.equal(aiexe.status, 'active');
  assert.equal(aiexe.owner, 'AIEXE Group Management Plane Controller');
  for (const id of result.cycle.unresolvedProjectIds) {
    const project = result.cycle.portfolio.projects.find((row) => row.id === id);
    assert.equal(project.status, 'unknown');
    assert.equal(project.owner, null);
  }
});

test('M2.7 provider cycle refuses evaluation before source capture or without explicit attestation source list', () => {
  assert.throws(() => buildExternalProviderManagementCycle({
    capture,
    attestationSources: [sourceFromSample()],
    evaluatedAt: '2026-08-09T15:00:00Z',
  }), /cannot predate provider capture/);

  assert.throws(() => buildExternalProviderManagementCycle({
    capture,
    evaluatedAt: '2026-08-09T15:56:00Z',
  }), /attestationSources must be an array/);
});
