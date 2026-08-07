'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createStepAttempt,
  deriveReadySet,
  evaluateMissionCompletion,
  markExternalStart,
  recoverUncertainAttempts,
  retryAfterReview,
  transitionAttempt,
  transitionRun,
} = require('../src/orchestration/mission-orchestrator.cjs');
const { createMissionCheckpoint, verifyMissionCheckpoint } = require('../src/checkpoint/mission-checkpoint.cjs');

const run = Object.freeze({ id: 'mission-run-1', workspaceId: 'workspace-a', state: 'running', version: 1 });
const steps = Object.freeze([
  Object.freeze({ id: 'step-a', dependsOn: [], declaredInputs: [], evidenceRequirements: ['evidence-a'], resourceRequirements: [] }),
  Object.freeze({ id: 'step-b', dependsOn: [], declaredInputs: [], evidenceRequirements: ['evidence-b'], resourceRequirements: [] }),
  Object.freeze({ id: 'step-c', dependsOn: ['step-a', 'step-b'], declaredInputs: ['input-a', 'input-b'], evidenceRequirements: ['evidence-final'], resourceRequirements: [] }),
]);
const plan = Object.freeze({ id: 'plan-a', terminalStepIds: ['step-c'], steps });

function completed(stepId, attemptNumber = 1) {
  return Object.freeze({ ...createStepAttempt({ run, step: { id: stepId }, attemptNumber }), state: 'completed' });
}

test('two independent root steps are ready concurrently', () => {
  const result = deriveReadySet({ run, plan, attempts: [], handoffs: [] });
  assert.deepEqual(result.ready, ['step-a', 'step-b']);
  assert.equal(result.blocked.find((item) => item.stepId === 'step-c').blockers.some((item) => item.code === 'dependency_unsatisfied'), true);
});

test('resource conflict blocks only the conflicting branch', () => {
  const result = deriveReadySet({
    run, plan, attempts: [], handoffs: [],
    resourceConflictForStep(step) { return step.id === 'step-a' ? { resource: 'browser-profile-a' } : null; },
  });
  assert.deepEqual(result.ready, ['step-b']);
  assert.deepEqual(result.blocked.find((item) => item.stepId === 'step-a').blockers.map((item) => item.code), ['resource_conflict']);
});

test('downstream step requires both completed dependencies and declared handoffs', () => {
  const attempts = [completed('step-a'), completed('step-b')];
  let result = deriveReadySet({ run, plan, attempts, handoffs: [] });
  assert.deepEqual(result.ready, []);
  assert.equal(result.blocked.find((item) => item.stepId === 'step-c').blockers.filter((item) => item.code === 'step_output_missing').length, 2);
  result = deriveReadySet({ run, plan, attempts, handoffs: [
    { toStepId: 'step-c', inputName: 'input-a' },
    { toStepId: 'step-c', inputName: 'input-b' },
  ] });
  assert.deepEqual(result.ready, ['step-c']);
});

test('pause is a scheduling barrier and resume restores only ready work', () => {
  const paused = transitionRun(run, 'paused', 'operator pause');
  const blocked = deriveReadySet({ run: paused, plan, attempts: [], handoffs: [] });
  assert.deepEqual(blocked.ready, []);
  assert.equal(blocked.blocked.every((item) => item.blockers.some((blocker) => blocker.code === 'mission_paused') || item.stepId === 'step-c'), true);
  const resumed = transitionRun(paused, 'running', 'operator resume');
  assert.deepEqual(deriveReadySet({ run: resumed, plan, attempts: [], handoffs: [] }).ready, ['step-a', 'step-b']);
});

test('cancel prevents future starts and remains terminal', () => {
  const cancelled = transitionRun(run, 'cancelled', 'operator cancel');
  const result = deriveReadySet({ run: cancelled, plan, attempts: [], handoffs: [] });
  assert.deepEqual(result.ready, []);
  assert.throws(() => transitionRun(cancelled, 'running', 'illegal resume'), /Invalid S2 MissionRun transition/);
});

test('external effect start is exactly-once for one StepAttempt', () => {
  const attempt = createStepAttempt({ run, step: steps[0] });
  const active = markExternalStart(attempt, 'execution-run-a');
  const repeated = markExternalStart(active, 'execution-run-a');
  assert.equal(active.externalStartCommitted, true);
  assert.equal(repeated, active);
  assert.equal(active.executionRunId, 'execution-run-a');
});

test('crash contains active attempt and explicit retry receives a new identity', () => {
  const attempt = markExternalStart(createStepAttempt({ run, step: steps[0] }), 'execution-run-a');
  const [recovered] = recoverUncertainAttempts([attempt], '2026-08-07T01:00:00.000Z');
  assert.equal(recovered.state, 'recovery_required');
  assert.match(recovered.recoveryReason, /requires_review/);
  assert.throws(() => retryAfterReview({ previousAttempt: recovered, run, step: steps[0], reviewed: false }), /human review/);
  const retried = retryAfterReview({ previousAttempt: recovered, run, step: steps[0], reviewed: true });
  assert.equal(retried.attemptNumber, 2);
  assert.notEqual(retried.id, recovered.id);
  assert.equal(retried.externalStartCommitted, false);
});

test('contained failed or recovery attempt is not silently auto-retried by ready-set', () => {
  const failed = transitionAttempt(createStepAttempt({ run, step: steps[0] }), 'active', 'start');
  const terminal = transitionAttempt(failed, 'failed', 'failed');
  const result = deriveReadySet({ run, plan, attempts: [terminal], handoffs: [] });
  assert.equal(result.ready.includes('step-a'), false);
  assert.equal(result.blocked.find((item) => item.stepId === 'step-a').blockers.some((item) => item.code === 'recovery_requires_review'), true);
});

test('mission completion requires terminal completion and declared terminal evidence', () => {
  const attempts = [completed('step-a'), completed('step-b'), completed('step-c')];
  let verdict = evaluateMissionCompletion({ run, plan, attempts, terminalEvidenceByStep: { 'step-c': [] } });
  assert.equal(verdict.complete, false);
  assert.equal(verdict.blockers[0].code, 'terminal_evidence_unsatisfied');
  verdict = evaluateMissionCompletion({ run, plan, attempts, terminalEvidenceByStep: { 'step-c': ['evidence-final'] } });
  assert.equal(verdict.complete, true);
});

test('checkpoint validates canonical sequence and projection digest', () => {
  const projectionState = { run: { state: 'running' }, attempts: [{ id: 'attempt-a', state: 'completed' }] };
  const checkpoint = createMissionCheckpoint({ id: 'checkpoint-1', workspaceId: 'workspace-a', missionRunId: run.id, canonicalEventSequence: 42, projectionState, readyStepIds: ['step-b'], activeAttemptIds: [], recoveryRequiredAttemptIds: [] });
  assert.equal(verifyMissionCheckpoint(checkpoint, { canonicalEventSequence: 42, projectionState }).valid, true);
  const mismatch = verifyMissionCheckpoint(checkpoint, { canonicalEventSequence: 43, projectionState: { ...projectionState, changed: true } });
  assert.equal(mismatch.valid, false);
  assert.deepEqual(mismatch.blockers.map((item) => item.code), ['checkpoint_sequence_mismatch', 'checkpoint_projection_mismatch']);
});
