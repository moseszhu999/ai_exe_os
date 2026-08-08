'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { S6SchedulingApplicationService } = require('../src/application/s6-scheduler-service.cjs');
const { boundedId } = require('../src/application/s6-index.cjs');

class FakeWorkerManager {
  constructor(status = 'idle') {
    this.workers = [
      { id: 's1-worker-chrome', projectId: 's1-local-project', role: 'review', status, browserChannel: 'chrome' },
      { id: 's1-worker-chromium', projectId: 's1-local-project', role: 'implementation', status, browserChannel: 'chromium' },
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

function prepareMission(service, { includeLow = true } = {}) {
  const install = service.installCapability({ workspaceId: 'workspace-a', packageId: 'local.form-submit', version: '1.0.0' });
  const targets = {
    high: `${service.localTarget}?s6-slot=high`,
    normal: `${service.localTarget}?s6-slot=normal`,
    low: `${service.localTarget}?s6-slot=low`,
  };
  service.grantCapability({
    workspaceId: 'workspace-a',
    agentId: 'agent-a',
    installationId: install.id,
    allowedActions: ['submit_payload'],
    allowedTargets: Object.values(targets),
  });
  service.createMission({ id: 's6-mission', workspaceId: 'workspace-a', title: 'S6 bounded scheduling mission', objective: 'ready steps for bounded assignment slots' });
  const steps = [
    {
      id: 'step-normal', name: 'Normal priority Chromium work', agentId: 'agent-a', installationId: install.id,
      capabilityVersionId: 'local.form-submit@1.0.0', action: 'submit_payload', target: targets.normal,
      workerId: 's1-worker-chromium', dependsOn: [], declaredInputs: [], declaredOutputs: ['normal-result'],
      evidenceRequirements: ['local result text'], humanGatePolicy: 'action', resourceRequirements: [], priority: 'normal', payload: 'normal',
    },
    {
      id: 'step-high', name: 'High priority Chrome work', agentId: 'agent-a', installationId: install.id,
      capabilityVersionId: 'local.form-submit@1.0.0', action: 'submit_payload', target: targets.high,
      workerId: 's1-worker-chrome', dependsOn: [], declaredInputs: [], declaredOutputs: ['high-result'],
      evidenceRequirements: ['local result text'], humanGatePolicy: 'action', resourceRequirements: [], priority: 'high', payload: 'high',
    },
  ];
  if (includeLow) {
    steps.unshift({
      id: 'step-low', name: 'Low priority Chrome work', agentId: 'agent-a', installationId: install.id,
      capabilityVersionId: 'local.form-submit@1.0.0', action: 'submit_payload', target: targets.low,
      workerId: 's1-worker-chrome', dependsOn: [], declaredInputs: [], declaredOutputs: ['low-result'],
      evidenceRequirements: ['local result text'], humanGatePolicy: 'action', resourceRequirements: [], priority: 'low', payload: 'low',
    });
  }
  return service.createRevision({
    id: 's6-revision',
    workspaceId: 'workspace-a',
    missionId: 's6-mission',
    revision: 1,
    objective: 'exercise priority and capacity before S2 creates attempts',
    terminalStepIds: steps.map((step) => step.id),
    steps,
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
    const revision = prepareMission(service);
    const started = service.startMission({ workspaceId: 'workspace-a', missionId: 's6-mission', revisionId: 's6-revision', runId: 's6-run' });
    assert.equal(started.run.state, 'running');

    const state = service.queryMissionState('workspace-a');
    const attempts = state.stepAttempts.filter((item) => item.missionRunId === 's6-run');
    assert.equal(attempts.length, 2, 'capacity two must create exactly two S2 attempts');
    assert.deepEqual(attempts.map((item) => item.stepId).sort(), ['step-high', 'step-normal']);
    assert.ok(attempts.every((item) => item.state === 'waiting_human'));
    assert.equal(state.humanGates.filter((gate) => gate.state === 'requested').length, 2);

    const readPlan = state.plans.find((item) => item.id === revision.plan.id);
    assert.equal(readPlan.steps.find((item) => item.id === 'step-low').state, 'ready');

    const proposals = service.assignmentProposal.list().filter((item) => item.workspaceId === 'workspace-a');
    assert.equal(proposals.length, 2);
    assert.ok(proposals.every((item) => item.state === 'accepted'));
    assert.deepEqual(new Set(proposals.map((item) => item.workerId)), new Set(['s1-worker-chrome', 's1-worker-chromium']));
    assert.ok(proposals.some((item) => item.candidateId === boundedId('schedcand', 's6-run', 'step-high')));
    assert.ok(proposals.some((item) => item.candidateId === boundedId('schedcand', 's6-run', 'step-normal')));

    const decisions = service.schedulingDecision.list().filter((item) => item.workspaceId === 'workspace-a');
    assert.ok(decisions.some((item) => item.selectedCandidateId === boundedId('schedcand', 's6-run', 'step-high')));
    assert.ok(decisions.some((item) => item.selectedCandidateId === null && item.reasonCodes.includes('no_assignment')));

    const locks = service.locks.list().filter((item) => item.resourceType === 'browser_profile');
    assert.deepEqual(new Set(locks.map((item) => item.resourceKey)), new Set(['s1-worker-chrome', 's1-worker-chromium']));
    assert.equal(service.locks.list().filter((item) => item.resourceType === 'provider_surface').length, 2);
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

test('ready action-gated work is schedulable, while the resulting waiting_human attempt is not re-scheduled', () => {
  const service = new S6SchedulingApplicationService({
    databasePath: ':memory:', workerManager: new FakeWorkerManager(), clock: () => '2026-08-08T00:05:00.000Z',
    localTarget: 'http://127.0.0.1:43119/task-form.html',
  });
  try {
    recordPolicy(service, { globalMaxActive: 1, workspaceMaxActive: 1 });
    prepareMission(service, { includeLow: false });
    service.startMission({ workspaceId: 'workspace-a', missionId: 's6-mission', revisionId: 's6-revision', runId: 's6-run-gate' });
    const state = service.queryMissionState('workspace-a');
    const attempts = state.stepAttempts.filter((item) => item.missionRunId === 's6-run-gate');
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].stepId, 'step-high');
    assert.equal(attempts[0].state, 'waiting_human');
    assert.equal(service.assignmentProposal.list().length, 1);
    assert.equal(service.querySchedulingState('workspace-a').eligibleQueue.some((item) => item.id === boundedId('schedcand', 's6-run-gate', 'step-high')), false);
  } finally {
    service.close();
  }
});

test('live browser sessions are eligible capacity supply until S1 browser-profile locks reserve them', () => {
  const workerManager = new FakeWorkerManager('active');
  const service = new S6SchedulingApplicationService({
    databasePath: ':memory:', workerManager, clock: () => '2026-08-08T00:05:00.000Z',
    localTarget: 'http://127.0.0.1:43119/task-form.html',
  });
  try {
    const policy = recordPolicy(service);
    const workers = service.safeWorkerSnapshots('workspace-a');
    assert.deepEqual(workers.map((item) => item.status), ['eligible', 'eligible']);
    assert.deepEqual(workers.map((item) => item.activeAssignmentCount), [0, 0]);
    const budgets = service.concurrencyBudgets('workspace-a', policy);
    assert.equal(budgets.globalBudget.activeObserved, 0);
    assert.equal(budgets.workspaceBudget.activeObserved, 0);
  } finally {
    service.close();
  }
});

test('S6 candidate resource set includes implicit S1 provider-surface reservation', () => {
  const service = new S6SchedulingApplicationService({
    databasePath: ':memory:', workerManager: new FakeWorkerManager(), clock: () => '2026-08-08T00:05:00.000Z',
    localTarget: 'http://127.0.0.1:43119/task-form.html',
  });
  try {
    recordPolicy(service, { globalMaxActive: 1, workspaceMaxActive: 1 });
    prepareMission(service, { includeLow: false });
    service.startMission({ workspaceId: 'workspace-a', missionId: 's6-mission', revisionId: 's6-revision', runId: 's6-run-resource' });
    const scheduling = service.schedulingInputs('workspace-a', service.activeSchedulingPolicy('workspace-a'));
    const remaining = scheduling.derived.candidates[0];
    assert.ok(remaining.requiredResources.length >= 1);
    assert.equal(remaining.requiredResources.some((resourceId) => scheduling.blockedResources.includes(resourceId)), false, 'independent query targets must not collide');
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
    prepareMission(service, { includeLow: false });
    service.startMission({ workspaceId: 'workspace-a', missionId: 's6-mission', revisionId: 's6-revision', runId: 's6-run-no-policy' });
    const attempts = service.queryMissionState('workspace-a').stepAttempts.filter((item) => item.missionRunId === 's6-run-no-policy');
    assert.equal(attempts.length, 2, 'legacy S2 eagerly schedules the distinct-worker/distinct-surface root ready-set when no S6 policy exists');
    assert.equal(service.schedulingDecision.list().length, 0);
  } finally {
    service.close();
  }
});

test('priority metadata is immutable per plan step and invalid priority fails before S2 persistence', () => {
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
    assert.equal(service.missionRevision.get('s6-invalid-revision'), null, 'invalid priority must fail before S2 revision persistence');
  } finally {
    service.close();
  }
});
