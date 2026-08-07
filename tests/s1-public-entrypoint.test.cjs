'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { S1ApplicationService } = require('../src/application/index.cjs');

class FakeWorkerManager {
  constructor(workers = []) { this.workers = workers; this.submissions = []; }
  list() { return this.workers.map((worker) => ({ ...worker })); }
  create(input) { const worker = { ...input, status: 'created' }; this.workers.push(worker); return worker; }
  async submitAuthorizedLocalTask(input) { this.submissions.push(input); return { result: 'ok' }; }
}

function prepare(service) {
  const installation = service.installCapability({ workspaceId: 'workspace-a' });
  service.grantCapability({ workspaceId: 'workspace-a', agentId: 'agent-a', installationId: installation.id });
  return installation;
}

test('unprovisioned bound Worker blocks before Human Gate and exposes actual local target', () => {
  const workers = new FakeWorkerManager();
  const service = new S1ApplicationService({
    databasePath: ':memory:',
    workerManager: workers,
    localTarget: 'http://127.0.0.1:43210/task-form.html',
  });
  const installation = prepare(service);
  const created = service.createTask({
    id: 'task-worker-blocked', workspaceId: 'workspace-a', agentId: 'agent-a',
    installationId: installation.id, workerId: 's1-worker-chromium', payload: 'hello',
  });
  assert.equal(service.queryState('workspace-a').localTarget, 'http://127.0.0.1:43210/task-form.html');
  assert.equal(created.run.state, 'blocked');
  assert.equal(created.gate, null);
  assert.equal(created.run.blockers[0].code, 'resource_conflict');
  assert.equal(created.run.blockers[0].detail.reason, 'worker_unavailable');
  assert.equal(workers.submissions.length, 0);
  service.close();
});

test('same-Workspace idle Worker permits the persisted Human Gate flow', () => {
  const workers = new FakeWorkerManager([{
    id: 's1-worker-chromium', projectId: 's1-local-project', role: 'implementation',
    browserChannel: 'chromium', status: 'idle',
  }]);
  const service = new S1ApplicationService({
    databasePath: ':memory:',
    workerManager: workers,
    localTarget: 'http://127.0.0.1:43210/task-form.html',
  });
  const installation = prepare(service);
  const created = service.createTask({
    id: 'task-worker-ready', workspaceId: 'workspace-a', agentId: 'agent-a',
    installationId: installation.id, workerId: 's1-worker-chromium', payload: 'hello',
  });
  assert.equal(created.run.state, 'waiting_human');
  assert.equal(created.gate.state, 'requested');
  assert.equal(created.task.target, 'http://127.0.0.1:43210/task-form.html');
  service.close();
});

test('Electron composition uses the S2 public entrypoint while preserving the S1 public service chain and local target', () => {
  const main = readFileSync(join(__dirname, '..', 'src/main/main.cjs'), 'utf8');
  const s2Service = readFileSync(join(__dirname, '..', 'src/application/s2-application-service.cjs'), 'utf8');
  assert.match(main, /require\('\.\.\/application\/s2-index\.cjs'\)/);
  assert.match(s2Service, /require\('\.\/index\.cjs'\)/);
  assert.match(main, /localTarget: `\$\{testBaseUrl\}\/task-form\.html`/);
});
