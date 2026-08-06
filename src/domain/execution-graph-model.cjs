'use strict';

const { assertSafeIdentifier } = require('./identifiers.cjs');
const { assertWorkspaceId, deepFreeze, requiredText } = require('./workspace-model.cjs');

const TASK_STATES = new Set([
  'draft', 'queued', 'ready', 'waiting_dependency', 'waiting_resource',
  'waiting_human', 'active', 'completed', 'failed', 'cancelled',
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  draft: new Set(['queued', 'cancelled']),
  queued: new Set(['ready', 'waiting_dependency', 'waiting_resource', 'waiting_human', 'cancelled']),
  ready: new Set(['waiting_resource', 'waiting_human', 'active', 'cancelled']),
  waiting_dependency: new Set(['ready', 'cancelled']),
  waiting_resource: new Set(['ready', 'waiting_human', 'cancelled']),
  waiting_human: new Set(['ready', 'active', 'failed', 'cancelled']),
  active: new Set(['waiting_human', 'completed', 'failed']),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
});

function createExecutionGraph({ id, workspaceId, name }) {
  return deepFreeze({
    id: assertSafeIdentifier(id, 'execution graph id'),
    workspaceId: assertSafeIdentifier(workspaceId, 'workspace id'),
    name: requiredText(name, 'execution graph name'),
    status: 'active',
  });
}

function createTaskNode(input) {
  const state = input?.state || 'draft';
  if (!TASK_STATES.has(state)) throw new Error(`Unsupported task state: ${state}`);
  return deepFreeze({
    id: assertSafeIdentifier(input?.id, 'task id'),
    workspaceId: assertSafeIdentifier(input?.workspaceId, 'workspace id'),
    graphId: assertSafeIdentifier(input?.graphId, 'execution graph id'),
    agentId: assertSafeIdentifier(input?.agentId, 'agent id'),
    installationId: assertSafeIdentifier(input?.installationId, 'capability installation id'),
    capabilityAction: assertSafeIdentifier(input?.capabilityAction, 'capability action'),
    target: requiredText(input?.target, 'task target', 500),
    input: deepFreeze(structuredClone(input?.input || {})),
    state,
    version: Number.isInteger(input?.version) ? input.version : 0,
    lastReason: input?.lastReason || 'created',
  });
}

function createDependencyEdge(input) {
  if (!['completed', 'evidence_accepted'].includes(input?.condition)) throw new Error('Unsupported dependency condition');
  return deepFreeze({
    graphId: assertSafeIdentifier(input?.graphId, 'execution graph id'),
    fromTaskId: assertSafeIdentifier(input?.fromTaskId, 'from task id'),
    toTaskId: assertSafeIdentifier(input?.toTaskId, 'to task id'),
    condition: input.condition,
  });
}

function validateExecutionGraph({ graph, tasks, edges }) {
  if (!graph || !Array.isArray(tasks) || !Array.isArray(edges)) throw new TypeError('graph, tasks, and edges are required');
  assertWorkspaceId(graph.workspaceId, ...tasks);
  const taskById = new Map();
  for (const task of tasks) {
    if (task.graphId !== graph.id) throw new Error('Task belongs to another graph');
    if (taskById.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
    taskById.set(task.id, task);
  }
  const adjacency = new Map(tasks.map((task) => [task.id, []]));
  for (const edge of edges) {
    if (edge.graphId !== graph.id) throw new Error('Dependency belongs to another graph');
    if (edge.fromTaskId === edge.toTaskId) throw new Error('Task cannot depend on itself');
    if (!taskById.has(edge.fromTaskId) || !taskById.has(edge.toTaskId)) throw new Error('Dependency references an unknown task');
    adjacency.get(edge.fromTaskId).push(edge.toTaskId);
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(taskId) {
    if (visiting.has(taskId)) throw new Error('Execution graph contains a cycle');
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    for (const next of adjacency.get(taskId)) visit(next);
    visiting.delete(taskId);
    visited.add(taskId);
  }
  for (const taskId of adjacency.keys()) visit(taskId);
  return deepFreeze({ graph, tasks: [...tasks], edges: [...edges] });
}

function evaluateTaskDependencies({ taskId, tasks, edges, acceptedEvidenceTaskIds = [] }) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  if (!taskById.has(taskId)) throw new Error(`Unknown task: ${taskId}`);
  const acceptedEvidence = new Set(acceptedEvidenceTaskIds);
  const blockers = [];
  for (const edge of edges.filter((candidate) => candidate.toTaskId === taskId)) {
    const source = taskById.get(edge.fromTaskId);
    const satisfied = edge.condition === 'completed'
      ? source?.state === 'completed'
      : source?.state === 'completed' && acceptedEvidence.has(source.id);
    if (!satisfied) blockers.push(deepFreeze({ dependencyTaskId: edge.fromTaskId, condition: edge.condition }));
  }
  return deepFreeze({ ready: blockers.length === 0, blockers });
}

function transitionTaskNode(task, nextState, reason) {
  if (!TASK_STATES.has(nextState)) throw new Error(`Unsupported task state: ${nextState}`);
  if (task.state === nextState) return task;
  if (!ALLOWED_TRANSITIONS[task.state]?.has(nextState)) {
    throw new Error(`Invalid S1 task transition: ${task.state} -> ${nextState}`);
  }
  return deepFreeze({ ...task, state: nextState, version: task.version + 1, lastReason: requiredText(reason, 'transition reason', 200) });
}

module.exports = {
  createDependencyEdge,
  createExecutionGraph,
  createTaskNode,
  evaluateTaskDependencies,
  transitionTaskNode,
  validateExecutionGraph,
};
