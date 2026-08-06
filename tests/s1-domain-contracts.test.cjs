'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProject, createWorkspace, archiveWorkspace } = require('../src/domain/workspace-model.cjs');
const {
  createCapabilityPackage,
  publishCapabilityVersion,
  createCapabilityInstallation,
  transitionInstallation,
  assertInstallationUsable,
} = require('../src/domain/capability-model.cjs');
const {
  createAgent,
  disableAgent,
  createAgentCapabilityGrant,
  revokeGrant,
  assertGrantAllows,
} = require('../src/domain/agent-model.cjs');
const {
  createExecutionGraph,
  createTaskNode,
  createDependencyEdge,
  validateExecutionGraph,
  evaluateTaskDependencies,
  transitionTaskNode,
} = require('../src/domain/execution-graph-model.cjs');
const { createProviderContractSnapshot, assertProviderSnapshotAllows } = require('../src/domain/provider-contract-snapshot.cjs');

const digest = `sha256:${'a'.repeat(64)}`;
function fixtures() {
  const project = createProject({ id: 'project-a', name: 'Project A' });
  const workspaceA = createWorkspace({ id: 'workspace-a', projectId: project.id, name: 'Workspace A' });
  const workspaceB = createWorkspace({ id: 'workspace-b', projectId: project.id, name: 'Workspace B' });
  const packageRecord = createCapabilityPackage({
    id: 'local.form-submit', name: 'Local form submit', publisher: 'project-owned', description: 'Project-owned deterministic local form capability',
  });
  const version = publishCapabilityVersion({
    packageId: packageRecord.id, version: '1.0.0', integrityDigest: digest,
    inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    evidenceRequirements: ['submission count'], resourceRequirements: ['browser profile'],
    providerContractIds: [], humanGatePolicy: 'action',
  });
  const installationA = createCapabilityInstallation({ id: 'install-a', workspace: workspaceA, version });
  const installationB = createCapabilityInstallation({ id: 'install-b', workspace: workspaceB, version });
  const agentA = createAgent({ id: 'agent-a', workspace: workspaceA, name: 'Agent A', role: 'operator' });
  const grantA = createAgentCapabilityGrant({
    id: 'grant-a', workspace: workspaceA, agent: agentA, installation: installationA,
    allowedActions: ['submit_payload'], allowedTargets: ['http://127.0.0.1:43119/task-form.html'],
  });
  return { project, workspaceA, workspaceB, packageRecord, version, installationA, installationB, agentA, grantA };
}

test('creates and archives isolated Workspaces idempotently', () => {
  const { workspaceA, workspaceB } = fixtures();
  assert.notEqual(workspaceA.id, workspaceB.id);
  const archived = archiveWorkspace(workspaceA, '2026-08-07T00:00:00.000Z');
  assert.equal(archived.status, 'archived');
  assert.equal(archiveWorkspace(archived), archived);
});

test('installs the same immutable capability version independently in two Workspaces', () => {
  const { installationA, installationB, version } = fixtures();
  assert.equal(installationA.workspaceId, 'workspace-a');
  assert.equal(installationB.workspaceId, 'workspace-b');
  assert.equal(installationA.integrityDigest, version.integrityDigest);
  assert.equal(Object.isFrozen(version), true);
  assert.throws(() => { version.version = '2.0.0'; }, TypeError);
});

test('denies cross-Workspace Agent grants and task authority', () => {
  const { workspaceA, workspaceB, installationB, agentA } = fixtures();
  assert.throws(() => createAgentCapabilityGrant({
    id: 'bad-grant', workspace: workspaceA, agent: agentA, installation: installationB,
    allowedActions: ['submit_payload'], allowedTargets: ['local'],
  }), /Cross-Workspace/);
  assert.throws(() => createAgentCapabilityGrant({
    id: 'bad-grant-2', workspace: workspaceB, agent: agentA, installation: installationB,
    allowedActions: ['submit_payload'], allowedTargets: ['local'],
  }), /Cross-Workspace/);
});

test('requires active installation, Agent, grant, action, and exact target', () => {
  const { workspaceA, installationA, agentA, grantA } = fixtures();
  assert.equal(assertGrantAllows({
    workspace: workspaceA, agent: agentA, installation: installationA, grant: grantA,
    action: 'submit_payload', target: 'http://127.0.0.1:43119/task-form.html',
  }), true);
  assert.throws(() => assertGrantAllows({ workspace: workspaceA, agent: agentA, installation: installationA, grant: grantA, action: 'delete', target: 'http://127.0.0.1:43119/task-form.html' }), /not granted/);
  assert.throws(() => assertGrantAllows({ workspace: workspaceA, agent: agentA, installation: installationA, grant: grantA, action: 'submit_payload', target: 'https://example.com' }), /not granted/);
  assert.throws(() => assertGrantAllows({ workspace: workspaceA, agent: disableAgent(agentA), installation: installationA, grant: grantA, action: 'submit_payload', target: 'http://127.0.0.1:43119/task-form.html' }), /not active/);
  assert.throws(() => assertGrantAllows({ workspace: workspaceA, agent: agentA, installation: installationA, grant: revokeGrant(grantA), action: 'submit_payload', target: 'http://127.0.0.1:43119/task-form.html' }), /revoked/);
  assert.throws(() => assertInstallationUsable(transitionInstallation(installationA, 'disabled')), /disabled/);
});

test('rejects graph cycles, cross-Workspace nodes, and unknown dependencies', () => {
  const { workspaceA, workspaceB, agentA, installationA } = fixtures();
  const graph = createExecutionGraph({ id: 'graph-a', workspaceId: workspaceA.id, name: 'Graph A' });
  const task1 = createTaskNode({ id: 'task-1', workspaceId: workspaceA.id, graphId: graph.id, agentId: agentA.id, installationId: installationA.id, capabilityAction: 'submit_payload', target: 'local', input: {} });
  const task2 = createTaskNode({ id: 'task-2', workspaceId: workspaceA.id, graphId: graph.id, agentId: agentA.id, installationId: installationA.id, capabilityAction: 'submit_payload', target: 'local', input: {} });
  assert.throws(() => validateExecutionGraph({ graph, tasks: [task1, task2], edges: [
    createDependencyEdge({ graphId: graph.id, fromTaskId: task1.id, toTaskId: task2.id, condition: 'completed' }),
    createDependencyEdge({ graphId: graph.id, fromTaskId: task2.id, toTaskId: task1.id, condition: 'completed' }),
  ] }), /cycle/);
  const wrongWorkspaceTask = createTaskNode({ ...task2, id: 'task-b', workspaceId: workspaceB.id });
  assert.throws(() => validateExecutionGraph({ graph, tasks: [task1, wrongWorkspaceTask], edges: [] }), /Cross-Workspace/);
  assert.throws(() => validateExecutionGraph({ graph, tasks: [task1], edges: [createDependencyEdge({ graphId: graph.id, fromTaskId: task1.id, toTaskId: 'missing', condition: 'completed' })] }), /unknown task/);
});

test('evaluates dependency completion/evidence and enforces idempotent task transitions', () => {
  const { workspaceA, agentA, installationA } = fixtures();
  const graph = createExecutionGraph({ id: 'graph-a', workspaceId: workspaceA.id, name: 'Graph A' });
  let source = createTaskNode({ id: 'source', workspaceId: workspaceA.id, graphId: graph.id, agentId: agentA.id, installationId: installationA.id, capabilityAction: 'submit_payload', target: 'local', input: {} });
  const target = createTaskNode({ id: 'target', workspaceId: workspaceA.id, graphId: graph.id, agentId: agentA.id, installationId: installationA.id, capabilityAction: 'submit_payload', target: 'local', input: {} });
  const edge = createDependencyEdge({ graphId: graph.id, fromTaskId: source.id, toTaskId: target.id, condition: 'evidence_accepted' });
  assert.equal(evaluateTaskDependencies({ taskId: target.id, tasks: [source, target], edges: [edge] }).ready, false);
  source = transitionTaskNode(source, 'queued', 'operator_queued');
  source = transitionTaskNode(source, 'ready', 'dependencies_satisfied');
  source = transitionTaskNode(source, 'active', 'execution_started');
  source = transitionTaskNode(source, 'completed', 'result_accepted');
  assert.equal(evaluateTaskDependencies({ taskId: target.id, tasks: [source, target], edges: [edge] }).ready, false);
  assert.equal(evaluateTaskDependencies({ taskId: target.id, tasks: [source, target], edges: [edge], acceptedEvidenceTaskIds: [source.id] }).ready, true);
  assert.equal(transitionTaskNode(source, 'completed', 'duplicate'), source);
  assert.throws(() => transitionTaskNode(source, 'active', 'invalid'), /Invalid S1 task transition/);
});

test('pins ProviderUseContract snapshots and revalidates action and expiry', () => {
  const snapshot = createProviderContractSnapshot({
    contractId: 'contract-local', providerId: 'project-owned', surfaceId: 'local-form', status: 'accepted',
    reviewedAt: '2026-08-01T00:00:00.000Z', expiresAt: '2027-08-01T00:00:00.000Z',
    governingTermsDigest: digest, permittedActions: ['submit_payload'], prohibitedActions: ['delete'],
  });
  assert.match(snapshot.snapshotDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(assertProviderSnapshotAllows({ snapshot, action: 'submit_payload', now: new Date('2026-08-07T00:00:00.000Z') }), true);
  assert.throws(() => assertProviderSnapshotAllows({ snapshot, action: 'delete', now: new Date('2026-08-07T00:00:00.000Z') }), /prohibited/);
  assert.throws(() => assertProviderSnapshotAllows({ snapshot, action: 'submit_payload', now: new Date('2028-01-01T00:00:00.000Z') }), /expired/);
  assert.throws(() => assertProviderSnapshotAllows({ snapshot: { ...snapshot, status: 'blocked' }, action: 'submit_payload' }), /unknown or blocked/);
});
