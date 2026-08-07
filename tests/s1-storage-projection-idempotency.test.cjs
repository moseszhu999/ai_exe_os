'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { S1SqliteEventStore } = require('../src/storage/index.cjs');

const migrationsDirectory = join(__dirname, '..', 'migrations');

function event(overrides = {}) {
  return {
    id: 'event-1', workspaceId: 'workspace-a', aggregateType: 'task', aggregateId: 'task-1',
    eventType: 'execution.requested', eventVersion: 1, idempotencyKey: 'request-task-1',
    occurredAt: '2026-08-07T00:00:00.000Z', payload: { taskId: 'task-1' }, metadata: {}, ...overrides,
  };
}

test('canonical storage entrypoint rejects a different projection under the same event key', () => {
  const store = new S1SqliteEventStore({ migrationsDirectory });
  store.appendWithProjection({
    event: event(),
    projection: { projectionType: 'task', projectionId: 'task-1', workspaceId: 'workspace-a', version: 1, data: { id: 'task-1', state: 'queued' } },
  });
  assert.throws(() => store.appendWithProjection({
    event: event({ id: 'event-copy' }),
    projection: { projectionType: 'task', projectionId: 'task-1', workspaceId: 'workspace-a', version: 2, data: { id: 'task-1', state: 'active' } },
  }), /Idempotency projection collision/);
  assert.equal(store.listEvents().length, 1);
  assert.equal(store.getProjection('task', 'task-1').data.state, 'queued');
  store.close();
});

test('canonical S0 import assigns deterministic IDs and rolls back the entire batch on ID collision', () => {
  const root = mkdtempSync(join(tmpdir(), 's1-import-'));
  const source = join(root, 'events.jsonl');
  writeFileSync(source, `${JSON.stringify({ type: 'task.snapshot', task: { id: 'legacy-task' } })}\n${JSON.stringify({ id: 'collision-id', type: 'worker.created', workerId: 'worker-a' })}\n`, 'utf8');
  const store = new S1SqliteEventStore({ migrationsDirectory });
  store.appendEvent(event({ id: 'collision-id', idempotencyKey: 'existing', aggregateId: 'existing' }));
  assert.throws(() => store.importS0Jsonl({ filePath: source }), /UNIQUE constraint failed/);
  assert.equal(store.listEvents().length, 1);
  assert.equal(store.database.prepare('SELECT COUNT(*) AS count FROM s0_import_journal').get().count, 0);
  store.close();
});

test('canonical S0 import is deterministic and repeat import is a zero-duplicate no-op', () => {
  const root = mkdtempSync(join(tmpdir(), 's1-import-'));
  const source = join(root, 'events.jsonl');
  writeFileSync(source, `${JSON.stringify({ type: 'task.snapshot', task: { id: 'legacy-task' } })}\n`, 'utf8');
  const store = new S1SqliteEventStore({ migrationsDirectory });
  const first = store.importS0Jsonl({ filePath: source });
  const imported = store.listEvents()[0];
  const second = store.importS0Jsonl({ filePath: source });
  assert.match(imported.id, /^s0-[a-f0-9]{24}-1$/);
  assert.equal(first.importedEventCount, 1);
  assert.equal(second.alreadyImported, true);
  assert.equal(second.importedEventCount, 0);
  assert.equal(store.listEvents().length, 1);
  store.close();
});
