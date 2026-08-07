'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOperatorCockpitSnapshot } = require('../src/operator-console/read-model/operator-cockpit.cjs');
const { createEvidenceLineage } = require('../src/operator-console/explanation/lineage.cjs');

function state() {
  return {
    workspaces: [{ id: 'workspace-a', name: 'A' }, { id: 'workspace-b', name: 'B' }],
    missions: [{ id: 'mission-a', workspaceId: 'workspace-a', title: 'Mission A' }],
    plans: [{ id: 'plan-a', workspaceId: 'workspace-a', steps: [{ id: 'step-a', name: 'Step A', state: 'blocked', blockers: [{ code: 'dependency_unsatisfied' }] }] }],
    missionRuns: [{ id: 'run-a', workspaceId: 'workspace-a', missionId: 'mission-a', missionRevisionId: 'rev-a', planId: 'plan-a', state: 'running' }],
    stepAttempts: [{ id: 'attempt-a', workspaceId: 'workspace-a', missionRunId: 'run-a', stepId: 'step-a', attemptNumber: 1, state: 'waiting_human', executionRunId: 'exec-a' }],
    humanGates: [{ id: 'gate-a', workspaceId: 'workspace-a', state: 'requested', token: 'should-redact' }],
    evidence: [{ id: 'ev-a', workspaceId: 'workspace-a', missionRunId: 'run-a', type: 'test' }],
    missionEvents: [{ id: 'event-a', workspaceId: 'workspace-a', eventType: 'mission.run_started' }],
    s1: {
      projects: [{ id: 'project-a', workspaceId: 'workspace-a' }],
      workerBindings: [{ id: 'worker-a', workspaceId: 'workspace-a' }, { id: 'worker-b', workspaceId: 'workspace-b' }],
      agents: [{ id: 'agent-a', workspaceId: 'workspace-a' }],
      installations: [{ id: 'install-a', workspaceId: 'workspace-a' }],
      providerSnapshots: [{ id: 'provider-a', workspaceId: 'workspace-a', authorization: 'Bearer abcdefghijklmnop' }],
      humanGates: [],
    },
  };
}

test('cockpit derives one Workspace and redacts raw Worker/profile/process/secret fields', () => {
  const snapshot = createOperatorCockpitSnapshot({
    workspaceId: 'workspace-a',
    missionState: state(),
    githubState: {
      repositories: [{ id: 'repo-a', workspaceId: 'workspace-a' }, { id: 'repo-b', workspaceId: 'workspace-b' }],
      pullRequestBindings: [], deliveryGates: [], deliveryEvidence: [],
    },
    workers: [
      { id: 'worker-a', projectId: 'project-a', role: 'implementation', browserChannel: 'chrome', status: 'idle', profilePath: '/secret/profile', processId: 1234 },
      { id: 'worker-b', projectId: 'project-b', role: 'review', browserChannel: 'chromium', status: 'idle', profilePath: '/other/profile', processId: 5678 },
    ],
  });
  assert.equal(snapshot.found, true);
  assert.deepEqual(snapshot.workers.map((item) => item.workerId), ['worker-a']);
  assert.deepEqual(snapshot.github.repositories.map((item) => item.id), ['repo-a']);
  assert.equal(snapshot.humanGates[0].token, '[redacted]');
  assert.equal(snapshot.providerSnapshots[0].authorization, '[redacted]');
  assert.doesNotMatch(JSON.stringify(snapshot), /secret\/profile|processId|1234/);
});

test('unknown explicit Workspace fails closed instead of falling back', () => {
  const snapshot = createOperatorCockpitSnapshot({ workspaceId: 'workspace-missing', missionState: state(), workers: [{ id: 'worker-a', workspaceId: 'workspace-a' }] });
  assert.equal(snapshot.found, false);
  assert.equal(snapshot.workspace, null);
  assert.deepEqual(snapshot.missions, []);
  assert.deepEqual(snapshot.workers, []);
  assert.deepEqual(snapshot.humanGates, []);
});

test('mission summary preserves exact step blocker state without inventing execution state', () => {
  const snapshot = createOperatorCockpitSnapshot({ workspaceId: 'workspace-a', missionState: state(), workers: [] });
  assert.equal(snapshot.missions[0].runId, 'run-a');
  assert.equal(snapshot.missions[0].steps[0].state, 'blocked');
  assert.equal(snapshot.missions[0].steps[0].blockers[0].code, 'dependency_unsatisfied');
  assert.equal(snapshot.missions[0].steps[0].latestAttemptId, 'attempt-a');
});

test('evidence lineage links attention to attempt/run/execution and human gate', () => {
  const missionState = state();
  const lineage = createEvidenceLineage({
    attentionItem: { id: 'attention-a', code: 'human_gate_required', stepAttemptId: 'attempt-a', humanGateId: 'gate-a', evidenceIds: ['ev-a'], eventIds: ['event-a'] },
    missionState,
  });
  assert.equal(lineage.available, true);
  assert.ok(lineage.nodes.some((item) => item.kind === 'stepAttempt' && item.id === 'attempt-a'));
  assert.ok(lineage.nodes.some((item) => item.kind === 'missionRun' && item.id === 'run-a'));
  assert.ok(lineage.nodes.some((item) => item.kind === 'executionRun' && item.id === 'exec-a'));
  assert.ok(lineage.nodes.some((item) => item.kind === 'humanGate' && item.id === 'gate-a'));
  assert.ok(lineage.nodes.some((item) => item.kind === 'evidence' && item.id === 'ev-a'));
});

test('missing provenance is explicit and never fabricated', () => {
  const lineage = createEvidenceLineage({ attentionItem: { id: 'attention-x', code: 'unknown' }, missionState: {}, githubState: {} });
  assert.equal(lineage.available, false);
  assert.equal(lineage.missingProvenance, true);
  assert.equal(lineage.nodes.length, 1);
  assert.equal(lineage.edges.length, 0);
});
