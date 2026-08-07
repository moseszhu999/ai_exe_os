'use strict';

const { createHash } = require('node:crypto');

const TERMINAL_ATTEMPT_STATES = new Set(['completed', 'cancelled', 'failed']);

function semanticAttemptId(runId, stepId, attemptNumber) {
  const digest = createHash('sha256').update(`${runId}:${stepId}:${attemptNumber}`).digest('hex').slice(0, 20);
  return `attempt-${digest}`;
}

function latestAttempt(attempts, stepId) {
  return attempts.filter((attempt) => attempt.stepId === stepId).sort((a, b) => b.attemptNumber - a.attemptNumber)[0] || null;
}

function completedAttempt(attempts, stepId) {
  return attempts.find((attempt) => attempt.stepId === stepId && attempt.state === 'completed') || null;
}

function handoffExists(handoffs, stepId, inputName) {
  return handoffs.some((handoff) => handoff.toStepId === stepId && handoff.inputName === inputName);
}

function declaredName(entry) { return typeof entry === 'string' ? entry : entry?.name; }

function deriveReadySet({ run, plan, attempts = [], handoffs = [], resourceConflictForStep = () => null }) {
  if (!run || !plan) throw new TypeError('run and plan are required');
  const ready = [];
  const blocked = [];
  const barrier = run.state === 'paused' ? 'mission_paused' : run.state === 'cancelled' ? 'mission_cancelled' : null;
  for (const step of [...plan.steps].sort((a, b) => a.id.localeCompare(b.id))) {
    if (completedAttempt(attempts, step.id)) continue;
    const current = latestAttempt(attempts, step.id);
    const blockers = [];
    if (current && ['failed', 'cancelled'].includes(current.state)) blockers.push({ code: 'recovery_requires_review', previousAttemptId: current.id });
    else if (current && !TERMINAL_ATTEMPT_STATES.has(current.state)) continue;
    if (barrier) blockers.push({ code: barrier });
    else if (run.state !== 'running') blockers.push({ code: 'mission_not_running' });
    for (const dependencyId of step.dependsOn || []) {
      if (!completedAttempt(attempts, dependencyId)) blockers.push({ code: 'dependency_unsatisfied', dependencyStepId: dependencyId });
    }
    for (const declaredInput of step.declaredInputs || []) {
      const inputName = declaredName(declaredInput);
      if (!handoffExists(handoffs, step.id, inputName)) blockers.push({ code: 'step_output_missing', inputName });
    }
    const resourceConflict = resourceConflictForStep(step);
    if (resourceConflict) blockers.push({ code: 'resource_conflict', detail: resourceConflict });
    if (blockers.length) blocked.push(Object.freeze({ stepId: step.id, blockers: Object.freeze(blockers) }));
    else ready.push(step.id);
  }
  return Object.freeze({ ready: Object.freeze(ready), blocked: Object.freeze(blocked) });
}

function createStepAttempt({ run, step, attemptNumber = 1, createdAt = new Date().toISOString() }) {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) throw new TypeError('attemptNumber must be a positive integer');
  return Object.freeze({ id: semanticAttemptId(run.id, step.id, attemptNumber), missionRunId: run.id, workspaceId: run.workspaceId, stepId: step.id, attemptNumber, state: 'ready', executionRunId: null, recoveryReason: null, externalStartCommitted: false, createdAt, updatedAt: createdAt });
}

function transitionAttempt(attempt, nextState, reason, occurredAt = new Date().toISOString()) {
  const allowed = {
    ready: new Set(['waiting_human', 'active', 'blocked', 'cancelled']), waiting_human: new Set(['active', 'cancelled', 'recovery_required']),
    active: new Set(['completed', 'failed', 'recovery_required', 'waiting_human']), blocked: new Set(['ready', 'cancelled']),
    recovery_required: new Set(['cancelled']), completed: new Set(), failed: new Set(), cancelled: new Set(),
  };
  if (attempt.state === nextState) return attempt;
  if (!allowed[attempt.state]?.has(nextState)) throw new Error(`Invalid S2 StepAttempt transition: ${attempt.state} -> ${nextState}`);
  return Object.freeze({ ...attempt, state: nextState, lastReason: String(reason || nextState), updatedAt: occurredAt });
}

function markExternalStart(attempt, executionRunId, occurredAt = new Date().toISOString()) {
  if (!executionRunId) throw new TypeError('executionRunId is required');
  if (attempt.externalStartCommitted) {
    if (attempt.executionRunId !== executionRunId) throw new Error(`StepAttempt external-start idempotency collision: ${attempt.id}`);
    return attempt;
  }
  if (!['ready', 'waiting_human'].includes(attempt.state)) throw new Error('StepAttempt is not eligible for external start');
  return Object.freeze({ ...attempt, state: 'active', executionRunId, externalStartCommitted: true, updatedAt: occurredAt });
}

function recoverUncertainAttempts(attempts, occurredAt = new Date().toISOString()) {
  return attempts.map((attempt) => attempt.state === 'active' ? Object.freeze({ ...attempt, state: 'recovery_required', recoveryReason: 'application_recovery_requires_review', updatedAt: occurredAt }) : attempt);
}

function retryAfterReview({ previousAttempt, run, step, reviewed = false, occurredAt = new Date().toISOString() }) {
  if (!reviewed) throw new Error('Explicit human review is required before retry');
  const recoverableWaiting = previousAttempt.state === 'waiting_human' && !!previousAttempt.recoveryReason;
  if (!recoverableWaiting && !['recovery_required', 'failed', 'cancelled'].includes(previousAttempt.state)) throw new Error('Previous StepAttempt is not safely contained for retry');
  return createStepAttempt({ run, step, attemptNumber: previousAttempt.attemptNumber + 1, createdAt: occurredAt });
}

function transitionRun(run, nextState, reason, occurredAt = new Date().toISOString()) {
  const allowed = { created: new Set(['running', 'cancelled']), running: new Set(['paused', 'cancelled', 'completed', 'failed', 'recovery_required']), paused: new Set(['running', 'cancelled']), recovery_required: new Set(['running', 'cancelled', 'failed']), completed: new Set(), cancelled: new Set(), failed: new Set() };
  if (run.state === nextState) return run;
  if (!allowed[run.state]?.has(nextState)) throw new Error(`Invalid S2 MissionRun transition: ${run.state} -> ${nextState}`);
  return Object.freeze({ ...run, state: nextState, lastReason: String(reason || nextState), version: (run.version || 0) + 1, updatedAt: occurredAt });
}

function evaluateMissionCompletion({ run, plan, attempts, terminalEvidenceByStep = {} }) {
  if (run.state === 'cancelled' || run.state === 'failed') return Object.freeze({ complete: false, blockers: [{ code: `mission_${run.state}` }] });
  const blockers = [];
  for (const terminalStepId of plan.terminalStepIds) {
    if (!completedAttempt(attempts, terminalStepId)) blockers.push({ code: 'dependency_unsatisfied', terminalStepId });
    const step = plan.steps.find((candidate) => candidate.id === terminalStepId);
    const available = new Set(terminalEvidenceByStep[terminalStepId] || []);
    for (const requirement of step?.evidenceRequirements || []) if (!available.has(requirement)) blockers.push({ code: 'terminal_evidence_unsatisfied', terminalStepId, requirement });
  }
  return Object.freeze({ complete: blockers.length === 0, blockers: Object.freeze(blockers) });
}

module.exports = { createStepAttempt, deriveReadySet, evaluateMissionCompletion, markExternalStart, recoverUncertainAttempts, retryAfterReview, semanticAttemptId, transitionAttempt, transitionRun };
