'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { S4ApplicationService } = require('../src/application/s4-index.cjs');

class FakeWorkerManager {
  constructor(workers = null) {
    this.workers = new Map((workers || [
      { id: 's1-worker-chrome', projectId: 's1-local-project', role: 'implementation', browserChannel: 'chrome', status: 'idle', profilePath: '/private/a', processId: 111 },
      { id: 's1-worker-chromium', projectId: 's1-local-project', role: 'review', browserChannel: 'chromium', status: 'idle', profilePath: '/private/b', processId: 222 },
    ]).map((worker) => [worker.id, { ...worker }]));
    this.calls = [];
    this.submissions = [];
    this.stopAllCalls = 0;
  }
  list() { return [...this.workers.values()].map((item) => ({ ...item })); }
  async focus(id) { this.calls.push(['focus', id]); return { ...this.workers.get(id) }; }
  pause(id) { this.calls.push(['pause', id]); this.workers.set(id, { ...this.workers.get(id), status: 'paused' }); return { ...this.workers.get(id) }; }
  resume(id) { this.calls.push(['resume', id]); this.workers.set(id, { ...this.workers.get(id), status: 'idle' }); return { ...this.workers.get(id) }; }
  async stop(id) { this.calls.push(['stop', id]); this.workers.set(id, { ...this.workers.get(id), status: 'stopped', processId: null }); return { ...this.workers.get(id) }; }
  async submitAuthorizedLocalTask(input) { this.submissions.push(input); return { result: 'ok' }; }
  async stopAll() { this.stopAllCalls += 1; }
}

function createService({ databasePath = ':memory:', manager = new FakeWorkerManager() } = {}) {
  return { manager, service: new S4ApplicationService({ databasePath, workerManager: manager }) };
}

function createWaitingGate(service, suffix = 'a') {
  const installation = service.installCapability({ workspaceId: 'workspace-a' });
  service.grantCapability({ workspaceId: 'workspace-a', agentId: 'agent-a', installationId: installation.id });
  return service.createTask({
    id: `s4-task-${suffix}`,
    workspaceId: 'workspace-a',
    agentId: 'agent-a',
    installationId: installation.id,
    workerId: 's1-worker-chrome',
    payload: `payload-${suffix}`,
  });
}

test('cockpit composes accepted S1-S3 authority state with live Worker bindings and no sensitive runtime fields', () => {
  const { service } = createService();
  const cockpit = service.queryOperatorCockpit('workspace-a');
  assert.equal(cockpit.found, true);
  assert.equal(cockpit.workspace.id, 'workspace-a');
  assert.equal(cockpit.projects.length, 1);
  assert.equal(cockpit.providerSnapshots.length, 1);
  assert.deepEqual(cockpit.workers.map((item) => item.workerId).sort(), ['s1-worker-chrome', 's1-worker-chromium']);
  const raw = JSON.stringify(cockpit);
  assert.doesNotMatch(raw, /profilePath|processId|\/private\/a|\/private\/b/);
  assert.match(raw, /provider-local-form/);
  service.close();
});

test('unknown explicit Workspace returns an empty fail-closed cockpit without falling back to Workspace A', () => {
  const { service } = createService();
  const cockpit = service.queryOperatorCockpit('workspace-missing');
  assert.equal(cockpit.found, false);
  assert.equal(cockpit.workspace, null);
  assert.deepEqual(cockpit.workers, []);
  assert.deepEqual(cockpit.missions, []);
  assert.deepEqual(cockpit.attention, []);
  service.close();
});

test('persisted Human Gate appears in derived attention and lineage without creating a second approval state', () => {
  const { manager, service } = createService();
  const created = createWaitingGate(service, 'gate');
  assert.equal(created.run.state, 'waiting_human');
  assert.equal(manager.submissions.length, 0);
  const cockpit = service.queryOperatorCockpit('workspace-a');
  const item = cockpit.attention.find((candidate) => candidate.code === 'human_gate_required');
  assert.ok(item);
  assert.equal(item.humanGateId, created.gate.id);
  assert.equal(Object.hasOwn(item, 'approved'), false);
  const lineage = cockpit.lineage[item.id];
  assert.equal(lineage.available, true);
  assert.ok(lineage.nodes.some((node) => node.kind === 'humanGate' && node.id === created.gate.id));
  service.close();
});

test('selected Worker stop delegates exactly once and leaves unrelated Worker plus pending canonical task unchanged', async () => {
  const { manager, service } = createService();
  const created = createWaitingGate(service, 'isolation');
  const beforeTask = service.task.get(created.task.id);
  const beforeB = manager.list().find((item) => item.id === 's1-worker-chromium');
  const response = await service.stopWorker({ workspaceId: 'workspace-a', workerId: 's1-worker-chrome' });
  assert.equal(response.result.worker.status, 'stopped');
  assert.deepEqual(manager.calls, [['stop', 's1-worker-chrome']]);
  assert.deepEqual(manager.list().find((item) => item.id === 's1-worker-chromium'), beforeB);
  assert.deepEqual(service.task.get(created.task.id), beforeTask);
  assert.equal(manager.stopAllCalls, 0);
  assert.equal(manager.submissions.length, 0);
  assert.equal(response.cockpit.workers.find((item) => item.workerId === 's1-worker-chromium').status, 'idle');
  service.close();
});

test('cross-Workspace selected Worker control fails closed even though the Worker exists', async () => {
  const { service } = createService();
  await assert.rejects(() => service.stopWorker({ workspaceId: 'workspace-b', workerId: 's1-worker-chrome' }), /Cross-Workspace/);
  service.close();
});

test('SQLite restart rebuilds attention/cockpit without replaying a pending submission or Mission work', () => {
  const root = mkdtempSync(join(tmpdir(), 'ai-exe-s4-'));
  const databasePath = join(root, 'state.sqlite');
  try {
    const firstManager = new FakeWorkerManager();
    const first = new S4ApplicationService({ databasePath, workerManager: firstManager });
    const created = createWaitingGate(first, 'restart');
    const before = first.queryOperatorCockpit('workspace-a');
    assert.equal(firstManager.submissions.length, 0);
    assert.ok(before.attention.some((item) => item.humanGateId === created.gate.id));
    first.close();

    const secondManager = new FakeWorkerManager();
    const second = new S4ApplicationService({ databasePath, workerManager: secondManager });
    const after = second.queryOperatorCockpit('workspace-a');
    assert.equal(secondManager.submissions.length, 0);
    assert.ok(after.attention.some((item) => item.humanGateId === created.gate.id));
    assert.equal(after.workers.length, 2);
    assert.equal(second.stepAttempt.list().length, 0, 'S4 restart must not invent Mission work');
    second.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
