'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateExecutionReadiness } = require('../src/main/scheduler/readiness-evaluator.cjs');
const { ResourceConflictError, ResourceLockManager } = require('../src/main/resource-lock/resource-lock-manager.cjs');
const { HumanGateService } = require('../src/main/human-gate/human-gate-service.cjs');
const { S0BrowserWorkerAdapter } = require('../src/main/runtime-adapters/s0-browser-worker-adapter.cjs');
const { ExecutionCoordinator } = require('../src/main/scheduler/execution-coordinator.cjs');

class MemoryRepository {
  constructor() { this.records = new Map(); }
  get(id) { return this.records.get(id) || null; }
  save(record) { this.records.set(record.id, record); return record; }
  list() { return [...this.records.values()]; }
}

class MemoryEvents {
  constructor() { this.events = new Map(); }
  append(event) {
    const existing = this.events.get(event.idempotencyKey);
    if (existing) return existing;
    const stored = Object.freeze({ ...event });
    this.events.set(event.idempotencyKey, stored);
    return stored;
  }
  list() { return [...this.events.values()]; }
}

const target = 'http://127.0.0.1:43119/task-form.html';
const snapshot = Object.freeze({ status: 'accepted', expiresAt: '2027-01-01T00:00:00.000Z', snapshotDigest: 'sha256:accepted' });

function context(overrides = {}) {
  const workspace = { id: 'workspace-a', status: 'active' };
  const agent = { id: 'agent-a', workspaceId: workspace.id, status: 'active' };
  const installation = { id: 'install-a', workspaceId: workspace.id, status: 'installed' };
  const grant = {
    id: 'grant-a', workspaceId: workspace.id, agentId: agent.id, installationId: installation.id,
    status: 'active', allowedActions: ['submit_payload'], allowedTargets: [target],
  };
  const task = { id: 'task-a', workspaceId: workspace.id, capabilityAction: 'submit_payload', target };
  return {
    workspace, agent, installation, grant, task, providerSnapshot: snapshot,
    currentProviderDigest: snapshot.snapshotDigest,
    dependenciesReady: true,
    resourceConflicts: [],
    humanGatePolicy: 'action',
    now: new Date('2026-08-07T00:00:00.000Z'),
    ...overrides,
  };
}

function harness({ runtimeFailure = null } = {}) {
  const runs = new MemoryRepository();
  const gates = new MemoryRepository();
  const events = new MemoryEvents();
  const lockManager = new ResourceLockManager();
  let submissionCount = 0;
  const runtimeAdapter = {
    async execute(input) {
      submissionCount += 1;
      if (runtimeFailure) throw runtimeFailure;
      return { observed: true, input };
    },
  };
  const gateService = new HumanGateService({ repository: gates, clock: () => '2026-08-07T00:00:00.000Z' });
  const coordinator = new ExecutionCoordinator({
    runRepository: runs,
    gateService,
    eventWriter: events,
    lockManager,
    runtimeAdapter,
    providerRevalidator(provider, currentDigest, action) {
      if (provider.status !== 'accepted' || provider.snapshotDigest !== currentDigest || action !== 'submit_payload') {
        throw new Error('Provider contract changed or expired');
      }
    },
    clock: () => '2026-08-07T00:00:00.000Z',
  });
  return { coordinator, runs, gates, events, lockManager, get submissionCount() { return submissionCount; } };
}

test('readiness reports explicit grant/provider/dependency blocker codes', () => {
  const result = evaluateExecutionReadiness(context({ grant: null, providerSnapshot: null, dependenciesReady: false, recoveryRequired: true }));
  assert.equal(result.ready, false);
  assert.deepEqual(result.blockers.map((item) => item.code), [
    'grant_missing_or_revoked', 'provider_contract_unknown', 'dependency_unsatisfied', 'recovery_requires_review',
  ]);
});

test('acquires non-conflicting resources concurrently and rolls back conflicting sets atomically', () => {
  const locks = new ResourceLockManager();
  locks.acquireAll({ workspaceId: 'workspace-a', taskId: 'task-a', executionRunId: 'run-a', resources: [{ type: 'branch', key: 'main' }] });
  locks.acquireAll({ workspaceId: 'workspace-a', taskId: 'task-b', executionRunId: 'run-b', resources: [{ type: 'browser_profile', key: 'profile-b' }] });
  assert.equal(locks.list().length, 2);
  assert.throws(() => locks.acquireAll({
    workspaceId: 'workspace-a', taskId: 'task-c', executionRunId: 'run-c',
    resources: [{ type: 'path', key: 'src/a' }, { type: 'branch', key: 'main' }],
  }), ResourceConflictError);
  assert.equal(locks.list().some((lock) => lock.executionRunId === 'run-c'), false);
});

test('rejecting a persisted Human Gate performs no submission and releases resources', () => {
  const h = harness();
  const requested = h.coordinator.request({
    ...context(), executionRunId: 'run-a', gateId: 'gate-a', workerId: 'worker-a', payload: 'hello',
    actionClass: 'EXTERNAL_WRITE', resources: [{ type: 'browser_profile', key: 'profile-a' }],
  });
  assert.equal(requested.run.state, 'waiting_human');
  const rejected = h.coordinator.reject('gate-a');
  assert.equal(rejected.run.state, 'cancelled');
  assert.equal(h.submissionCount, 0);
  assert.equal(h.lockManager.list().length, 0);
  assert.equal(h.coordinator.reject('gate-a').changed, false);
});

test('approval starts exactly once and repeated approval is idempotent', async () => {
  const h = harness();
  h.coordinator.request({
    ...context(), executionRunId: 'run-a', gateId: 'gate-a', workerId: 'worker-a', payload: 'hello',
    actionClass: 'EXTERNAL_WRITE', resources: [{ type: 'browser_profile', key: 'profile-a' }],
  });
  const first = await h.coordinator.approve('gate-a');
  const second = await h.coordinator.approve('gate-a');
  assert.equal(first.run.state, 'result_observed');
  assert.equal(second.changed, false);
  assert.equal(h.submissionCount, 1);
  assert.equal(h.events.list().filter((event) => event.type === 'execution.started').length, 1);
  assert.equal(h.events.list().filter((event) => event.type === 'execution.result_observed').length, 1);
});

test('provider contract change after request blocks before runtime effect', async () => {
  const h = harness();
  h.coordinator.request({
    ...context(), executionRunId: 'run-a', gateId: 'gate-a', workerId: 'worker-a', payload: 'hello',
    actionClass: 'EXTERNAL_WRITE', resources: [{ type: 'browser_profile', key: 'profile-a' }],
  });
  h.runs.save(Object.freeze({ ...h.runs.get('run-a'), currentProviderDigest: 'sha256:changed' }));
  await assert.rejects(() => h.coordinator.approve('gate-a'), /Provider contract changed or expired/);
  assert.equal(h.submissionCount, 0);
  assert.equal(h.runs.get('run-a').state, 'waiting_human');
});

test('runtime uncertainty returns to waiting_human and is never automatically replayed', async () => {
  const h = harness({ runtimeFailure: new Error('browser context closed') });
  h.coordinator.request({
    ...context(), executionRunId: 'run-a', gateId: 'gate-a', workerId: 'worker-a', payload: 'hello',
    actionClass: 'EXTERNAL_WRITE', resources: [{ type: 'browser_profile', key: 'profile-a' }],
  });
  await assert.rejects(() => h.coordinator.approve('gate-a'), /browser context closed/);
  assert.equal(h.runs.get('run-a').state, 'waiting_human');
  assert.equal(h.submissionCount, 1);
  assert.equal(h.coordinator.recoverUncertain().length, 0);
  assert.equal(h.submissionCount, 1);
});

test('application recovery contains active executions without invoking runtime', () => {
  const h = harness();
  h.runs.save({ id: 'run-a', state: 'active', workspaceId: 'workspace-a', taskId: 'task-a' });
  const recovered = h.coordinator.recoverUncertain();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].state, 'waiting_human');
  assert.equal(recovered[0].recoveryReason, 'application_recovery_requires_review');
  assert.equal(h.submissionCount, 0);
});

test('S0 runtime adapter restricts execution to project-owned loopback target', async () => {
  const calls = [];
  const adapter = new S0BrowserWorkerAdapter({ workerManager: { async submitAuthorizedLocalTask(input) { calls.push(input); return { ok: true }; } } });
  assert.deepEqual(await adapter.execute({ workerId: 'worker-a', taskId: 'task-a', capabilityAction: 'submit_payload', target, payload: 'hello' }), { ok: true });
  await assert.rejects(() => adapter.execute({ workerId: 'worker-a', taskId: 'task-a', capabilityAction: 'submit_payload', target: 'https://example.com', payload: 'x' }), /project-owned loopback/);
  assert.equal(calls.length, 1);
});
