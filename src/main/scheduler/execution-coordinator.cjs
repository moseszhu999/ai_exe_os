'use strict';

const { evaluateExecutionReadiness } = require('./readiness-evaluator.cjs');

class ExecutionCoordinator {
  constructor({ runRepository, gateService, eventWriter, lockManager, runtimeAdapter, providerRevalidator, clock = () => new Date().toISOString() }) {
    if (!runRepository?.get || !runRepository?.save || !runRepository?.list) throw new TypeError('runRepository is required');
    if (!gateService || !eventWriter?.append || !lockManager || !runtimeAdapter?.execute) throw new TypeError('coordinator dependencies are required');
    this.runs = runRepository;
    this.gates = gateService;
    this.events = eventWriter;
    this.locks = lockManager;
    this.runtime = runtimeAdapter;
    this.providerRevalidator = providerRevalidator || (() => true);
    this.clock = clock;
  }

  request(input) {
    const existing = this.runs.get(input.executionRunId);
    if (existing) return Object.freeze({ created: false, run: existing, gate: input.gateId ? this.gates.repository.get(input.gateId) : null });
    const resourceConflicts = this.locks.conflicts(input.resources || []);
    const readiness = evaluateExecutionReadiness({ ...input, resourceConflicts });
    if (!readiness.ready) {
      const run = Object.freeze({
        id: input.executionRunId,
        workspaceId: input.workspace?.id || input.task?.workspaceId,
        taskId: input.task?.id,
        state: 'blocked',
        blockers: readiness.blockers,
        requestedAt: this.clock(),
      });
      this.runs.save(run);
      this.events.append({ type: 'execution.blocked', idempotencyKey: `blocked:${run.id}`, runId: run.id, blockers: readiness.blockers });
      return Object.freeze({ created: true, run, gate: null });
    }

    const locks = this.locks.acquireAll({
      workspaceId: input.workspace.id,
      taskId: input.task.id,
      executionRunId: input.executionRunId,
      resources: input.resources,
      acquiredAt: this.clock(),
    });
    const run = Object.freeze({
      id: input.executionRunId,
      workspaceId: input.workspace.id,
      taskId: input.task.id,
      workerId: input.workerId,
      capabilityAction: input.task.capabilityAction,
      target: input.task.target,
      payload: input.payload,
      providerSnapshot: input.providerSnapshot,
      currentProviderDigest: input.currentProviderDigest,
      state: readiness.requiresHumanGate ? 'waiting_human' : 'ready',
      blockers: [],
      requestedAt: this.clock(),
      startedAt: null,
      completedAt: null,
    });
    this.runs.save(run);
    this.events.append({ type: 'execution.requested', idempotencyKey: `request:${run.id}`, runId: run.id });
    this.events.append({ type: 'resource.reserved', idempotencyKey: `reserve:${run.id}`, runId: run.id, locks });
    let gate = null;
    if (readiness.requiresHumanGate) {
      gate = this.gates.request({
        id: input.gateId,
        workspaceId: run.workspaceId,
        taskId: run.taskId,
        executionRunId: run.id,
        actionClass: input.actionClass,
        workerId: run.workerId,
        capabilityAction: run.capabilityAction,
        target: run.target,
        payloadPreview: input.payloadPreview || {},
        evidenceExpected: input.evidenceExpected || [],
      }).gate;
      this.events.append({ type: 'human_gate.requested', idempotencyKey: `gate-request:${gate.id}`, runId: run.id, gateId: gate.id });
    }
    return Object.freeze({ created: true, run, gate });
  }

  reject(gateId) {
    const decision = this.gates.reject(gateId);
    const run = this.runs.get(decision.gate.executionRunId);
    if (!decision.changed) return Object.freeze({ changed: false, run, gate: decision.gate });
    const next = Object.freeze({ ...run, state: 'cancelled', completedAt: this.clock() });
    this.runs.save(next);
    const released = this.locks.releaseAll(run.id, this.clock());
    this.events.append({ type: 'human_gate.rejected', idempotencyKey: `gate-reject:${gateId}`, runId: run.id, gateId });
    this.events.append({ type: 'resource.released', idempotencyKey: `release:${run.id}`, runId: run.id, locks: released });
    return Object.freeze({ changed: true, run: next, gate: decision.gate });
  }

  async approve(gateId) {
    const currentGate = this.gates.repository.get(gateId);
    if (!currentGate) throw new Error(`Unknown Human Gate: ${gateId}`);
    let run = this.runs.get(currentGate.executionRunId);
    if (['active', 'result_observed', 'completed'].includes(run.state)) {
      return Object.freeze({ changed: false, run, gate: currentGate, execution: run.execution || null });
    }
    if (run.state !== 'waiting_human') throw new Error(`Execution is not waiting for approval: ${run.state}`);

    // Revalidate immediately before consuming the human approval or causing an effect.
    this.providerRevalidator(run.providerSnapshot, run.currentProviderDigest, run.capabilityAction);
    const decision = this.gates.approve(gateId);
    this.events.append({ type: 'human_gate.approved', idempotencyKey: `gate-approve:${gateId}`, runId: run.id, gateId });
    this.events.append({ type: 'execution.started', idempotencyKey: `start:${run.id}`, runId: run.id });
    run = Object.freeze({ ...run, state: 'active', startedAt: this.clock() });
    this.runs.save(run);
    try {
      const execution = await this.runtime.execute({
        workerId: run.workerId,
        taskId: run.taskId,
        capabilityAction: run.capabilityAction,
        target: run.target,
        payload: run.payload,
      });
      const completed = Object.freeze({ ...run, state: 'result_observed', execution, completedAt: this.clock() });
      this.runs.save(completed);
      this.events.append({ type: 'execution.result_observed', idempotencyKey: `result:${run.id}`, runId: run.id, execution });
      const released = this.locks.releaseAll(run.id, this.clock());
      this.events.append({ type: 'resource.released', idempotencyKey: `release:${run.id}`, runId: run.id, locks: released });
      return Object.freeze({ changed: true, run: completed, gate: decision.gate, execution });
    } catch (error) {
      const uncertain = Object.freeze({ ...run, state: 'waiting_human', recoveryReason: 'execution_uncertain_requires_review' });
      this.runs.save(uncertain);
      this.events.append({ type: 'execution.waiting_human', idempotencyKey: `uncertain:${run.id}`, runId: run.id, reason: uncertain.recoveryReason });
      throw error;
    }
  }

  recoverUncertain() {
    const recovered = [];
    for (const run of this.runs.list()) {
      if (run.state !== 'active') continue;
      const next = Object.freeze({ ...run, state: 'waiting_human', recoveryReason: 'application_recovery_requires_review' });
      this.runs.save(next);
      this.events.append({ type: 'execution.waiting_human', idempotencyKey: `recovery:${run.id}`, runId: run.id, reason: next.recoveryReason });
      recovered.push(next);
    }
    return Object.freeze(recovered);
  }
}

module.exports = { ExecutionCoordinator };
