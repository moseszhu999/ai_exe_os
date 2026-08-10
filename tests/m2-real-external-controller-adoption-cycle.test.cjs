'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  parseControllerAttestationEnvelope,
  sourceDigestFor,
} = require('../src/management/portfolio/controller-attestation-envelope.cjs');
const { createGithubReadOnlyProjectObservation } = require('../src/management/portfolio/read-only-adapters.cjs');
const { enrichGithubObservationWithExternalAttestation } = require('../src/management/portfolio/external-controller-attestation.cjs');

const cycle = JSON.parse(readFileSync(
  join(__dirname, '..', 'fixtures', 'management', 'm2-real-external-controller-adoption-cycle-2026-08-10.json'),
  'utf8',
));

function observation(source, headSha = source.headSha) {
  return createGithubReadOnlyProjectObservation({
    projectId: source.projectId,
    repository: source.repository,
    defaultBranch: 'main',
    headSha,
    observedAt: cycle.capturedAt,
    now: cycle.capturedAt,
    openPullRequests: [],
    evidenceRefs: [`github:${source.repository}:commit:${headSha}`],
  });
}

test('M2.14 first real external cycle contains one structured source for all three Domain projects', () => {
  assert.equal(cycle.evidenceClass, 'REAL_EXTERNAL_STRUCTURED_CONTROLLER_ADOPTION_CYCLE');
  assert.equal(cycle.readOnly, true);
  assert.equal(cycle.writeAuthority, 'none');
  assert.equal(cycle.externalDomainCount, 3);
  assert.equal(cycle.structuredSourceExistenceCount, 3);
  assert.equal(cycle.acceptedInFixtureCount, 3);
  assert.equal(cycle.recurringStructuredProducerProven, false);
  assert.equal(cycle.g3Verdict, 'PARTIAL');
  assert.deepEqual(
    cycle.sources.map((source) => source.projectId).sort(),
    ['tradeos', 'trainingos', 'video-operation-shared-media'],
  );
});

test('M2.14 exact GitHub comment bodies verify full-body digest and canonical marked JSON', () => {
  for (const source of cycle.sources) {
    assert.equal(sourceDigestFor(source.body), source.sourceDigest);
    const envelope = parseControllerAttestationEnvelope({
      body: source.body,
      sourceKind: source.sourceKind,
      sourceRef: source.sourceRef,
      sourceDigest: source.sourceDigest,
    });
    assert.equal(envelope.sourceDigestVerified, true);
    assert.equal(envelope.surroundingProseAuthoritative, false);
    assert.equal(envelope.factExtraction, 'marked-json-only');
    assert.equal(envelope.llmFactGenerationAllowed, false);
    assert.equal(envelope.writeAuthority, 'none');
    assert.equal(envelope.attestation.projectId, source.projectId);
    assert.equal(envelope.attestation.canonicalReceipt.repository, source.repository);
    assert.equal(envelope.attestation.canonicalReceipt.exactHeadSha, source.headSha);
    assert.equal(envelope.attestation.canonicalReceipt.domainStatus, 'active');
  }
});

test('M2.14 first real 3-Domain cycle is accepted only at exact current heads and current freshness', () => {
  for (const source of cycle.sources) {
    const envelope = parseControllerAttestationEnvelope({
      body: source.body,
      sourceKind: source.sourceKind,
      sourceRef: source.sourceRef,
      sourceDigest: source.sourceDigest,
    });
    const enriched = enrichGithubObservationWithExternalAttestation({
      observation: observation(source),
      attestation: envelope.attestation,
      now: cycle.capturedAt,
    });
    assert.equal(enriched.domainReceipt.accepted, true, source.projectId);
    assert.equal(enriched.domainReceipt.reason, 'accepted_exact_head_current', source.projectId);
    assert.equal(enriched.snapshot.status, 'active', source.projectId);
    assert.equal(enriched.snapshot.owner, 'moseszhu999', source.projectId);
  }
});

test('M2.14 an external structured source cannot promote across an exact-head mismatch', () => {
  for (const source of cycle.sources) {
    const envelope = parseControllerAttestationEnvelope({
      body: source.body,
      sourceKind: source.sourceKind,
      sourceRef: source.sourceRef,
      sourceDigest: source.sourceDigest,
    });
    const wrongHead = source.headSha === '1111111111111111111111111111111111111111'
      ? '2222222222222222222222222222222222222222'
      : '1111111111111111111111111111111111111111';
    const enriched = enrichGithubObservationWithExternalAttestation({
      observation: observation(source, wrongHead),
      attestation: envelope.attestation,
      now: cycle.capturedAt,
    });
    assert.equal(enriched.domainReceipt.accepted, false, source.projectId);
    assert.equal(enriched.domainReceipt.reason, 'exact_head_mismatch', source.projectId);
    assert.equal(enriched.snapshot.status, 'unknown', source.projectId);
  }
});

test('M2.14 first accepted external cycle does not falsely close recurring G3 or authorize A2 execution', () => {
  assert.equal(cycle.acceptedInFixtureCount, 3);
  assert.equal(cycle.recurringStructuredProducerProven, false);
  assert.equal(cycle.g3Verdict, 'PARTIAL');
});
