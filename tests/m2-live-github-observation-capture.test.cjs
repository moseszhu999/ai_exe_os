'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createGithubReadOnlyProjectObservation } = require('../src/management/portfolio/read-only-adapters.cjs');
const { buildReadOnlyManagementObservationCycle } = require('../src/management/portfolio/observation-cycle.cjs');

const fixture = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'management', 'm2-live-github-observation-capture-2026-08-09.json'), 'utf8'));

function observations() {
  return fixture.observations.map((input) => createGithubReadOnlyProjectObservation(input));
}

test('M2.6 fixture is a real provider observation capture, not a Domain truth receipt', () => {
  assert.equal(fixture.schema, 'aiexe.live-github-observation-capture.v1');
  assert.equal(fixture.evidenceClass, 'REAL_PROVIDER_OBSERVATION');
  assert.match(fixture.captureMethod, /GitHub connector read-only/i);
  assert.match(fixture.captureMethod, /no Domain OS status inferred/i);
  assert.equal(fixture.controllerAttestations.length, 0);
  assert.equal(fixture.observations.length, 4);
});

test('M2.6 current exact GitHub heads remain read-only and Domain status stays unknown without attestations', () => {
  const rows = observations();
  assert.deepEqual(rows.map((row) => row.projectId).sort(), ['aiexe', 'tradeos', 'trainingos', 'video-operation-shared-media']);
  assert.ok(rows.every((row) => row.readOnly === true));
  assert.ok(rows.every((row) => row.writeAuthority === 'none'));
  assert.ok(rows.every((row) => row.source.freshness.state === 'current'));
  assert.ok(rows.every((row) => row.snapshot.status === 'unknown'));
  assert.ok(rows.every((row) => row.snapshot.owner === null));
  assert.ok(rows.every((row) => row.snapshot.milestone === null));
  assert.ok(rows.every((row) => row.snapshot.attentionSignals.includes('domain_status_unknown')));
  assert.ok(rows.every((row) => row.snapshot.attentionSignals.includes('owner_unknown')));
});

test('M2.6 live capture fails closed through the management cycle when no current Controller attestations exist', () => {
  const cycle = buildReadOnlyManagementObservationCycle({
    portfolioId: 'group-portfolio',
    observedAt: fixture.capturedAt,
    githubObservations: observations(),
    controllerAttestations: [],
  });
  assert.equal(cycle.projectCount, fixture.expected.projectCount);
  assert.equal(cycle.attestedProjectCount, fixture.expected.attestedProjectCount);
  assert.deepEqual(cycle.unresolvedProjectIds, fixture.expected.unresolvedProjectIds);
  assert.equal(cycle.readOnly, true);
  assert.equal(cycle.writeAuthority, 'none');
  assert.equal(cycle.llmFactGenerationAllowed, false);
  assert.equal(cycle.providerFetchPerformed, fixture.expected.providerRunnerProven);
  assert.equal(cycle.scheduledRuntimeStarted, fixture.expected.scheduledRuntimeProven);
  assert.ok(cycle.portfolio.projects.every((project) => project.status === 'unknown'));
  assert.ok(cycle.packets.every((packet) => packet.proposal.type === 'escalate'));
});

test('M2.6 current Video controller document cannot silently ride forward after provider head movement', () => {
  const evidence = fixture.knownControllerEvidence.find((row) => row.projectId === 'video-operation-shared-media');
  assert.ok(evidence);
  assert.notEqual(evidence.controllerDocumentObservedMain, evidence.currentProviderHead);
  assert.equal(evidence.reusableAsCurrentDomainAttestation, false);
  assert.equal(evidence.reason, 'exact_head_mismatch');
});
