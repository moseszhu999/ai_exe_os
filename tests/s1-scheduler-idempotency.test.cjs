'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HumanGateService } = require('../src/main/human-gate/human-gate-service.cjs');
const { ResourceLockManager } = require('../src/main/resource-lock/resource-lock-manager.cjs');

class MemoryRepository {
  constructor() { this.records = new Map(); }
  get(id) { return this.records.get(id) || null; }
  save(record) { this.records.set(record.id, record); return record; }
}

const target = 'http://127.0.0.1:43119/task-form.html';

test('Human Gate request is semantically idempotent and rejects key reuse with different intent', () => {
  const service = new HumanGateService({ repository: new MemoryRepository() });
  const input = {
    id: 'gate-a', workspaceId: 'workspace-a', taskId: 'task-a', executionRunId: 'run-a',
    actionClass: 'EXTERNAL_WRITE', workerId: 'worker-a', capabilityAction: 'submit_payload', target,
    payloadPreview: { message: 'hello' }, evidenceExpected: ['result'],
  };
  assert.equal(service.request(input).created, true);
  assert.equal(service.request(input).created, false);
  assert.throws(() => service.request({ ...input, target: 'http://127.0.0.1:43119/other.html' }), /idempotency collision/);
});

test('resource manager permits capabilities with no exclusive resource requirements', () => {
  const locks = new ResourceLockManager();
  assert.deepEqual(locks.acquireAll({
    workspaceId: 'workspace-a', taskId: 'task-a', executionRunId: 'run-a', resources: [],
  }), []);
  assert.equal(locks.list().length, 0);
});
