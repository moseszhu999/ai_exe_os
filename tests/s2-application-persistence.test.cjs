'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const {
  S2ApplicationService,
  LOCAL_JOIN_TARGET,
  LOCAL_TRANSFORM_PACKAGE_ID,
  LOCAL_TRANSFORM_TARGET,
  LOCAL_TRANSFORM_VERSION,
} = require('../src/application/s2-index.cjs');

const FORM_VERSION = 'local.form-submit@1.0.0';
const TRANSFORM_VERSION = `${LOCAL_TRANSFORM_PACKAGE_ID}@${LOCAL_TRANSFORM_VERSION}`;

class FakeWorkerManager {
  constructor() {
    this.submissionCount = 0;
    this.workers = [
      { id: 's1-worker-chrome', status: 'idle', browserChannel: 'chrome' },
      { id: 's1-worker-chromium', status: 'idle', browserChannel: 'chromium' },
    ];
  }
  list() { return this.workers.map((item) => ({ ...item })); }
  async submitAuthorizedLocalTask(input) {
    this.submissionCount += 1;
    return {
      worker: { id: input.workerId, status: 'waiting_human' },
      result: { ok: true, payload: input.payload, observed: 'durable-local-result' },
    };
  }
}

function bootstrap(service) {
  const formInstall = service.installCapability({ workspaceId: 'workspace-a', packageId: 'local.form-submit', version: '1.0.0' });
  const transformInstall = service.installCapability({ workspaceId: 'workspace-a', packageId: LOCAL_TRANSFORM_PACKAGE_ID, version: LOCAL_TRANSFORM_VERSION });
  service.grantCapability({ workspaceId: 'workspace-a', agentId: 'agent-a', installationId: formInstall.id, allowedActions: ['submit_payload'], allowedTargets: [service.localTarget] });
  service.grantCapability({ workspaceId: 'workspace-a', agentId: 'agent-a2', installationId: transformInstall.id, allowedActions: ['transform_payload', 'join_payload'], allowedTargets: [LOCAL_TRANSFORM_TARGET, LOCAL_JOIN_TARGET] });
  const { mission } = service.createMission({ id: 'mission-persist', workspaceId: 'workspace-a', title: 'Persistent mission', objective: 'prove restart state and no replay' });
  const { revision } = service.createRevision({
    workspaceId: 'workspace-a', missionId: mission.id, id: 'mission-persist-rev-1', revision: 1,
    objective: mission.objective, terminalStepIds: ['step-c'],
    steps: [
      { id: 'step-a', name: 'Browser', agentId: 'agent-a', installationId: formInstall.id, capabilityVersionId: FORM_VERSION, action: 'submit_payload', target: service.localTarget, workerId: 's1-worker-chromium', dependsOn: [], declaredInputs: [], declaredOutputs: ['result_a'], evidenceRequirements: ['local result text'], humanGatePolicy: 'action', payload: 'persist-me' },
      { id: 'step-b', name: 'Transform', agentId: 'agent-a2', installationId: transformInstall.id, capabilityVersionId: TRANSFORM_VERSION, action: 'transform_payload', target: LOCAL_TRANSFORM_TARGET, dependsOn: [], declaredInputs: [], declaredOutputs: ['result_b'], evidenceRequirements: ['local-transform-evidence'], humanGatePolicy: 'never', payload: 'local' },
      { id: 'step-c', name: 'Join', agentId: 'agent-a2', installationId: transformInstall.id, capabilityVersionId: TRANSFORM_VERSION, action: 'join_payload', target: LOCAL_JOIN_TARGET, dependsOn: ['step-a', 'step-b'], declaredInputs: [{ name: 'input_a', fromStepId: 'step-a', outputName: 'result_a' }, { name: 'input_b', fromStepId: 'step-b', outputName: 'result_b' }], declaredOutputs: ['final_result'], evidenceRequirements: ['final-evidence'], humanGatePolicy: 'never' },
    ],
  });
  return { mission, revision };
}

test('completed Mission rehydrates from SQLite without replaying external effect', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ai-exe-s2-persist-'));
  const databasePath = join(root, 'state.sqlite');
  try {
    const firstManager = new FakeWorkerManager();
    const first = new S2ApplicationService({ workerManager: firstManager, databasePath, localTarget: 'http://127.0.0.1:43119/task-form.html' });
    const { mission, revision } = bootstrap(first);
    first.startMission({ workspaceId: 'workspace-a', missionId: mission.id, revisionId: revision.id, runId: 'mission-persist-run' });
    const gate = first.queryMissionState('workspace-a').humanGates.find((item) => item.state === 'requested');
    await first.approveHumanGate({ gateId: gate.id });
    assert.equal(firstManager.submissionCount, 1);
    const before = first.queryMissionState('workspace-a');
    assert.equal(before.missionRuns.find((item) => item.id === 'mission-persist-run').state, 'completed');
    assert.equal(before.stepAttempts.filter((item) => item.missionRunId === 'mission-persist-run').length, 3);
    assert.equal(before.agentHandoffs.filter((item) => item.missionRunId === 'mission-persist-run').length, 2);
    const checkpoint = first.recordCheckpoint({ id: 'checkpoint-complete', workspaceId: 'workspace-a', runId: 'mission-persist-run' });
    first.close();

    const secondManager = new FakeWorkerManager();
    const second = new S2ApplicationService({ workerManager: secondManager, databasePath, localTarget: 'http://127.0.0.1:43119/task-form.html' });
    const after = second.queryMissionState('workspace-a');
    assert.equal(secondManager.submissionCount, 0);
    assert.equal(after.missionRuns.find((item) => item.id === 'mission-persist-run').state, 'completed');
    assert.equal(after.stepAttempts.filter((item) => item.missionRunId === 'mission-persist-run').length, 3);
    assert.equal(after.agentHandoffs.filter((item) => item.missionRunId === 'mission-persist-run').length, 2);
    assert.equal(after.stepOutputs.some((item) => item.outputName === 'final_result'), true);
    const sameCheckpoint = second.recordCheckpoint({ id: 'checkpoint-complete', workspaceId: 'workspace-a', runId: 'mission-persist-run' });
    assert.equal(sameCheckpoint.id, checkpoint.id);
    assert.equal(sameCheckpoint.projectionDigest, checkpoint.projectionDigest);
    assert.equal(secondManager.submissionCount, 0);
    second.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('checkpoint ID is idempotent only while Mission projection state is unchanged', () => {
  const manager = new FakeWorkerManager();
  const service = new S2ApplicationService({ workerManager: manager, databasePath: ':memory:', localTarget: 'http://127.0.0.1:43119/task-form.html' });
  const { mission, revision } = bootstrap(service);
  service.startMission({ workspaceId: 'workspace-a', missionId: mission.id, revisionId: revision.id, runId: 'mission-checkpoint-run' });
  const first = service.recordCheckpoint({ id: 'checkpoint-live', workspaceId: 'workspace-a', runId: 'mission-checkpoint-run' });
  const repeated = service.recordCheckpoint({ id: 'checkpoint-live', workspaceId: 'workspace-a', runId: 'mission-checkpoint-run' });
  assert.equal(repeated, first);
  service.pauseMission({ workspaceId: 'workspace-a', runId: 'mission-checkpoint-run' });
  assert.throws(() => service.recordCheckpoint({ id: 'checkpoint-live', workspaceId: 'workspace-a', runId: 'mission-checkpoint-run' }), /checkpoint idempotency collision/i);
  assert.equal(manager.submissionCount, 0);
  service.close();
});
