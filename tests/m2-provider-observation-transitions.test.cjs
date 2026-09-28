'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  buildRepeatedReadOnlyProviderEvidence,
  digestBody,
} = require('../src/management/portfolio/repeated-provider-ingestion.cjs');
const {
  buildProviderObservationTransitions,
} = require('../src/management/portfolio/provider-observation-transitions.cjs');

function fixture(name) {
  return readFileSync(join(__dirname, '..', 'fixtures', 'management', name), 'utf8');
}

const firstBody = fixture('m2-live-github-observation-capture-2026-08-09.json');
const secondBody = fixture('m2-live-github-observation-capture-2026-08-10.json');
const thirdBody = fixture('m2-live-github-observation-capture-2026-08-10-cycle3.json');

function run(body, name, capturedAt, evaluatedAt, ingestedAt) {
  return {
    runId: `provider-run-${capturedAt}`,
    captureSource: {
      body,
      sourceRef: `github:moseszhu999/ai_exe_os:fixture:${name}`,
      sourceDigest: digestBody(body),
    },
    attestationSources: [],
    evaluatedAt,
    ingestedAt,
  };
}

function threeRunEvidence() {
  return buildRepeatedReadOnlyProviderEvidence({
    runs: [
      run(firstBody, 'm2-live-github-observation-capture-2026-08-09.json', '2026-08-09T15:31:29Z', '2026-08-09T15:56:00Z', '2026-08-09T15:57:00Z'),
      run(secondBody, 'm2-live-github-observation-capture-2026-08-10.json', '2026-08-09T22:58:48Z', '2026-08-09T22:59:10Z', '2026-08-09T23:00:00Z'),
      run(thirdBody, 'm2-live-github-observation-capture-2026-08-10-cycle3.json', '2026-08-09T23:16:39Z', '2026-08-09T23:17:00Z', '2026-08-09T23:17:30Z'),
    ],
    minimumSpacingSeconds: 60,
  });
}

test('M2.9 third real capture records actual TrainingOS and Shared Media main transitions', () => {
  const capture = JSON.parse(thirdBody);
  assert.equal(capture.capturedAt, '2026-08-09T23:16:39Z');
  assert.equal(capture.expected.headTransitionObservedSincePreviousCapture, true);
  assert.deepEqual(capture.expected.headTransitionProjectIds, ['trainingos', 'video-operation-shared-media']);
  assert.equal(capture.expected.openPullRequestCounts.aiexe, 1);
  assert.equal(capture.expected.openPullRequestCounts.trainingos, 4);
  assert.equal(capture.expected.openPullRequestCounts.tradeos, 14);
  assert.equal(capture.expected.openPullRequestCounts['video-operation-shared-media'], 1);

  const training = capture.observations.find((row) => row.projectId === 'trainingos');
  const media = capture.observations.find((row) => row.projectId === 'video-operation-shared-media');
  assert.equal(training.headSha, 'd75d7cb9c0c3ab6c0af3e2df147ac3f8aeecd5fc');
  assert.equal(training.openPullRequests.some((pr) => pr.number === 674), false);
  assert.equal(media.headSha, '9e3391d8d0eea52004026c5643370c72ba0506cb');
  assert.equal(media.openPullRequests.some((pr) => pr.number === 112), true);
});

test('M2.9 three real provider cycles distinguish stable and changed head intervals without claiming scheduled runtime', () => {
  const repeated = threeRunEvidence();
  assert.equal(repeated.runCount, 3);
  assert.equal(repeated.multiRunIngestionObserved, true);
  assert.equal(repeated.stableDefaultBranchHeadsAcrossRuns, false);
  assert.equal(repeated.openWorkChangedAcrossRuns, true);
  assert.equal(repeated.recurringIngestionProven, false);
  assert.equal(repeated.scheduledRuntimeStarted, false);
  assert.equal(repeated.scheduledRuntimeProven, false);

  const transitions = buildProviderObservationTransitions(repeated);
  assert.equal(transitions.schema, 'aiexe.provider-observation-head-transitions.v1');
  assert.equal(transitions.evidenceClass, 'REAL_PROVIDER_HEAD_TRANSITION_EVIDENCE');
  assert.equal(transitions.runCount, 3);
  assert.equal(transitions.transitionCount, 2);
  assert.equal(transitions.changedTransitionCount, 1);
  assert.equal(transitions.headChangedAcrossRuns, true);
  assert.deepEqual(transitions.changedProjectIds, ['trainingos', 'video-operation-shared-media']);
  assert.equal(transitions.readOnly, true);
  assert.equal(transitions.writeAuthority, 'none');
  assert.equal(transitions.domainTruthInferred, false);

  assert.equal(transitions.transitions[0].headChanged, false);
  assert.deepEqual(transitions.transitions[0].changes, []);
  assert.equal(transitions.transitions[1].headChanged, true);
  assert.deepEqual(transitions.transitions[1].changes, [
    {
      projectId: 'trainingos',
      fromHeadSha: '0b69d1d7ad2c67c4ba36294ec153280c3da69352',
      toHeadSha: 'd75d7cb9c0c3ab6c0af3e2df147ac3f8aeecd5fc',
    },
    {
      projectId: 'video-operation-shared-media',
      fromHeadSha: '24996407449df28b2d83fce1a145b3200fff168a',
      toHeadSha: '9e3391d8d0eea52004026c5643370c72ba0506cb',
    },
  ]);
});

test('M2.9 transition evidence rejects a spoofed project-head set', () => {
  const repeated = threeRunEvidence();
  const spoofed = {
    ...repeated,
    runs: repeated.runs.map((row, index) => index === 2 ? {
      ...row,
      heads: row.heads.filter((head) => head.projectId !== 'tradeos'),
    } : row),
  };
  assert.throws(() => buildProviderObservationTransitions(spoofed), /project head set changed/);
});
