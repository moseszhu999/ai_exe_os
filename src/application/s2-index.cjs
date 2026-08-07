'use strict';

const base = require('./s2-application-service.cjs');
const { canonicalDigest } = require('../checkpoint/mission-checkpoint.cjs');

class S2ApplicationService extends base.S2ApplicationService {
  retryStepAfterReview(input) {
    if (input?.reviewed !== true) throw new Error('Explicit human review is required before retry');
    const run = this.requireRunInWorkspace(input.runId, input.workspaceId);
    const previous = this.require(this.stepAttempt, input.previousAttemptId, 'Previous StepAttempt');
    if (previous.missionRunId !== run.id) throw new Error('StepAttempt does not belong to MissionRun');
    const recoverableWaiting = previous.state === 'waiting_human' && !!previous.recoveryReason;
    if (!recoverableWaiting && !['recovery_required', 'failed', 'cancelled'].includes(previous.state)) {
      throw new Error('Previous StepAttempt is not safely contained for retry');
    }
    this.reconcileReviewedExternalAttempt(previous);
    return super.retryStepAfterReview(input);
  }

  reconcileReviewedExternalAttempt(previous) {
    if (!previous?.executionRunId) return Object.freeze({ changed: false, released: [] });
    const priorRun = this.executionRun.get(previous.executionRunId);
    if (!priorRun) return Object.freeze({ changed: false, released: [] });
    if (!priorRun.recoveryReason && !['cancelled', 'failed'].includes(priorRun.state)) {
      throw new Error('External execution is not recovery-contained for reviewed retry');
    }
    if (priorRun.recoveryReason === 'reviewed_retry_superseded') {
      return Object.freeze({ changed: false, released: [] });
    }
    const released = this.locks.releaseAll(priorRun.id, this.clock());
    if (released.length) {
      this.events.append({
        type: 'resource.released',
        idempotencyKey: `release:${priorRun.id}`,
        runId: priorRun.id,
        locks: released,
      });
    }
    const superseded = this.executionRun.save({
      ...priorRun,
      state: 'cancelled',
      recoveryReason: 'reviewed_retry_superseded',
      completedAt: this.clock(),
    }, 'execution.reviewed_for_retry');
    const task = this.task.get(priorRun.taskId);
    if (task) {
      this.task.save({
        ...task,
        state: 'cancelled',
        blockers: [{ code: 'recovery_reviewed_retry_created' }],
      }, 'execution.reviewed_for_retry');
    }
    this.events.append({
      type: 'execution.reviewed_for_retry',
      idempotencyKey: `reviewed-retry:${priorRun.id}`,
      runId: priorRun.id,
      priorRecoveryReason: priorRun.recoveryReason,
    });
    return Object.freeze({ changed: true, run: superseded, released });
  }

  recordCheckpoint(input) {
    if (input?.id) {
      const existing = this.missionCheckpoint.get(input.id);
      if (existing) {
        const run = this.requireRunInWorkspace(input.runId, input.workspaceId);
        if (existing.missionRunId !== run.id || existing.workspaceId !== run.workspaceId) {
          throw new Error(`Mission checkpoint idempotency collision: ${input.id}`);
        }
        const projectionDigest = canonicalDigest(this.missionProjectionState(run.id));
        if (existing.projectionDigest !== projectionDigest) {
          throw new Error(`Mission checkpoint idempotency collision: ${input.id}`);
        }
        return existing;
      }
    }
    return super.recordCheckpoint(input);
  }
}

module.exports = {
  ...base,
  S2ApplicationService,
};
