'use strict';

const NAVIGATION = Object.freeze([
  'Projects', 'Workspaces', 'Marketplace', 'Agents', 'Workers',
  'Tasks', 'Execution Graph', 'Human Gates', 'Evidence', 'Events / Recovery',
]);

const BLOCKER_LABELS = Object.freeze({
  workspace_inactive: 'Workspace is inactive',
  agent_inactive: 'Agent is inactive',
  installation_missing_or_disabled: 'Capability is not installed or is disabled',
  grant_missing_or_revoked: 'Agent capability grant is missing or revoked',
  action_or_target_not_granted: 'Action or target is outside the Agent grant',
  provider_contract_unknown: 'Provider contract is not accepted',
  provider_contract_changed_or_expired: 'Provider contract changed or expired',
  dependency_unsatisfied: 'Task dependency is not satisfied',
  resource_conflict: 'An exclusive resource is already reserved',
  human_gate_required: 'Human approval is required',
  recovery_requires_review: 'Recovered execution requires human review',
});

const FORBIDDEN_KEY = /password|passwd|cookie|authorization|token|profilepath|userdata|storagestate/i;
const FORBIDDEN_VALUE = /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sessionid|access_token|refresh_token)=)/i;

function sanitizeForDisplay(value, key = '') {
  if (FORBIDDEN_KEY.test(key)) return '[redacted]';
  if (typeof value === 'string' && FORBIDDEN_VALUE.test(value)) return '[redacted]';
  if (Array.isArray(value)) return value.map((item) => sanitizeForDisplay(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([nestedKey, nested]) => [nestedKey, sanitizeForDisplay(nested, nestedKey)]));
  }
  return value;
}

function inWorkspace(items, workspaceId) {
  return (Array.isArray(items) ? items : []).filter((item) => item.workspaceId === workspaceId);
}

function createS1ViewModel(state, activeWorkspaceId) {
  if (!state || typeof state !== 'object') throw new TypeError('S1 state is required');
  const workspaces = Array.isArray(state.workspaces) ? state.workspaces : [];
  const workspace = workspaces.find((item) => item.id === activeWorkspaceId) || workspaces[0] || null;
  const workspaceId = workspace?.id || null;
  const tasks = workspaceId ? inWorkspace(state.tasks, workspaceId) : [];
  const runs = workspaceId ? inWorkspace(state.executionRuns, workspaceId) : [];
  const gates = workspaceId ? inWorkspace(state.humanGates, workspaceId) : [];
  const blockers = tasks.flatMap((task) => (task.blockers || []).map((item) => Object.freeze({
    taskId: task.id,
    code: item.code,
    label: BLOCKER_LABELS[item.code] || item.code,
    detail: sanitizeForDisplay(item.detail),
  })));
  return Object.freeze({
    navigation: NAVIGATION,
    activeWorkspace: workspace,
    workspaces,
    marketplace: sanitizeForDisplay(state.marketplace || []),
    installations: workspaceId ? inWorkspace(state.installations, workspaceId) : [],
    agents: workspaceId ? inWorkspace(state.agents, workspaceId) : [],
    workers: workspaceId ? inWorkspace(state.workers, workspaceId) : [],
    tasks,
    graphs: workspaceId ? inWorkspace(state.graphs, workspaceId) : [],
    executionRuns: runs,
    humanGates: gates.map((gate) => sanitizeForDisplay(gate)),
    evidence: workspaceId ? inWorkspace(state.evidence, workspaceId).map((item) => sanitizeForDisplay(item)) : [],
    events: workspaceId ? inWorkspace(state.events, workspaceId).map((item) => sanitizeForDisplay(item)) : [],
    blockers: Object.freeze(blockers),
    counts: Object.freeze({
      agents: workspaceId ? inWorkspace(state.agents, workspaceId).length : 0,
      tasks: tasks.length,
      waitingHuman: runs.filter((run) => run.state === 'waiting_human').length,
      evidence: workspaceId ? inWorkspace(state.evidence, workspaceId).length : 0,
    }),
  });
}

module.exports = { BLOCKER_LABELS, NAVIGATION, createS1ViewModel, sanitizeForDisplay };
