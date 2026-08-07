'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { S1SqliteEventStore } = require('../src/storage/index.cjs');

const migrationsDirectory = join(__dirname, '..', 'migrations');

function event(overrides = {}) {
  return {
    id: 'event-1',
    workspaceId: 'workspace-a',
    aggregateType: 'task',
    aggregateId: 'task-1',
    eventType: 'execution.requested',
    eventVersion: 1,
    idempotencyKey: 'request-task-1',
    occurredAt: '2026-08-07T00:00:00.000Z',
    payload: { taskId: 'task-1' },
    metadata: {},
    ...overrides,
  };
}

test('canonical storage entrypoint rejects a different projection under the same event key', () => {
  const store = new S1SqliteEventStore({ migrationsDirectory });
  store.appendWithProjection({
    event: event(),
    projection: {
      projectionType: 'task',
      projectionId: 'task-1',
      workspaceId: 'workspace-a',
      version: 1,
      data: { id: 'task-1', state: 'queued' },
    },
  });

  assert.throws(() => store.appendWithProjection({
    event: event({ id: 'event-copy' }),
    projection: {
      projectionType: 'task',
      projectionId: 'task-1',
      workspaceId: 'workspace-a',
      version: 2,
      data: { id: 'task-1', state: 'active' },
    },
  }), /Idempotency projection collision/);

  assert.equal(store.listEvents().length, 1);
  assert.equal(store.getProjection('task', 'task-1').data.state, 'queued');
  store.close();
});
