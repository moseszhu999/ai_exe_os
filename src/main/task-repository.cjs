const { createTask, transitionTask } = require('../domain/task-state.cjs');

class TaskRepository {
  constructor({ eventStore }) {
    this.eventStore = eventStore;
    this.tasks = new Map();
    this.rehydrate();
  }

  rehydrate() {
    for (const event of this.eventStore.readAll()) {
      if (event.type === 'task.snapshot' && event.task?.id) {
        this.tasks.set(event.task.id, Object.freeze({ ...event.task }));
      }
    }
  }

  list() {
    return [...this.tasks.values()];
  }

  get(taskId) {
    return this.tasks.get(taskId) || null;
  }

  create(input) {
    if (this.tasks.has(input.id)) throw new Error(`Task already exists: ${input.id}`);
    let task = createTask(input);
    task = transitionTask(task, 'queued', { reason: 'operator_created' });
    task = transitionTask(task, 'ready', { reason: 'no_dependencies' });
    return this.save(task, 'task_created');
  }

  transition(taskId, nextState, metadata = {}) {
    const current = this.get(taskId);
    if (!current) throw new Error(`Unknown task: ${taskId}`);
    const next = transitionTask(current, nextState, metadata);
    if (next === current) return current;
    return this.save(next, metadata.reason || 'task_transitioned');
  }

  recoverUncertain() {
    const recovered = [];
    for (const task of this.tasks.values()) {
      if (task.state !== 'active') continue;
      recovered.push(this.transition(task.id, 'waiting_human', {
        reason: 'application_recovery_requires_review',
      }));
    }
    return recovered;
  }

  save(task, reason) {
    const stored = Object.freeze({ ...task });
    this.tasks.set(stored.id, stored);
    this.eventStore.append({ type: 'task.snapshot', task: stored, reason });
    return stored;
  }
}

module.exports = { TaskRepository };
