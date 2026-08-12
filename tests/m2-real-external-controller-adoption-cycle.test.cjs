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
const revalidation = JSON.parse(readFileSync(
  join(__dirname, '..', 'fixtures', 'management', 'm2-external-controller-adoption-revalidation-2026-08-10.json'),
  'utf8',
));
const revalidationByProject = new Map(revalidation.projects.map((project) => [project.projectId, project]));

function observation(source, providerHeadSha, observedAt = revalidation.observedAt) {
  if (!providerHeadSha) throw new Error('independent provider head is required');
  return createGithubReadOnlyProjectObservation({
    projectId: source.projectId,
    repository: source.repository,
    defaultBranch: 'main',
    headSha: providerHeadSha,
    observedAt,
    now: observedAt,
    openPullRequests: [],
    evidenceRefs: [`github:${source.repository}:commit:${providerHeadSha}`],
  });
}

function envelopeFor(source) {
  return parseControllerAttestationEnvelope({
    body: source.body,
    sourceKind: source.sourceKind,
    sourceRef: source.sourceRef,
    sourceDigest: source.sourceDigest,
  });
}

test('M2.14 source capture contains one real structured source for all three Domain projects', () => {
  assert.equal(cycle.evidenceClass, 'REAL_EXTERNAL_STRUCTURED_CONTROLLER_ADOPTION_CYCLE');
  assert.equal(cycle.readOnly, true);
  assert.equal(cycle.writeAuthority, 'none');
  assert.equal(cycle.externalDomainCount, 3);
  assert.equal(cycle.structuredSourceExistenceCount, 3);
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
    const envelope = envelopeFor(source);
    assert.equal(envelope.sourceDigestVerified, true);
    assert.equal(envelope.surroundingProseAuthoritative, false);
    assert.equal(envelope.factExtraction, 'marked-json-only');
    assert.equal(envelope.llmFactGenerationAllowed, false);
    assert.equal(envelope.writeAuthority, 'none');
    assert.equal(envelope.attestation.projectId, source.projectId);
    assert.equal(envelope.attestation.canonicalReceipt.repository, source.repository);
    assert.equal(envelope.attestation.canonicalReceipt.domainStatus, 'active');
  }
});

test('M2.16 independent provider-head revalidation corrects the first-cycle current acceptance to 2 of 3', () => {
  assert.equal(revalidation.evidenceClass, 'REAL_EXTERNAL_CONTROLLER_INDEPENDENT_HEAD_REVALIDATION');
  assert.equal(revalidation.readOnly, true);
  assert.equal(revalidation.writeAuthority, 'none');
  assert.equal(revalidation.externalDomainCount, 3);
  assert.equal(revalidation.structuredSourceExistenceCount, 3);
  assert.equal(revalidation.acceptedCurrentCount, 2);
  assert.equal(revalidation.rejectedCurrentCount, 1);
  assert.equal(revalidation.firstCycleAcceptanceComplete, false);
  assert.equal(revalidation.g3Verdict, 'PARTIAL');

  let accepted = 0;
  for (const source of cycle.sources) {
    const live = revalidationByProject.get(source.projectId);
    assert.ok(live, source.projectId);
    assert.equal(live.repository, source.repository);
    assert.equal(live.sourceRef, source.sourceRef);

    const envelope = envelopeFor(source);
    assert.equal(envelope.attestation.canonicalReceipt.exactHeadSha, live.attestedHeadSha, source.projectId);

    const enriched = enrichGithubObservationWithExternalAttestation({
      observation: observation(source, live.providerHeadSha),
      attestation: envelope.attestation,
      now: revalidation.observedAt,
    });
    assert.equal(enriched.domainReceipt.accepted, live.expectedAccepted, source.projectId);
    assert.equal(enriched.domainReceipt.reason, live.expectedReason, source.projectId);
    assert.equal(enriched.snapshot.status, live.expectedAccepted ? 'active' : 'unknown', source.projectId);
    if (live.expectedAccepted) accepted += 1;
  }
  assert.equal(accepted, 2);
});

test('M2.16 Video first source was already stale against independently observed provider main and must fail closed', () => {
  const source = cycle.sources.find((row) => row.projectId === 'video-operation-shared-media');
  const live = revalidationByProject.get(source.projectId);
  assert.notEqual(live.attestedHeadSha, live.providerHeadSha);
  assert.equal(live.attestedHeadSha, '24996407449df28b2d83fce1a145b3200fff168a');
  assert.equal(live.providerHeadSha, '23d92ffc4674f1581c4191e595d279a20008be53');

  const enriched = enrichGithubObservationWithExternalAttestation({
    observation: observation(source, live.providerHeadSha),
    attestation: envelopeFor(source).attestation,
    now: revalidation.observedAt,
  });
  assert.equal(enriched.domainReceipt.accepted, false);
  assert.equal(enriched.domainReceipt.reason, 'exact_head_mismatch');
  assert.equal(enriched.snapshot.status, 'unknown');
});

test('M2.16 source-attested head cannot be reused as independent provider observation evidence', () => {
  const source = cycle.sources.find((row) => row.projectId === 'video-operation-shared-media');
  assert.throws(() => observation(source), /independent provider head is required/);
});

test('M2.16 corrected first-cycle acceptance still cannot close recurring G3 or authorize A2 execution', () => {
  assert.equal(revalidation.acceptedCurrentCount, 2);
  assert.equal(revalidation.firstCycleAcceptanceComplete, false);
  assert.equal(cycle.recurringStructuredProducerProven, false);
  assert.equal(revalidation.g3Verdict, 'PARTIAL');
});
