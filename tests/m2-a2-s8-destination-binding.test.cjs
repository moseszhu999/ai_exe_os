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
const { observeA2DestinationDecisionAndBinding } = require('../src/management/policy/a2-s8-destination-binding.cjs');

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
  async start() { throw new Error('M2.24 must not directly start Worker'); }
  async stop() { throw new Error('unused'); }
  async focus() { throw new Error('unused'); }
  pause() { throw new Error('unused'); }
  resume() { throw new Error('unused'); }
}

class SharedDelegationExchange {
  constructor() { this.requests = []; this.receipts = []; this.calls = []; }
  async submitRequest(request) {
    this.calls.push('submitRequest');
    const existing = this.requests.find((item) => item.id === request.id);
    if (existing) return { state: existing.requestDigest === request.requestDigest ? 'duplicate' : 'divergent', reasonCode: existing.requestDigest === request.requestDigest ? 'exact_duplicate' : 'request_digest_conflict' };
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
  async readCancellations() { this.calls.push('readCancellations'); return []; }
  async submitReceipt(receipt) { this.calls.push('submitReceipt'); this.receipts.push(structuredClone(receipt)); return { state: 'accepted' }; }
  async readReceipts() { this.calls.push('readReceipts'); return this.receipts.map((item) => structuredClone(item)); }
}

function clockAt(start = '2026-08-10T14:00:00.000Z') {
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
    delegationTransport: exchange, clock: clockAt('2026-08-10T14:10:00.000Z'),
  });
  const current = service.providerSnapshot.get(LOCAL_PROVIDER_SNAPSHOT_ID);
  const fixtureSnapshot = createProviderContractSnapshot({
    contractId: current.contractId,
    providerId: current.providerId,
    surfaceId: current.surfaceId,
    status: current.status,
    reviewedAt: current.reviewedAt,
    expiresAt: current.expiresAt,
    governingTermsDigest: current.governingTermsDigest,
    permittedActions: [...new Set([...current.permittedActions, 'run_approved_test_profile'])],
    prohibitedActions: current.prohibitedActions,
  });
  service.providerSnapshot.save({ id: LOCAL_PROVIDER_SNAPSHOT_ID, ...fixtureSnapshot }, 'test.m2_24_provider_scope');
  return service;
}

function a2(overrides = {}) {
  return {
    actionId: 'aiexe:management-action:run-tests:24', actionType: 'run_approved_test_profile', projectId: 'trainingos',
    policyRef: 'aiexe:policy:a2-management-v1', policyPreapproved: true,
    capabilityRef: 'local.form-submit@1.0.0', workApprovalRef: null,
    evidenceRefs: ['evidence:trainingos:test-profile-approved'], requestedAt: '2026-08-10T14:00:00.000Z',
    ...overrides,
  };
}

function authorization(overrides = {}) {
  const input = {
    schema: 'execution.authorization.request.v1', requestRef: 'aiexe:exec-auth-request:24', organizationRef: 'group:org:1',
    actorRef: 'aiexe:agent:group-manager-1', actorKind: 'agent', requestedActionRef: 'aiexe:management-action:run-tests:24',
    action: 'run_approved_test_profile', targetRef: 'project:trainingos', observedAt: '2026-08-10T14:00:00.000Z',
    requirements: {
      requiredHumanCapabilityRefs: [], requiredAgentCapabilityRefs: ['local.form-submit@1.0.0'],
      requiredEvidenceRefs: ['evidence:trainingos:test-profile-approved'], requiredPolicyRefs: ['aiexe:policy:a2-management-v1'],
      humanGateRequired: false,
    },
    resolved: {
      authorityGrant: {
        ref: 'group:authority-grant:aiexe-manager', status: 'active', organizationRef: 'group:org:1', actorRef: 'aiexe:agent:group-manager-1',
        allowedActions: ['run_approved_test_profile'], allowedTargets: ['project:trainingos'], expiresAt: '2026-08-11T14:00:00.000Z',
      },
      delegation: {
        ref: 'aiexe:delegation:trainingos-tests', status: 'active', organizationRef: 'group:org:1', actorRef: 'aiexe:agent:group-manager-1',
        allowedActions: ['run_approved_test_profile'], allowedTargets: ['project:trainingos'], expiresAt: '2026-08-11T14:00:00.000Z',
      },
      humanCapabilityCredentials: [], agentCapabilityPackages: [{ ref: 'local.form-submit@1.0.0', status: 'accepted' }],
      evidence: [{ ref: 'evidence:trainingos:test-profile-approved', status: 'current' }],
      policies: [{ ref: 'aiexe:policy:a2-management-v1', status: 'accepted' }], humanGate: null, revocations: [],
    },
  };
  return Object.assign(input, overrides);
}

function prepareBilateral(source, destination) {
  const peer = {
    id: 'aiexe-to-trainingos-peer-24', sourceInstanceId: source.activeSourceInstance().id, sourceWorkspaceId: 'workspace-a',
    destinationInstanceId: destination.activeSourceInstance().id, destinationWorkspaceId: 'workspace-a', status: 'active',
    createdAt: '2026-08-10T14:00:01.000Z', updatedAt: '2026-08-10T14:00:01.000Z',
  };
  source.recordPeerBinding({ ...peer, workspaceId: 'workspace-a' });
  destination.recordPeerBinding({ ...peer, workspaceId: 'workspace-a' });
  const install = destination.installCapability({ workspaceId: 'workspace-a', packageId: 'local.form-submit', version: '1.0.0' });
  destination.grantCapability({
    workspaceId: 'workspace-a', agentId: 'agent-a', installationId: install.id,
    allowedActions: ['run_approved_test_profile'], allowedTargets: ['project:trainingos'],
  });
  destination.recordDelegationPolicy({
    id: 'trainingos-delegation-policy-24', version: '1.0.0', peerBindingId: peer.id,
    destinationWorkspaceId: 'workspace-a', workspaceId: 'workspace-a', status: 'active',
    allowedCapabilityVersionIds: ['local.form-submit@1.0.0'], allowedActions: ['run_approved_test_profile'],
    allowedTargets: ['project:trainingos'], maxPendingRequests: 8, maxAcceptedNotStarted: 2,
    createdAt: '2026-08-10T14:00:02.000Z', expiresAt: '2030-08-10T14:00:02.000Z',
  });
  return peer;
}

function envelope(source, peer) {
  return {
    id: 'management-delegation-request-24', sourceInstanceId: source.activeSourceInstance().id,
    sourceWorkspaceId: 'workspace-a', destinationInstanceId: peer.destinationInstanceId, destinationWorkspaceId: 'workspace-a',
    peerBindingId: peer.id, policyId: 'trainingos-delegation-policy-24', policyVersion: '1.0.0',
    sourceMissionId: null, sourcePlanStepId: null, requestSequence: 1, previousRequestDigest: null,
    createdAt: '2026-08-10T14:00:03.000Z',
  };
}

async function setup() {
  const exchange = new SharedDelegationExchange();
  const source = makeSource(exchange);
  const destination = makeDestination(exchange);
  const peer = prepareBilateral(source, destination);
  const sourceSubmission = await submitA2AuthorizedRequestThroughS8Source({
    a2Request: a2(), authorizationRequest: authorization(), delegationEnvelope: envelope(source, peer), s8Service: source,
  });
  assert.equal(sourceSubmission.sourceSubmissionAccepted, true);
  const destinationAdmission = await observeA2RequestAtS8Destination({
    sourceSubmission, destinationWorkspaceId: 'workspace-a', s8Service: destination,
  });
  assert.equal(destinationAdmission.destinationAdmissionAccepted, true);
  assert.equal(destinationAdmission.destinationHumanGateState, 'requested');
  return { exchange, source, destination, sourceSubmission, destinationAdmission };
}

function observe(destination, destinationAdmission, overrides = {}) {
  return observeA2DestinationDecisionAndBinding({
    destinationAdmission,
    destinationWorkspaceId: 'workspace-a',
    s8Service: destination,
    ...overrides,
  });
}

test('M2.24 observes destination-owned approval and exact binding without performing the HumanGate decision or effect', async () => {
  const { source, destination, destinationAdmission } = await setup();
  try {
    const ownerDecision = destination.approveDelegationProposal({ workspaceId: 'workspace-a', proposalId: destinationAdmission.destinationProposalRef });
    assert.equal(ownerDecision.proposal.state, 'bound');
    assert.equal(ownerDecision.acceptance.state, 'accepted');
    assert.ok(ownerDecision.binding.id);
    assert.equal(ownerDecision.actionGate, null);
    assert.ok(ownerDecision.binding.localExecutionRunId);

    const result = observe(destination, destinationAdmission);
    assert.equal(result.destinationBindingObservationAccepted, true);
    assert.equal(result.destinationDecisionObserved, true);
    assert.equal(result.destinationHumanGateDecision, 'approved');
    assert.equal(result.destinationHumanGateState, 'approved');
    assert.equal(result.destinationFreshAdmissionObserved, true);
    assert.notEqual(result.destinationFreshAdmissionRef, destinationAdmission.destinationAdmissionSnapshotRef);
    assert.equal(result.destinationAcceptanceObserved, true);
    assert.equal(result.destinationAcceptanceState, 'accepted');
    assert.equal(result.destinationExecutionBindingObserved, true);
    assert.equal(result.destinationExecutionBindingRef, ownerDecision.binding.id);
    assert.equal(result.destinationLocalMissionRef, ownerDecision.binding.localMissionId);
    assert.equal(result.destinationLocalExecutionRunRef, ownerDecision.binding.localExecutionRunId);
    assert.equal(result.destinationHumanGateDecisionCreatedByManagementLayer, false);
    assert.equal(result.destinationExecutionBindingCreatedByManagementLayer, false);
    assert.equal(result.destinationExecutionPerformedByManagementLayer, false);
    assert.equal(result.managementEffectInvocationPerformed, false);
    assert.equal(result.destinationReceiptObserved, false);
    assert.equal(result.executionAuthorized, false);
    assert.equal(result.binding, false);
    assert.equal(destination.workerManager.submissions.length, 0);
  } finally { source.close(); destination.close(); }
});

test('M2.24 pending destination HumanGate remains pending and the observer never advances it', async () => {
  const { source, destination, destinationAdmission } = await setup();
  try {
    const result = observe(destination, destinationAdmission);
    assert.equal(result.destinationBindingObservationAccepted, true);
    assert.equal(result.destinationBindingObservationReason, 'destination_human_gate_still_pending');
    assert.equal(result.destinationDecisionObserved, false);
    assert.equal(result.destinationHumanGateState, 'requested');
    assert.equal(result.destinationExecutionBindingObserved, false);
    assert.equal(destination.queryDelegationState('workspace-a').acceptances.length, 0);
    assert.equal(destination.queryDelegationState('workspace-a').executionBindings.length, 0);
    assert.equal(destination.workerManager.submissions.length, 0);
  } finally { source.close(); destination.close(); }
});

test('M2.24 observes destination-owned rejection as terminal no-binding evidence', async () => {
  const { source, destination, destinationAdmission } = await setup();
  try {
    const ownerDecision = destination.rejectDelegationProposal({ workspaceId: 'workspace-a', proposalId: destinationAdmission.destinationProposalRef });
    assert.equal(ownerDecision.proposal.state, 'rejected');
    assert.equal(ownerDecision.acceptance.state, 'rejected');
    const result = observe(destination, destinationAdmission);
    assert.equal(result.destinationBindingObservationAccepted, true);
    assert.equal(result.destinationDecisionObserved, true);
    assert.equal(result.destinationHumanGateDecision, 'rejected');
    assert.equal(result.destinationAcceptanceState, 'rejected');
    assert.equal(result.destinationExecutionBindingObserved, false);
    assert.equal(result.destinationReceiptObserved, false);
    assert.equal(destination.workerManager.submissions.length, 0);
  } finally { source.close(); destination.close(); }
});

test('M2.24 fails closed when destination-local authority drifts before the destination owner approves', async () => {
  const { source, destination, destinationAdmission } = await setup();
  try {
    const grant = destination.grant.list().find((item) => item.workspaceId === 'workspace-a');
    destination.grant.save({ ...grant, status: 'revoked' }, 'test.destination_grant_revoked');
    assert.throws(
      () => destination.approveDelegationProposal({ workspaceId: 'workspace-a', proposalId: destinationAdmission.destinationProposalRef }),
      /local_grant_missing|delegation_admission_stale/,
    );
    const result = observe(destination, destinationAdmission);
    assert.equal(result.destinationBindingObservationAccepted, false);
    assert.equal(result.destinationStateQueryPerformed, true);
    assert.equal(result.destinationExecutionBindingObserved, false);
    assert.equal(destination.workerManager.submissions.length, 0);
  } finally { source.close(); destination.close(); }
});

test('M2.24 rejects ambiguous duplicate acceptance evidence instead of choosing one', async () => {
  const { source, destination, destinationAdmission } = await setup();
  try {
    const ownerDecision = destination.approveDelegationProposal({ workspaceId: 'workspace-a', proposalId: destinationAdmission.destinationProposalRef });
    destination.delegationAcceptance.save({ ...ownerDecision.acceptance, id: 'forged-duplicate-acceptance-24' }, 'test.duplicate_acceptance');
    const result = observe(destination, destinationAdmission);
    assert.equal(result.destinationBindingObservationAccepted, false);
    assert.equal(result.destinationBindingObservationReason, 'destination_acceptance_missing_or_ambiguous');
    assert.equal(result.destinationExecutionBindingCreatedByManagementLayer, false);
    assert.equal(destination.workerManager.submissions.length, 0);
  } finally { source.close(); destination.close(); }
});

test('M2.24 rejects Workspace substitution before querying destination state', async () => {
  const { source, destination, destinationAdmission } = await setup();
  try {
    let calls = 0;
    const service = { queryDelegationState() { calls += 1; return destination.queryDelegationState('workspace-b'); } };
    const result = observeA2DestinationDecisionAndBinding({
      destinationAdmission, destinationWorkspaceId: 'workspace-b', s8Service: service,
    });
    assert.equal(result.destinationBindingObservationAccepted, false);
    assert.equal(result.destinationBindingObservationReason, 'destination_workspace_mismatch');
    assert.equal(calls, 0);
  } finally { source.close(); destination.close(); }
});

test('M2.24 accepts no caller-supplied HumanGate decision, acceptance or binding answer fields', async () => {
  const { source, destination, destinationAdmission } = await setup();
  try {
    for (const [key, value] of [
      ['humanGateDecision', 'approved'],
      ['acceptanceRef', 'forged-acceptance'],
      ['executionBindingRef', 'forged-binding'],
      ['effectApproved', true],
    ]) {
      assert.throws(() => observeA2DestinationDecisionAndBinding({
        destinationAdmission, destinationWorkspaceId: 'workspace-a', s8Service: destination, [key]: value,
      }), /unsupported field/);
    }
    assert.equal(destination.queryDelegationState('workspace-a').humanGates[0].state, 'requested');
    assert.equal(destination.workerManager.submissions.length, 0);
  } finally { source.close(); destination.close(); }
});

test('M2.24 management observer imports no destination decision or execution method', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/management/policy/a2-s8-destination-binding.cjs'), 'utf8');
  assert.match(source, /queryDelegationState/);
  assert.doesNotMatch(source, /\.approveDelegationProposal\s*\(/);
  assert.doesNotMatch(source, /\.rejectDelegationProposal\s*\(/);
  assert.doesNotMatch(source, /\.approveHumanGate\s*\(/);
  assert.doesNotMatch(source, /\.submitAuthorizedLocalTask\s*\(/);
  assert.doesNotMatch(source, /workerManager|child_process|wallet|payment|fetch\s*\(/);
});
