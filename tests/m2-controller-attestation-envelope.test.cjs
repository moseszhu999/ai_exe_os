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

const sample = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'management', 'm2-out-of-band-controller-attestation-aiexe-2026-08-09.json'), 'utf8'));
const scan = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'management', 'm2-controller-evidence-scan-2026-08-09.json'), 'utf8'));

function parse(body = sample.body, sourceDigest = sourceDigestFor(body)) {
  return parseControllerAttestationEnvelope({
    body,
    sourceKind: sample.sourceKind,
    sourceRef: sample.sourceRef,
    sourceDigest,
  });
}

function observation(headSha = sample.currentProviderHead) {
  return createGithubReadOnlyProjectObservation({
    projectId: 'aiexe',
    repository: 'moseszhu999/ai_exe_os',
    defaultBranch: 'main',
    headSha,
    observedAt: '2026-08-09T15:56:00Z',
    now: '2026-08-09T15:56:00Z',
    openPullRequests: [],
    evidenceRefs: [`github:moseszhu999/ai_exe_os:commit:${headSha}`],
  });
}

test('M2.7 real AIEXE comment body has the recorded immutable source digest', () => {
  assert.equal(sample.evidenceClass, 'REAL_OUT_OF_BAND_CONTROLLER_ATTESTATION');
  assert.equal(sourceDigestFor(sample.body), sample.sourceDigest);
  assert.match(sample.sourceRef, /issuecomment-5232406288$/);
});

test('M2.7 marked JSON from a verified out-of-band source promotes without reading surrounding prose', () => {
  const envelope = parse(sample.body, sample.sourceDigest);
  assert.equal(envelope.transport, 'out-of-band');
  assert.equal(envelope.sourceDigestVerified, true);
  assert.equal(envelope.surroundingProseAuthoritative, false);
  assert.equal(envelope.factExtraction, 'marked-json-only');
  assert.equal(envelope.llmFactGenerationAllowed, false);
  assert.equal(envelope.writeAuthority, 'none');
  assert.equal(envelope.attestation.projectId, 'aiexe');
  assert.equal(envelope.attestation.canonicalReceipt.exactHeadSha, sample.currentProviderHead);
  assert.equal(envelope.attestation.canonicalReceipt.domainStatus, 'active');

  const enriched = enrichGithubObservationWithExternalAttestation({
    observation: observation(),
    attestation: envelope.attestation,
    now: '2026-08-09T15:56:00Z',
  });
  assert.equal(enriched.domainReceipt.accepted, true);
  assert.equal(enriched.domainReceipt.reason, 'accepted_exact_head_current');
  assert.equal(enriched.snapshot.status, 'active');
  assert.equal(enriched.snapshot.owner, 'AIEXE Group Management Plane Controller');
});

test('M2.7 a valid structured envelope is still rejected when its exact head is stale', () => {
  const oldSha = '1111111111111111111111111111111111111111';
  const staleBody = sample.body.replace(sample.currentProviderHead, oldSha);
  const envelope = parse(staleBody);
  const enriched = enrichGithubObservationWithExternalAttestation({
    observation: observation(sample.currentProviderHead),
    attestation: envelope.attestation,
    now: '2026-08-09T15:56:00Z',
  });
  assert.equal(enriched.domainReceipt.accepted, false);
  assert.equal(enriched.domainReceipt.reason, 'exact_head_mismatch');
  assert.equal(enriched.snapshot.status, 'unknown');
  assert.equal(enriched.snapshot.owner, null);
});

test('M2.7 human-readable Controller prose without the marked envelope cannot become Domain truth', () => {
  assert.throws(() => parseControllerAttestationEnvelope({
    body: 'Current main is abc. Project is healthy. Continue work.',
    sourceKind: 'coordinator-issue',
    sourceRef: 'https://github.com/example/repo/issues/1#issuecomment-1',
    sourceDigest: sourceDigestFor('Current main is abc. Project is healthy. Continue work.'),
  }), /exactly one attestation marker pair/);
});

test('M2.7 transport digest mismatch, duplicate envelopes and unsupported facts fail closed', () => {
  assert.throws(() => parse(sample.body, `sha256:${'0'.repeat(64)}`), /source digest mismatch/);

  const duplicated = `${sample.body}\n\n${sample.body}`;
  assert.throws(() => parse(duplicated), /exactly one attestation marker pair/);

  const withInferredField = sample.body.replace(
    '  "observedAt": "2026-08-09T15:55:00Z"',
    '  "observedAt": "2026-08-09T15:55:00Z",\n  "completionPercent": 99'
  );
  assert.throws(() => parse(withInferredField), /unsupported field: completionPercent/);
});

test('M2.7 real cross-project scan distinguishes Controller existence from promotable current attestation', () => {
  assert.equal(scan.evidenceClass, 'REAL_READ_ONLY_CONTROLLER_EVIDENCE_SCAN');
  assert.equal(scan.summary.controllerEvidenceSourcesObserved, 4);
  assert.equal(scan.summary.promotableCurrentAttestations, 1);
  assert.equal(scan.summary.externalDomainPromotableCurrentAttestations, 0);
  const training = scan.findings.find((row) => row.projectId === 'trainingos');
  const trade = scan.findings.find((row) => row.projectId === 'tradeos');
  const video = scan.findings.find((row) => row.projectId === 'video-operation-shared-media');
  assert.equal(training.promotable, false);
  assert.equal(trade.promotable, false);
  assert.equal(video.promotable, false);
  assert.match(video.reason, /self_advances_main/);
});
