'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateAttention } = require('../src/operator-console/attention/attention-inbox.cjs');

function state() {
  return {
    workspaces: [{ id: 'workspace-a' }, { id: 'workspace-b' }],
    humanGates: [{ id: 'gate-a', workspaceId: 'workspace-a', state: 'requested', executionRunId: 'exec-a', taskId: 'task-a' }],
    stepAttempts: [
      { id: 'attempt-a', workspaceId: 'workspace-a', missionRunId: 'run-a', executionRunId: 'exec-a', state: 'waiting_human' },
      { id: 'attempt-r', workspaceId: 'workspace-a', missionRunId: 'run-a', state: 'recovery_required', recoveryReason: 'application_restart' },
      { id: 'attempt-b', workspaceId: 'workspace-b', missionRunId: 'run-b', state: 'waiting_human' },
    ],
    missionRuns: [{ id: 'run-a', workspaceId: 'workspace-a', state: 'recovery_required', recoveryReason: 'review' }],
    plans: [{ id: 'plan-a', workspaceId: 'workspace-a', steps: [{ id: 'step-a', blockers: [{ code: 'dependency_unsatisfied', detail: { predecessor: 'step-0' } }] }] }],
    evidence: [{ id: 'evidence-a', workspaceId: 'workspace-a', executionRunId: 'exec-a' }],
    missionEvents: [{ id: 'event-r', workspaceId: 'workspace-a', aggregateId: 'attempt-r', eventType: 'step.attempt_recovery_required' }],
  };
}

test('aggregates persisted gate, waiting-human, recovery and step blockers into one deterministic inbox', () => {
  const attention = aggregateAttention({
    workspaceId: 'workspace-a',
    missionState: state(),
    githubState: {
      deliveryGates: [{ id: 'delivery-a', workspaceId: 'workspace-a', pullRequestBindingId: 'pr-a', blockers: [{ code: 'head_mismatch' }] }],
      deliveryEvidence: [{ id: 'delivery-evidence-a', workspaceId: 'workspace-a', pullRequestBindingId: 'pr-a' }],
    },
  });
  const codes = attention.map((item) => item.code);
  for (const code of ['human_gate_required', 'waiting_human', 'recovery_requires_review', 'dependency_unsatisfied', 'head_mismatch']) assert.ok(codes.includes(code), code);
  assert.equal(attention.some((item) => item.aggregateId === 'attempt-b'), false);
});

test('recovery attention is critical and retains exact provenance when available', () => {
  const attention = aggregateAttention({ workspaceId: 'workspace-a', missionState: state() });
  const recovery = attention.find((item) => item.aggregateId === 'attempt-r' && item.code === 'recovery_requires_review');
  assert.equal(recovery.severity, 'critical');
  assert.equal(recovery.detail.recoveryReason, 'application_restart');
  assert.deepEqual(recovery.eventIds, ['event-r']);
  assert.equal(recovery.provenanceAvailable, true);
});

test('human gate attention links persisted gate and evidence rather than creating approval truth', () => {
  const attention = aggregateAttention({ workspaceId: 'workspace-a', missionState: state() });
  const gate = attention.find((item) => item.code === 'human_gate_required');
  assert.equal(gate.humanGateId, 'gate-a');
  assert.equal(gate.executionRunId, 'exec-a');
  assert.deepEqual(gate.evidenceIds, ['evidence-a']);
  assert.equal(Object.hasOwn(gate, 'approved'), false);
});

test('missing provenance is explicit instead of inferred', () => {
  const attention = aggregateAttention({ workspaceId: 'workspace-a', missionState: state() });
  const blocker = attention.find((item) => item.code === 'dependency_unsatisfied');
  assert.equal(blocker.provenanceAvailable, false);
  assert.deepEqual(blocker.evidenceIds, []);
  assert.deepEqual(blocker.eventIds, []);
});

test('unknown Workspace fails closed', () => {
  assert.deepEqual(aggregateAttention({ workspaceId: 'missing', missionState: state() }), []);
});
