'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { S2ApplicationService, LOCAL_JOIN_TARGET, LOCAL_TRANSFORM_PACKAGE_ID, LOCAL_TRANSFORM_TARGET, LOCAL_TRANSFORM_VERSION } = require('../src/application/s2-application-service.cjs');

const LOCAL_FORM_VERSION_ID = 'local.form-submit@1.0.0';
const LOCAL_TRANSFORM_VERSION_ID = `${LOCAL_TRANSFORM_PACKAGE_ID}@${LOCAL_TRANSFORM_VERSION}`;

class FakeWorkerManager {
  constructor({ failSubmit = false } = {}) {
    this.failSubmit = failSubmit;
    this.submissionCount = 0;
    this.workers = [
      { id: 's1-worker-chrome', status: 'idle', browserChannel: 'chrome' },
      { id: 's1-worker-chromium', status: 'idle', browserChannel: 'chromium' },
    ];
  }
  list() { return this.workers.map((item) => ({ ...item })); }
  async submitAuthorizedLocalTask(input) {
    this.submissionCount += 1;
    if (this.failSubmit) throw new Error('simulated browser context closed');
    return { worker: { id: input.workerId, status: 'waiting_human' }, result: { ok: true, payload: input.payload, observed: 'project-owned-local-result' } };
  }
}

function prepare({ failSubmit = false } = {}) {
  const workerManager = new FakeWorkerManager({ failSubmit });
  const service = new S2ApplicationService({ workerManager, databasePath: ':memory:', localTarget: 'http://127.0.0.1:43119/task-form.html', clock: (() => { let tick = 0; return () => `2026-08-07T03:00:${String(tick++).padStart(2, '0')}.000Z`; })() });
  const externalInstallation = service.installCapability({ workspaceId: 'workspace-a', packageId: 'local.form-submit', version: '1.0.0' });
  const transformInstallation = service.installCapability({ workspaceId: 'workspace-a', packageId: LOCAL_TRANSFORM_PACKAGE_ID, version: LOCAL_TRANSFORM_VERSION });
  service.grantCapability({ workspaceId: 'workspace-a', agentId: 'agent-a', installationId: externalInstallation.id, allowedActions: ['submit_payload'], allowedTargets: [service.localTarget] });
  service.grantCapability({ workspaceId: 'workspace-a', agentId: 'agent-a2', installationId: transformInstallation.id, allowedActions: ['transform_payload', 'join_payload'], allowedTargets: [LOCAL_TRANSFORM_TARGET, LOCAL_JOIN_TARGET] });
  const { mission } = service.createMission({ id: 'mission-a', workspaceId: 'workspace-a', title: 'Fork join mission', objective: 'Run one bounded browser step and one local transform, then join evidence' });
  const { revision, plan } = service.createRevision({
    workspaceId: 'workspace-a', missionId: mission.id, id: 'mission-rev-1', revision: 1, objective: mission.objective,
    terminalStepIds: ['step-c'],
    steps: [
      {
        id: 'step-a', name: 'Browser evidence', agentId: 'agent-a', installationId: externalInstallation.id,
        capabilityVersionId: LOCAL_FORM_VERSION_ID, action: 'submit_payload', target: service.localTarget,
        workerId: 's1-worker-chromium', dependsOn: [], declaredInputs: [], declaredOutputs: ['result_a'],
        evidenceRequirements: ['local result text'], humanGatePolicy: 'action', payload: 'S2 browser evidence payload',
      },
      {
        id: 'step-b', name: 'Local transform', agentId: 'agent-a2', installationId: transformInstallation.id,
        capabilityVersionId: LOCAL_TRANSFORM_VERSION_ID, action: 'transform_payload', target: LOCAL_TRANSFORM_TARGET,
        dependsOn: [], declaredInputs: [], declaredOutputs: ['result_b'], evidenceRequirements: ['local-transform-evidence'],
        humanGatePolicy: 'never', payload: 'deterministic local branch',
      },
      {
        id: 'step-c', name: 'Join outputs', agentId: 'agent-a2', installationId: transformInstallation.id,
        capabilityVersionId: LOCAL_TRANSFORM_VERSION_ID, action: 'join_payload', target: LOCAL_JOIN_TARGET,
        dependsOn: ['step-a', 'step-b'],
        declaredInputs: [
          { name: 'input_a', fromStepId: 'step-a', outputName: 'result_a' },
          { name: 'input_b', fromStepId: 'step-b', outputName: 'result_b' },
        ],
        declaredOutputs: ['final_result'], evidenceRequirements: ['final-evidence'], humanGatePolicy: 'never',
      },
    ],
  });
  return { service, workerManager, mission, revision, plan, externalInstallation, transformInstallation };
}

test('start creates two independent root attempts: local completes while browser waits for Human Gate', () => {
  const h = prepare();
  const started = h.service.startMission({ workspaceId: 'workspace-a', missionId: h.mission.id, revisionId: h.revision.id, runId: 'mission-run-1' });
  const state = started.state;
  const a = state.stepAttempts.find((item) => item.stepId === 'step-a');
  const b = state.stepAttempts.find((item) => item.stepId === 'step-b');
  assert.equal(a.state, 'waiting_human');
  assert.equal(b.state, 'completed');
  assert.equal(h.workerManager.submissionCount, 0);
  assert.equal(state.humanGates.filter((gate) => gate.state === 'requested').length, 1);
  assert.equal(state.agentHandoffs.some((handoff) => handoff.fromStepAttemptId === b.id && handoff.toStepId === 'step-c'), true);
  assert.equal(state.stepAttempts.some((item) => item.stepId === 'step-c'), false);
  h.service.close();
});

test('rejecting browser gate performs zero submission and blocks only its dependent path', () => {
  const h = prepare();
  h.service.startMission({ workspaceId: 'workspace-a', missionId: h.mission.id, revisionId: h.revision.id, runId: 'mission-run-1' });
  const gate = h.service.queryMissionState('workspace-a').humanGates.find((item) => item.state === 'requested');
  h.service.rejectHumanGate({ gateId: gate.id });
  const state = h.service.queryMissionState('workspace-a');
  assert.equal(h.workerManager.submissionCount, 0);
  assert.equal(state.stepAttempts.find((item) => item.stepId === 'step-a').state, 'cancelled');
  assert.equal(state.stepAttempts.find((item) => item.stepId === 'step-b').state, 'completed');
  assert.equal(state.missionRuns[0].state, 'running');
  assert.equal(state.stepAttempts.some((item) => item.stepId === 'step-c'), false);
  h.service.close();
});

test('approved browser gate submits exactly once, records handoff, joins locally, and completes Mission', async () => {
  const h = prepare();
  h.service.startMission({ workspaceId: 'workspace-a', missionId: h.mission.id, revisionId: h.revision.id, runId: 'mission-run-1' });
  const gate = h.service.queryMissionState('workspace-a').humanGates.find((item) => item.state === 'requested');
  const before = h.workerManager.submissionCount;
  await h.service.approveHumanGate({ gateId: gate.id });
  const after = h.workerManager.submissionCount;
  await h.service.approveHumanGate({ gateId: gate.id });
  const repeated = h.workerManager.submissionCount;
  const state = h.service.queryMissionState('workspace-a');
  assert.equal(after, before + 1);
  assert.equal(repeated, after);
  assert.equal(state.stepAttempts.find((item) => item.stepId === 'step-a').state, 'completed');
  assert.equal(state.stepAttempts.find((item) => item.stepId === 'step-b').state, 'completed');
  assert.equal(state.stepAttempts.find((item) => item.stepId === 'step-c').state, 'completed');
  assert.equal(state.agentHandoffs.filter((item) => item.toStepId === 'step-c').length, 2);
  assert.equal(state.stepOutputs.some((item) => item.outputName === 'final_result'), true);
  assert.equal(state.missionRuns[0].state, 'completed');
  assert.equal(state.evidence.some((item) => item.type === 'final-evidence'), true);
  h.service.close();
});

test('pause prevents a pending Human Gate from starting external effect, resume permits exactly one start', async () => {
  const h = prepare();
  h.service.startMission({ workspaceId: 'workspace-a', missionId: h.mission.id, revisionId: h.revision.id, runId: 'mission-run-1' });
  const gate = h.service.queryMissionState('workspace-a').humanGates.find((item) => item.state === 'requested');
  h.service.pauseMission({ workspaceId: 'workspace-a', runId: 'mission-run-1' });
  await assert.rejects(() => h.service.approveHumanGate({ gateId: gate.id }), /Mission is paused/);
  assert.equal(h.workerManager.submissionCount, 0);
  h.service.resumeMission({ workspaceId: 'workspace-a', runId: 'mission-run-1' });
  await h.service.approveHumanGate({ gateId: gate.id });
  assert.equal(h.workerManager.submissionCount, 1);
  h.service.close();
});

test('cancel rejects pending gate without submission and preserves completed local output/evidence', () => {
  const h = prepare();
  h.service.startMission({ workspaceId: 'workspace-a', missionId: h.mission.id, revisionId: h.revision.id, runId: 'mission-run-1' });
  const beforeOutputs = h.service.queryMissionState('workspace-a').stepOutputs.length;
  h.service.cancelMission({ workspaceId: 'workspace-a', runId: 'mission-run-1', reason: 'operator cancel' });
  const state = h.service.queryMissionState('workspace-a');
  assert.equal(h.workerManager.submissionCount, 0);
  assert.equal(state.missionRuns[0].state, 'cancelled');
  assert.equal(state.stepOutputs.length, beforeOutputs);
  assert.equal(state.stepAttempts.find((item) => item.stepId === 'step-b').state, 'completed');
  h.service.close();
});

test('uncertain external failure contains StepAttempt and reviewed retry creates a new identity without auto replay', async () => {
  const h = prepare({ failSubmit: true });
  h.service.startMission({ workspaceId: 'workspace-a', missionId: h.mission.id, revisionId: h.revision.id, runId: 'mission-run-1' });
  const gate = h.service.queryMissionState('workspace-a').humanGates.find((item) => item.state === 'requested');
  await assert.rejects(() => h.service.approveHumanGate({ gateId: gate.id }), /browser context closed/);
  const failedState = h.service.queryMissionState('workspace-a');
  const previous = failedState.stepAttempts.find((item) => item.stepId === 'step-a');
  assert.equal(previous.state, 'recovery_required');
  assert.equal(failedState.missionRuns[0].state, 'recovery_required');
  assert.equal(h.workerManager.submissionCount, 1);
  assert.throws(() => h.service.retryStepAfterReview({ workspaceId: 'workspace-a', runId: 'mission-run-1', previousAttemptId: previous.id, reviewed: false }), /human review/);
  h.workerManager.failSubmit = false;
  const retried = h.service.retryStepAfterReview({ workspaceId: 'workspace-a', runId: 'mission-run-1', previousAttemptId: previous.id, reviewed: true });
  assert.equal(retried.attemptNumber, 2);
  assert.notEqual(retried.id, previous.id);
  assert.equal(h.workerManager.submissionCount, 1);
  const newGate = h.service.queryMissionState('workspace-a').humanGates.find((item) => item.state === 'requested');
  await h.service.approveHumanGate({ gateId: newGate.id });
  assert.equal(h.workerManager.submissionCount, 2);
  h.service.close();
});

test('Workspace-scoped query never exposes another Workspace Mission', () => {
  const h = prepare();
  h.service.createMission({ id: 'mission-b', workspaceId: 'workspace-b', title: 'Workspace B Mission', objective: 'must remain isolated' });
  assert.deepEqual(h.service.queryMissionState('workspace-a').missions.map((item) => item.id), ['mission-a']);
  assert.deepEqual(h.service.queryMissionState('workspace-b').missions.map((item) => item.id), ['mission-b']);
  assert.throws(() => h.service.startMission({ workspaceId: 'workspace-b', missionId: h.mission.id, revisionId: h.revision.id }), /Cross-Workspace|Mission/);
  h.service.close();
});
