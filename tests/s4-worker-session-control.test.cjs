'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkerSessionControlAdapter } = require('../src/operator-console/control/worker-session-control.cjs');

class FakeWorkerManager {
  constructor() {
    this.workers = new Map([
      ['worker-a', { id: 'worker-a', projectId: 'project-a', role: 'implementation', browserChannel: 'chrome', status: 'idle', profilePath: '/secret/a', processId: 111 }],
      ['worker-b', { id: 'worker-b', projectId: 'project-b', role: 'review', browserChannel: 'chromium', status: 'idle', profilePath: '/secret/b', processId: 222 }],
    ]);
    this.calls = [];
    this.stopAllCalls = 0;
  }
  list() { return [...this.workers.values()].map((item) => ({ ...item })); }
  async focus(id) { this.calls.push(['focus', id]); return { ...this.workers.get(id) }; }
  pause(id) { this.calls.push(['pause', id]); this.workers.set(id, { ...this.workers.get(id), status: 'paused' }); return { ...this.workers.get(id) }; }
  resume(id) { this.calls.push(['resume', id]); this.workers.set(id, { ...this.workers.get(id), status: 'idle' }); return { ...this.workers.get(id) }; }
  async stop(id) { this.calls.push(['stop', id]); this.workers.set(id, { ...this.workers.get(id), status: 'stopped', processId: null }); return { ...this.workers.get(id) }; }
  async stopAll() { this.stopAllCalls += 1; throw new Error('selected control must never call stopAll'); }
}

function adapter(manager = new FakeWorkerManager()) {
  return { manager, adapter: new WorkerSessionControlAdapter({
    workerManager: manager,
    resolveWorkspaceId: (id) => id === 'worker-a' ? 'workspace-a' : 'workspace-b',
  }) };
}

test('focus selected Worker delegates exactly once and leaves unrelated Worker unchanged', async () => {
  const { manager, adapter: control } = adapter();
  const beforeB = manager.list().find((item) => item.id === 'worker-b');
  const result = await control.focus({ workspaceId: 'workspace-a', workerId: 'worker-a' });
  assert.equal(result.ok, true);
  assert.deepEqual(manager.calls, [['focus', 'worker-a']]);
  assert.deepEqual(manager.list().find((item) => item.id === 'worker-b'), beforeB);
  assert.equal(manager.stopAllCalls, 0);
});

test('stop selected Worker never fans out and unrelated Worker remains alive', async () => {
  const { manager, adapter: control } = adapter();
  const beforeB = manager.list().find((item) => item.id === 'worker-b');
  const result = await control.stop({ workspaceId: 'workspace-a', workerId: 'worker-a' });
  assert.equal(result.worker.status, 'stopped');
  assert.equal(manager.list().find((item) => item.id === 'worker-b').status, 'idle');
  assert.deepEqual(manager.list().find((item) => item.id === 'worker-b'), beforeB);
  assert.deepEqual(manager.calls, [['stop', 'worker-a']]);
  assert.equal(manager.stopAllCalls, 0);
  assert.doesNotMatch(JSON.stringify(result), /profilePath|processId|\/secret\/a/);
});

test('pause and resume target exact Worker only', async () => {
  const { manager, adapter: control } = adapter();
  await control.pause({ workspaceId: 'workspace-a', workerId: 'worker-a' });
  assert.equal(manager.list().find((item) => item.id === 'worker-a').status, 'paused');
  assert.equal(manager.list().find((item) => item.id === 'worker-b').status, 'idle');
  await control.resume({ workspaceId: 'workspace-a', workerId: 'worker-a' });
  assert.equal(manager.list().find((item) => item.id === 'worker-a').status, 'idle');
  assert.deepEqual(manager.calls, [['pause', 'worker-a'], ['resume', 'worker-a']]);
});

test('cross-Workspace and unknown Worker controls fail closed', async () => {
  const { adapter: control } = adapter();
  await assert.rejects(() => control.stop({ workspaceId: 'workspace-b', workerId: 'worker-a' }), /Cross-Workspace/);
  await assert.rejects(() => control.stop({ workspaceId: 'workspace-a', workerId: 'missing' }), /Unknown worker/);
});

test('unsupported or unavailable control is explicit and not simulated', async () => {
  const manager = new FakeWorkerManager();
  delete manager.pause;
  manager.workers.set('worker-a', { ...manager.workers.get('worker-a'), status: 'stopped' });
  const control = new WorkerSessionControlAdapter({ workerManager: manager, resolveWorkspaceId: () => 'workspace-a' });
  const result = await control.focus({ workspaceId: 'workspace-a', workerId: 'worker-a' });
  assert.equal(result.ok, false);
  assert.equal(result.unavailable, true);
  await assert.rejects(() => control.execute('restart', { workspaceId: 'workspace-a', workerId: 'worker-a' }), /Unsupported Worker control/);
});
