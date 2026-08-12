'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { LOCAL_PROVIDER_SNAPSHOT_ID } = require('../src/application/index.cjs');
const { S8ApplicationService: SourceS8ApplicationService } = require('../src/application/s8-index.cjs');
const { S8ApplicationService: DestinationS8ApplicationService } = require('../src/application/s8-product-service.cjs');
const { createCapabilityPackage, publishCapabilityVersion } = require('../src/domain/capability-model.cjs');
const { A2_S8_DESTINATION_BINDING_SCHEMA } = require('../src/management/policy/a2-s8-destination-binding.cjs');
const { observeA2DestinationActionReadiness } = require('../src/management/policy/a2-s8-destination-action-readiness.cjs');
const { observeA2DestinationEffectEntryPreflight } = require('../src/management/policy/a2-s8-destination-effect-entry-preflight.cjs');
const { observeA2DestinationEffect } = require('../src/management/policy/a2-s8-destination-effect-observation.cjs');

const PACKAGE_ID = 'local.form-submit-effect';
const VERSION = '1.0.0';
const VERSION_ID = `${PACKAGE_ID}@${VERSION}`;
const SOURCE_ACTION = 'run_approved_test_profile';
const SOURCE_TARGET = 'project:trainingos';
const RUNTIME_ACTION = 'submit_payload';
const RUNTIME_TARGET = 'http://127.0.0.1:43119/task-form.html';
const DIGEST = `sha256:${'f'.repeat(64)}`;

class FakeWorkerManager {
  constructor() {
    this.submissions = [];
    this.workers = [
      { id: 's1-worker-chrome', projectId: 's1-local-project', role: 'implementation', status: 'idle', browserChannel: 'chrome' },
      { id: 's1-worker-chromium', projectId: 's1-local-project', role: 'review', status: 'idle', browserChannel: 'chromium' },
    ];
  }
  list() { return this.workers.map((item) => ({ ...item })); }
  async submitAuthorizedLocalTask(input) {
    this.submissions.push({ ...input });
    return { result: { text: 'm2.28 bounded test effect', submissionCount: this.submissions.length } };
  }
  async start() { throw new Error('M2.28 must not directly start Worker'); }
  async stop() { throw new Error('unused'); }
  async focus() { throw new Error('unused'); }
  pause() { throw new Error('unused'); }
  resume() { throw new Error('unused'); }
}

class Exchange {
  constructor() { this.requests = []; }
  async submitRequest(request) { this.requests.push(structuredClone(request)); return { state: 'accepted', reasonCode: 'stored' }; }
  async readInbox({ destinationInstanceId, destinationWorkspaceId }) { return this.requests.filter((item) => item.destinationInstanceId === destinationInstanceId && item.destinationWorkspaceId === destinationWorkspaceId).map((item) => structuredClone(item)); }
  async acknowledgeRequest(input) { return { ...input }; }
  async readCancellations() { return []; }
}

function clockAt(start) { let tick = 0; return () => new Date(Date.parse(start) + (tick++ * 1000)).toISOString(); }

function makeService(Service, exchange, start) {
  return new Service({
    databasePath: ':memory:', workerManager: new FakeWorkerManager(), localTarget: RUNTIME_TARGET,
    delegationEndpoint: { id: 'delegation-test-endpoint', status: 'active' }, delegationTransport: exchange,
    clock: clockAt(start),
  });
}

async function setup() {
  const exchange = new Exchange();
  const source = makeService(SourceS8ApplicationService, exchange, '2026-08-10T21:00:00.000Z');
  const destination = makeService(DestinationS8ApplicationService, exchange, '2026-08-10T21:10:00.000Z');
  const peer = {
    id: 'aiexe-to-trainingos-peer-28', sourceInstanceId: source.activeSourceInstance().id, sourceWorkspaceId: 'workspace-a',
    destinationInstanceId: destination.activeSourceInstance().id, destinationWorkspaceId: 'workspace-a', status: 'active',
    createdAt: '2026-08-10T21:00:01.000Z', updatedAt: '2026-08-10T21:00:01.000Z',
  };
  source.recordPeerBinding({ ...peer, workspaceId: 'workspace-a' });
  destination.recordPeerBinding({ ...peer, workspaceId: 'workspace-a' });
  destination.capabilityPackage.save({ id: PACKAGE_ID, ...createCapabilityPackage({ id: PACKAGE_ID, name: 'M2.28 bounded effect', publisher: 'project-owned', description: 'isolated destination-owned effect proof' }) }, 'test.m2_28_package');
  destination.capabilityVersion.save({ id: VERSION_ID, ...publishCapabilityVersion({
    packageId: PACKAGE_ID, version: VERSION, integrityDigest: DIGEST,
    inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, evidenceRequirements: ['local result text', 'submission count'],
    resourceRequirements: ['browser profile', 'local target'], providerContractIds: [LOCAL_PROVIDER_SNAPSHOT_ID], humanGatePolicy: 'action',
    delegatedActionBindings: [{ sourceAction: SOURCE_ACTION, sourceTarget: SOURCE_TARGET, runtimeAction: RUNTIME_ACTION, runtimeTarget: RUNTIME_TARGET, payloadBinding: 'delegation_payload_json_v1' }],
  }) }, 'test.m2_28_version');
  const install = destination.installCapability({ workspaceId: 'workspace-a', packageId: PACKAGE_ID, version: VERSION });
  destination.grantCapability({ workspaceId: 'workspace-a', agentId: 'agent-a', installationId: install.id, allowedActions: [RUNTIME_ACTION], allowedTargets: [RUNTIME_TARGET] });
  destination.recordDelegationPolicy({
    id: 'trainingos-policy-28', version: '1.0.0', peerBindingId: peer.id, destinationWorkspaceId: 'workspace-a', workspaceId: 'workspace-a', status: 'active',
    allowedCapabilityVersionIds: [VERSION_ID], allowedActions: [SOURCE_ACTION], allowedTargets: [SOURCE_TARGET], maxPendingRequests: 8, maxAcceptedNotStarted: 2,
    createdAt: '2026-08-10T21:00:02.000Z', expiresAt: '2030-08-10T21:00:02.000Z',
  });
  const request = source.createDelegationRequest({
    id: 'management-request-28', workspaceId: 'workspace-a', peerBindingId: peer.id, policyId: 'trainingos-policy-28', policyVersion: '1.0.0',
    capabilityVersionId: VERSION_ID, action: SOURCE_ACTION, target: SOURCE_TARGET, payloadClass: 'management-authorization',
    payload: { managementActionRef: 'aiexe:management-action:run-tests:28', evidenceRefs: ['evidence:test-profile-approved'] },
    sourceMissionId: null, sourcePlanStepId: null, createdAt: '2026-08-10T21:00:03.000Z',
  });
  await source.pushDelegationRequest({ workspaceId: 'workspace-a', requestId: request.id });
  await destination.pullDelegationInbox({ workspaceId: 'workspace-a' });
  const proposal = destination.queryDelegationState('workspace-a').incomingProposals.find((item) => item.delegationRequestId === request.id);
  const decision = destination.approveDelegationProposal({ workspaceId: 'workspace-a', proposalId: proposal.id });
  const binding = decision.binding;
  const destinationBinding = Object.freeze({
    schema: A2_S8_DESTINATION_BINDING_SCHEMA,
    actionId: 'aiexe:management-action:run-tests:28', actionType: SOURCE_ACTION, projectId: 'trainingos',
    authorizationRequestRef: 'auth-request-28', authorizationDecisionRef: 'auth-decision-28', delegationRequestRef: request.id, delegationRequestDigest: request.requestDigest,
    destinationWorkspaceId: 'workspace-a', destinationProposalRef: proposal.id, destinationHumanGateRef: proposal.humanGateId,
    destinationAcceptanceRef: decision.acceptance.id, destinationExecutionBindingRef: binding.id, destinationLocalMissionRef: binding.localMissionId,
    destinationLocalPlanStepRef: binding.localPlanStepId, destinationLocalStepAttemptRef: binding.localStepAttemptId, destinationLocalExecutionRunRef: binding.localExecutionRunId,
    destinationBindingObservationAccepted: true, destinationDecisionObserved: true, destinationHumanGateDecision: 'approved', destinationHumanGateState: 'approved',
    destinationAcceptanceObserved: true, destinationAcceptanceState: 'accepted', destinationExecutionBindingObserved: true,
    destinationHumanGateDecisionCreatedByManagementLayer: false, destinationExecutionBindingCreatedByManagementLayer: false,
    destinationExecutionPerformedByManagementLayer: false, managementEffectInvocationPerformed: false,
  });
  const readiness = observeA2DestinationActionReadiness({ destinationBinding, destinationWorkspaceId: 'workspace-a', s8Service: destination });
  const preflight = observeA2DestinationEffectEntryPreflight({ actionReadiness: readiness, destinationWorkspaceId: 'workspace-a', s8Service: destination });
  return { source, destination, request, proposal, decision, readiness, preflight };
}

test('M2.28 destination owner approves the downstream action gate, performs one isolated effect, and management only observes completion', async () => {
  const ctx = await setup();
  try {
    assert.equal(ctx.readiness.destinationActionReadinessState, 'waiting_human');
    assert.equal(ctx.preflight.destinationDelegatedActionBindingCompatible, true);
    assert.equal(ctx.preflight.destinationRuntimeAction, RUNTIME_ACTION);
    assert.equal(ctx.destination.workerManager.submissions.length, 0);
    await ctx.destination.approveHumanGate({ gateId: ctx.readiness.destinationActionHumanGateRef });
    assert.equal(ctx.destination.workerManager.submissions.length, 1);
    const observed = observeA2DestinationEffect({ actionReadiness: ctx.readiness, effectPreflight: ctx.preflight, destinationWorkspaceId: 'workspace-a', s8Service: ctx.destination });
    assert.equal(observed.destinationEffectObservationAccepted, true);
    assert.equal(observed.destinationEffectCompleted, true);
    assert.equal(observed.destinationActionHumanGateState, 'approved');
    assert.equal(observed.destinationExecutionRunState, 'result_observed');
    assert.equal(observed.destinationStepAttemptState, 'completed');
    assert.equal(observed.destinationMissionRunState, 'completed');
    assert.ok(observed.destinationEffectEvidenceRefs.length >= 1);
    assert.equal(observed.destinationActionHumanGateDecisionCreatedByManagementLayer, false);
    assert.equal(observed.destinationExecutionPerformedByManagementLayer, false);
    assert.equal(observed.managementEffectInvocationPerformed, false);
    assert.equal(observed.destinationReceiptObserved, false);
  } finally { ctx.source.close(); ctx.destination.close(); }
});

test('M2.28 repeated destination-owner approval cannot replay the isolated effect', async () => {
  const ctx = await setup();
  try {
    const gateId = ctx.readiness.destinationActionHumanGateRef;
    await ctx.destination.approveHumanGate({ gateId });
    await ctx.destination.approveHumanGate({ gateId });
    assert.equal(ctx.destination.workerManager.submissions.length, 1);
    const state = ctx.destination.queryMissionState('workspace-a');
    const evidenceIds = state.evidence.filter((item) => item.executionRunId === ctx.readiness.destinationLocalExecutionRunRef || item.stepAttemptId === ctx.readiness.destinationLocalStepAttemptRef).map((item) => item.id);
    assert.equal(new Set(evidenceIds).size, evidenceIds.length);
  } finally { ctx.source.close(); ctx.destination.close(); }
});

test('M2.28 observer before local action decision cannot manufacture completion', async () => {
  const ctx = await setup();
  try {
    const observed = observeA2DestinationEffect({ actionReadiness: ctx.readiness, effectPreflight: ctx.preflight, destinationWorkspaceId: 'workspace-a', s8Service: ctx.destination });
    assert.equal(observed.destinationEffectObservationAccepted, false);
    assert.equal(observed.destinationEffectCompleted, false);
    assert.equal(observed.destinationActionHumanGateDecisionCreatedByManagementLayer, false);
    assert.equal(ctx.destination.workerManager.submissions.length, 0);
  } finally { ctx.source.close(); ctx.destination.close(); }
});

test('M2.28 rejects caller-supplied decision/effect/result answers and imports no execution method', async () => {
  const ctx = await setup();
  try {
    for (const [key, value] of [['actionHumanGateDecision', 'approved'], ['effectCompleted', true], ['result', { ok: true }], ['receipt', 'forged']]) {
      assert.throws(() => observeA2DestinationEffect({ actionReadiness: ctx.readiness, effectPreflight: ctx.preflight, destinationWorkspaceId: 'workspace-a', s8Service: ctx.destination, [key]: value }), /unsupported field/);
    }
    assert.equal(ctx.destination.workerManager.submissions.length, 0);
    const source = fs.readFileSync(path.join(__dirname, '../src/management/policy/a2-s8-destination-effect-observation.cjs'), 'utf8');
    assert.match(source, /queryMissionState/);
    assert.doesNotMatch(source, /\.approveHumanGate\s*\(|\.rejectHumanGate\s*\(|submitAuthorizedLocalTask|workerManager|fetch\s*\(|child_process|wallet|payment/);
  } finally { ctx.source.close(); ctx.destination.close(); }
});
