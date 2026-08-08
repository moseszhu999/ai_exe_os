'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { S6SchedulingApplicationService } = require('../src/application/s6-scheduler-service.cjs');
const { boundedId } = require('../src/application/s6-index.cjs');

class FakeWorkerManager {
  constructor() {
    this.workers = [
      { id: 's1-worker-chrome', projectId: 's1-local-project', role: 'review', status: 'idle', browserChannel: 'chrome' },
      { id: 's1-worker-chromium', projectId: 's1-local-project', role: 'implementation', status: 'idle', browserChannel: 'chromium' },
    ];
    this.startCalls = 0;
    this.submitCalls = 0;
  }
  list() { return this.workers.map((item) => ({ ...item })); }
  async start() { this.startCalls += 1; throw new Error('scheduler repair must not start Worker directly'); }
  async submitAuthorizedLocalTask() { this.submitCalls += 1; throw new Error('scheduler repair must not submit without HumanGate'); }
  async focus() { throw new Error('unused'); }
  async stop() { throw new Error('unused'); }
  pause() { throw new Error('unused'); }
  resume() { throw new Error('unused'); }
}

function recordPolicy(service, overrides = {}) {
  return service.recordSchedulingPolicy({
    id: 's6-policy-workspace-a-v1',
    workspaceId: 'workspace-a',
    version: '1.0.0',
    status: 'active',
    globalMaxActive: 2,
    workspaceMaxActive: 2,
    priorityOrder: ['critical', 'high', 'normal', 'low'],
    fairness: { mode: 'bounded-aging', agingIntervalSeconds: 300, maxPriorityBoostSteps: 1 },
    sessionReuse: 'compatible-only',
    createdAt: '2026-08-08T00:00:00.000Z',
    ...overrides,
  });
}

function prepareMission(service) {
  const install = service.installCapability({ workspaceId: 'workspace-a', packageId: 'local.form-submit', version: '1.0.0' });
  service.grantCapability({
    workspaceId: 'workspace-a',
    agentId: 'agent-a',
    installationId: install.id,
    allowedActions: ['submit_payload'],
    allowedTargets: [service.localTarget],
  });
  service.createMission({ id: 's6-mission', workspaceId: 'workspace-a', title: 'S6 bounded scheduling mission', objective: 'three ready steps for two assignment slots' });
  return service.createRevision({
    id: 's6-revision',
    workspaceId: 'workspace-a',
    missionId: 's6-mission',
    revision: 1,
    objective: 'exercise priority and capacity before S2 creates attempts',
    terminalStepIds: ['step-high', 'step-normal', 'step-low'],
    steps: [
      {
        id: 'step-low', name: 'Low priority Chrome work', agentId: 'agent-a', installationId: install.id,
        capabilityVersionId: 'local.form-submit@1.0.0', action: 'submit_payload', target: service.localTarget,
        workerId: 's1-worker-chrome', dependsOn: [], declaredInputs: [], declaredOutputs: ['low-result'],
        evidenceRequirements: ['local result text'], humanGatePolicy: 'action', resourceRequirements: [], priority: 'low', payload: 'low',
      },
      {
        id: 'step-normal', name: 'Normal priority Chromium work', agentId: 'agent-a', installationId: install.id,
        capabilityVersionId: 'local.form-submit@1.0.0', action: 'submit_payload', target: service.localTarget,
        workerId: 's1-worker-chromium', dependsOn: [], declaredInputs: [], declaredOutputs: ['normal-result'],
        evidenceRequirements: ['local result text'], humanGatePolicy: 'action', resourceRequirements: [], priority: 'normal', payload: 'normal',
      },
      {
        id: 'step-high', name: 'High priority Chrome work', agentId: 'agent-a', installationId: install.id,
        capabilityVersionId: 'local.form-submit@1.0.0', action: 'submit_payload', target: service.localTarget,
        workerId: 's1-worker-chrome', dependsOn: [], declaredInputs: [], declaredOutputs: ['high-result'],
        evidenceRequirements: ['local result text'], humanGatePolicy: 'action', resourceRequirements: [], priority: 'high', payload: 'high',
      },
    ],
  });
}

test('S6 scheduler consumes policy proposal before S2 creates attempts and reserves at most explicit capacity', () => {
  const workerManager = new FakeWorkerManager();
  const service = new S6SchedulingApplicationService({
    databasePath: ':memory:',
    workerManager,
    clock: () => '2026-08-08T00:05:00.000Z',
    localTarget: 'http://127.0.0.1:43119/task-form.html',
  });
  try {
    recordPolicy(service);
    prepareMission(service);
    const started = service.startMission({ workspaceId: 'workspace-a', missionId: 's6-mission', revisionId: 's6-revision', runId: 's6-run' });
    assert.equal(started.run.state, 'running');

    const state = service.queryMissionState('workspace-a');
    const attempts = state.stepAttempts.filter((item) => item.missionRunId === 's6-run');
    assert.equal(attempts.length, 2, 'capacity two must create exactly two S2 attempts');
    assert.deepEqual(attempts.map((item) => item.stepId).sort(), ['step-high', 'step-normal']);
    assert.ok(attempts.every((item) => item.state === 'waiting_human'));
    assert.equal(state.humanGates.filter((gate) => gate.state === 'requested').length, 2);

    const readPlan = state.plans.find((item) => item.id === 'missionplan-s6-revision');
    assert.equal(readPlan.steps.find((item) => item.id === 'step-low').state, 'ready');

    const proposals = service.assignmentProposal.list().filter((item) => item.workspaceId === 'workspace-a');
    assert.equal(proposals.length, 2);
    assert.deepEqual(proposals.map((item) => item.state), ['accepted', 'accepted']);
    assert.deepEqual(new Set(proposals.map((item) => item.workerId)), new Set(['s1-worker-chrome', 's1-worker-chromium']));
    assert.equal(proposals[0].candidateId, boundedId('schedcand', 's6-run', 'step-high'));
    assert.equal(proposals[1].candidateId, boundedId('schedcand', 's6-run', 'step-normal'));

    const decisions = service.schedulingDecision.list().filter((item) => item.workspaceId === 'workspace-a');
    assert.equal(decisions[0].selectedCandidateId, boundedId('schedcand', 's6-run', 'step-high'));
    assert.ok(decisions.some((item) => item.selectedCandidateId === null && item.reasonCodes.includes('no_assignment')));

    const locks = service.locks.list().filter((item) => item.resourceType === 'browser_profile');
    assert.deepEqual(new Set(locks.map((item) => item.resourceKey)), new Set(['s1-worker-chrome', 's1-worker-chromium']));
    const scheduling = service.querySchedulingState('workspace-a');
    assert.equal(scheduling.capacity.workspaceActive, 2);
    assert.equal(scheduling.capacity.workspaceMaxActive, 2);
    assert.deepEqual(scheduling.eligibleQueue.map((item) => item.id), [boundedId('schedcand', 's6-run', 'step-low')]);

    assert.equal(workerManager.startCalls, 0);
    assert.equal(workerManager.submitCalls, 0);
  } finally {
    service.close();
  }
});

test('without an S6 policy the inherited S2 scheduler behavior remains unchanged', () => {
  const workerManager = new FakeWorkerManager();
  const service = new S6SchedulingApplicationService({
    databasePath: ':memory:',
    workerManager,
    clock: () => '2026-08-08T00:05:00.000Z',
    localTarget: 'http://127.0.0.1:43119/task-form.html',
  });
  try {
    prepareMission(service);
    service.startMission({ workspaceId: 'workspace-a', missionId: 's6-mission', revisionId: 's6-revision', runId: 's6-run-no-policy' });
    const attempts = service.queryMissionState('workspace-a').stepAttempts.filter((item) => item.missionRunId === 's6-run-no-policy');
    assert.equal(attempts.length, 3, 'legacy S2 eagerly schedules the complete root ready-set when no S6 policy exists');
    assert.equal(service.schedulingDecision.list().length, 0);
  } finally {
    service.close();
  }
});

test('priority metadata is immutable per plan step and defaults to normal', () => {
  const workerManager = new FakeWorkerManager();
  const service = new S6SchedulingApplicationService({ databasePath: ':memory:', workerManager, localTarget: 'http://127.0.0.1:43119/task-form.html' });
  try {
    const revision = prepareMission(service);
    const priorities = service.schedulingPriority.list().filter((item) => item.planId === revision.plan.id);
    assert.equal(priorities.find((item) => item.stepId === 'step-high').priority, 'high');
    assert.equal(priorities.find((item) => item.stepId === 'step-normal').priority, 'normal');
    assert.equal(priorities.find((item) => item.stepId === 'step-low').priority, 'low');
    assert.throws(() => service.createRevision({
      id: 's6-invalid-revision', workspaceId: 'workspace-a', missionId: 's6-mission', revision: 2, objective: 'invalid priority', terminalStepIds: ['invalid-step'],
      steps: [{
        id: 'invalid-step', name: 'invalid', agentId: 'agent-a', installationId: service.installation.list()[0].id,
        capabilityVersionId: 'local.form-submit@1.0.0', action: 'submit_payload', target: service.localTarget,
        workerId: 's1-worker-chrome', dependsOn: [], declaredInputs: [], declaredOutputs: ['result'], evidenceRequirements: [], humanGatePolicy: 'action', resourceRequirements: [], priority: 'urgent',
      }],
    }), /Invalid S6 scheduling priority/);
  } finally {
    service.close();
  }
});
