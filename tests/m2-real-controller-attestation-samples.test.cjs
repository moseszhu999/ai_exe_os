'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createGithubReadOnlyProjectObservation } = require('../src/management/portfolio/read-only-adapters.cjs');
const {
  createExternalControllerAttestation,
  enrichGithubObservationWithExternalAttestation,
} = require('../src/management/portfolio/external-controller-attestation.cjs');

const fixture = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'management', 'm2-real-controller-attestation-samples-v1.json'), 'utf8'));

function runSample(sample) {
  const observation = createGithubReadOnlyProjectObservation(sample.githubObservation);
  const attestation = createExternalControllerAttestation(sample.attestation);
  return enrichGithubObservationWithExternalAttestation({
    observation,
    attestation,
    now: sample.githubObservation.now,
  });
}

test('M2.3 real attestation samples preserve explicit source provenance', () => {
  assert.equal(fixture.schema, 'aiexe.real-controller-attestation-samples.v1');
  assert.equal(fixture.samples.length, 2);
  for (const sample of fixture.samples) {
    assert.equal(sample.attestation.sourceKind, 'current-handoff');
    assert.ok(sample.attestation.evidenceRefs.length >= 2);
    assert.match(sample.attestation.exactHeadSha, /^[0-9a-f]{40}$/);
    assert.match(sample.githubObservation.headSha, /^[0-9a-f]{40}$/);
  }
});

test('M2.3 Video current-handoff is accepted at the exact head it attested', () => {
  const sample = fixture.samples.find((row) => row.id === 'video-m10-handoff-accepted-at-original-head');
  const enriched = runSample(sample);
  assert.equal(enriched.domainReceipt.accepted, sample.expected.receiptAccepted);
  assert.equal(enriched.domainReceipt.reason, sample.expected.reason);
  assert.equal(enriched.snapshot.status, sample.expected.domainStatus);
  assert.equal(enriched.snapshot.attentionSignals.includes(sample.expected.attentionSignal), true);
  assert.equal(enriched.snapshot.owner, 'video-operation-controller');
});

test('M2.3 the same real handoff becomes non-authoritative after main advances', () => {
  const sample = fixture.samples.find((row) => row.id === 'video-m10-handoff-invalidated-after-head-movement');
  const enriched = runSample(sample);
  assert.equal(enriched.domainReceipt.accepted, sample.expected.receiptAccepted);
  assert.equal(enriched.domainReceipt.reason, sample.expected.reason);
  assert.equal(enriched.snapshot.status, sample.expected.domainStatus);
  assert.equal(enriched.snapshot.owner, null);
  assert.equal(enriched.snapshot.attentionSignals.includes(sample.expected.attentionSignal), true);
  assert.equal(enriched.snapshot.attentionSignals.includes('domain_status_unknown'), true);
});
