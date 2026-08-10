'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { LOCAL_PROVIDER_SNAPSHOT_ID } = require('../src/application/index.cjs');
const { S8ApplicationService: SourceS8ApplicationService } = require('../src/application/s8-index.cjs');
const { S8ApplicationService: DestinationS8ApplicationService } = require('../src/application/s8-product-service.cjs');
const { createCapabilityPackage, publishCapabilityVersion } = require('../src/domain/capability-model.cjs');

const PACKAGE_ID = 'local.form-submit-delegated';
const VERSION = '1.0.0';
const VERSION_ID = `${PACKAGE_ID}@${VERSION}`;
const SOURCE_ACTION = 'run_approved_test_profile';
const SOURCE_TARGET = 'project:trainingos';
const RUNTIME_ACTION = 'submit_payload';
const RUNTIME_TARGET = 'http://127.0.0.1:43119/task-form.html';
const DIGEST = `sha256:${'e'.repeat(64)}`;

class FakeWorkerManager {
  constructor() {
    this.workers = [
      { id: 's1-worker-chrome', projectId: 's1-local-project', role: 'implementation', status: 'idle', browserChannel: 'chrome' },
      { id: 's1-worker-chromium', projectId: 's1-local-project', role: 'review', status: 'idle', browserChannel: 'chromium' },
    ];
    this.submissions = [];
  }
  list() { return this.workers.map((item) => ({ ...item })); }
  async submitAuthorizedLocalTask(input) { this.submissions.push({ ...input }); return { result: { text: 'unexpected' } }; }
  async start() { throw new Error('M2.27 must not directly start Worker'); }
  async stop() { throw new Error('unused'); }
  async focus() { throw new Error('unused'); }
  pause() { throw new Error('unused'); }
  resume() { throw new Error('unused'); }
}

class SharedDelegationExchange {
  constructor() { this.requests = []; this.calls = []; }
  async submitRequest(request) {
    this.calls.push('submitRequest');
    const existing = this.requests.find((item) => item.id === request.id);
    if (existing) return { state: existing.requestDigest === request.requestDigest ? 'duplicate' : 'divergent' };
    this.requests.push(structuredClone(request));
    return { state: 'accepted', reasonCode: 'stored' };
  }
  async readInbox({ destinationInstanceId, destinationWorkspaceId }) {
    this.calls.push('readInbox');
    return this.requests
      .filter((item) => item.destinationInstanceId === destinationInstanceId && item.destinationWorkspaceId === destinationWorkspaceId)
      .map((item) => structuredClone(item));
  }
  async acknowledgeRequest(input) { this.calls.push('acknowledgeRequest'); return { ...input }; }
  async readCancellations() { return []; }
}

function clockAt(start) {
  let tick = 0;
  return () => new Date(Date.parse(start) + (tick++ * 1000)).toISOString();
}

function makeSource(exchange) {
  return new SourceS8ApplicationService({
    databasePath: ':memory:', workerManager: new FakeWorkerManager(), localTarget: RUNTIME_TARGET,
    delegationEndpoint: { id: 'delegation-test-endpoint', status: 'active' }, delegationTransport: exchange,
    clock: clockAt('2026-08-10T20:00:00.000Z'),
  });
}

function makeDestination(exchange) {
  return new DestinationS8ApplicationService({
    databasePath: ':memory:', workerManager: new FakeWorkerManager(), localTarget: RUNTIME_TARGET,
    delegationEndpoint: { id: 'delegation-test-endpoint', status: 'active' }, delegationTransport: exchange,
    clock: clockAt('2026-08-10T20:10:00.000Z'),
  });
}

function publishDelegatedCapability(destination, { binding = true, runtimeAction = RUNTIME_ACTION, payloadBinding = 'delegation_payload_json_v1' } = {}) {
  destination.capabilityPackage.save({
    id: PACKAGE_ID,
    ...createCapabilityPackage({
      id: PACKAGE_ID, name: 'Delegated Local Form Submit', publisher: 'project-owned',
      description: 'Destination-owned delegated action binding test capability',
    }),
  }, 'test.m2_27_capability_package');
  destination.capabilityVersion.save({
    id: VERSION_ID,
    ...publishCapabilityVersion({
      packageId: PACKAGE_ID, version: VERSION, integrityDigest: DIGEST,
      inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
      evidenceRequirements: ['local result text', 'submission count'], resourceRequirements: ['browser profile', 'local target'],
      providerContractIds: [LOCAL_PROVIDER_SNAPSHOT_ID], humanGatePolicy: 'action',
      delegatedActionBindings: binding ? [{
        sourceAction: SOURCE_ACTION, sourceTarget: SOURCE_TARGET,
        runtimeAction, runtimeTarget: RUNTIME_TARGET, payloadBinding,
      }] : [],
    }),
  }, 'test.m2_27_capability_version');
}

function prepareTopology(source, destination, options = {}) {
  const peer = {
    id: 'aiexe-to-trainingos-peer-27',
    sourceInstanceId: source.activeSourceInstance().id, sourceWorkspaceId: 'workspace-a',
    destinationInstanceId: destination.activeSourceInstance().id, destinationWorkspaceId: 'workspace-a',
    status: 'active', createdAt: '2026-08-10T20:00:01.000Z', updatedAt: '2026-08-10T20:00:01.000Z',
  };
  source.recordPeerBinding({ ...peer, workspaceId: 'workspace-a' });
  destination.recordPeerBinding({ ...peer, workspaceId: 'workspace-a' });
  publishDelegatedCapability(destination, options);
  const install = destination.installCapability({ workspaceId: 'workspace-a', packageId: PACKAGE_ID, version: VERSION });
  destination.grantCapability({
    workspaceId: 'workspace-a', agentId: 'agent-a', installationId: install.id,
    allowedActions: [options.runtimeAction || RUNTIME_ACTION], allowedTargets: [RUNTIME_TARGET],
  });
  destination.recordDelegationPolicy({
    id: 'trainingos-delegation-policy-27', version: '1.0.0', peerBindingId: peer.id,
    destinationWorkspaceId: 'workspace-a', workspaceId: 'workspace-a', status: 'active',
    allowedCapabilityVersionIds: [VERSION_ID], allowedActions: [SOURCE_ACTION], allowedTargets: [SOURCE_TARGET],
    maxPendingRequests: 8, maxAcceptedNotStarted: 2,
    createdAt: '2026-08-10T20:00:02.000Z', expiresAt: '2030-08-10T20:00:02.000Z',
  });
  return { peer, install };
}

async function sendRequest(source, peer) {
  const request = source.createDelegationRequest({
    id: 'management-delegation-request-27', workspaceId: 'workspace-a', peerBindingId: peer.id,
    policyId: 'trainingos-delegation-policy-27', policyVersion: '1.0.0', capabilityVersionId: VERSION_ID,
    action: SOURCE_ACTION, target: SOURCE_TARGET, payloadClass: 'management-authorization',
    payload: { managementActionRef: 'aiexe:management-action:run-tests:27', evidenceRefs: ['evidence:test-profile-approved'] },
    sourceMissionId: null, sourcePlanStepId: null, createdAt: '2026-08-10T20:00:03.000Z',
  });
  const pushed = await source.pushDelegationRequest({ workspaceId: 'workspace-a', requestId: request.id });
  assert.equal(pushed.ack.state, 'accepted');
  return request;
}

async function setup(options = {}) {
  const exchange = new SharedDelegationExchange();
  const source = makeSource(exchange);
  const destination = makeDestination(exchange);
  const topology = prepareTopology(source, destination, options);
  const request = await sendRequest(source, topology.peer);
  const pull = await destination.pullDelegationInbox({ workspaceId: 'workspace-a' });
  return { exchange, source, destination, topology, request, pull };
}

function pendingProposal(destination) {
  return destination.queryDelegationState('workspace-a').incomingProposals.find((item) => item.delegationRequestId === 'management-delegation-request-27') || null;
}

function runtimeStep(destination, binding) {
  const mission = destination.mission.get(binding.localMissionId);
  const revision = destination.missionRevision.list()
    .filter((item) => item.missionId === mission.id)
    .sort((a, b) => Number(b.revision || 0) - Number(a.revision || 0))[0];
  assert.ok(revision);
  const plan = destination.executionPlan.get(revision.planId);
  const step = plan.steps.find((item) => item.id === binding.localPlanStepId);
  assert.ok(step);
  const stepBinding = destination.stepBinding.get(step.bindingId);
  assert.ok(stepBinding);
  return { step, stepBinding };
}

test('M2.27 destination owner consumes exact CapabilityVersion binding into runtime StepBinding and stops at action HumanGate', async () => {
  const { source, destination, request, pull } = await setup();
  try {
    assert.equal(pull.accepted, 1);
    const proposal = pendingProposal(destination);
    assert.equal(proposal.state, 'waiting_human');
    const decision = destination.approveDelegationProposal({ workspaceId: 'workspace-a', proposalId: proposal.id });
    const { step, stepBinding } = runtimeStep(destination, decision.binding);
    assert.equal(request.action, SOURCE_ACTION);
    assert.equal(request.target, SOURCE_TARGET);
    assert.equal(step.executionMode, 's1');
    assert.equal(stepBinding.action, RUNTIME_ACTION);
    assert.equal(stepBinding.target, RUNTIME_TARGET);
    assert.equal(stepBinding.capabilityVersionId, VERSION_ID);
    assert.equal(decision.actionGate.state, 'requested');
    assert.equal(decision.actionGate.capabilityAction, RUNTIME_ACTION);
    assert.equal(decision.actionGate.target, RUNTIME_TARGET);
    assert.equal(destination.workerManager.submissions.length, 0);
  } finally { source.close(); destination.close(); }
});

test('M2.27 destination AgentGrant authorizes runtime semantics instead of source management semantics', async () => {
  const { source, destination } = await setup();
  try {
    const grant = destination.grant.list().find((item) => item.installationId && item.workspaceId === 'workspace-a' && item.allowedActions.includes(RUNTIME_ACTION));
    assert.ok(grant);
    assert.deepEqual(grant.allowedActions, [RUNTIME_ACTION]);
    assert.deepEqual(grant.allowedTargets, [RUNTIME_TARGET]);
    assert.equal(grant.allowedActions.includes(SOURCE_ACTION), false);
    assert.equal(pendingProposal(destination).state, 'waiting_human');
  } finally { source.close(); destination.close(); }
});

test('M2.27 missing destination binding fails closed for a source semantic action that is not natively granted', async () => {
  const { source, destination, pull } = await setup({ binding: false });
  try {
    assert.equal(pull.accepted, 1);
    const proposal = pendingProposal(destination);
    assert.equal(proposal.state, 'inadmissible');
    const state = destination.queryDelegationState('workspace-a');
    const admission = state.admissionSnapshots.find((item) => item.proposalId === proposal.id);
    assert.equal(admission.admissible, false);
    assert.ok(admission.reasonCodes.includes('local_grant_missing'));
    assert.equal(state.delegationHumanGates.length, 0);
    assert.equal(destination.mission.list().filter((item) => item.title?.startsWith('Delegated request')).length, 0);
    assert.equal(destination.workerManager.submissions.length, 0);
  } finally { source.close(); destination.close(); }
});

test('M2.27 provider denial of bound runtime action is checked before delegation HumanGate decision or Mission creation', async () => {
  const runtimeAction = 'unapproved_runtime_action';
  const { source, destination } = await setup({ runtimeAction });
  try {
    const proposal = pendingProposal(destination);
    const gateBefore = destination.queryDelegationState('workspace-a').delegationHumanGates.find((item) => item.id === proposal.humanGateId);
    assert.equal(gateBefore.state, 'requested');
    assert.throws(
      () => destination.approveDelegationProposal({ workspaceId: 'workspace-a', proposalId: proposal.id }),
      /destination_runtime_provider_action_not_allowed/,
    );
    const state = destination.queryDelegationState('workspace-a');
    assert.equal(state.delegationHumanGates.find((item) => item.id === proposal.humanGateId).state, 'requested');
    assert.equal(state.delegationAcceptances.length, 0);
    assert.equal(state.delegatedExecutionBindings.length, 0);
    assert.equal(destination.mission.list().filter((item) => item.title?.startsWith('Delegated request')).length, 0);
    assert.equal(destination.workerManager.submissions.length, 0);
  } finally { source.close(); destination.close(); }
});

test('M2.27 unsupported payload binding fails before destination HumanGate decision and cannot become an implicit transform', async () => {
  const { source, destination } = await setup({ payloadBinding: 'custom_transform_v1' });
  try {
    const proposal = pendingProposal(destination);
    assert.throws(
      () => destination.approveDelegationProposal({ workspaceId: 'workspace-a', proposalId: proposal.id }),
      /destination_payload_binding_unsupported/,
    );
    const state = destination.queryDelegationState('workspace-a');
    assert.equal(state.delegationHumanGates.find((item) => item.id === proposal.humanGateId).state, 'requested');
    assert.equal(state.delegationAcceptances.length, 0);
    assert.equal(state.delegatedExecutionBindings.length, 0);
    assert.equal(destination.workerManager.submissions.length, 0);
  } finally { source.close(); destination.close(); }
});

test('M2.27 repeated destination approval is exact-once for Mission/binding and never auto-approves the action gate', async () => {
  const { source, destination } = await setup();
  try {
    const proposal = pendingProposal(destination);
    const first = destination.approveDelegationProposal({ workspaceId: 'workspace-a', proposalId: proposal.id });
    const second = destination.approveDelegationProposal({ workspaceId: 'workspace-a', proposalId: proposal.id });
    assert.equal(second.binding.id, first.binding.id);
    assert.equal(second.binding.localMissionId, first.binding.localMissionId);
    assert.equal(destination.mission.list().filter((item) => item.title?.startsWith('Delegated request')).length, 1);
    assert.equal(second.actionGate.id, first.actionGate.id);
    assert.equal(second.actionGate.state, 'requested');
    assert.equal(destination.workerManager.submissions.length, 0);
  } finally { source.close(); destination.close(); }
});

test('M2.27 binding owner has no management-supplied runtime choice or effect shortcut', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/application/s8-destination-authority-service.cjs'), 'utf8');
  const product = fs.readFileSync(path.join(__dirname, '../src/application/s8-product-service.cjs'), 'utf8');
  assert.match(source, /version\.delegatedActionBindings/);
  assert.match(source, /runtimeIntent\.runtimeAction/);
  assert.match(source, /runtimeIntent\.runtimeTarget/);
  assert.doesNotMatch(source, /input\.runtimeAction|input\.runtimeTarget|input\.payloadBinding/);
  assert.doesNotMatch(source, /submitAuthorizedLocalTask|workerManager\.submit|fetch\s*\(|child_process|wallet|payment/);
  assert.match(product, /'localAuthorityForRequest'/);
  assert.match(product, /'createLocalDelegatedMission'/);
});