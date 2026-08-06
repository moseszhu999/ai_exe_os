const { assertSafeIdentifier } = require('./identifiers.cjs');
const TASK_STATES = Object.freeze([
  'draft',
  'queued',
  'ready',
  'active',
  'paused',
  'waiting_human',
  'waiting_external',
  'blocked',
  'failed',
  'completed',
  'cancelled',
]);

const TRANSITIONS = Object.freeze({
  draft: new Set(['queued', 'cancelled']),
  queued: new Set(['ready', 'blocked', 'cancelled']),
  ready: new Set(['active', 'blocked', 'cancelled']),
  active: new Set(['paused', 'waiting_human', 'waiting_external', 'blocked', 'failed', 'completed']),
  paused: new Set(['active', 'blocked', 'cancelled']),
  waiting_human: new Set(['active', 'blocked', 'cancelled']),
  waiting_external: new Set(['active', 'blocked', 'failed', 'completed', 'cancelled']),
  blocked: new Set(['ready', 'cancelled']),
  failed: new Set(['ready', 'cancelled']),
  completed: new Set(),
  cancelled: new Set(),
});

function assertTaskState(state) {
  if (!TASK_STATES.includes(state)) {
    throw new TypeError(`Unknown task state: ${state}`);
  }
}

function transitionTask(task, nextState, metadata = {}) {
  assertTaskState(task.state);
  assertTaskState(nextState);

  if (task.state === nextState) return task;
  if (!TRANSITIONS[task.state].has(nextState)) {
    throw new Error(`Invalid task transition: ${task.state} -> ${nextState}`);
  }

  const now = metadata.occurredAt || new Date().toISOString();
  return Object.freeze({
    ...task,
    state: nextState,
    updatedAt: now,
    revision: (task.revision || 0) + 1,
    lastTransitionReason: metadata.reason || null,
  });
}

function createTask({ id, projectId, title, payload, now = new Date().toISOString() }) {
  assertSafeIdentifier(id, 'task id');
  assertSafeIdentifier(projectId, 'project id');
  if (typeof title !== 'string' || !title.trim()) throw new TypeError('title is required');
  return Object.freeze({
    id,
    projectId,
    title,
    payload: payload ?? null,
    state: 'draft',
    revision: 0,
    createdAt: now,
    updatedAt: now,
    lastTransitionReason: null,
  });
}

module.exports = { TASK_STATES, createTask, transitionTask };
