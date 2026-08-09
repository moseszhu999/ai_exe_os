'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { S8SourceHandoffApplicationService } = require('../src/application/s8-source-handoff-service.cjs');

class NoEffectWorkerManager {
  constructor() {
    this.submissions = [];
    this.workers = [
      { id: 's1-worker-chrome', projectId: 's1-local-project', role: 'implementation', status: 'idle', browserChannel: 'chrome' },
      { id: 's1-worker-chromium', projectId: 's1-local-project', role: 'review', status: 'idle', browserChannel: 'chromium' },
    ];
  }
  list() { return this.workers.map((item) => ({ ...item })); }
  async submitAuthorizedLocalTask(input) { this.submissions.push(input); throw new Error('source delegated step must not execute locally'); }
  async start() { throw new Error('source delegated step must not start Worker directly'); }
  async stop() { throw new Error('unused'); }
  async focus() { throw new Error('unused'); }
  pause() { throw new Error('unused'); }
  resume() { throw new Error('unused'); }
}

function service() {
  return new S8SourceHandoffApplicationService({
    databasePath: ':memory:',
    workerManager: new NoEffectWorkerManager(),
    localTarget: 'http://127.0.0.1:43119/task-form.html',
    clock: (() => {
      let tick = 0;
      return () => new Date(Date.parse('2026-08-08T13:00:00.000Z') + (tick++ * 1000)).toISOString();
    })(),
  });
}

function canonicalMissionExecutionState(app) {
  const state = app.queryMissionState('workspace-a');
  return JSON.stringify({
    workspaces: state.workspaces,
    missions: state.missions,
    revisions: state.revisions,
    plans: state.plans,
    missionRuns: state.missionRuns,
    stepAttempts: state.stepAttempts,
    stepOutputs: state.stepOutputs,
    agentHandoffs: state.agentHandoffs,
    checkpoints: state.checkpoints,
    humanGates: state.humanGates,
    evidence: state.evidence,
    missionEvents: state.missionEvents,
    activeWorkspaceId: state.activeWorkspaceId,
  });
}

function prepareSourceMission(app, { missionId = 'source-mission', revisionId = 'source-revision-1' } = {}) {
  const install = app.installCapability({ workspaceId: 'workspace-a', packageId: 'local.mission-transform', version: '1.0.0' });
  app.grantCapability({
    workspaceId: 'workspace-a',
    agentId: 'agent-a2',
    installationId: install.id,
    allowedActions: ['transform_payload', 'join_payload'],
    allowedTargets: ['local://mission-transform', 'local://mission-join'],
  });
  const mission = app.createMission({ id: missionId, workspaceId: 'workspace-a', title: 'Source mission with delegated first step', objective: 'consume remote receipt then continue locally' }).mission;
  const revision = app.createRevision({
    id: revisionId,
    workspaceId: 'workspace-a',
    missionId: mission.id,
    revision: 1,
    objective: 'delegated source step feeds canonical downstream handoff',
    terminalStepIds: ['source-step-join'],
    steps: [
      {
        id: 'source-step-delegated', name: 'Delegated source step', agentId: 'agent-a2', installationId: install.id,
        capabilityVersionId: 'local.mission-transform@1.0.0', action: 'transform_payload', target: 'local://mission-transform',
        dependsOn: [], declaredInputs: [], declaredOutputs: ['delegated-result'], evidenceRequirements: ['delegation-receipt-evidence'],
        humanGatePolicy: 'never', resourceRequirements: [], payload: 'must-not-run-locally',
      },
      {
        id: 'source-step-join', name: 'Local downstream join', agentId: 'agent-a2', installationId: install.id,
        capabilityVersionId: 'local.mission-transform@1.0.0', action: 'join_payload', target: 'local://mission-join',
        dependsOn: ['source-step-delegated'],
        declaredInputs: [{ name: 'delegated-input', fromStepId: 'source-step-delegated', outputName: 'delegated-result' }],
        declaredOutputs: ['final-result'], evidenceRequirements: ['local-transform-evidence'], humanGatePolicy: 'never', resourceRequirements: [], payload: '',
      },
    ],
  });
  return { mission: revision.mission, revision: revision.revision, plan: revision.plan };
}

function bindOutboundDelegation(app, mission) {
  const sourceInstanceId = app.activeSourceInstance().id;
  app.recordPeerBinding({
    id: 'peer-source-to-destination', workspaceId: 'workspace-a', sourceInstanceId, sourceWorkspaceId: 'workspace-a',
    destinationInstanceId: 'sync-source-destination', destinationWorkspaceId: 'workspace-a', status: 'active',
    createdAt: '2026-08-08T13:10:00.000Z', updatedAt: '2026-08-08T13:10:00.000Z',
  });
  return app.createDelegationRequest({
    id: 'delegation-request-source-step', workspaceId: 'workspace-a', peerBindingId: 'peer-source-to-destination',
    policyId: 'policy-destination-v1', policyVersion: '1.0.0', sourceMissionId: mission.mission.id, sourcePlanStepId: 'source-step-delegated',
    capabilityVersionId: 'local.form-submit@1.0.0', action: 'submit_payload', target: 'http://127.0.0.1:43119/task-form.html',
    payloadClass: 'bounded-input', payload: { message: 'execute on destination' },
  });
}

function mirrorCompletedReceipt(app, request, id = 'receipt-mirror-1') {
  return app.delegationReceiptMirror.save({
    id,
    workspaceId: 'workspace-a',
    direction: 'inbound',
    delegationRequestId: request.id,
    delegatedExecutionBindingId: 'destination-binding-1',
    sourceInstanceId: request.sourceInstanceId,
    sourceWorkspaceId: request.sourceWorkspaceId,
    destinationInstanceId: request.destinationInstanceId,
    destinationWorkspaceId: request.destinationWorkspaceId,
    state: 'completed',
    resultClass: 'bounded-local-result-observed',
    resultSummary: { executionState: 'result_observed' },
    evidenceDigests: ['sha256:evidence-remote-1'],
    receiptRevision: 1,
    receiptDigest: 'sha256:completed-receipt-1',
    observedAt: '2026-08-08T13:20:00.000Z',
  }, 'test.receipt_mirrored');
}

test('S8 source Mission blocks delegated PlanStep canonically before receipt consumption', () => {
  const app = service();
  try {
    const mission = prepareSourceMission(app);
    const request = bindOutboundDelegation(app, mission);
    const started = app.startMission({ workspaceId: 'workspace-a', missionId: mission.mission.id, revisionId: mission.revision.id, runId: 'source-run-1' });
    const attempt = app.stepAttempt.list().find((item) => item.missionRunId === started.run.id && item.stepId === 'source-step-delegated');
    assert.ok(attempt);
    assert.equal(attempt.state, 'blocked');
    assert.equal(attempt.lastReason, 'delegation_receipt_required');
    assert.equal(app.stepAttempt.list().some((item) => item.stepId === 'source-step-join'), false);
    assert.equal(app.workerManager.submissions.length, 0);
    const binding = app.queryDelegationState('workspace-a').sourceStepBindings.find((item) => item.delegationRequestId === request.id);
    assert.equal(binding.state, 'awaiting_receipt');
  } finally { app.close(); }
});

test('S8 receipt mirror alone does not mutate source canonical S2 execution truth', () => {
  const app = service();
  try {
    const mission = prepareSourceMission(app);
    const request = bindOutboundDelegation(app, mission);
    app.startMission({ workspaceId: 'workspace-a', missionId: mission.mission.id, revisionId: mission.revision.id, runId: 'source-run-1' });
    const before = canonicalMissionExecutionState(app);
    const eventsBefore = app.queryMissionState('workspace-a').missionEvents.length;
    mirrorCompletedReceipt(app, request);
    assert.equal(canonicalMissionExecutionState(app), before);
    assert.equal(app.queryMissionState('workspace-a').missionEvents.length, eventsBefore, 'S8 receipt mirror audit storage must stay outside canonical S2 mission events');
    assert.equal(app.agentHandoff.list().length, 0);
  } finally { app.close(); }
});

test('S8 explicit receipt consumption completes canonical source step, records handoff and releases downstream exactly once', () => {
  const app = service();
  try {
    const mission = prepareSourceMission(app);
    const request = bindOutboundDelegation(app, mission);
    app.startMission({ workspaceId: 'workspace-a', missionId: mission.mission.id, revisionId: mission.revision.id, runId: 'source-run-1' });
    const receipt = mirrorCompletedReceipt(app, request);
    const consumed = app.consumeDelegationReceipt({ workspaceId: 'workspace-a', receiptMirrorId: receipt.id });
    assert.equal(consumed.state, 'consumed_once');

    const delegatedAttempt = app.stepAttempt.list().find((item) => item.missionRunId === 'source-run-1' && item.stepId === 'source-step-delegated');
    assert.equal(delegatedAttempt.state, 'completed');
    const output = app.stepOutput.list().find((item) => item.stepAttemptId === delegatedAttempt.id && item.outputName === 'delegated-result');
    assert.equal(output.value.kind, 'delegation-receipt');
    assert.equal(output.value.receiptDigest, receipt.receiptDigest);
    const handoff = app.agentHandoff.list().find((item) => item.missionRunId === 'source-run-1' && item.toStepId === 'source-step-join' && item.inputName === 'delegated-input');
    assert.ok(handoff);

    const downstream = app.stepAttempt.list().find((item) => item.missionRunId === 'source-run-1' && item.stepId === 'source-step-join');
    assert.equal(downstream.state, 'completed');
    assert.equal(app.missionRun.get('source-run-1').state, 'completed');
    assert.equal(app.workerManager.submissions.length, 0);

    const counts = {
      attempts: app.stepAttempt.list().length,
      outputs: app.stepOutput.list().length,
      handoffs: app.agentHandoff.list().length,
      consumptions: app.delegationReceiptConsumption.list().length,
    };
    const repeated = app.consumeDelegationReceipt({ workspaceId: 'workspace-a', receiptMirrorId: receipt.id });
    assert.equal(repeated.id, consumed.id);
    assert.deepEqual({
      attempts: app.stepAttempt.list().length,
      outputs: app.stepOutput.list().length,
      handoffs: app.agentHandoff.list().length,
      consumptions: app.delegationReceiptConsumption.list().length,
    }, counts);
  } finally { app.close(); }
});

test('S8 stale source Mission revision cannot consume a delegation receipt', () => {
  const app = service();
  try {
    const mission = prepareSourceMission(app);
    const request = bindOutboundDelegation(app, mission);
    const install = app.installCapability({ workspaceId: 'workspace-a', packageId: 'local.mission-transform', version: '1.0.0' });
    app.createRevision({
      id: 'source-revision-2', workspaceId: 'workspace-a', missionId: mission.mission.id, revision: 2,
      objective: 'newer source revision', terminalStepIds: ['new-step'],
      steps: [{
        id: 'new-step', name: 'New current step', agentId: 'agent-a2', installationId: install.id,
        capabilityVersionId: 'local.mission-transform@1.0.0', action: 'transform_payload', target: 'local://mission-transform',
        dependsOn: [], declaredInputs: [], declaredOutputs: ['new-result'], evidenceRequirements: ['local-transform-evidence'],
        humanGatePolicy: 'never', resourceRequirements: [], payload: 'new',
      }],
    });
    app.startMission({ workspaceId: 'workspace-a', missionId: mission.mission.id, revisionId: mission.revision.id, runId: 'source-run-old-revision' });
    const receipt = mirrorCompletedReceipt(app, request);
    assert.throws(() => app.consumeDelegationReceipt({ workspaceId: 'workspace-a', receiptMirrorId: receipt.id }), /source_mission_revision_stale/);
  } finally { app.close(); }
});
