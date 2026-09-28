'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  buildRepeatedReadOnlyProviderEvidence,
  digestBody,
} = require('../src/management/portfolio/repeated-provider-ingestion.cjs');

const firstBody = readFileSync(join(__dirname, '..', 'fixtures', 'management', 'm2-live-github-observation-capture-2026-08-09.json'), 'utf8');
const secondBody = readFileSync(join(__dirname, '..', 'fixtures', 'management', 'm2-live-github-observation-capture-2026-08-10.json'), 'utf8');

function firstRun() {
  return {
    runId: 'provider-run-2026-08-09T15:31:29Z',
    captureSource: {
      body: firstBody,
      sourceRef: 'github:moseszhu999/ai_exe_os:fixture:m2-live-github-observation-capture-2026-08-09.json',
      sourceDigest: digestBody(firstBody),
    },
    attestationSources: [],
    evaluatedAt: '2026-08-09T15:56:00Z',
    ingestedAt: '2026-08-09T15:57:00Z',
  };
}

function secondRun() {
  return {
    runId: 'provider-run-2026-08-09T22:58:48Z',
    captureSource: {
      body: secondBody,
      sourceRef: 'github:moseszhu999/ai_exe_os:fixture:m2-live-github-observation-capture-2026-08-10.json',
      sourceDigest: digestBody(secondBody),
    },
    attestationSources: [],
    evaluatedAt: '2026-08-09T22:59:10Z',
    ingestedAt: '2026-08-09T23:00:00Z',
  };
}

test('M2.8 corrected second capture includes the newly-created TrainingOS work visible on completeness recheck', () => {
  const capture = JSON.parse(secondBody);
  const training = capture.observations.find((row) => row.projectId === 'trainingos');
  assert.equal(capture.capturedAt, '2026-08-09T22:58:48Z');
  assert.equal(capture.expected.openPullRequestCounts.trainingos, 5);
  assert.equal(training.openPullRequests.length, 5);
  assert.equal(training.openPullRequests.some((pr) => pr.number === 674 && pr.headSha === 'acc1c03369e6b885bdf2b574e3923589c0ad5f28'), true);
  assert.match(capture.captureMethod, /completeness was rechecked/);
});

test('M2.8 two independent real provider captures prove multi-run ingestion without claiming a schedule', () => {
  const result = buildRepeatedReadOnlyProviderEvidence({
    runs: [firstRun(), secondRun()],
    minimumSpacingSeconds: 60,
  });

  assert.equal(result.schema, 'aiexe.management-repeated-provider-ingestion.v1');
  assert.equal(result.evidenceClass, 'REAL_PROVIDER_MULTI_RUN_OBSERVATION');
  assert.equal(result.providerTransport, 'external-read-only-connector');
  assert.equal(result.readOnly, true);
  assert.equal(result.writeAuthority, 'none');
  assert.equal(result.crossRepositoryCredentialRequiredByThisModule, false);
  assert.equal(result.llmFactGenerationAllowed, false);
  assert.equal(result.runCount, 2);
  assert.equal(result.multiRunIngestionObserved, true);
  assert.equal(result.stableDefaultBranchHeadsAcrossRuns, true);
  assert.equal(result.openWorkChangedAcrossRuns, true);
  assert.equal(result.recurringIngestionProven, false);
  assert.equal(result.scheduledRuntimeStarted, false);
  assert.equal(result.scheduledRuntimeProven, false);
  assert.equal(result.recurringEvidenceState, 'MULTI_RUN_REAL_PROVIDER_OBSERVED_SCHEDULE_UNPROVEN');
  assert.notEqual(result.runs[0].captureSourceDigest, result.runs[1].captureSourceDigest);
  assert.notEqual(result.runs[0].openWorkFingerprint, result.runs[1].openWorkFingerprint);
  assert.equal(result.runs[0].headsFingerprint, result.runs[1].headsFingerprint);
  assert.deepEqual(result.runs[0].unresolvedProjectIds, ['aiexe', 'tradeos', 'trainingos', 'video-operation-shared-media']);
  assert.deepEqual(result.runs[1].unresolvedProjectIds, ['aiexe', 'tradeos', 'trainingos', 'video-operation-shared-media']);
});

test('M2.8 repeated provider evidence rejects replayed capture identity, insufficient spacing and schedule spoofing', () => {
  const replayed = secondRun();
  replayed.captureSource = {
    ...firstRun().captureSource,
    sourceRef: 'github:moseszhu999/ai_exe_os:fixture:replayed-copy.json',
  };
  assert.throws(() => buildRepeatedReadOnlyProviderEvidence({
    runs: [firstRun(), replayed],
  }), /capture digests must be unique/);

  const tooClose = secondRun();
  const secondCapture = JSON.parse(secondBody);
  secondCapture.capturedAt = '2026-08-09T15:31:40Z';
  for (const observation of secondCapture.observations) {
    observation.observedAt = secondCapture.capturedAt;
    observation.now = secondCapture.capturedAt;
    observation.openPullRequestsObservedAt = secondCapture.capturedAt;
  }
  const closeBody = `${JSON.stringify(secondCapture, null, 2)}\n`;
  tooClose.captureSource = {
    body: closeBody,
    sourceRef: 'github:moseszhu999/ai_exe_os:fixture:too-close.json',
    sourceDigest: digestBody(closeBody),
  };
  tooClose.evaluatedAt = '2026-08-09T15:32:00Z';
  tooClose.ingestedAt = '2026-08-09T15:32:30Z';
  assert.throws(() => buildRepeatedReadOnlyProviderEvidence({
    runs: [firstRun(), tooClose],
    minimumSpacingSeconds: 60,
  }), /minimum repeated-run spacing/);

  assert.throws(() => buildRepeatedReadOnlyProviderEvidence({
    runs: [{ ...firstRun(), scheduledRuntimeProven: true }, secondRun()],
  }), /unsupported field: scheduledRuntimeProven/);
});
