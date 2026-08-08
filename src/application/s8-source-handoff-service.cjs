'use strict';

const { ProjectionRepository } = require('./projection-repository.cjs');
const { S8ApplicationService: S8DelegationApplicationService, boundedId } = require('./s8-index.cjs');
const { assertJsonSafe } = require('../domain/step-output-model.cjs');
const { createStepAttempt, transitionAttempt } = require('../orchestration/mission-orchestrator.cjs');

class S8SourceHandoffApplicationService extends S8DelegationApplicationService {
  constructor(options = {}) {
    super(options);
    this.delegationSourceStepBinding = new ProjectionRepository({
      store: this.store,
      projectionType: 'delegationSourceStepBinding',
    });
  }

  validateSourceStepBindingInput(input) {
    const missionId = input?.sourceMissionId || null;
    const stepId = input?.sourcePlanStepId || null;
    if (!missionId && !stepId) return null;
    if (!missionId || !stepId) throw new Error('sourceMissionId and sourcePlanStepId must be provided together');

    const workspaceId = String(input.workspaceId || '');
    const mission = this.require(this.mission, missionId, 'Source Mission');
    if (mission.workspaceId !== workspaceId) throw new Error('Cross-Workspace source delegation denied');
    const revision = this.require(this.missionRevision, mission.currentRevisionId, 'Source Mission revision');
    if (revision.workspaceId !== workspaceId || revision.status === 'draft') throw new Error('source_mission_revision_not_ready');
    const plan = this.require(this.executionPlan, revision.planId, 'Source ExecutionPlan');
    const step = plan.steps.find((candidate) => candidate.id === stepId);
    if (!step) throw new Error('source_plan_step_not_current');
    const existingRun = this.missionRun.list().find((run) => run.missionId === mission.id && run.missionRevisionId === revision.id);
    if (existingRun) throw new Error('source_delegation_must_bind_before_mission_start');
    const occupied = this.delegationSourceStepBinding.list().find((binding) => (
      binding.workspaceId === workspaceId
      && binding.missionRevisionId === revision.id
      && binding.planId === plan.id
      && binding.stepId === step.id
    ));
    if (occupied && occupied.delegationRequestId !== input.id) throw new Error('source_plan_step_already_delegated');
    return Object.freeze({ workspaceId, mission, revision, plan, step, occupied });
  }

  createDelegationRequest(input) {
    const source = this.validateSourceStepBindingInput(input);
    const request = super.createDelegationRequest(input);
    if (!source) return request;

    const id = boundedId('delegation-source-step', request.id, source.revision.id, source.step.id);
    const candidate = Object.freeze({
      id,
      workspaceId: source.workspaceId,
      delegationRequestId: request.id,
      requestDigest: request.requestDigest,
      missionId: source.mission.id,
      missionRevisionId: source.revision.id,
      planId: source.plan.id,
      stepId: source.step.id,
      state: 'awaiting_receipt',
      createdAt: this.clock(),
    });
    const existing = this.delegationSourceStepBinding.get(id);
    if (existing) {
      if (existing.delegationRequestId !== candidate.delegationRequestId
        || existing.requestDigest !== candidate.requestDigest
        || existing.missionRevisionId !== candidate.missionRevisionId
        || existing.planId !== candidate.planId
        || existing.stepId !== candidate.stepId) {
        throw new Error(`DelegationSourceStepBinding idempotency collision: ${id}`);
      }
      return request;
    }
    this.delegationSourceStepBinding.save(candidate, 'delegation.source_step_bound');
    this.appendS8Event({
      type: 'delegation.source_step_bound',
      workspaceId: source.workspaceId,
      aggregateType: 'delegationSourceStepBinding',
      aggregateId: id,
      idempotencyKey: `delegation.source_step_bound:${id}`,
      payload: {
        delegationRequestId: request.id,
        missionId: source.mission.id,
        missionRevisionId: source.revision.id,
        planId: source.plan.id,
        stepId: source.step.id,
      },
    });
    return request;
  }

  sourceDelegationBindingsForRun(run) {
    return this.delegationSourceStepBinding.list().filter((binding) => (
      binding.workspaceId === run.workspaceId
      && binding.missionId === run.missionId
      && binding.missionRevisionId === run.missionRevisionId
      && binding.planId === run.planId
    ));
  }

  ensureDelegatedSourceAttemptsBlocked(run) {
    const plan = this.require(this.executionPlan, run.planId, 'Execution plan');
    for (const binding of this.sourceDelegationBindingsForRun(run)) {
      const step = plan.steps.find((candidate) => candidate.id === binding.stepId);
      if (!step) throw new Error('delegated source step is missing from frozen plan');
      if (this.latestAttempt(run.id, step.id)) continue;
      const ready = this.stepAttempt.save(createStepAttempt({
        run,
        step,
        attemptNumber: 1,
        createdAt: this.clock(),
      }), 'step.attempt_created');
      this.appendS2Event({
        type: 'step.attempt_created',
        workspaceId: run.workspaceId,
        aggregateType: 'stepAttempt',
        aggregateId: ready.id,
        idempotencyKey: `step.attempt_created:${ready.id}`,
        payload: {
          missionRunId: run.id,
          stepId: step.id,
          delegationRequestId: binding.delegationRequestId,
        },
      });
      const blocked = this.stepAttempt.save(Object.freeze({
        ...transitionAttempt(ready, 'blocked', 'delegation_receipt_required', this.clock()),
        blockers: Object.freeze([{ code: 'delegation_receipt_required', delegationRequestId: binding.delegationRequestId }]),
      }), 'step.attempt_blocked_for_delegation');
      this.appendS2Event({
        type: 'plan.step_blocked',
        workspaceId: run.workspaceId,
        aggregateType: 'stepAttempt',
        aggregateId: blocked.id,
        idempotencyKey: `plan.step_blocked:${blocked.id}:delegation_receipt_required`,
        payload: {
          missionRunId: run.id,
          stepId: step.id,
          delegationRequestId: binding.delegationRequestId,
          blockers: blocked.blockers,
        },
      });
    }
  }

  evaluateRun(runId) {
    const run = this.require(this.missionRun, runId, 'Mission run');
    if (run.state !== 'running') return run;
    this.ensureDelegatedSourceAttemptsBlocked(run);
    return super.evaluateRun(runId);
  }

  receiptValue(receipt, request) {
    const value = {
      kind: 'delegation-receipt',
      delegationRequestId: request.id,
      receiptDigest: receipt.receiptDigest,
      resultClass: receipt.resultClass || null,
      resultSummary: receipt.resultSummary || null,
      evidenceDigests: [...(receipt.evidenceDigests || [])],
      destinationInstanceId: receipt.destinationInstanceId || request.destinationInstanceId,
      destinationWorkspaceId: receipt.destinationWorkspaceId || request.destinationWorkspaceId,
    };
    assertJsonSafe(value);
    return Object.freeze(value);
  }

  consumeDelegationReceipt(input) {
    const workspaceId = String(input?.workspaceId || '');
    const receipt = this.delegationReceiptMirror.get(input?.receiptMirrorId);
    if (!receipt || receipt.workspaceId !== workspaceId) throw new Error('delegation_receipt_not_found');
    if (receipt.state !== 'completed') throw new Error('delegation_receipt_not_completed');
    const request = this.delegationRequest.get(receipt.delegationRequestId);
    if (!request || request.direction !== 'outbound' || request.workspaceId !== workspaceId) throw new Error('delegation_source_request_not_found');

    const sourceBinding = this.delegationSourceStepBinding.list().find((binding) => (
      binding.workspaceId === workspaceId && binding.delegationRequestId === request.id
    ));
    if (!sourceBinding) return super.consumeDelegationReceipt(input);

    const consumptionId = boundedId('delegation-receipt-consumption', request.id, receipt.receiptDigest);
    const existingConsumption = this.delegationReceiptConsumption.get(consumptionId);
    if (existingConsumption) return existingConsumption;

    const mission = this.require(this.mission, sourceBinding.missionId, 'Source Mission');
    if (mission.currentRevisionId !== sourceBinding.missionRevisionId) throw new Error('source_mission_revision_stale');
    const revision = this.require(this.missionRevision, sourceBinding.missionRevisionId, 'Source Mission revision');
    if (revision.planId !== sourceBinding.planId) throw new Error('source_plan_stale');
    const plan = this.require(this.executionPlan, sourceBinding.planId, 'Source ExecutionPlan');
    const step = plan.steps.find((candidate) => candidate.id === sourceBinding.stepId);
    if (!step) throw new Error('source_plan_step_not_current');
    const run = this.missionRun.list().find((candidate) => (
      candidate.workspaceId === workspaceId
      && candidate.missionId === mission.id
      && candidate.missionRevisionId === revision.id
      && candidate.planId === plan.id
      && ['running', 'paused'].includes(candidate.state)
    ));
    if (!run) throw new Error('source_mission_run_not_active');
    if (run.state !== 'running') throw new Error('source_mission_must_be_running_to_consume_receipt');

    this.ensureDelegatedSourceAttemptsBlocked(run);
    let attempt = this.latestAttempt(run.id, step.id);
    if (!attempt) throw new Error('source_delegated_step_attempt_missing');
    if (attempt.state === 'completed') {
      const completedConsumption = this.delegationReceiptConsumption.list().find((item) => (
        item.workspaceId === workspaceId
        && item.delegationRequestId === request.id
        && item.receiptDigest === receipt.receiptDigest
      ));
      if (completedConsumption) return completedConsumption;
      throw new Error('source_delegated_step_already_completed_by_other_evidence');
    }
    if (attempt.state !== 'blocked' || attempt.lastReason !== 'delegation_receipt_required') {
      throw new Error('source_delegated_step_not_waiting_for_receipt');
    }

    const ready = this.stepAttempt.save(Object.freeze({
      ...transitionAttempt(attempt, 'ready', 'delegation receipt explicitly consumed', this.clock()),
      blockers: Object.freeze([]),
    }), 'step.attempt_delegation_receipt_ready');
    const active = this.stepAttempt.save(transitionAttempt(ready, 'active', 'delegation receipt handoff', this.clock()), 'step.attempt_started');
    const value = this.receiptValue(receipt, request);
    this.recordOutputsAndEvidence({ attempt: active, step, value });
    const completed = this.stepAttempt.save(transitionAttempt(active, 'completed', 'delegation receipt consumed', this.clock()), 'step.attempt_completed');
    this.appendS2Event({
      type: 'step.attempt_completed',
      workspaceId,
      aggregateType: 'stepAttempt',
      aggregateId: completed.id,
      idempotencyKey: `step.attempt_completed:${completed.id}`,
      payload: {
        stepId: completed.stepId,
        delegationRequestId: request.id,
        receiptDigest: receipt.receiptDigest,
        delegated: true,
      },
    });
    this.recordHandoffsForCompletedAttempt(completed, step, plan);

    const consumption = this.delegationReceiptConsumption.save({
      id: consumptionId,
      workspaceId,
      delegationRequestId: request.id,
      receiptMirrorId: receipt.id,
      receiptDigest: receipt.receiptDigest,
      sourceMissionId: mission.id,
      sourceMissionRevisionId: revision.id,
      sourcePlanId: plan.id,
      sourcePlanStepId: step.id,
      sourceStepAttemptId: completed.id,
      state: 'consumed_once',
      consumedAt: this.clock(),
    }, 'delegation.receipt_consumed');
    this.delegationSourceStepBinding.save({
      ...sourceBinding,
      state: 'receipt_consumed',
      receiptDigest: receipt.receiptDigest,
      sourceStepAttemptId: completed.id,
      consumedAt: consumption.consumedAt,
    }, 'delegation.source_step_completed');
    this.appendS8Event({
      type: 'delegation.receipt_consumed',
      workspaceId,
      aggregateType: 'delegationReceiptConsumption',
      aggregateId: consumption.id,
      idempotencyKey: `delegation.receipt_consumed:${consumption.id}`,
      payload: {
        delegationRequestId: request.id,
        receiptDigest: receipt.receiptDigest,
        sourceMissionId: mission.id,
        sourceMissionRevisionId: revision.id,
        sourcePlanId: plan.id,
        sourcePlanStepId: step.id,
        sourceStepAttemptId: completed.id,
      },
    });
    this.evaluateRun(run.id);
    return consumption;
  }

  queryDelegationState(workspaceId) {
    const state = super.queryDelegationState(workspaceId);
    if (!state.found) return Object.freeze({ ...state, sourceStepBindings: [] });
    return Object.freeze({
      ...state,
      sourceStepBindings: this.delegationSourceStepBinding.list()
        .filter((item) => item.workspaceId === workspaceId)
        .map((item) => {
          const { _revision, ...rest } = item;
          return Object.freeze(rest);
        }),
    });
  }
}

module.exports = {
  S8ApplicationService: S8SourceHandoffApplicationService,
  S8SourceHandoffApplicationService,
};
