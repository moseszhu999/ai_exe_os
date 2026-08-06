const test = require('node:test');
const assert = require('node:assert/strict');
const { createTask, transitionTask } = require('../src/domain/task-state.cjs');

test('task follows bounded happy path', () => {
  let task = createTask({ id: 't1', projectId: 'p1', title: 'Local test', payload: 'hello', now: '2026-08-06T00:00:00.000Z' });
  task = transitionTask(task, 'queued', { occurredAt: '2026-08-06T00:00:01.000Z' });
  task = transitionTask(task, 'ready', { occurredAt: '2026-08-06T00:00:02.000Z' });
  task = transitionTask(task, 'active', { occurredAt: '2026-08-06T00:00:03.000Z' });
  task = transitionTask(task, 'waiting_human', { occurredAt: '2026-08-06T00:00:04.000Z' });
  assert.equal(task.state, 'waiting_human');
  assert.equal(task.revision, 4);
});

test('same-state observation is idempotent', () => {
  const task = createTask({ id: 't1', projectId: 'p1', title: 'Local test' });
  assert.equal(transitionTask(task, 'draft'), task);
});

test('invalid transition is rejected', () => {
  const task = createTask({ id: 't1', projectId: 'p1', title: 'Local test' });
  assert.throws(() => transitionTask(task, 'completed'), /Invalid task transition/);
});
