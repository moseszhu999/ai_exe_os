'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { S1ApplicationService, LOCAL_TARGET } = require('../src/application/s1-application-service.cjs');

class FakeWorkerManager {
  constructor() { this.workers = []; this.submissions = []; }
  list() { return this.workers.map((worker) => ({ ...worker })); }
  create(input) {
    const worker = { ...input, status: 'created', lastKnownUrl: null };
    this.workers.push(worker);
    return { ...worker };
  }
  async submitAuthorizedLocalTask(input) {
    this.submissions.push({ ...input });
    return { worker: { id: input.workerId, status: 'waiting_human' }, result: `accepted:${input.payload}` };
  }
}

function harness(databasePath = null, workerManager = new FakeWorkerManager()) {
  const root = mkdtempSync(join(tmpdir(), 's1-app-'));
  const path = databasePath || join(root, 'state.sqlite');
  const service = new S1ApplicationService({ databasePath: path, workerManager, clock: () => '2026-08-07T00:00:00.000Z' });
  return { service, databasePath: path, workerManager };
}

function prepareWorkspaceA(service) {
  const installation = service.installCapability({ workspaceId: 'workspace-a' });
  const grant = service.grantCapability({ workspaceId: 'workspace-a', agentId: 'agent-a', installationId: installation.id });
  return { installation, grant };
}

test('seeds two Workspaces, Marketplace, Agents and isolated workers', () => {
  const { service } = harness();
  const stateA = service.queryState('workspace-a');
  const stateB = service.queryState('workspace-b');
  assert.equal(stateA.workspaces.length, 2);
  assert.equal(stateA.marketplace.some((item) => item.packageId === 'local.form-submit'), true);
  assert.equal(stateA.agents.length, 1);
  assert.equal(stateA.agents[0].id, 'agent-a');
  assert.equal(stateA.agents.some((item) => item.id === 'agent-b'), false);
  assert.equal(stateB.agents.length, 1);
  assert.equal(stateB.agents[0].id, 'agent-b');
  assert.equal(stateB.agents.some((item) => item.id === 'agent-a'), false);
  assert.equal(stateA.workers.length, 2);
  assert.equal(stateB.workers.length, 0);
  service.close();
});

test('Workspace without installation or grant is blocked before runtime submission', () => {
  const { service, workerManager } = harness();
  const result = service.createTask({
    id: 'task-b', workspaceId: 'workspace-b', agentId: 'agent-b', installationId: 'install-missing',
    workerId: 's1-worker-chromium', target: LOCAL_TARGET, payload: 'blocked',
  });
  assert.equal(result.run.state, 'blocked');
  assert.equal(result.task.state, 'waiting_resource');
  assert.deepEqual(result.run.blockers.map((item) => item.code), ['installation_missing_or_disabled', 'grant_missing_or_revoked']);
  assert.equal(result.gate, null);
  assert.equal(workerManager.submissions.length, 0);
  service.close();
});

test('Human Gate rejection performs zero submission and persists cancellation', () => {
  const { service, workerManager } = harness();
  const { installation } = prepareWorkspaceA(service);
  const created = service.createTask({
    id: 'task-reject', workspaceId: 'workspace-a', agentId: 'agent-a', installationId: installation.id,
    workerId: 's1-worker-chromium', target: LOCAL_TARGET, payload: 'reject me',
  });
  assert.equal(created.gate.state, 'requested');
  service.rejectHumanGate({ gateId: created.gate.id });
  assert.equal(workerManager.submissions.length, 0);
  assert.equal(service.task.get('task-reject').state, 'cancelled');
  service.close();
});

test('approved task submits exactly once, records result/evidence, and repeat approval is a no-op', async () => {
  const { service, workerManager } = harness();
  const { installation } = prepareWorkspaceA(service);
  const created = service.createTask({
    id: 'task-approve', workspaceId: 'workspace-a', agentId: 'agent-a', installationId: installation.id,
    workerId: 's1-worker-chromium', target: LOCAL_TARGET, payload: 'approved',
  });
  const first = await service.approveHumanGate({ gateId: created.gate.id });
  const second = await service.approveHumanGate({ gateId: created.gate.id });
  assert.equal(first.run.state, 'result_observed');
  assert.equal(second.changed, false);
  assert.equal(workerManager.submissions.length, 1);
  assert.equal(service.evidence.list().length, 1);
  assert.equal(service.task.get('task-approve').state, 'waiting_human');
  service.close();
});

test('restart rehydrates install, grant, task, gate, run and evidence without replay', async () => {
  const workerManager = new FakeWorkerManager();
  const first = harness(null, workerManager);
  const { installation } = prepareWorkspaceA(first.service);
  const created = first.service.createTask({
    id: 'task-restart', workspaceId: 'workspace-a', agentId: 'agent-a', installationId: installation.id,
    workerId: 's1-worker-chromium', target: LOCAL_TARGET, payload: 'restart',
  });
  await first.service.approveHumanGate({ gateId: created.gate.id });
  assert.equal(workerManager.submissions.length, 1);
  first.service.close();

  const secondManager = new FakeWorkerManager();
  const second = harness(first.databasePath, secondManager);
  const state = second.service.queryState('workspace-a');
  assert.equal(state.installations.length, 1);
  assert.equal(state.grants.length, 1);
  assert.equal(state.tasks.some((item) => item.id === 'task-restart'), true);
  assert.equal(state.evidence.length, 1);
  const repeated = await second.service.approveHumanGate({ gateId: created.gate.id });
  assert.equal(repeated.changed, false);
  assert.equal(secondManager.submissions.length, 0);
  second.service.close();
});

test('active execution on restart is contained to waiting_human without submission', () => {
  const first = harness();
  first.service.executionRun.save({ id: 'run-crash', workspaceId: 'workspace-a', taskId: 'task-crash', state: 'active', workerId: 's1-worker-chromium' }, 'test_crash');
  first.service.task.save({ id: 'task-crash', workspaceId: 'workspace-a', state: 'active', blockers: [] }, 'test_crash');
  first.service.close();

  const secondManager = new FakeWorkerManager();
  const second = harness(first.databasePath, secondManager);
  assert.equal(second.service.executionRun.get('run-crash').state, 'waiting_human');
  assert.equal(second.service.task.get('task-crash').state, 'waiting_human');
  assert.equal(secondManager.submissions.length, 0);
  second.service.close();
});
