'use strict';

const { createHash } = require('node:crypto');
const { S1ApplicationService, LOCAL_PROVIDER_SNAPSHOT_ID } = require('./index.cjs');
const { ProjectionRepository } = require('./projection-repository.cjs');
const { createAgent, assertGrantAllows } = require('../domain/agent-model.cjs');
const { createCapabilityPackage, publishCapabilityVersion } = require('../domain/capability-model.cjs');
const { createProviderContractSnapshot, assertProviderSnapshotAllows } = require('../domain/provider-contract-snapshot.cjs');
const { createMission, createMissionRevision, createMissionRun, freezeMissionRevision } = require('../domain/mission-model.cjs');
const { createExecutionPlan, createPlanStep, createStepBinding } = require('../domain/plan-model.cjs');
const { createStepOutput, assertJsonSafe } = require('../domain/step-output-model.cjs');
const { createAgentHandoff } = require('../domain/agent-handoff-model.cjs');
const {
  createStepAttempt,
  deriveReadySet,
  evaluateMissionCompletion,
  markExternalStart,
  recoverUncertainAttempts,
  retryAfterReview,
  transitionAttempt,
  transitionRun,
} = require('../orchestration/mission-orchestrator.cjs');
const { createMissionCheckpoint, verifyMissionCheckpoint } = require('../checkpoint/mission-checkpoint.cjs');

const LOCAL_TRANSFORM_PACKAGE_ID = 'local.mission-transform';
const LOCAL_TRANSFORM_VERSION = '1.0.0';
const LOCAL_TRANSFORM_VERSION_ID = `${LOCAL_TRANSFORM_PACKAGE_ID}@${LOCAL_TRANSFORM_VERSION}`;
const LOCAL_TRANSFORM_PROVIDER_ID = 'provider-local-transform';
const LOCAL_TRANSFORM_TARGET = 'local://mission-transform';
const LOCAL_JOIN_TARGET = 'local://mission-join';
const LOCAL_TRANSFORM_DIGEST = `sha256:${'b'.repeat(64)}`;

function boundedId(prefix, ...parts) {
  return `${prefix}-${createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 20)}`;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function semanticDigest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')}`;
}
function named(entry) { return typeof entry === 'string' ? entry : entry?.name; }

class S2ApplicationService extends S1ApplicationService {
  constructor(options = {}) {
    super(options);
    this.s2Repositories = Object.fromEntries([
      'mission', 'missionRevision', 'executionPlan', 'stepBinding', 'missionRun',
      'stepAttempt', 'stepOutput', 'agentHandoff', 'missionCheckpoint',
    ].map((name) => [name, new ProjectionRepository({ store: this.store, projectionType: name })]));
    Object.assign(this, this.s2Repositories);
    this.seedS2();
    this.recoverS2Uncertain();
  }

  seedS2() {
    const workspace = this.workspace.get('workspace-a');
    if (workspace && !this.agent.get('agent-a2')) {
      this.agent.save(createAgent({ id: 'agent-a2', workspace, name: 'Agent A2', role: 'local-transform', createdAt: this.clock() }), 's2_seed');
    }
    if (!this.capabilityPackage.get(LOCAL_TRANSFORM_PACKAGE_ID)) {
      this.capabilityPackage.save({ id: LOCAL_TRANSFORM_PACKAGE_ID, ...createCapabilityPackage({
        id: LOCAL_TRANSFORM_PACKAGE_ID,
        name: 'Local Mission Transform',
        publisher: 'project-owned',
        description: 'Deterministic project-owned transform and join capability for S2 mission handoff validation',
      }) }, 'capability.published');
    }
    if (!this.capabilityVersion.get(LOCAL_TRANSFORM_VERSION_ID)) {
      this.capabilityVersion.save({ id: LOCAL_TRANSFORM_VERSION_ID, ...publishCapabilityVersion({
        packageId: LOCAL_TRANSFORM_PACKAGE_ID,
        version: LOCAL_TRANSFORM_VERSION,
        integrityDigest: LOCAL_TRANSFORM_DIGEST,
        inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
        evidenceRequirements: ['local-transform-evidence'], resourceRequirements: [],
        providerContractIds: [LOCAL_TRANSFORM_PROVIDER_ID], humanGatePolicy: 'never',
      }) }, 'capability.published');
    }
    if (!this.providerSnapshot.get(LOCAL_TRANSFORM_PROVIDER_ID)) {
      this.providerSnapshot.save({ id: LOCAL_TRANSFORM_PROVIDER_ID, ...createProviderContractSnapshot({
        contractId: LOCAL_TRANSFORM_PROVIDER_ID,
        providerId: 'project-owned', surfaceId: 'local-mission-transform', status: 'accepted',
        reviewedAt: '2026-08-01T00:00:00.000Z', expiresAt: '2030-01-01T00:00:00.000Z',
        governingTermsDigest: LOCAL_TRANSFORM_DIGEST,
        permittedActions: ['transform_payload', 'join_payload'], prohibitedActions: [],
      }) }, 'provider_contract.accepted');
    }
  }

  appendS2Event({ type, workspaceId, aggregateType, aggregateId, idempotencyKey, payload = {} }) {
    return this.store.appendEvent({
      workspaceId, aggregateType, aggregateId, eventType: type, eventVersion: 1,
      idempotencyKey, occurredAt: this.clock(), payload, metadata: { source: 's2-application' },
    }).event;
  }

  createMission(input) {
    const workspace = this.require(this.workspace, input.workspaceId, 'Workspace');
    const id = input.id || boundedId('mission', workspace.id, input.idempotencyKey || input.title);
    const existing = this.mission.get(id);
    if (existing) {
      if (existing.workspaceId !== workspace.id || existing.title !== input.title || existing.objective !== String(input.objective || '')) {
        throw new Error(`Mission idempotency collision: ${id}`);
      }
      return Object.freeze({ mission: existing, draftRevision: this.missionRevision.get(existing.draftRevisionId) || null });
    }
    const mission = this.mission.save({
      ...createMission({ id, workspaceId: workspace.id, title: input.title, createdAt: this.clock() }),
      objective: String(input.objective || ''), draftRevisionId: boundedId('missionrev', id, 'draft'),
    }, 'mission.created');
    const draftRevision = this.missionRevision.save({
      id: mission.draftRevisionId, missionId: mission.id, workspaceId: workspace.id,
      revision: 0, objective: String(input.objective || ''), planId: null, status: 'draft',
      frozenAt: null, contentDigest: null, createdAt: this.clock(),
    }, 'mission.draft_created');
    this.appendS2Event({ type: 'mission.created', workspaceId: workspace.id, aggregateType: 'mission', aggregateId: mission.id, idempotencyKey: `mission.created:${mission.id}`, payload: { missionId: mission.id } });
    return Object.freeze({ mission, draftRevision });
  }

  createRevision(input) {
    const mission = this.require(this.mission, input.missionId, 'Mission');
    if (mission.workspaceId !== input.workspaceId) throw new Error('Cross-Workspace Mission revision denied');
    if (!Array.isArray(input.steps) || input.steps.length < 1) throw new TypeError('Mission revision requires steps');
    const priorRevisions = this.missionRevision.list().filter((item) => item.missionId === mission.id && Number(item.revision) > 0);
    const revisionNumber = Number(input.revision || (priorRevisions.length ? Math.max(...priorRevisions.map((item) => Number(item.revision))) + 1 : 1));
    const revisionId = input.id || boundedId('missionrev', mission.id, revisionNumber);
    const planId = input.planId || boundedId('missionplan', revisionId);
    const bindings = [];
    const steps = [];
    for (const raw of input.steps) {
      const target = String(raw.target || '');
      const action = String(raw.action || '');
      const providerSnapshotId = raw.providerSnapshotId || (target.startsWith('local://') ? LOCAL_TRANSFORM_PROVIDER_ID : LOCAL_PROVIDER_SNAPSHOT_ID);
      const binding = createStepBinding({
        id: raw.bindingId || boundedId('binding', revisionId, raw.id), workspaceId: input.workspaceId,
        agentId: raw.agentId, installationId: raw.installationId, capabilityVersionId: raw.capabilityVersionId,
        action, target, providerSnapshotId,
      });
      this.validateBinding(binding);
      const step = createPlanStep({
        id: raw.id, planId, workspaceId: input.workspaceId, name: raw.name || raw.id, bindingId: binding.id,
        dependsOn: raw.dependsOn || [], declaredInputs: raw.declaredInputs || [], declaredOutputs: raw.declaredOutputs || [],
        evidenceRequirements: raw.evidenceRequirements || [], humanGatePolicy: raw.humanGatePolicy || (target.startsWith('local://') ? 'never' : 'action'),
        resourceRequirements: raw.resourceRequirements || [],
      });
      steps.push(Object.freeze({
        ...step, workerId: raw.workerId || null, payload: raw.payload === undefined ? '' : String(raw.payload),
        executionMode: target.startsWith('local://') ? 'local' : 's1',
      }));
      bindings.push(binding);
    }
    const domainPlan = createExecutionPlan({
      id: planId, missionRevisionId: revisionId, workspaceId: input.workspaceId,
      steps, bindings, terminalStepIds: input.terminalStepIds || [steps.at(-1).id],
    });
    const integrationDigest = semanticDigest({ objective: input.objective, steps, bindings, terminalStepIds: domainPlan.terminalStepIds });
    const existingRevision = this.missionRevision.get(revisionId);
    if (existingRevision) {
      if (existingRevision.integrationDigest !== integrationDigest) throw new Error(`Mission revision idempotency collision: ${revisionId}`);
      return Object.freeze({ mission, revision: existingRevision, plan: this.executionPlan.get(existingRevision.planId) });
    }
    for (const binding of bindings) {
      const current = this.stepBinding.get(binding.id);
      if (current && semanticDigest({ ...current, _revision: undefined }) !== semanticDigest(binding)) throw new Error(`Step binding idempotency collision: ${binding.id}`);
      if (!current) this.stepBinding.save(binding, 'step.binding_created');
    }
    const plan = this.executionPlan.save({ ...domainPlan, steps, bindings, integrationDigest }, 'mission.plan_created');
    const revision = this.missionRevision.save({
      ...createMissionRevision({ id: revisionId, missionId: mission.id, workspaceId: mission.workspaceId, revision: revisionNumber, objective: input.objective, planId, createdAt: this.clock() }),
      integrationDigest, status: 'ready',
    }, 'mission.revision_created');
    this.mission.save({ ...mission, currentRevisionId: revision.id, updatedAt: this.clock() }, 'mission.revision_selected');
    this.appendS2Event({ type: 'mission.revision_created', workspaceId: mission.workspaceId, aggregateType: 'mission', aggregateId: mission.id, idempotencyKey: `mission.revision_created:${revision.id}`, payload: { revisionId: revision.id, planId: plan.id, integrationDigest } });
    return Object.freeze({ mission: this.mission.get(mission.id), revision, plan });
  }

  validateBinding(binding) {
    const workspace = this.require(this.workspace, binding.workspaceId, 'Workspace');
    const agent = this.require(this.agent, binding.agentId, 'Agent');
    const installation = this.require(this.installation, binding.installationId, 'Installation');
    const version = this.require(this.capabilityVersion, binding.capabilityVersionId, 'Capability version');
    if (installation.packageId !== version.packageId || installation.version !== version.version || installation.integrityDigest !== version.integrityDigest) {
      throw new Error('Step binding capability installation/version mismatch');
    }
    const grant = this.grant.list().find((candidate) => candidate.workspaceId === workspace.id && candidate.agentId === agent.id && candidate.installationId === installation.id && candidate.status === 'active');
    assertGrantAllows({ workspace, agent, installation, grant, action: binding.action, target: binding.target });
    const snapshot = this.require(this.providerSnapshot, binding.providerSnapshotId, 'Provider snapshot');
    assertProviderSnapshotAllows({ snapshot, action: binding.action, now: new Date(this.clock()) });
    return true;
  }

  startMission(input) {
    const mission = this.require(this.mission, input.missionId, 'Mission');
    const revision = this.require(this.missionRevision, input.revisionId || mission.currentRevisionId, 'Mission revision');
    if (mission.workspaceId !== input.workspaceId || revision.workspaceId !== input.workspaceId) throw new Error('Cross-Workspace Mission start denied');
    const plan = this.require(this.executionPlan, revision.planId, 'Execution plan');
    const runId = input.runId || boundedId('missionrun', revision.id);
    const existing = this.missionRun.get(runId);
    if (existing) return Object.freeze({ run: existing, state: this.queryMissionState(input.workspaceId) });
    const frozen = freezeMissionRevision(revision, this.clock());
    this.missionRevision.save({ ...frozen, status: 'frozen' }, 'mission.revision_frozen');
    let run = createMissionRun({ id: runId, workspaceId: mission.workspaceId, missionId: mission.id, missionRevisionId: revision.id, planId: plan.id, createdAt: this.clock() });
    run = this.missionRun.save(transitionRun(run, 'running', 'mission start', this.clock()), 'mission.run_started');
    this.appendS2Event({ type: 'mission.run_started', workspaceId: run.workspaceId, aggregateType: 'missionRun', aggregateId: run.id, idempotencyKey: `mission.run_started:${run.id}`, payload: { missionId: mission.id, revisionId: revision.id, planId: plan.id } });
    this.evaluateRun(run.id);
    return Object.freeze({ run: this.missionRun.get(run.id), state: this.queryMissionState(run.workspaceId) });
  }

  evaluateRun(runId) {
    let run = this.require(this.missionRun, runId, 'Mission run');
    if (run.state !== 'running') return run;
    const plan = this.require(this.executionPlan, run.planId, 'Execution plan');
    let progressed = true;
    while (progressed && this.missionRun.get(runId)?.state === 'running') {
      progressed = false;
      const attempts = this.stepAttempt.list().filter((item) => item.missionRunId === runId);
      const handoffs = this.agentHandoff.list().filter((item) => item.missionRunId === runId);
      const ready = deriveReadySet({ run: this.missionRun.get(runId), plan, attempts, handoffs });
      for (const stepId of ready.ready) {
        if (this.latestAttempt(runId, stepId)) continue;
        const step = plan.steps.find((candidate) => candidate.id === stepId);
        let attempt = this.stepAttempt.save(createStepAttempt({ run: this.missionRun.get(runId), step, attemptNumber: 1, createdAt: this.clock() }), 'step.attempt_created');
        this.appendS2Event({ type: 'step.attempt_created', workspaceId: run.workspaceId, aggregateType: 'stepAttempt', aggregateId: attempt.id, idempotencyKey: `step.attempt_created:${attempt.id}`, payload: { missionRunId: runId, stepId } });
        if (step.executionMode === 'local') {
          this.executeLocalAttempt(attempt, step, plan);
          progressed = true;
        } else {
          this.scheduleExternalAttempt(attempt, step);
        }
      }
      run = this.missionRun.get(runId);
    }
    this.maybeCompleteMission(runId);
    return this.missionRun.get(runId);
  }

  scheduleExternalAttempt(attempt, step) {
    const binding = this.require(this.stepBinding, step.bindingId, 'Step binding');
    const workerId = step.workerId || this.selectIdleWorker(attempt.workspaceId);
    const result = super.createTask({
      id: boundedId('s2task', attempt.id), workspaceId: attempt.workspaceId,
      agentId: binding.agentId, installationId: binding.installationId,
      capabilityAction: binding.action, target: binding.target, workerId,
      payload: step.payload || `${attempt.missionRunId}:${step.id}`,
    });
    let next = attempt;
    if (result.gate) next = transitionAttempt(next, 'waiting_human', 'human gate requested', this.clock());
    else if (result.run?.state === 'blocked') next = transitionAttempt(next, 'blocked', 'S1 execution blocked', this.clock());
    next = this.stepAttempt.save({
      ...next, executionRunId: result.run?.id || null, humanGateId: result.gate?.id || null,
      blockers: result.run?.blockers || [], workerId,
    }, result.gate ? 'step.attempt_waiting_human' : 'step.attempt_blocked');
    this.appendS2Event({
      type: result.gate ? 'step.attempt_waiting_human' : 'plan.step_blocked',
      workspaceId: attempt.workspaceId, aggregateType: 'stepAttempt', aggregateId: attempt.id,
      idempotencyKey: `${result.gate ? 'step.attempt_waiting_human' : 'plan.step_blocked'}:${attempt.id}`,
      payload: { executionRunId: result.run?.id || null, gateId: result.gate?.id || null, blockers: result.run?.blockers || [] },
    });
    return next;
  }

  executeLocalAttempt(attempt, step, plan) {
    let active = this.stepAttempt.save(transitionAttempt(attempt, 'active', 'local deterministic execution', this.clock()), 'step.attempt_started');
    const inputs = {};
    for (const descriptor of step.declaredInputs || []) {
      const inputName = named(descriptor);
      const handoff = this.agentHandoff.list().find((item) => item.missionRunId === attempt.missionRunId && item.toStepId === step.id && item.inputName === inputName);
      if (!handoff) throw new Error(`Missing declared handoff for ${step.id}.${inputName}`);
      inputs[inputName] = this.require(this.stepOutput, handoff.outputId, 'Step output').value;
    }
    const value = step.declaredInputs?.length ? { kind: 'join', inputs } : { kind: 'local-transform', stepId: step.id, payload: step.payload || '' };
    assertJsonSafe(value);
    this.recordOutputsAndEvidence({ attempt: active, step, value });
    active = this.stepAttempt.save(transitionAttempt(active, 'completed', 'local result observed', this.clock()), 'step.attempt_completed');
    this.appendS2Event({ type: 'step.attempt_completed', workspaceId: active.workspaceId, aggregateType: 'stepAttempt', aggregateId: active.id, idempotencyKey: `step.attempt_completed:${active.id}`, payload: { stepId: active.stepId, local: true } });
    this.recordHandoffsForCompletedAttempt(active, step, plan);
    return active;
  }

  recordOutputsAndEvidence({ attempt, step, value }) {
    for (const outputName of (step.declaredOutputs || []).map(named).filter(Boolean)) {
      const outputId = boundedId('stepoutput', attempt.id, outputName);
      if (!this.stepOutput.get(outputId)) {
        this.stepOutput.save(createStepOutput({
          id: outputId, workspaceId: attempt.workspaceId, missionRunId: attempt.missionRunId,
          stepAttemptId: attempt.id, outputName, schemaDigest: semanticDigest({ outputName }), value,
          evidenceIds: (step.evidenceRequirements || []).map((requirement) => boundedId('evidence', attempt.id, requirement)), createdAt: this.clock(),
        }), 'step.output_recorded');
      }
      this.appendS2Event({ type: 'step.output_recorded', workspaceId: attempt.workspaceId, aggregateType: 'stepAttempt', aggregateId: attempt.id, idempotencyKey: `step.output_recorded:${outputId}`, payload: { stepId: step.id, outputId, outputName } });
    }
    for (const requirement of step.evidenceRequirements || []) {
      const evidenceId = boundedId('evidence', attempt.id, requirement);
      if (!this.evidence.get(evidenceId)) {
        this.evidence.save({
          id: evidenceId, workspaceId: attempt.workspaceId, missionRunId: attempt.missionRunId,
          stepAttemptId: attempt.id, stepId: step.id, type: requirement, observedAt: this.clock(), result: value,
        }, 's2.evidence_recorded');
      }
    }
  }

  recordHandoffsForCompletedAttempt(attempt, sourceStep, plan) {
    const outputs = this.stepOutput.list().filter((item) => item.stepAttemptId === attempt.id);
    for (const targetStep of plan.steps.filter((candidate) => (candidate.dependsOn || []).includes(sourceStep.id))) {
      for (const descriptor of targetStep.declaredInputs || []) {
        if (!descriptor || typeof descriptor !== 'object' || descriptor.fromStepId !== sourceStep.id) continue;
        const output = outputs.find((item) => item.outputName === descriptor.outputName);
        if (!output) continue;
        const handoffId = boundedId('handoff', attempt.missionRunId, sourceStep.id, targetStep.id, descriptor.name);
        if (this.agentHandoff.get(handoffId)) continue;
        const handoff = createAgentHandoff({
          id: handoffId, workspaceId: attempt.workspaceId, missionRunId: attempt.missionRunId,
          sourceStep, targetStep, inputName: descriptor.name, output, createdAt: this.clock(),
        });
        this.agentHandoff.save(handoff, 'agent.handoff_recorded');
        this.appendS2Event({ type: 'agent.handoff_recorded', workspaceId: attempt.workspaceId, aggregateType: 'missionRun', aggregateId: attempt.missionRunId, idempotencyKey: `agent.handoff_recorded:${handoff.id}`, payload: { handoffId: handoff.id, outputId: output.id, fromStepAttemptId: attempt.id, toStepId: targetStep.id } });
      }
    }
  }

  rejectHumanGate(input) {
    const gate = this.humanGate.get(input.gateId);
    const attempt = gate ? this.stepAttempt.list().find((item) => item.executionRunId === gate.executionRunId) : null;
    const result = super.rejectHumanGate(input);
    if (attempt && attempt.state === 'waiting_human') {
      const cancelled = this.stepAttempt.save(transitionAttempt(attempt, 'cancelled', 'human gate rejected', this.clock()), 'step.attempt_cancelled');
      this.appendS2Event({ type: 'step.attempt_cancelled', workspaceId: cancelled.workspaceId, aggregateType: 'stepAttempt', aggregateId: cancelled.id, idempotencyKey: `step.attempt_cancelled:${cancelled.id}`, payload: { reason: 'human_gate_rejected' } });
      this.evaluateRun(cancelled.missionRunId);
    }
    return result;
  }

  async approveHumanGate(input) {
    const gate = this.humanGate.get(input.gateId);
    const attempt = gate ? this.stepAttempt.list().find((item) => item.executionRunId === gate.executionRunId) : null;
    if (attempt) {
      const missionRun = this.require(this.missionRun, attempt.missionRunId, 'Mission run');
      if (missionRun.state === 'paused') throw new Error('Mission is paused; no new external step may start');
      if (missionRun.state === 'cancelled') throw new Error('Mission is cancelled; no external step may start');
      if (attempt.recoveryReason || attempt.state === 'recovery_required') throw new Error('Recovered StepAttempt cannot be replayed; create a reviewed retry');
    }
    try {
      const result = await super.approveHumanGate(input);
      if (!attempt || result.run?.state !== 'result_observed') return result;
      const missionRun = this.require(this.missionRun, attempt.missionRunId, 'Mission run');
      const plan = this.require(this.executionPlan, missionRun.planId, 'Execution plan');
      const step = plan.steps.find((candidate) => candidate.id === attempt.stepId);
      const latest = this.require(this.stepAttempt, attempt.id, 'Step attempt');
      if (latest.state !== 'completed') {
        const value = result.execution?.result || result.execution || { observed: true };
        assertJsonSafe(value);
        const active = latest.state === 'active' ? latest : markExternalStart(latest, result.run.id, this.clock());
        this.stepAttempt.save(active, 'step.attempt_started');
        this.recordOutputsAndEvidence({ attempt: active, step, value });
        const completed = this.stepAttempt.save(transitionAttempt(active, 'completed', 'S1 result observed', this.clock()), 'step.attempt_completed');
        this.appendS2Event({ type: 'step.attempt_completed', workspaceId: completed.workspaceId, aggregateType: 'stepAttempt', aggregateId: completed.id, idempotencyKey: `step.attempt_completed:${completed.id}`, payload: { stepId: completed.stepId, executionRunId: completed.executionRunId } });
        this.recordHandoffsForCompletedAttempt(completed, step, plan);
        this.evaluateRun(completed.missionRunId);
      }
      return result;
    } catch (error) {
      if (attempt) {
        const latest = this.stepAttempt.get(attempt.id);
        if (latest && latest.state !== 'completed' && latest.state !== 'recovery_required') {
          this.stepAttempt.save(Object.freeze({ ...latest, state: 'recovery_required', externalStartCommitted: true, recoveryReason: 'application_recovery_requires_review', updatedAt: this.clock() }), 'step.attempt_recovery_required');
          const run = this.missionRun.get(latest.missionRunId);
          if (run?.state === 'running') this.missionRun.save(transitionRun(run, 'recovery_required', 'uncertain external StepAttempt', this.clock()), 'mission.recovery_required');
        }
      }
      throw error;
    }
  }

  pauseMission(input) {
    const run = this.requireRunInWorkspace(input.runId, input.workspaceId);
    const next = this.missionRun.save(transitionRun(run, 'paused', input.reason || 'operator pause', this.clock()), 'mission.run_paused');
    this.appendS2Event({ type: 'mission.run_paused', workspaceId: next.workspaceId, aggregateType: 'missionRun', aggregateId: next.id, idempotencyKey: `mission.run_paused:${next.id}:${next.version}`, payload: { reason: next.lastReason } });
    return next;
  }

  resumeMission(input) {
    const run = this.requireRunInWorkspace(input.runId, input.workspaceId);
    const next = this.missionRun.save(transitionRun(run, 'running', input.reason || 'operator resume', this.clock()), 'mission.run_resumed');
    this.appendS2Event({ type: 'mission.run_resumed', workspaceId: next.workspaceId, aggregateType: 'missionRun', aggregateId: next.id, idempotencyKey: `mission.run_resumed:${next.id}:${next.version}`, payload: { reason: next.lastReason } });
    this.evaluateRun(next.id);
    return this.missionRun.get(next.id);
  }

  cancelMission(input) {
    let run = this.requireRunInWorkspace(input.runId, input.workspaceId);
    if (run.state === 'cancelled') return run;
    for (const attempt of this.stepAttempt.list().filter((item) => item.missionRunId === run.id)) {
      if (attempt.state === 'waiting_human' && attempt.humanGateId) {
        const gate = this.humanGate.get(attempt.humanGateId);
        if (gate?.state === 'requested') super.rejectHumanGate({ gateId: gate.id });
      }
      const current = this.stepAttempt.get(attempt.id);
      if (!current || ['completed', 'cancelled', 'failed'].includes(current.state)) continue;
      if (current.state === 'active') {
        this.stepAttempt.save(Object.freeze({ ...current, state: 'recovery_required', recoveryReason: 'mission_cancel_requires_review', updatedAt: this.clock() }), 'step.attempt_recovery_required');
      } else {
        try { this.stepAttempt.save(transitionAttempt(current, 'cancelled', 'mission cancelled', this.clock()), 'step.attempt_cancelled'); } catch {}
      }
    }
    run = this.missionRun.save(transitionRun(run, 'cancelled', input.reason || 'operator cancel', this.clock()), 'mission.run_cancelled');
    this.appendS2Event({ type: 'mission.run_cancelled', workspaceId: run.workspaceId, aggregateType: 'missionRun', aggregateId: run.id, idempotencyKey: `mission.run_cancelled:${run.id}:${run.version}`, payload: { reason: run.lastReason } });
    return run;
  }

  retryStepAfterReview(input) {
    let run = this.requireRunInWorkspace(input.runId, input.workspaceId);
    if (run.state === 'recovery_required') run = this.missionRun.save(transitionRun(run, 'running', 'reviewed retry authorized', this.clock()), 'mission.run_resumed');
    if (run.state !== 'running') throw new Error('Mission must be running for reviewed retry');
    const previous = this.require(this.stepAttempt, input.previousAttemptId, 'Previous StepAttempt');
    if (previous.missionRunId !== run.id) throw new Error('StepAttempt does not belong to MissionRun');
    const plan = this.require(this.executionPlan, run.planId, 'Execution plan');
    const step = plan.steps.find((candidate) => candidate.id === previous.stepId);
    const retried = this.stepAttempt.save(retryAfterReview({ previousAttempt: previous, run, step, reviewed: input.reviewed === true, occurredAt: this.clock() }), 'step.attempt_retry_created');
    this.appendS2Event({ type: 'step.attempt_created', workspaceId: run.workspaceId, aggregateType: 'stepAttempt', aggregateId: retried.id, idempotencyKey: `step.attempt_created:${retried.id}`, payload: { retryOf: previous.id, attemptNumber: retried.attemptNumber } });
    if (step.executionMode === 'local') this.executeLocalAttempt(retried, step, plan); else this.scheduleExternalAttempt(retried, step);
    return this.stepAttempt.get(retried.id);
  }

  recordCheckpoint(input) {
    const run = this.requireRunInWorkspace(input.runId, input.workspaceId);
    const projectionState = this.missionProjectionState(run.id);
    const events = this.store.listEvents({ workspaceId: run.workspaceId });
    const sequence = events.length ? events.at(-1).sequence : 0;
    const checkpointId = input.id || boundedId('checkpoint', run.id, sequence);
    const existing = this.missionCheckpoint.get(checkpointId);
    if (existing) {
      const verification = verifyMissionCheckpoint(existing, { canonicalEventSequence: sequence, projectionState });
      if (!verification.valid) throw new Error(`Mission checkpoint idempotency collision: ${checkpointId}`);
      return existing;
    }
    const ready = deriveReadySet({ run, plan: this.require(this.executionPlan, run.planId, 'Execution plan'), attempts: projectionState.attempts, handoffs: projectionState.handoffs });
    const checkpoint = createMissionCheckpoint({
      id: checkpointId, workspaceId: run.workspaceId, missionRunId: run.id,
      canonicalEventSequence: sequence, projectionState, readyStepIds: ready.ready,
      activeAttemptIds: projectionState.attempts.filter((item) => item.state === 'active').map((item) => item.id),
      recoveryRequiredAttemptIds: projectionState.attempts.filter((item) => item.state === 'recovery_required').map((item) => item.id),
      createdAt: this.clock(),
    });
    const stored = this.missionCheckpoint.save(checkpoint, 'mission.checkpoint_recorded');
    this.appendS2Event({ type: 'mission.checkpoint_recorded', workspaceId: run.workspaceId, aggregateType: 'missionRun', aggregateId: run.id, idempotencyKey: `mission.checkpoint_recorded:${stored.id}`, payload: { checkpointId: stored.id, canonicalEventSequence: stored.canonicalEventSequence, projectionDigest: stored.projectionDigest } });
    return stored;
  }

  maybeCompleteMission(runId) {
    const run = this.missionRun.get(runId);
    if (!run || run.state !== 'running') return run;
    const plan = this.require(this.executionPlan, run.planId, 'Execution plan');
    const attempts = this.stepAttempt.list().filter((item) => item.missionRunId === runId);
    const evidenceByStep = {};
    for (const evidence of this.evidence.list().filter((item) => item.missionRunId === runId)) (evidenceByStep[evidence.stepId] ||= []).push(evidence.type);
    const verdict = evaluateMissionCompletion({ run, plan, attempts, terminalEvidenceByStep: evidenceByStep });
    if (!verdict.complete) return run;
    const completed = this.missionRun.save(transitionRun(run, 'completed', 'terminal evidence satisfied', this.clock()), 'mission.run_completed');
    this.appendS2Event({ type: 'mission.run_completed', workspaceId: completed.workspaceId, aggregateType: 'missionRun', aggregateId: completed.id, idempotencyKey: `mission.run_completed:${completed.id}`, payload: { missionId: completed.missionId } });
    return completed;
  }

  queryMissionState(workspaceId = 'workspace-a') {
    const base = super.queryState(workspaceId);
    const scoped = (repository) => repository.list().filter((item) => item.workspaceId === workspaceId);
    const runs = scoped(this.missionRun);
    const attempts = scoped(this.stepAttempt);
    const allHandoffs = scoped(this.agentHandoff);
    const plans = scoped(this.executionPlan).map((plan) => {
      const run = runs.find((candidate) => candidate.planId === plan.id) || null;
      if (!run) return plan;
      const runAttempts = attempts.filter((item) => item.missionRunId === run.id);
      const derived = deriveReadySet({ run, plan, attempts: runAttempts, handoffs: allHandoffs.filter((item) => item.missionRunId === run.id) });
      const blockerByStep = new Map(derived.blocked.map((item) => [item.stepId, item.blockers]));
      return Object.freeze({ ...plan, steps: plan.steps.map((step) => {
        const latest = this.latestAttempt(run.id, step.id);
        return Object.freeze({ ...step, state: latest?.state || (derived.ready.includes(step.id) ? 'ready' : 'pending'), blockers: latest?.blockers || blockerByStep.get(step.id) || [] });
      }) });
    });
    return Object.freeze({
      workspaces: base.workspaces, missions: scoped(this.mission), revisions: scoped(this.missionRevision), plans,
      missionRuns: runs, stepAttempts: attempts, stepOutputs: scoped(this.stepOutput), agentHandoffs: allHandoffs,
      checkpoints: scoped(this.missionCheckpoint), humanGates: base.humanGates,
      evidence: base.evidence.filter((item) => item.missionRunId || item.executionRunId),
      missionEvents: this.store.listEvents({ workspaceId }).filter((event) => /^(mission\.|plan\.|step\.|agent\.handoff)/.test(event.eventType)).slice(-300),
      activeWorkspaceId: workspaceId, s1: base,
    });
  }

  missionProjectionState(runId) {
    const run = this.require(this.missionRun, runId, 'Mission run');
    return Object.freeze({
      mission: this.mission.get(run.missionId), revision: this.missionRevision.get(run.missionRevisionId),
      plan: this.executionPlan.get(run.planId), run,
      attempts: this.stepAttempt.list().filter((item) => item.missionRunId === runId),
      outputs: this.stepOutput.list().filter((item) => item.missionRunId === runId),
      handoffs: this.agentHandoff.list().filter((item) => item.missionRunId === runId),
    });
  }

  recoverS2Uncertain() {
    const active = this.stepAttempt.list().filter((item) => item.state === 'active');
    if (!active.length) return [];
    const recovered = recoverUncertainAttempts(active, this.clock());
    for (const item of recovered) this.stepAttempt.save(item, 'step.attempt_recovery_required');
    for (const runId of new Set(recovered.map((item) => item.missionRunId))) {
      const run = this.missionRun.get(runId);
      if (run?.state === 'running') this.missionRun.save(transitionRun(run, 'recovery_required', 'application recovery requires review', this.clock()), 'mission.recovery_required');
    }
    return recovered;
  }

  latestAttempt(runId, stepId) {
    return this.stepAttempt.list().filter((item) => item.missionRunId === runId && item.stepId === stepId).sort((a, b) => b.attemptNumber - a.attemptNumber)[0] || null;
  }
  selectIdleWorker(workspaceId) {
    const bindings = this.workerBinding.list().filter((item) => item.workspaceId === workspaceId);
    const live = new Map(this.workerManager.list().map((item) => [item.id, item]));
    return bindings.find((item) => live.get(item.id)?.status === 'idle')?.id || bindings[0]?.id || 's1-worker-chromium';
  }
  requireRunInWorkspace(runId, workspaceId) {
    const run = this.require(this.missionRun, runId, 'Mission run');
    if (run.workspaceId !== workspaceId) throw new Error('Cross-Workspace MissionRun access denied');
    return run;
  }
}

module.exports = {
  LOCAL_JOIN_TARGET,
  LOCAL_TRANSFORM_PACKAGE_ID,
  LOCAL_TRANSFORM_PROVIDER_ID,
  LOCAL_TRANSFORM_TARGET,
  LOCAL_TRANSFORM_VERSION,
  LOCAL_TRANSFORM_VERSION_ID,
  S2ApplicationService,
};
