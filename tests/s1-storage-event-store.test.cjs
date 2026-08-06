const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const {
  S1SqliteEventStore,
  assertNoForbiddenSecrets,
} = require('../src/storage/sqlite-event-store.cjs');

const migrationsDirectory = join(__dirname, '..', 'migrations');

function makeStore() {
  const root = mkdtempSync(join(tmpdir(), 'ai-exe-os-s1-store-'));
  const databasePath = join(root, 'state.sqlite');
  return { root, databasePath, store: new S1SqliteEventStore({ databasePath, migrationsDirectory }) };
}

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
    metadata: { actor: 'operator' },
    ...overrides,
  };
}

test('bootstraps WAL/foreign keys and applies migrations idempotently', () => {
  const { store } = makeStore();
  assert.deepEqual(store.health(), {
    foreignKeys: true,
    journalMode: 'wal',
    databasePath: store.databasePath,
  });
  assert.equal(store.migrate(migrationsDirectory), 1);
  store.close();
});

test('commits one canonical event and projection atomically', () => {
  const { store } = makeStore();
  const result = store.appendWithProjection({
    event: event(),
    projection: {
      projectionType: 'task',
      projectionId: 'task-1',
      workspaceId: 'workspace-a',
      version: 1,
      data: { id: 'task-1', state: 'queued' },
    },
  });
  assert.equal(result.created, true);
  assert.equal(result.event.sequence, 1);
  assert.equal(store.listEvents().length, 1);
  assert.equal(store.getProjection('task', 'task-1').data.state, 'queued');
  store.close();
});

test('contains duplicate idempotency keys and rejects semantic collisions', () => {
  const { store } = makeStore();
  assert.equal(store.appendEvent(event()).created, true);
  assert.equal(store.appendEvent(event({ id: 'event-copy' })).created, false);
  assert.equal(store.listEvents().length, 1);
  assert.throws(() => store.appendEvent(event({ id: 'event-2', eventType: 'execution.started' })), /Idempotency key collision/);
  assert.equal(store.listEvents().length, 1);
  store.close();
});

test('rolls back the event when projection validation fails inside the transaction boundary', () => {
  const { store } = makeStore();
  store.appendWithProjection({
    event: event(),
    projection: {
      projectionType: 'task', projectionId: 'task-1', workspaceId: 'workspace-a', version: 2,
      data: { id: 'task-1', state: 'queued' },
    },
  });
  assert.throws(() => store.appendWithProjection({
    event: event({ id: 'event-2', idempotencyKey: 'start-task-1', eventType: 'execution.started' }),
    projection: {
      projectionType: 'task', projectionId: 'task-1', workspaceId: 'workspace-a', version: 1,
      data: { id: 'task-1', state: 'active' },
    },
  }), /cannot move backwards/);
  assert.equal(store.listEvents().length, 1);
  store.close();
});

test('rebuilds projections deterministically with equal digests', () => {
  const { store } = makeStore();
  store.appendEvent(event());
  store.appendEvent(event({
    id: 'event-2', idempotencyKey: 'start-task-1', eventType: 'execution.started',
    payload: { taskId: 'task-1', state: 'active' },
  }));
  const reducer = (state, current) => {
    const previous = state.get(current.aggregateId);
    state.set(current.aggregateId, {
      projectionType: 'task', projectionId: current.aggregateId, workspaceId: current.workspaceId,
      version: (previous?.version || 0) + 1,
      data: { id: current.aggregateId, lastEventType: current.eventType },
    });
  };
  const first = store.rebuildProjection({ projectionType: 'task', reducer });
  const second = store.rebuildProjection({ projectionType: 'task', reducer });
  assert.equal(first.count, 1);
  assert.equal(first.digest, second.digest);
  assert.equal(store.getProjection('task', 'task-1').data.lastEventType, 'execution.started');
  store.close();
});

test('imports S0 JSONL once, records checksum, and never mutates the source', () => {
  const { root, store } = makeStore();
  const source = join(root, 'events.jsonl');
  const original = `${JSON.stringify({ id: 'legacy-1', type: 'task.snapshot', task: { id: 'task-legacy' }, occurredAt: '2026-08-06T00:00:00.000Z' })}\n`;
  writeFileSync(source, original, 'utf8');
  const first = store.importS0Jsonl({ filePath: source });
  const second = store.importS0Jsonl({ filePath: source });
  assert.equal(first.alreadyImported, false);
  assert.equal(first.importedEventCount, 1);
  assert.equal(second.alreadyImported, true);
  assert.equal(second.importedEventCount, 0);
  assert.equal(store.listEvents().length, 1);
  assert.equal(readFileSync(source, 'utf8'), original);
  store.close();
});

test('rejects corrupt imports and forbidden secret/profile fields', () => {
  const { root, store } = makeStore();
  const corrupt = join(root, 'corrupt.jsonl');
  writeFileSync(corrupt, '{bad json}\n', 'utf8');
  assert.throws(() => store.importS0Jsonl({ filePath: corrupt }), /Invalid JSONL/);
  assert.equal(store.listEvents().length, 0);
  assert.throws(() => store.appendEvent(event({ payload: { accessToken: 'copied' } })), /Forbidden secret field/);
  assert.throws(() => assertNoForbiddenSecrets({ profilePath: '/Users/me/profile' }), /Forbidden secret field/);
  assert.equal(store.listEvents().length, 0);
  store.close();
});

test('exports committed SQLite events as a read-only JSONL derivative', () => {
  const { root, store } = makeStore();
  store.appendEvent(event());
  const output = join(root, 'export', 'events.jsonl');
  store.exportEventsJsonl(output);
  const lines = readFileSync(output, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].idempotencyKey, 'request-task-1');
  store.close();
});
