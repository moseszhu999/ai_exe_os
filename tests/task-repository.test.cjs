const test = require('node:test');
const assert = require('node:assert/strict');
const { TaskRepository } = require('../src/main/task-repository.cjs');

function memoryStore(initial = []) {
  const events = [...initial];
  return { events, readAll: () => [...events], append: (event) => (events.push(event), event) };
}

test('task repository rehydrates the latest snapshot', () => {
  const store = memoryStore();
  const first = new TaskRepository({ eventStore: store });
  const created = first.create({ id: 't1', projectId: 'p1', title: 'Persist me' });
  first.transition(created.id, 'active', { reason: 'human_confirmed' });

  const second = new TaskRepository({ eventStore: store });
  assert.equal(second.get('t1').state, 'active');
});

test('uncertain active task becomes waiting_human after restart', () => {
  const store = memoryStore();
  const first = new TaskRepository({ eventStore: store });
  const created = first.create({ id: 't1', projectId: 'p1', title: 'Recover me' });
  first.transition(created.id, 'active', { reason: 'human_confirmed' });

  const second = new TaskRepository({ eventStore: store });
  const recovered = second.recoverUncertain();
  assert.equal(recovered.length, 1);
  assert.equal(second.get('t1').state, 'waiting_human');
  assert.equal(second.get('t1').lastTransitionReason, 'application_recovery_requires_review');
});
