'use strict';

const { ProjectionRepository } = require('./projection-repository.cjs');
const {
  S6ApplicationService: S6PolicyApplicationService,
  boundedId,
  resourceIdentifier,
} = require('./s6-index.cjs');
const {
  createConcurrencyBudget,
  createWorkerCapacitySnapshot,
} = require('../scheduling/capacity/index.cjs');
const { createStepAttempt } = require('../orchestration/mission-orchestrator.cjs');

const PRIORITIES = new Set(['critical', 'high', 'normal', 'low']);

function workerRuntimeStatus(worker) {
  if (worker?.status === 'idle' || worker?.status === 'active') return 'eligible';
  if (worker?.status === 'draining') return 'draining';
  return 'unavailable';
}

class S6SchedulingApplicationService extends S6PolicyApplicationService {
  constructor(options = {}) {
    super(options);
    this.schedulingPriority = new ProjectionRepository({ store: this.store, projectionType: 'schedulingPriority' });
  }

  createRevision(input) {
    for (const step of input.steps || []) {
      const priority = step.priority || 'normal';
      if (!PRIORITIES.has(priority)) throw new Error(`Invalid S6 scheduling priority: ${priority}`);
    }
    const result = super.createRevision(input);
    for (const step of input.steps || []) {
      const priority = step.priority || 'normal';
      const id = boundedId('schedpriority', result.plan.id, step.id);
      const candidate = Object.freeze({
        id,
        workspaceId: input.workspaceId,
        planId: result.plan.id,
        stepId: step.id,
        priority,
      });
      const existing = this.schedulingPriority.get(id);
      if (existing) {
        if (existing.workspaceId !== candidate.workspaceId
          || existing.planId !== candidate.planId
          || existing.stepId !== candidate.stepId
          || existing.priority !== candidate.priority) {
          throw new Error(`Scheduling priority idempotency collision: ${id}`);
        }
      } else {
        this.schedulingPriority.save(candidate, 'scheduling.priority_bound');
      }
    }
    return result;
  }

  sourceRecordForStep({ workspaceId, run, step }) {
    const record = super.sourceRecordForStep({ workspaceId, run, step });
    const priority = this.schedulingPriority.list().find((item) => (
      item.workspaceId === workspaceId
      && item.planId === run.planId
      && item.stepId === step.id
    ));
    const binding = this.stepBinding.get(step.bindingId);
    const providerSurfaceResource = binding?.target
      ? resourceIdentifier({ type: 'provider_surface', key: binding.target })
      : null;
    const requiredResources = [...new Set([
      ...(record.requiredResources || []),
      ...(providerSurfaceResource ? [providerSurfaceResource] : []),
    ])];
    return Object.freeze({
      ...record,
      priority: priority?.priority || record.priority || 'normal',
      requiredResources,
      // A canonical ready step may declare a future action HumanGate. That is
      // schedulable because S2/S1 will create the gate before execution. An
      // already waiting_human step is still excluded by readyState itself.
      humanGateClear: record.readyState === 'ready' && record.executionIdentityCurrent === true,
    });
  }

  safeWorkerSnapshots(workspaceId) {
    const lockedWorkerIds = new Set(this.locks.list()
      .filter((lock) => lock.resourceType === 'browser_profile')
      .map((lock) => lock.resourceKey));
    const bindings = this.workerBinding.list().filter((item) => item.workspaceId === workspaceId);
    const liveById = new Map(this.workerManager.list().map((item) => [item.id, item]));
    return Object.freeze(bindings.map((binding) => {
      const live = liveById.get(binding.id) || null;
      const locked = lockedWorkerIds.has(binding.id);
      const browserChannel = ['chrome', 'chromium'].includes(live?.browserChannel)
        ? live.browserChannel
        : (['chrome', 'chromium'].includes(binding.browserChannel) ? binding.browserChannel : 'chromium');
      return createWorkerCapacitySnapshot({
        workerId: binding.id,
        workspaceId,
        status: locked ? 'unavailable' : workerRuntimeStatus(live),
        browserChannel,
        activeAssignmentCount: locked ? 1 : 0,
        reusableSession: !locked && (live?.status === 'idle' || live?.status === 'active'),
        safeCompatibilityKeys: [`profile-worker-${binding.id}`],
      });
    }));
  }

  concurrencyBudgets(workspaceId, policy) {
    const globalAssignedWorkers = new Set();
    const workspaceAssignedWorkers = new Set();

    // Browser processes/sessions are capacity supply, not assignment demand.
    // S1 browser_profile locks are the canonical reservation signal for work
    // that has already consumed a scheduling slot, including waiting_human.
    for (const lock of this.locks.list()) {
      if (lock.resourceType !== 'browser_profile') continue;
      globalAssignedWorkers.add(lock.resourceKey);
      if (lock.workspaceId === workspaceId) workspaceAssignedWorkers.add(lock.resourceKey);
    }

    const observedAt = this.clock();
    return Object.freeze({
      globalBudget: createConcurrencyBudget({
        id: boundedId('budget-global', policy.id, observedAt),
        scope: 'global',
        maxActive: policy.globalMaxActive,
        activeObserved: globalAssignedWorkers.size,
        status: 'current',
        observedAt,
      }),
      workspaceBudget: createConcurrencyBudget({
        id: boundedId('budget-workspace', workspaceId, policy.id, observedAt),
        workspaceId,
        scope: 'workspace',
        maxActive: policy.workspaceMaxActive,
        activeObserved: workspaceAssignedWorkers.size,
        status: 'current',
        observedAt,
      }),
    });
  }

  evaluateRun(runId) {
    let run = this.require(this.missionRun, runId, 'Mission run');
    if (run.state !== 'running') return run;
    const policy = this.activeSchedulingPolicy(run.workspaceId);
    if (!policy) return super.evaluateRun(runId);

    while (this.missionRun.get(runId)?.state === 'running') {
      const plan = this.require(this.executionPlan, run.planId, 'Execution plan');
      const liveState = this.queryMissionState(run.workspaceId);
      const readPlan = liveState.plans.find((item) => item.id === plan.id);
      const readyStepIds = new Set((readPlan?.steps || []).filter((step) => step.state === 'ready').map((step) => step.id));
      if (readyStepIds.size === 0) break;

      const computed = this.computeSchedulingDecisionForWorkspace({ workspaceId: run.workspaceId });
      if (!computed.proposal) break;
      const accepted = this.revalidateSchedulingProposal({
        workspaceId: run.workspaceId,
        proposalId: computed.proposal.id,
      });
      if (accepted.state !== 'accepted') break;

      const sourceRecord = computed.inputs.sourceRecords.find((item) => item.id === accepted.candidateId);
      if (!sourceRecord || !readyStepIds.has(sourceRecord.sourceId)) break;
      const step = plan.steps.find((item) => item.id === sourceRecord.sourceId);
      if (!step || this.latestAttempt(runId, step.id)) break;

      const attempt = this.stepAttempt.save(createStepAttempt({
        run: this.missionRun.get(runId),
        step,
        attemptNumber: 1,
        createdAt: this.clock(),
      }), 'step.attempt_created');
      this.appendS2Event({
        type: 'step.attempt_created',
        workspaceId: run.workspaceId,
        aggregateType: 'stepAttempt',
        aggregateId: attempt.id,
        idempotencyKey: `step.attempt_created:${attempt.id}`,
        payload: {
          missionRunId: runId,
          stepId: step.id,
          schedulingDecisionId: computed.decision.id,
          assignmentProposalId: accepted.id,
          selectedWorkerId: accepted.workerId,
        },
      });

      if (step.executionMode === 'local') {
        this.executeLocalAttempt(attempt, step, plan);
      } else {
        const scheduledStep = Object.freeze({ ...step, workerId: accepted.workerId });
        this.scheduleExternalAttempt(attempt, scheduledStep);
      }
      run = this.missionRun.get(runId);
    }

    this.maybeCompleteMission(runId);
    return this.missionRun.get(runId);
  }
}

module.exports = {
  S6ApplicationService: S6SchedulingApplicationService,
  S6SchedulingApplicationService,
};
