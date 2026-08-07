'use strict';

const { createHash } = require('node:crypto');
const { join } = require('node:path');
const { createProject, createWorkspace } = require('../domain/workspace-model.cjs');
const { createCapabilityPackage, publishCapabilityVersion, createCapabilityInstallation } = require('../domain/capability-model.cjs');
const { createAgent, createAgentCapabilityGrant } = require('../domain/agent-model.cjs');
const { createExecutionGraph, createTaskNode } = require('../domain/execution-graph-model.cjs');
const { createProviderContractSnapshot, assertProviderSnapshotAllows } = require('../domain/provider-contract-snapshot.cjs');
const { HumanGateService } = require('../main/human-gate/human-gate-service.cjs');
const { ResourceLockManager } = require('../main/resource-lock/resource-lock-manager.cjs');
const { S0BrowserWorkerAdapter } = require('../main/runtime-adapters/s0-browser-worker-adapter.cjs');
const { ExecutionCoordinator } = require('../main/scheduler/execution-coordinator.cjs');
const { S1SqliteEventStore } = require('../storage/index.cjs');
const { CanonicalEventWriter, ProjectionRepository } = require('./projection-repository.cjs');

const LOCAL_TARGET = 'http://127.0.0.1:43119/task-form.html';
const LOCAL_PACKAGE_ID = 'local.form-submit';
const LOCAL_VERSION = '1.0.0';
const LOCAL_VERSION_ID = `${LOCAL_PACKAGE_ID}@${LOCAL_VERSION}`;
const LOCAL_PROVIDER_SNAPSHOT_ID = 'provider-local-form';
const LOCAL_DIGEST = `sha256:${'a'.repeat(64)}`;

function boundedId(prefix, ...parts) {
  const digest = createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 20);
  return `${prefix}-${digest}`;
}

function repositorySet(store) {
  const names = ['project', 'workspace', 'capabilityPackage', 'capabilityVersion', 'installation', 'agent', 'grant', 'graph', 'task', 'executionRun', 'humanGate', 'evidence', 'workerBinding', 'providerSnapshot'];
  return Object.fromEntries(names.map((name) => [name, new ProjectionRepository({ store, projectionType: name })]));
}

class S1ApplicationService {
  constructor({ databasePath = ':memory:', migrationsDirectory = join(__dirname, '..', '..', 'migrations'), workerManager, clock = () => new Date().toISOString() }) {
    if (!workerManager) throw new TypeError('workerManager is required');
    this.clock = clock;
    this.workerManager = workerManager;
    this.store = new S1SqliteEventStore({ databasePath, migrationsDirectory });
    this.repositories = repositorySet(this.store);
    Object.assign(this, this.repositories);
    this.locks = new ResourceLockManager();
    this.events = new CanonicalEventWriter({
      store: this.store,
      workspaceResolver: (event) => this.executionRun.get(event.runId)?.workspaceId
        || this.humanGate.get(event.gateId)?.workspaceId
        || 'system',
    });
    this.gateService = new HumanGateService({ repository: this.humanGate, clock });
    this.runtime = new S0BrowserWorkerAdapter({ workerManager });
    this.coordinator = new ExecutionCoordinator({
      runRepository: this.executionRun,
      gateService: this.gateService,
      eventWriter: this.events,
      lockManager: this.locks,
      runtimeAdapter: this.runtime,
      providerRevalidator: (snapshot, currentDigest, action) => {
        const current = this.providerSnapshot.get(snapshot.id || LOCAL_PROVIDER_SNAPSHOT_ID);
        if (!current || current.snapshotDigest !== currentDigest) throw new Error('Provider contract changed or expired');
        assertProviderSnapshotAllows({ snapshot: current, action, now: new Date(this.clock()) });
      },
      clock,
    });
    this.seed();
    this.rehydrateLocks();
    this.recoverUncertain();
  }

  seed() {
    if (!this.project.get('s1-local-project')) {
      this.project.save(createProject({ id: 's1-local-project', name: 'S1 Local Project', createdAt: this.clock() }), 's1_seed');
    }
    for (const [id, name] of [['workspace-a', 'Workspace A'], ['workspace-b', 'Workspace B']]) {
      if (!this.workspace.get(id)) this.workspace.save(createWorkspace({ id, projectId: 's1-local-project', name, createdAt: this.clock() }), 's1_seed');
    }
    if (!this.capabilityPackage.get(LOCAL_PACKAGE_ID)) {
      this.capabilityPackage.save({ id: LOCAL_PACKAGE_ID, ...createCapabilityPackage({ id: LOCAL_PACKAGE_ID, name: 'Local Form Submit', publisher: 'project-owned', description: 'Project-owned deterministic local form capability' }) }, 'capability.published');
    }
    if (!this.capabilityVersion.get(LOCAL_VERSION_ID)) {
      this.capabilityVersion.save({
        id: LOCAL_VERSION_ID,
        ...publishCapabilityVersion({
          packageId: LOCAL_PACKAGE_ID, version: LOCAL_VERSION, integrityDigest: LOCAL_DIGEST,
          inputSchema: { type: 'object', required: ['payload'] }, outputSchema: { type: 'object' },
          evidenceRequirements: ['local result text', 'submission count'],
          resourceRequirements: ['browser profile', 'local target'], providerContractIds: [LOCAL_PROVIDER_SNAPSHOT_ID], humanGatePolicy: 'action',
        }),
      }, 'capability.published');
    }
    if (!this.providerSnapshot.get(LOCAL_PROVIDER_SNAPSHOT_ID)) {
      this.providerSnapshot.save({
        id: LOCAL_PROVIDER_SNAPSHOT_ID,
        ...createProviderContractSnapshot({
          contractId: LOCAL_PROVIDER_SNAPSHOT_ID, providerId: 'project-owned', surfaceId: 'local-form', status: 'accepted',
          reviewedAt: '2026-08-01T00:00:00.000Z', expiresAt: '2030-01-01T00:00:00.000Z',
          governingTermsDigest: LOCAL_DIGEST, permittedActions: ['submit_payload'], prohibitedActions: [],
        }),
      }, 'provider_contract.accepted');
    }
    for (const workspaceId of ['workspace-a', 'workspace-b']) {
      const agentId = workspaceId === 'workspace-a' ? 'agent-a' : 'agent-b';
      if (!this.agent.get(agentId)) {
        this.agent.save(createAgent({ id: agentId, workspace: this.workspace.get(workspaceId), name: agentId === 'agent-a' ? 'Agent A' : 'Agent B', role: 'operator', createdAt: this.clock() }), 'agent.created');
      }
    }
    const workerSeeds = [
      { id: 's1-worker-chrome', workspaceId: 'workspace-a', browserChannel: 'chrome' },
      { id: 's1-worker-chromium', workspaceId: 'workspace-a', browserChannel: 'chromium' },
    ];
    for (const seed of workerSeeds) {
      if (!this.workerBinding.get(seed.id)) this.workerBinding.save({ ...seed, id: seed.id, workspaceId: seed.workspaceId }, 'worker.bound');
      if (!workerManagerHas(this.workerManager, seed.id)) {
        this.workerManager.create({ id: seed.id, projectId: 's1-local-project', role: 'implementation', browserChannel: seed.browserChannel });
      }
    }
  }

  installCapability({ workspaceId, packageId = LOCAL_PACKAGE_ID, version = LOCAL_VERSION }) {
    const workspace = this.require(this.workspace, workspaceId, 'Workspace');
    const versionRecord = this.require(this.capabilityVersion, `${packageId}@${version}`, 'Capability version');
    const id = boundedId('install', workspaceId, packageId, version);
    const existing = this.installation.get(id);
    if (existing) return existing;
    return this.installation.save(createCapabilityInstallation({ id, workspace, version: versionRecord, installedAt: this.clock() }), 'capability.installed');
  }

  grantCapability({ workspaceId, agentId, installationId, allowedActions = ['submit_payload'], allowedTargets = [LOCAL_TARGET] }) {
    const id = boundedId('grant', workspaceId, agentId, installationId);
    const existing = this.grant.get(id);
    if (existing) return existing;
    return this.grant.save(createAgentCapabilityGrant({
      id, workspace: this.require(this.workspace, workspaceId, 'Workspace'),
      agent: this.require(this.agent, agentId, 'Agent'), installation: this.require(this.installation, installationId, 'Installation'),
      allowedActions, allowedTargets, grantedAt: this.clock(),
    }), 'capability.granted');
  }

  createTask(input) {
    const workspace = this.require(this.workspace, input.workspaceId, 'Workspace');
    const graphId = input.graphId || boundedId('graph', input.workspaceId, input.id);
    if (!this.graph.get(graphId)) this.graph.save(createExecutionGraph({ id: graphId, workspaceId: workspace.id, name: input.graphName || `Graph for ${input.id}` }), 'graph.created');
    let task = createTaskNode({
      id: input.id, workspaceId: workspace.id, graphId,
      agentId: input.agentId, installationId: input.installationId,
      capabilityAction: input.capabilityAction || 'submit_payload', target: input.target || LOCAL_TARGET,
      input: { payload: String(input.payload || '') }, state: 'queued',
    });
    task = this.task.save(task, 'task.created');
    const runId = boundedId('run', task.workspaceId, task.id);
    const gateId = boundedId('gate', task.workspaceId, task.id);
    const agent = this.agent.get(task.agentId);
    const installation = this.installation.get(task.installationId);
    const grant = this.grant.list().find((candidate) => candidate.workspaceId === workspace.id
      && candidate.agentId === task.agentId && candidate.installationId === task.installationId && candidate.status === 'active') || null;
    const providerSnapshot = this.providerSnapshot.get(LOCAL_PROVIDER_SNAPSHOT_ID);
    const result = this.coordinator.request({
      executionRunId: runId, gateId, workspace, agent, installation, grant, task,
      providerSnapshot, currentProviderDigest: providerSnapshot?.snapshotDigest,
      dependenciesReady: true, humanGatePolicy: 'action', workerId: input.workerId || 's1-worker-chromium',
      payload: String(input.payload || ''), actionClass: 'EXTERNAL_WRITE',
      payloadPreview: { payload: String(input.payload || '') }, evidenceExpected: ['local result text', 'submission count'],
      resources: [
        { type: 'browser_profile', key: input.workerId || 's1-worker-chromium' },
        { type: 'provider_surface', key: task.target },
      ],
      now: new Date(this.clock()),
    });
    task = this.task.save({
      ...task,
      state: result.run.state === 'blocked' ? 'waiting_resource' : 'waiting_human',
      blockers: result.run.blockers || [],
      executionRunId: runId,
      humanGateId: result.gate?.id || null,
    }, result.run.state === 'blocked' ? 'execution.blocked' : 'human_gate.requested');
    return Object.freeze({ task, run: result.run, gate: result.gate });
  }

  rejectHumanGate({ gateId }) {
    const result = this.coordinator.reject(gateId);
    const task = this.task.get(result.run.taskId);
    if (task) this.task.save({ ...task, state: 'cancelled', blockers: [] }, 'human_gate.rejected');
    return result;
  }

  async approveHumanGate({ gateId }) {
    try {
      const result = await this.coordinator.approve(gateId);
      const task = this.task.get(result.run.taskId);
      if (task && result.run.state === 'result_observed') {
        this.task.save({ ...task, state: 'waiting_human', blockers: [], resultObserved: true }, 'execution.result_observed');
        const evidenceId = boundedId('evidence', result.run.workspaceId, result.run.id);
        if (!this.evidence.get(evidenceId)) {
          this.evidence.save({
            id: evidenceId, workspaceId: result.run.workspaceId, taskId: result.run.taskId,
            executionRunId: result.run.id, workerId: result.run.workerId, type: 'local-result',
            observedAt: this.clock(), result: result.execution?.result || result.execution,
          }, 'evidence.recorded');
        }
      }
      return result;
    } catch (error) {
      const gate = this.humanGate.get(gateId);
      const run = gate ? this.executionRun.get(gate.executionRunId) : null;
      const task = run ? this.task.get(run.taskId) : null;
      if (task) this.task.save({ ...task, state: 'waiting_human', blockers: [{ code: 'recovery_requires_review' }] }, 'execution.uncertain');
      throw error;
    }
  }

  queryState(workspaceId = 'workspace-a') {
    const workspace = this.require(this.workspace, workspaceId, 'Workspace');
    const scoped = (repository) => repository.list().filter((item) => item.workspaceId === workspaceId);
    const bindings = scoped(this.workerBinding);
    const workersById = new Map(this.workerManager.list().map((item) => [item.id, item]));
    return Object.freeze({
      projects: this.project.list().filter((item) => item.id === workspace.projectId),
      workspaces: this.workspace.list(),
      marketplace: this.capabilityVersion.list(),
      installations: scoped(this.installation),
      agents: scoped(this.agent),
      grants: scoped(this.grant),
      graphs: scoped(this.graph),
      tasks: scoped(this.task),
      executionRuns: scoped(this.executionRun),
      humanGates: scoped(this.humanGate),
      evidence: scoped(this.evidence),
      workers: bindings.map((binding) => ({ ...binding, ...(workersById.get(binding.id) || { status: 'missing' }) })),
      events: this.store.listEvents({ workspaceId }).slice(-200),
      activeWorkspaceId: workspaceId,
    });
  }

  importS0(filePath) { return this.store.importS0Jsonl({ filePath }); }

  recoverUncertain() {
    const recovered = this.coordinator.recoverUncertain();
    for (const run of recovered) {
      const task = this.task.get(run.taskId);
      if (task) this.task.save({ ...task, state: 'waiting_human', blockers: [{ code: 'recovery_requires_review' }] }, 'application_recovery_requires_review');
    }
    return recovered;
  }

  rehydrateLocks() {
    const events = this.store.listEvents();
    const released = new Set(events.filter((event) => event.eventType === 'resource.released').map((event) => event.payload.runId));
    for (const event of events.filter((candidate) => candidate.eventType === 'resource.reserved')) {
      const runId = event.payload.runId;
      if (released.has(runId) || this.locks.list().some((lock) => lock.executionRunId === runId)) continue;
      const run = this.executionRun.get(runId);
      const locks = event.payload.locks || [];
      if (!run || !locks.length || ['completed', 'result_observed', 'cancelled', 'failed'].includes(run.state)) continue;
      this.locks.acquireAll({
        workspaceId: run.workspaceId, taskId: run.taskId, executionRunId: run.id,
        resources: locks.map((lock) => ({ type: lock.resourceType, key: lock.resourceKey })), acquiredAt: locks[0].acquiredAt,
      });
    }
  }

  require(repository, id, label) {
    const value = repository.get(id);
    if (!value) throw new Error(`${label} not found: ${id}`);
    return value;
  }

  close() { this.store.close(); }
}

function workerManagerHas(workerManager, workerId) {
  return workerManager.list().some((worker) => worker.id === workerId);
}

module.exports = { LOCAL_PACKAGE_ID, LOCAL_TARGET, LOCAL_VERSION, S1ApplicationService, boundedId };
