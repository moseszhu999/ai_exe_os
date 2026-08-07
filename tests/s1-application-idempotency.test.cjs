'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { S1ApplicationService, LOCAL_TARGET } = require('../src/application/s1-application-service.cjs');

class FakeWorkerManager {
  constructor({ failSubmission = false } = {}) { this.workers = []; this.submissions = []; this.failSubmission = failSubmission; }
  list() { return this.workers.map((worker) => ({ ...worker })); }
  create(input) { const worker = { ...input, status: 'created' }; this.workers.push(worker); return worker; }
  async submitAuthorizedLocalTask(input) {
    this.submissions.push({ ...input });
    if (this.failSubmission) throw new Error('submission outcome uncertain');
    return { worker: { id: input.workerId, status: 'waiting_human' }, result: `accepted:${input.payload}` };
  }
}

function service(workerManager = new FakeWorkerManager()) {
  return new S1ApplicationService({ databasePath: ':memory:', workerManager, clock: () => '2026-08-07T00:00:00.000Z' });
}

function prepare(current) {
  const installation = current.installCapability({ workspaceId: 'workspace-a' });
  current.grantCapability({ workspaceId: 'workspace-a', agentId: 'agent-a', installationId: installation.id });
  return installation;
}

test('same Task and Grant semantic keys reject changed intent', () => {
  const current = service();
  const installation = prepare(current);
  assert.throws(() => current.grantCapability({
    workspaceId: 'workspace-a', agentId: 'agent-a', installationId: installation.id,
    allowedActions: ['different_action'], allowedTargets: [LOCAL_TARGET],
  }), /Grant idempotency collision/);
  const input = {
    id: 'task-idempotent', workspaceId: 'workspace-a', agentId: 'agent-a', installationId: installation.id,
    workerId: 's1-worker-chromium', target: LOCAL_TARGET, payload: 'first',
  };
  const created = current.createTask(input);
  assert.equal(current.createTask(input).task.id, created.task.id);
  assert.throws(() => current.createTask({ ...input, payload: 'changed' }), /Task idempotency collision/);
  current.close();
});

test('uncertain execution cannot be replayed by repeating approval', async () => {
  const workers = new FakeWorkerManager({ failSubmission: true });
  const current = service(workers);
  const installation = prepare(current);
  const created = current.createTask({
    id: 'task-uncertain', workspaceId: 'workspace-a', agentId: 'agent-a', installationId: installation.id,
    workerId: 's1-worker-chromium', target: LOCAL_TARGET, payload: 'uncertain',
  });
  await assert.rejects(() => current.approveHumanGate({ gateId: created.gate.id }), /submission outcome uncertain/);
  assert.equal(workers.submissions.length, 1);
  await assert.rejects(() => current.approveHumanGate({ gateId: created.gate.id }), /cannot be replayed/);
  assert.equal(workers.submissions.length, 1);
  current.close();
});
