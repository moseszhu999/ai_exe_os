'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { S8ApplicationService: SourceS8ApplicationService } = require('../src/application/s8-index.cjs');
const { S8ApplicationService: DestinationS8ApplicationService } = require('../src/application/s8-product-service.cjs');
const { submitA2AuthorizedRequestThroughS8Source } = require('../src/management/policy/a2-s8-source-submission.cjs');
const { observeA2RequestAtS8Destination } = require('../src/management/policy/a2-s8-destination-admission.cjs');

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
  async start() { throw new Error('M2.23 must not directly start Worker'); }
  async stop() { throw new Error('unused'); }
  async focus() { throw new Error('unused'); }
  pause() { throw new Error('unused'); }
  resume() { throw new Error('unused'); }
}

class SharedDelegationExchange {
  constructor({ failRead = false } = {}) {
    this.failRead = failRead;
    this.requests = [];
    this.calls = [];
  }
  async submitRequest(request) {
    this.calls.push('submitRequest');
    const existing = this.requests.find((item) => item.id === request.id);
    if (existing) return { state: existing.requestDigest === request.requestDigest ? 'duplicate' : 'divergent', reasonCode: existing.requestDigest === request.requestDigest ? 'exact_duplicate' : 'request_digest_conflict' };
    this.requests.push(structuredClone(request));
    return { state: 'accepted', reasonCode: 'stored' };
  }
  async readInbox({ destinationInstanceId, destinationWorkspaceId }) {
    this.calls.push('readInbox');
    if (this.failRead) throw new Error('simulated_destination_pull_uncertainty');
    return this.requests
      .filter((item) => item.destinationInstanceId === destinationInstanceId && item.destinationWorkspaceId === destinationWorkspaceId)
      .map((item) => structuredClone(item));
  }
  async acknowledgeRequest(input) { this.calls.push('acknowledgeRequest'); return { ...input }; }
  async readCancellations() { this.calls.push('readCancellations'); return []; }
}

function clockAt(start = '2026-08-10T13:00:00.000Z') {
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
  return new DestinationS8ApplicationService({
    databasePath: ':memory:', workerManager: new FakeWorkerManager(),
    localTarget: 'http://127.0.0.1:43119/task-form.html',
    delegationEndpoint: { id: 'delegation-test-endpoint', status: 'active' },
    delegationTransport: exchange, clock: clockAt('2026-08-10T13:10:00.000Z'),
  });
}

function a2(overrides = {}) {
  return {
    actionId: 'aiexe:management-action:run-tests:23', actionType: 'run_approved_test_profile', projectId: 'trainingos',
    policyRef: 'aiexe:policy:a2-management-v1', policyPreapproved: true,
    capabilityRef: 'local.form-submit@1.0.0', workApprovalRef: null,
    evidenceRefs: ['evidence:trainingos:test-profile-approved'], requestedAt: '2026-08-10T13:00:00.000Z',
    ...overrides,
  };
}

function authorization(overrides = {}) {
  const input = {
    schema: 'execution.authorization.request.v1', requestRef: 'aiexe:exec-auth-request:23', organizationRef: 'group:org:1',
    actorRef: 'aiexe:agent:group-manager-1', actorKind: 'agent', requestedActionRef: 'aiexe:management-action:run-tests:23',
    action: 'run_approved_test_profile', targetRef: 'project:trainingos', observedAt: '2026-08-10T13:00:00.000Z',
    requirements: {
      requiredHumanCapabilityRefs: [], requiredAgentCapabilityRefs: ['local.form-submit@1.0.0'],
      requiredEvidenceRefs: ['evidence:trainingos:test-profile-approved'], requiredPolicyRefs: ['aiexe:policy:a2-management-v1'],
      humanGateRequired: false,
    },
    resolved: {
      authorityGrant: {
        ref: 'group:authority-grant:aiexe-manager', status: 'active', organizationRef: 'group:org:1', actorRef: 'aiexe:agent:group-manager-1',
        allowedActions: ['run_approved_test_profile'], allowedTargets: ['project:trainingos'], expiresAt: '2026-08-11T13:00:00.000Z',
      },
      delegation: {
        ref: 'aiexe:delegation:trainingos-tests', status: 'active', organizationRef: 'group:org:1', actorRef: 'aiexe:agent:group-manager-1',
        allowedActions: ['run_approved_test_profile'], allowedTargets: ['project:trainingos'], expiresAt: '2026-08-11T13:00:00.000Z',
      },
      humanCapabilityCredentials: [], agentCapabilityPackages: [{ ref: 'local.form-submit@1.0.0', status: 'accepted' }],
      evidence: [{ ref: 'evidence:trainingos:test-profile-approved', status: 'current' }],
      policies: [{ ref: 'aiexe:policy:a2-management-v1', status: 'accepted' }], humanGate: null, revocations: [],
    },
  };
  return Object.assign(input, overrides);
}

function prepareBilateral(source, destination, { grant = true } = {}) {
  const sourceInstanceId = source.activeSourceInstance().id;
  const destinationInstanceId = destination.activeSourceInstance().id;
  const peer = {
    id: 'aiexe-to-trainingos-peer-23', sourceInstanceId, sourceWorkspaceId: 'workspace-a',
    destinationInstanceId, destinationWorkspaceId: 'workspace-a', status: 'active',
    createdAt: '2026-08-10T13:00:01.000Z', updatedAt: '2026-08-10T13:00:01.000Z',
  };
  source.recordPeerBinding({ ...peer, workspaceId: 'workspace-a' });
  destination.recordPeerBinding({ ...peer, workspaceId: 'workspace-a' });
  const install = destination.installCapability({ workspaceId: 'workspace-a', packageId: 'local.form-submit', version: '1.0.0' });
  if (grant) {
    destination.grantCapability({
      workspaceId: 'workspace-a', agentId: 'agent-a', installationId: install.id,
      allowedActions: ['run_approved_test_profile'], allowedTargets: ['project:trainingos'],
    });
  }
  destination.recordDelegationPolicy({
    id: 'trainingos-delegation-policy-23', version: '1.0.0', peerBindingId: peer.id,
    destinationWorkspaceId: 'workspace-a', workspaceId: 'workspace-a', status: 'active',
    allowedCapabilityVersionIds: ['local.form-submit@1.0.0'], allowedActions: ['run_approved_test_profile'],
    allowedTargets: ['project:trainingos'], maxPendingRequests: 8, maxAcceptedNotStarted: 2,
    createdAt: '2026-08-10T13:00:02.000Z', expiresAt: '2030-08-10T13:00:02.000Z',
  });
  return { peer, sourceInstanceId, destinationInstanceId };
}

function envelope(source, peer) {
  return {
    id: 'management-delegation-request-23', sourceInstanceId: source.activeSourceInstance().id,
    sourceWorkspaceId: 'workspace-a', destinationInstanceId: peer.destinationInstanceId, destinationWorkspaceId: 'workspace-a',
    peerBindingId: peer.id, policyId: 'trainingos-delegation-policy-23', policyVersion: '1.0.0',
    sourceMissionId: null, sourcePlanStepId: null, requestSequence: 1, previousRequestDigest: null,
    createdAt: '2026-08-10T13:00:03.000Z',
  };
}

async function sourceSubmit(source, peer) {
  return submitA2AuthorizedRequestThroughS8Source({
    a2Request: a2(), authorizationRequest: authorization(), delegationEnvelope: envelope(source, peer), s8Service: source,
  });
}

async function setup(options = {}) {
  const exchange = new SharedDelegationExchange(options.exchange || {});
  const source = makeSource(exchange);
  const destination = makeDestination(exchange);
  const topology = prepareBilateral(source, destination, options);
  const sourceSubmission = await sourceSubmit(source, topology.peer);
  assert.equal(sourceSubmission.sourceSubmissionAccepted, true);
  return { exchange, source, destination, sourceSubmission };
}

test('M2.23 receives the exact M2.22 request through the existing destination owner and stops at requested HumanGate', async () => {
  const { exchange, source, destination, sourceSubmission } = await setup();
  try {
    const result = await observeA2RequestAtS8Destination({ sourceSubmission, destinationWorkspaceId: 'workspace-a', s8Service: destination });
    assert.equal(result.destinationInboxPullAttempted, true);
    assert.equal(result.destinationInboxPullObserved, true);
    assert.equal(result.destinationAdmissionObserved, true);
    assert.equal(result.destinationAdmissionAdmissible, true);
    assert.equal(result.destinationAdmissionAccepted, true);
    assert.equal(result.destinationProposalState, 'waiting_human');
    assert.equal(result.destinationHumanGateRequested, true);
    assert.equal(result.destinationHumanGateState, 'requested');
    assert.equal(result.destinationHumanGateDecisionCreated, false);
    assert.equal(result.destinationExecutionBindingCreated, false);
    assert.equal(result.destinationExecutionPerformed, false);
    assert.equal(result.executionAuthorized, false);
    assert.equal(result.binding, false);
    assert.equal(exchange.calls.filter((item) => item === 'readInbox').length, 1);
    const state = destination.queryDelegationState('workspace-a');
    const admission = state.admissionSnapshots.find((item) => item.id === result.destinationAdmissionSnapshotRef);
    assert.equal(admission.requestDigest, sourceSubmission.delegationRequestDigest);
    assert.equal(state.acceptances.length, 0);
    assert.equal(state.executionBindings.length, 0);
    assert.equal(destination.mission.list().filter((item) => item.title?.startsWith('Delegated request')).length, 0);
    assert.equal(destination.workerManager.submissions.length, 0);
  } finally { source.close(); destination.close(); }
});

test('M2.23 destination-local missing grant is inadmissible and creates no HumanGate or execution identity', async () => {
  const { source, destination, sourceSubmission } = await setup({ grant: false });
  try {
    const result = await observeA2RequestAtS8Destination({ sourceSubmission, destinationWorkspaceId: 'workspace-a', s8Service: destination });
    assert.equal(result.destinationAdmissionObserved, true);
    assert.equal(result.destinationAdmissionAdmissible, false);
    assert.equal(result.destinationAdmissionAccepted, false);
    assert.ok(result.destinationAdmissionReasonCodes.includes('local_grant_missing'));
    assert.equal(result.destinationProposalState, 'inadmissible');
    assert.equal(result.destinationHumanGateRequested, false);
    assert.equal(destination.queryDelegationState('workspace-a').humanGates.length, 0);
    assert.equal(destination.queryDelegationState('workspace-a').executionBindings.length, 0);
    assert.equal(destination.workerManager.submissions.length, 0);
  } finally { source.close(); destination.close(); }
});

test('M2.23 tampered transport payload is rejected before proposal/admission promotion', async () => {
  const { exchange, source, destination, sourceSubmission } = await setup();
  try {
    exchange.requests[0].payload.authorizationDecisionRef = 'tampered-decision-ref';
    const result = await observeA2RequestAtS8Destination({ sourceSubmission, destinationWorkspaceId: 'workspace-a', s8Service: destination });
    assert.equal(result.destinationAdmissionAccepted, false);
    assert.equal(result.destinationAdmissionReason, 'destination_request_not_observed_after_pull');
    const state = destination.queryDelegationState('workspace-a');
    assert.equal(state.incomingProposals.length, 0);
    assert.equal(state.admissionSnapshots.length, 0);
    assert.equal(state.humanGates.length, 0);
    assert.equal(state.executionBindings.length, 0);
    assert.ok(state.divergences.some((item) => ['request_digest_conflict', 'payload_schema_rejected'].includes(item.reasonCode)));
  } finally { source.close(); destination.close(); }
});

test('M2.23 wrong destination Workspace cannot observe or promote the request', async () => {
  const { source, destination, sourceSubmission } = await setup();
  try {
    const result = await observeA2RequestAtS8Destination({ sourceSubmission, destinationWorkspaceId: 'workspace-b', s8Service: destination });
    assert.equal(result.destinationAdmissionAccepted, false);
    assert.equal(result.destinationAdmissionReason, 'destination_request_not_observed_after_pull');
    assert.equal(destination.queryDelegationState('workspace-b').incomingProposals.length, 0);
    assert.equal(destination.queryDelegationState('workspace-b').humanGates.length, 0);
    assert.equal(destination.queryDelegationState('workspace-b').executionBindings.length, 0);
  } finally { source.close(); destination.close(); }
});

test('M2.23 exact already-observed destination state is a no-pull no-op', async () => {
  const { exchange, source, destination, sourceSubmission } = await setup();
  try {
    const first = await observeA2RequestAtS8Destination({ sourceSubmission, destinationWorkspaceId: 'workspace-a', s8Service: destination });
    const second = await observeA2RequestAtS8Destination({ sourceSubmission, destinationWorkspaceId: 'workspace-a', s8Service: destination });
    assert.equal(first.destinationAdmissionAccepted, true);
    assert.equal(second.destinationAdmissionAccepted, true);
    assert.equal(second.destinationObservationState, 'existing_exact_no_pull');
    assert.equal(second.destinationInboxPullAttempted, false);
    assert.equal(exchange.calls.filter((item) => item === 'readInbox').length, 1);
    assert.equal(destination.queryDelegationState('workspace-a').humanGates.length, 1);
    assert.equal(destination.queryDelegationState('workspace-a').executionBindings.length, 0);
  } finally { source.close(); destination.close(); }
});

test('M2.23 unacknowledged source result performs zero destination owner calls', async () => {
  const service = new Proxy({}, { get() { throw new Error('destination owner must not be touched'); } });
  const result = await observeA2RequestAtS8Destination({
    sourceSubmission: {
      schema: 'aiexe.a2-s8-source-submission.v1', sourceSubmissionAccepted: false, transportSubmissionState: 'uncertain_requires_review_no_auto_replay',
      transportAckState: null, delegationRequestRef: 'management-delegation-request-23', delegationRequestDigest: `sha256:${'a'.repeat(64)}`,
    },
    destinationWorkspaceId: 'workspace-a', s8Service: service,
  });
  assert.equal(result.destinationAdmissionReason, 'source_submission_not_safely_acknowledged');
  assert.equal(result.destinationPreflightPerformed, false);
  assert.equal(result.destinationInboxPullAttempted, false);
});

test('M2.23 destination pull uncertainty is contained without HumanGate decision or effect', async () => {
  const { source, destination, sourceSubmission } = await setup({ exchange: { failRead: true } });
  try {
    const result = await observeA2RequestAtS8Destination({ sourceSubmission, destinationWorkspaceId: 'workspace-a', s8Service: destination });
    assert.equal(result.destinationAdmissionReason, 'destination_inbox_pull_outcome_uncertain');
    assert.equal(result.destinationInboxPullAttempted, true);
    assert.equal(result.destinationInboxPullObserved, false);
    assert.equal(result.destinationHumanGateDecisionCreated, false);
    assert.equal(result.destinationExecutionPerformed, false);
    assert.equal(result.automaticReplayAllowed, false);
    assert.equal(destination.queryDelegationState('workspace-a').executionBindings.length, 0);
    assert.equal(destination.workerManager.submissions.length, 0);
  } finally { source.close(); destination.close(); }
});

test('M2.23 imports no second S8 owner and has no destination decision or execution method', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/management/policy/a2-s8-destination-admission.cjs'), 'utf8');
  assert.doesNotMatch(source, /delegation\/admission|delegation\/transport|application\/s8|node:http|node:https|child_process|wallet|settlement|bankAdapter|dexAdapter/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /approveDelegationProposal|rejectDelegationProposal|decideDelegationGate|approveHumanGate|rejectHumanGate|submitAuthorizedLocalTask|createLocalDelegatedMission/);
  assert.match(source, /queryDelegationState/);
  assert.match(source, /pullDelegationInbox/);
});