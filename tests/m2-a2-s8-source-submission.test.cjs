'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { S8ApplicationService } = require('../src/application/s8-index.cjs');
const {
  submitA2AuthorizedRequestThroughS8Source,
} = require('../src/management/policy/a2-s8-source-submission.cjs');

class FakeWorkerManager {
  constructor() {
    this.workers = [
      { id: 's1-worker-chrome', projectId: 's1-local-project', role: 'implementation', status: 'idle', browserChannel: 'chrome' },
    ];
    this.submissions = [];
  }
  list() { return this.workers.map((item) => ({ ...item })); }
  async submitAuthorizedLocalTask(input) { this.submissions.push({ ...input }); return { result: { text: 'unexpected', submissionCount: this.submissions.length } }; }
  async start() { throw new Error('M2.22 must not directly start Worker'); }
  async stop() { throw new Error('unused'); }
  async focus() { throw new Error('unused'); }
  pause() { throw new Error('unused'); }
  resume() { throw new Error('unused'); }
}

class SourceExchange {
  constructor({ fail = false, ackState = 'accepted' } = {}) {
    this.fail = fail;
    this.ackState = ackState;
    this.requests = [];
    this.calls = [];
  }
  async submitRequest(request) {
    this.calls.push('submitRequest');
    this.requests.push(structuredClone(request));
    if (this.fail) throw new Error('simulated_transport_uncertainty');
    return {
      state: this.ackState,
      reasonCode: this.ackState === 'accepted' ? 'stored' : 'simulated_rejection',
    };
  }
}

function makeSource(exchange) {
  return new S8ApplicationService({
    databasePath: ':memory:',
    workerManager: new FakeWorkerManager(),
    localTarget: 'http://127.0.0.1:43119/task-form.html',
    delegationEndpoint: { id: 'delegation-test-endpoint', status: 'active' },
    delegationTransport: exchange,
    clock: (() => {
      let tick = 0;
      return () => new Date(Date.parse('2026-08-10T12:20:00.000Z') + (tick++ * 1000)).toISOString();
    })(),
  });
}

function a2(overrides = {}) {
  return {
    actionId: 'aiexe:management-action:run-tests:22',
    actionType: 'run_approved_test_profile',
    projectId: 'trainingos',
    policyRef: 'aiexe:policy:a2-management-v1',
    policyPreapproved: true,
    capabilityRef: 'testing.run@1.0.0',
    workApprovalRef: null,
    evidenceRefs: ['evidence:trainingos:test-profile-approved'],
    requestedAt: '2026-08-10T12:20:00.000Z',
    ...overrides,
  };
}

function authorization(overrides = {}) {
  const input = {
    schema: 'execution.authorization.request.v1',
    requestRef: 'aiexe:exec-auth-request:22',
    organizationRef: 'group:org:1',
    actorRef: 'aiexe:agent:group-manager-1',
    actorKind: 'agent',
    requestedActionRef: 'aiexe:management-action:run-tests:22',
    action: 'run_approved_test_profile',
    targetRef: 'project:trainingos',
    observedAt: '2026-08-10T12:20:00.000Z',
    requirements: {
      requiredHumanCapabilityRefs: [],
      requiredAgentCapabilityRefs: ['testing.run@1.0.0'],
      requiredEvidenceRefs: ['evidence:trainingos:test-profile-approved'],
      requiredPolicyRefs: ['aiexe:policy:a2-management-v1'],
      humanGateRequired: false,
    },
    resolved: {
      authorityGrant: {
        ref: 'group:authority-grant:aiexe-manager', status: 'active', organizationRef: 'group:org:1', actorRef: 'aiexe:agent:group-manager-1',
        allowedActions: ['run_approved_test_profile'], allowedTargets: ['project:trainingos'], expiresAt: '2026-08-11T12:20:00.000Z',
      },
      delegation: {
        ref: 'aiexe:delegation:trainingos-tests', status: 'active', organizationRef: 'group:org:1', actorRef: 'aiexe:agent:group-manager-1',
        allowedActions: ['run_approved_test_profile'], allowedTargets: ['project:trainingos'], expiresAt: '2026-08-11T12:20:00.000Z',
      },
      humanCapabilityCredentials: [],
      agentCapabilityPackages: [{ ref: 'testing.run@1.0.0', status: 'accepted' }],
      evidence: [{ ref: 'evidence:trainingos:test-profile-approved', status: 'current' }],
      policies: [{ ref: 'aiexe:policy:a2-management-v1', status: 'accepted' }],
      humanGate: null,
      revocations: [],
    },
  };
  return Object.assign(input, overrides);
}

function prepareEnvelope(source, overrides = {}) {
  const sourceInstanceId = source.activeSourceInstance().id;
  const peer = {
    id: 'aiexe-to-trainingos-peer',
    sourceInstanceId,
    sourceWorkspaceId: 'workspace-a',
    destinationInstanceId: 'trainingos-destination-instance',
    destinationWorkspaceId: 'workspace-a',
    status: 'active',
    createdAt: '2026-08-10T12:20:01.000Z',
    updatedAt: '2026-08-10T12:20:01.000Z',
  };
  source.recordPeerBinding({ ...peer, workspaceId: 'workspace-a' });
  return {
    id: 'management-delegation-request-22',
    sourceInstanceId,
    sourceWorkspaceId: 'workspace-a',
    destinationInstanceId: peer.destinationInstanceId,
    destinationWorkspaceId: peer.destinationWorkspaceId,
    peerBindingId: peer.id,
    policyId: 'trainingos-delegation-policy-v1',
    policyVersion: '1.0.0',
    sourceMissionId: null,
    sourcePlanStepId: null,
    requestSequence: 1,
    previousRequestDigest: null,
    createdAt: '2026-08-10T12:20:02.000Z',
    ...overrides,
  };
}

async function submit(source, envelope) {
  return submitA2AuthorizedRequestThroughS8Source({
    a2Request: a2(),
    authorizationRequest: authorization(),
    delegationEnvelope: envelope,
    s8Service: source,
  });
}

test('M2.22 submits an allowed A2 request exactly once through the existing S8 source owner', async () => {
  const exchange = new SourceExchange();
  const source = makeSource(exchange);
  try {
    const envelope = prepareEnvelope(source);
    const result = await submit(source, envelope);
    assert.equal(result.authorizationDecision, 'allow');
    assert.equal(result.s8OwnerPreflightPassed, true);
    assert.equal(result.s8RequestPersistencePerformed, true);
    assert.equal(result.s8InvocationPerformed, true);
    assert.equal(result.transportSubmissionAttempted, true);
    assert.equal(result.transportSubmissionObserved, true);
    assert.equal(result.transportSubmissionPerformed, true);
    assert.equal(result.transportAckState, 'accepted');
    assert.equal(result.sourceSubmissionAccepted, true);
    assert.equal(exchange.calls.filter((item) => item === 'submitRequest').length, 1);
    assert.equal(exchange.requests.length, 1);
    const state = source.queryDelegationState('workspace-a');
    assert.equal(state.outboundRequests.length, 1);
    assert.equal(state.outboundRequests[0].transportState, 'acknowledged');
    assert.equal(state.incomingProposals.length, 0);
    assert.equal(state.humanGates.length, 0);
    assert.equal(state.executionBindings.length, 0);
    assert.equal(source.workerManager.submissions.length, 0);
  } finally { source.close(); }
});

test('M2.22 blocked A2 or authorization state performs zero S8 owner calls', async () => {
  const forbiddenService = new Proxy({}, { get() { throw new Error('S8 owner must not be touched'); } });
  const result = await submitA2AuthorizedRequestThroughS8Source({
    a2Request: a2({ actionType: 'merge', capabilityRef: null }),
    authorizationRequest: authorization(),
    delegationEnvelope: {
      id: 'unused', sourceInstanceId: 'unused-source', sourceWorkspaceId: 'workspace-a', destinationInstanceId: 'unused-dest', destinationWorkspaceId: 'workspace-a',
      peerBindingId: 'unused-peer', policyId: 'unused-policy', policyVersion: '1.0.0', sourceMissionId: null, sourcePlanStepId: null,
      requestSequence: 1, previousRequestDigest: null, createdAt: '2026-08-10T12:20:02.000Z',
    },
    s8Service: forbiddenService,
  });
  assert.equal(result.sourceSubmissionAccepted, false);
  assert.equal(result.s8OwnerPreflightPerformed, false);
  assert.equal(result.transportSubmissionAttempted, false);
});

test('M2.22 authorization requiring HumanGate review cannot reach S8 source persistence or transport', async () => {
  const exchange = new SourceExchange();
  const source = makeSource(exchange);
  try {
    const envelope = prepareEnvelope(source);
    const auth = authorization();
    auth.requirements.humanGateRequired = true;
    const result = await submitA2AuthorizedRequestThroughS8Source({ a2Request: a2(), authorizationRequest: auth, delegationEnvelope: envelope, s8Service: source });
    assert.equal(result.authorizationDecision, 'needs_human_review');
    assert.equal(result.s8RequestPersistencePerformed, false);
    assert.equal(result.transportSubmissionAttempted, false);
    assert.equal(exchange.calls.length, 0);
    assert.equal(source.queryDelegationState('workspace-a').outboundRequests.length, 0);
  } finally { source.close(); }
});

test('M2.22 source preflight rejects stale request sequence before local persistence or transport', async () => {
  const exchange = new SourceExchange();
  const source = makeSource(exchange);
  try {
    const envelope = prepareEnvelope(source, { requestSequence: 2, previousRequestDigest: `sha256:${'a'.repeat(64)}` });
    const result = await submit(source, envelope);
    assert.equal(result.sourceSubmissionReason, 'request_sequence_not_current');
    assert.equal(result.s8OwnerPreflightPerformed, true);
    assert.equal(result.s8OwnerPreflightPassed, false);
    assert.equal(result.s8RequestPersistencePerformed, false);
    assert.equal(exchange.calls.length, 0);
    assert.equal(source.queryDelegationState('workspace-a').outboundRequests.length, 0);
  } finally { source.close(); }
});

test('M2.22 source preflight rejects peer or destination substitution before transport', async () => {
  const exchange = new SourceExchange();
  const source = makeSource(exchange);
  try {
    const envelope = prepareEnvelope(source, { destinationInstanceId: 'substituted-destination' });
    const result = await submit(source, envelope);
    assert.equal(result.sourceSubmissionReason, 'peer_binding_mismatch_or_inactive');
    assert.equal(result.s8RequestPersistencePerformed, false);
    assert.equal(result.transportSubmissionAttempted, false);
    assert.equal(exchange.calls.length, 0);
  } finally { source.close(); }
});

test('M2.22 exact acknowledged repeat is a no-op and never replays transport', async () => {
  const exchange = new SourceExchange();
  const source = makeSource(exchange);
  try {
    const envelope = prepareEnvelope(source);
    const first = await submit(source, envelope);
    const second = await submit(source, envelope);
    assert.equal(first.sourceSubmissionAccepted, true);
    assert.equal(second.sourceSubmissionReason, 'exact_request_already_acknowledged');
    assert.equal(second.s8RequestAlreadyPresent, true);
    assert.equal(second.transportSubmissionAttempted, false);
    assert.equal(second.automaticReplayAllowed, false);
    assert.equal(exchange.calls.filter((item) => item === 'submitRequest').length, 1);
  } finally { source.close(); }
});

test('M2.22 uncertain transport outcome is contained and exact repeat does not auto-replay', async () => {
  const exchange = new SourceExchange({ fail: true });
  const source = makeSource(exchange);
  try {
    const envelope = prepareEnvelope(source);
    const first = await submit(source, envelope);
    assert.equal(first.sourceSubmissionReason, 'transport_submission_outcome_uncertain');
    assert.equal(first.transportSubmissionAttempted, true);
    assert.equal(first.transportSubmissionObserved, false);
    assert.equal(first.transportSubmissionPerformed, false);
    assert.equal(first.transportSubmissionState, 'uncertain_requires_review_no_auto_replay');
    assert.equal(first.automaticReplayAllowed, false);
    assert.equal(first.executionAuthorized, false);
    const second = await submit(source, envelope);
    assert.equal(second.sourceSubmissionReason, 'existing_request_not_safely_replayable');
    assert.equal(second.transportSubmissionAttempted, false);
    assert.equal(second.transportSubmissionState, 'requires_review_no_auto_replay');
    assert.equal(exchange.calls.filter((item) => item === 'submitRequest').length, 1);
  } finally { source.close(); }
});

test('M2.22 imports no second S8 transport/application owner and cannot decide destination HumanGate or execution', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/management/policy/a2-s8-source-submission.cjs'), 'utf8');
  assert.doesNotMatch(source, /delegation\/transport|application\/s8|node:http|node:https|child_process|wallet|settlement|bankAdapter|dexAdapter/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /approveDelegationProposal|rejectDelegationProposal|approveHumanGate|rejectHumanGate|submitAuthorizedLocalTask|startWorker|stopWorker/);
  assert.match(source, /queryDelegationState/);
  assert.match(source, /createDelegationRequest/);
  assert.match(source, /pushDelegationRequest/);
});