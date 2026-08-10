'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { LOCAL_PROVIDER_SNAPSHOT_ID } = require('../src/application/index.cjs');
const { S8ApplicationService: SourceS8ApplicationService } = require('../src/application/s8-index.cjs');
const { S8ApplicationService: DestinationS8ApplicationService } = require('../src/application/s8-product-service.cjs');
const { createProviderContractSnapshot } = require('../src/domain/provider-contract-snapshot.cjs');
const { submitA2AuthorizedRequestThroughS8Source } = require('../src/management/policy/a2-s8-source-submission.cjs');
const { observeA2RequestAtS8Destination } = require('../src/management/policy/a2-s8-destination-admission.cjs');
const { A2_S8_DESTINATION_BINDING_SCHEMA, observeA2DestinationDecisionAndBinding } = require('../src/management/policy/a2-s8-destination-binding.cjs');
const { observeA2DestinationActionReadiness } = require('../src/management/policy/a2-s8-destination-action-readiness.cjs');

class FakeWorkerManager {
  constructor() {
    this.workers = [
      { id: 's1-worker-chrome', projectId: 's1-local-project', role: 'implementation', status: 'idle', browserChannel: 'chrome' },
      { id: 's1-worker-chromium', projectId: 's1-local-project', role: 'review', status: 'idle', browserChannel: 'chromium' },
    ];
    this.submissions = [];
  }
  list() { return this.workers.map((item) => ({ ...item })); }
  async submitAuthorizedLocalTask(input) { this.submissions.push({ ...input }); return { result: { text: 'unexpected', submissionCount: this.submissions.length } }; }
  async start() { throw new Error('M2.25 must not start Worker'); }
  async stop() { throw new Error('unused'); }
  async focus() { throw new Error('unused'); }
  pause() { throw new Error('unused'); }
  resume() { throw new Error('unused'); }
}

class SharedDelegationExchange {
  constructor() { this.requests = []; }
  async submitRequest(request) {
    const existing = this.requests.find((item) => item.id === request.id);
    if (existing) return { state: existing.requestDigest === request.requestDigest ? 'duplicate' : 'divergent', reasonCode: existing.requestDigest === request.requestDigest ? 'exact_duplicate' : 'request_digest_conflict' };
    this.requests.push(structuredClone(request));
    return { state: 'accepted', reasonCode: 'stored' };
  }
  async readInbox({ destinationInstanceId, destinationWorkspaceId }) {
    return this.requests.filter((item) => item.destinationInstanceId === destinationInstanceId && item.destinationWorkspaceId === destinationWorkspaceId).map((item) => structuredClone(item));
  }
  async acknowledgeRequest(input) { return { ...input }; }
  async readCancellations() { return []; }
  async submitReceipt() { return { state: 'accepted' }; }
  async readReceipts() { return []; }
}

function clockAt(start = '2026-08-10T15:00:00.000Z') {
  let tick = 0;
  return () => new Date(Date.parse(start) + (tick++ * 1000)).toISOString();
}

function makeSource(exchange) {
  return new SourceS8ApplicationService({
    databasePath: ':memory:', workerManager: new FakeWorkerManager(),
    localTarget: 'http://127.0.0.1:43119/task-form.html',
    delegationEndpoint: { id: 'delegation-test-endpoint', status: 'active' },
    delegationTransport: exchange, clock: clockAt(),
  });
}

function makeDestination(exchange) {
  const service = new DestinationS8ApplicationService({
    databasePath: ':memory:', workerManager: new FakeWorkerManager(),
    localTarget: 'http://127.0.0.1:43119/task-form.html',
    delegationEndpoint: { id: 'delegation-test-endpoint', status: 'active' },
    delegationTransport: exchange, clock: clockAt('2026-08-10T15:10:00.000Z'),
  });
  const current = service.providerSnapshot.get(LOCAL_PROVIDER_SNAPSHOT_ID);
  service.providerSnapshot.save({
    id: LOCAL_PROVIDER_SNAPSHOT_ID,
    ...createProviderContractSnapshot({
      contractId: current.contractId,
      providerId: current.providerId,
      surfaceId: current.surfaceId,
      status: current.status,
      reviewedAt: current.reviewedAt,
      expiresAt: current.expiresAt,
      governingTermsDigest: current.governingTermsDigest,
      permittedActions: [...new Set([...current.permittedActions, 'run_approved_test_profile'])],
      prohibitedActions: current.prohibitedActions,
    }),
  }, 'test.m2_25_provider_scope');
  return service;
}

function a2() {
  return {
    actionId: 'aiexe:management-action:run-tests:25', actionType: 'run_approved_test_profile', projectId: 'trainingos',
    policyRef: 'aiexe:policy:a2-management-v1', policyPreapproved: true,
    capabilityRef: 'local.form-submit@1.0.0', workApprovalRef: null,
    evidenceRefs: ['evidence:trainingos:test-profile-approved'], requestedAt: '2026-08-10T15:00:00.000Z',
  };
}

function authorization() {
  return {
    schema: 'execution.authorization.request.v1', requestRef: 'aiexe:exec-auth-request:25', organizationRef: 'group:org:1',
    actorRef: 'aiexe:agent:group-manager-1', actorKind: 'agent', requestedActionRef: 'aiexe:management-action:run-tests:25',
    action: 'run_approved_test_profile', targetRef: 'project:trainingos', observedAt: '2026-08-10T15:00:00.000Z',
    requirements: {
      requiredHumanCapabilityRefs: [], requiredAgentCapabilityRefs: ['local.form-submit@1.0.0'],
      requiredEvidenceRefs: ['evidence:trainingos:test-profile-approved'], requiredPolicyRefs: ['aiexe:policy:a2-management-v1'], humanGateRequired: false,
    },
    resolved: {
      authorityGrant: { ref: 'group:authority-grant:aiexe-manager', status: 'active', organizationRef: 'group:org:1', actorRef: 'aiexe:agent:group-manager-1', allowedActions: ['run_approved_test_profile'], allowedTargets: ['project:trainingos'], expiresAt: '2026-08-11T15:00:00.000Z' },
      delegation: { ref: 'aiexe:delegation:trainingos-tests', status: 'active', organizationRef: 'group:org:1', actorRef: 'aiexe:agent:group-manager-1', allowedActions: ['run_approved_test_profile'], allowedTargets: ['project:trainingos'], expiresAt: '2026-08-11T15:00:00.000Z' },
      humanCapabilityCredentials: [], agentCapabilityPackages: [{ ref: 'local.form-submit@1.0.0', status: 'accepted' }],
      evidence: [{ ref: 'evidence:trainingos:test-profile-approved', status: 'current' }],
      policies: [{ ref: 'aiexe:policy:a2-management-v1', status: 'accepted' }], humanGate: null, revocations: [],
    },
  };
}

function prepareBilateral(source, destination) {
  const peer = {
    id: 'aiexe-to-trainingos-peer-25', sourceInstanceId: source.activeSourceInstance().id, sourceWorkspaceId: 'workspace-a',
    destinationInstanceId: destination.activeSourceInstance().id, destinationWorkspaceId: 'workspace-a', status: 'active',
    createdAt: '2026-08-10T15:00:01.000Z', updatedAt: '2026-08-10T15:00:01.000Z',
  };
  source.recordPeerBinding({ ...peer, workspaceId: 'workspace-a' });
  destination.recordPeerBinding({ ...peer, workspaceId: 'workspace-a' });
  const install = destination.installCapability({ workspaceId: 'workspace-a', packageId: 'local.form-submit', version: '1.0.0' });
  destination.grantCapability({ workspaceId: 'workspace-a', agentId: 'agent-a', installationId: install.id, allowedActions: ['run_approved_test_profile'], allowedTargets: ['project:trainingos'] });
  destination.recordDelegationPolicy({
    id: 'trainingos-delegation-policy-25', version: '1.0.0', peerBindingId: peer.id,
    destinationWorkspaceId: 'workspace-a', workspaceId: 'workspace-a', status: 'active',
    allowedCapabilityVersionIds: ['local.form-submit@1.0.0'], allowedActions: ['run_approved_test_profile'], allowedTargets: ['project:trainingos'],
    maxPendingRequests: 8, maxAcceptedNotStarted: 2, createdAt: '2026-08-10T15:00:02.000Z', expiresAt: '2030-08-10T15:00:02.000Z',
  });
  return peer;
}

async function realBoundSetup() {
  const exchange = new SharedDelegationExchange();
  const source = makeSource(exchange);
  const destination = makeDestination(exchange);
  const peer = prepareBilateral(source, destination);
  const sourceSubmission = await submitA2AuthorizedRequestThroughS8Source({
    a2Request: a2(), authorizationRequest: authorization(),
    delegationEnvelope: {
      id: 'management-delegation-request-25', sourceInstanceId: source.activeSourceInstance().id, sourceWorkspaceId: 'workspace-a',
      destinationInstanceId: peer.destinationInstanceId, destinationWorkspaceId: 'workspace-a', peerBindingId: peer.id,
      policyId: 'trainingos-delegation-policy-25', policyVersion: '1.0.0', sourceMissionId: null, sourcePlanStepId: null,
      requestSequence: 1, previousRequestDigest: null, createdAt: '2026-08-10T15:00:03.000Z',
    },
    s8Service: source,
  });
  const admission = await observeA2RequestAtS8Destination({ sourceSubmission, destinationWorkspaceId: 'workspace-a', s8Service: destination });
  destination.approveDelegationProposal({ workspaceId: 'workspace-a', proposalId: admission.destinationProposalRef });
  const binding = observeA2DestinationDecisionAndBinding({ destinationAdmission: admission, destinationWorkspaceId: 'workspace-a', s8Service: destination });
  assert.equal(binding.destinationBindingObservationAccepted, true);
  return { source, destination, binding };
}

function bindingFixture() {
  return Object.freeze({
    schema: A2_S8_DESTINATION_BINDING_SCHEMA,
    actionId: 'action-1', actionType: 'run_approved_test_profile', projectId: 'trainingos',
    authorizationRequestRef: 'auth-request-1', authorizationDecisionRef: 'auth-decision-1',
    delegationRequestRef: 'request-1', delegationRequestDigest: 'sha256:request-1', destinationWorkspaceId: 'workspace-a',
    destinationProposalRef: 'proposal-1', destinationHumanGateRef: 'delegation-gate-1', destinationAcceptanceRef: 'acceptance-1',
    destinationExecutionBindingRef: 'binding-1', destinationLocalMissionRef: 'mission-1', destinationLocalPlanStepRef: 'step-1',
    destinationLocalStepAttemptRef: 'attempt-1', destinationLocalExecutionRunRef: 'run-1',
    destinationBindingObservationAccepted: true, destinationDecisionObserved: true, destinationHumanGateDecision: 'approved', destinationHumanGateState: 'approved',
    destinationAcceptanceObserved: true, destinationAcceptanceState: 'accepted', destinationExecutionBindingObserved: true,
    destinationHumanGateDecisionCreatedByManagementLayer: false, destinationExecutionBindingCreatedByManagementLayer: false,
    destinationExecutionPerformedByManagementLayer: false, managementEffectInvocationPerformed: false,
  });
}

function syntheticService({ runState = 'waiting_human', gateState = 'requested', attemptState = null, blockers = [], drift = {} } = {}) {
  const binding = bindingFixture();
  const stepState = attemptState || (runState === 'blocked' ? 'blocked' : runState === 'cancelled' ? 'cancelled' : 'waiting_human');
  const gate = gateState ? { id: 'action-gate-1', executionRunId: 'run-1', state: gateState } : null;
  const executionBinding = {
    id: 'binding-1', workspaceId: 'workspace-a', proposalId: 'proposal-1', delegationRequestId: 'request-1',
    localMissionId: 'mission-1', localPlanStepId: 'step-1', localStepAttemptId: 'attempt-1', localExecutionRunId: 'run-1',
    ...drift,
  };
  return {
    queryDelegationState() {
      return {
        found: true,
        executionBindings: [executionBinding],
        humanGates: [{ id: 'delegation-gate-1', proposalId: 'proposal-1', delegationRequestId: 'request-1', state: 'approved' }],
        acceptances: [{ id: 'acceptance-1', proposalId: 'proposal-1', state: 'accepted' }],
      };
    },
    queryMissionState() {
      return {
        activeWorkspaceId: 'workspace-a',
        missions: [{ id: 'mission-1', workspaceId: 'workspace-a' }],
        missionRuns: [{ id: 'mission-run-1', missionId: 'mission-1', workspaceId: 'workspace-a', state: 'running' }],
        stepAttempts: [{ id: 'attempt-1', missionRunId: 'mission-run-1', stepId: 'step-1', executionRunId: 'run-1', humanGateId: gate?.id || null, state: stepState, blockers }],
        humanGates: gate ? [gate] : [],
        s1: {
          executionRuns: [{ id: 'run-1', taskId: 'task-1', workspaceId: 'workspace-a', state: runState, blockers }],
          tasks: [{ id: 'task-1', workspaceId: 'workspace-a', state: runState === 'blocked' ? 'waiting_resource' : runState === 'cancelled' ? 'cancelled' : 'waiting_human' }],
          humanGates: gate ? [gate] : [],
        },
      };
    },
    binding,
  };
}

test('M2.25 real S8 chain observes destination-local pre-effect action state and performs zero action decision/effect', async () => {
  const { source, destination, binding } = await realBoundSetup();
  try {
    const result = observeA2DestinationActionReadiness({ destinationBinding: binding, destinationWorkspaceId: 'workspace-a', s8Service: destination });
    assert.equal(result.destinationActionReadinessObservationAccepted, true);
    assert.ok(['blocked', 'waiting_human'].includes(result.destinationActionReadinessState));
    if (result.destinationActionReadinessState === 'blocked') {
      assert.equal(result.destinationActionHumanGateRequested, false);
      assert.ok(result.destinationActionBlockers.length >= 1);
    } else {
      assert.equal(result.destinationActionHumanGateRequested, true);
      assert.equal(result.destinationActionHumanGateState, 'requested');
    }
    assert.equal(result.destinationActionHumanGateDecisionCreatedByManagementLayer, false);
    assert.equal(result.destinationExecutionPerformedByManagementLayer, false);
    assert.equal(result.managementEffectInvocationPerformed, false);
    assert.equal(result.executionAuthorized, false);
    assert.equal(destination.workerManager.submissions.length, 0);
  } finally { source.close(); destination.close(); }
});

test('M2.25 exact waiting_human state observes the action-level HumanGate without deciding it', () => {
  const service = syntheticService();
  const result = observeA2DestinationActionReadiness({ destinationBinding: service.binding, destinationWorkspaceId: 'workspace-a', s8Service: service });
  assert.equal(result.destinationActionReadinessObservationAccepted, true);
  assert.equal(result.destinationActionReadinessState, 'waiting_human');
  assert.equal(result.destinationActionHumanGateRequested, true);
  assert.equal(result.destinationActionHumanGateState, 'requested');
  assert.equal(result.destinationActionHumanGateDecisionObserved, false);
  assert.equal(result.managementEffectInvocationPerformed, false);
});

test('M2.25 exact blocked state preserves destination-local blockers and creates no action gate', () => {
  const blockers = [{ code: 'resource_conflict', detail: { reason: 'worker_unavailable' } }];
  const service = syntheticService({ runState: 'blocked', gateState: null, blockers });
  const result = observeA2DestinationActionReadiness({ destinationBinding: service.binding, destinationWorkspaceId: 'workspace-a', s8Service: service });
  assert.equal(result.destinationActionReadinessObservationAccepted, true);
  assert.equal(result.destinationActionReadinessState, 'blocked');
  assert.deepEqual(result.destinationActionBlockers, blockers);
  assert.equal(result.destinationActionHumanGateObserved, false);
  assert.equal(result.destinationActionHumanGateRequested, false);
});

test('M2.25 observes destination-owned action rejection as terminal no-effect evidence', () => {
  const service = syntheticService({ runState: 'cancelled', gateState: 'rejected' });
  const result = observeA2DestinationActionReadiness({ destinationBinding: service.binding, destinationWorkspaceId: 'workspace-a', s8Service: service });
  assert.equal(result.destinationActionReadinessObservationAccepted, true);
  assert.equal(result.destinationActionReadinessState, 'rejected');
  assert.equal(result.destinationActionHumanGateDecisionObserved, true);
  assert.equal(result.destinationActionHumanGateState, 'rejected');
  assert.equal(result.managementEffectInvocationPerformed, false);
});

test('M2.25 fails closed when action state has advanced beyond readiness into active/effect territory', () => {
  const service = syntheticService({ runState: 'active', gateState: 'approved', attemptState: 'active' });
  const result = observeA2DestinationActionReadiness({ destinationBinding: service.binding, destinationWorkspaceId: 'workspace-a', s8Service: service });
  assert.equal(result.destinationActionReadinessObservationAccepted, false);
  assert.equal(result.destinationActionReadinessObservationReason, 'destination_action_state_advanced_beyond_readiness_slice');
  assert.equal(result.destinationActionAdvancedBeyondReadinessSlice, true);
  assert.equal(result.managementEffectInvocationPerformed, false);
});

test('M2.25 rejects execution-binding identity drift instead of following a substituted local Mission', () => {
  const service = syntheticService({ drift: { localMissionId: 'mission-substituted' } });
  const result = observeA2DestinationActionReadiness({ destinationBinding: service.binding, destinationWorkspaceId: 'workspace-a', s8Service: service });
  assert.equal(result.destinationActionReadinessObservationAccepted, false);
  assert.equal(result.destinationActionReadinessObservationReason, 'destination_execution_binding_identity_drift');
});

test('M2.25 rejects Workspace substitution before either destination read method is called', () => {
  let calls = 0;
  const binding = bindingFixture();
  const result = observeA2DestinationActionReadiness({
    destinationBinding: binding,
    destinationWorkspaceId: 'workspace-b',
    s8Service: { queryDelegationState() { calls += 1; }, queryMissionState() { calls += 1; } },
  });
  assert.equal(result.destinationActionReadinessObservationAccepted, false);
  assert.equal(result.destinationActionReadinessObservationReason, 'destination_workspace_mismatch');
  assert.equal(calls, 0);
});

test('M2.25 accepts no caller-supplied action decision/effect answer and imports no decision or execution method', () => {
  const service = syntheticService();
  for (const [key, value] of [
    ['actionHumanGateDecision', 'approved'],
    ['effectApproved', true],
    ['executionResult', { ok: true }],
    ['receiptRef', 'forged-receipt'],
  ]) {
    assert.throws(() => observeA2DestinationActionReadiness({ destinationBinding: service.binding, destinationWorkspaceId: 'workspace-a', s8Service: service, [key]: value }), /unsupported field/);
  }
  const source = fs.readFileSync(path.join(__dirname, '../src/management/policy/a2-s8-destination-action-readiness.cjs'), 'utf8');
  assert.match(source, /queryDelegationState/);
  assert.match(source, /queryMissionState/);
  assert.doesNotMatch(source, /\.approveHumanGate\s*\(/);
  assert.doesNotMatch(source, /\.rejectHumanGate\s*\(/);
  assert.doesNotMatch(source, /\.approveDelegationProposal\s*\(/);
  assert.doesNotMatch(source, /submitAuthorizedLocalTask|workerManager|child_process|wallet|payment|fetch\s*\(/);
});
