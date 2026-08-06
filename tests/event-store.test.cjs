const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { JsonlEventStore } = require('../src/main/event-store.cjs');

test('event store appends ordered JSONL events', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ai-exe-os-events-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new JsonlEventStore(join(root, 'events.jsonl'));
  store.append({ id: 'e1', type: 'worker.created', occurredAt: '2026-08-06T00:00:00.000Z' });
  store.append({ id: 'e2', type: 'worker.ready', occurredAt: '2026-08-06T00:00:01.000Z' });
  assert.deepEqual(store.readAll().map((event) => event.id), ['e1', 'e2']);
});
