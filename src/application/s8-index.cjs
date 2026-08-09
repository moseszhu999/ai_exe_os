'use strict';

const { createHash } = require('node:crypto');
const { ProjectionRepository } = require('./projection-repository.cjs');
const { S7ApplicationService, publicRecord } = require('./s7-index.cjs');
const { HumanGateService } = require('../main/human-gate/human-gate-service.cjs');
const { digest, safeClone } = require('../sync/envelope/index.cjs');
const {
  classifyDelegationRequestAppend,
  createDelegationCancellationProposal,
  createDelegationPeerBinding,
  createDelegationPolicySnapshot,
  createDelegationRequest,
} = require('../delegation/policy/index.cjs');
const {
  applyAdmissionToProposal,
  applyCancellationProposal,
  createDelegatedExecutionBinding,
  createDelegationAcceptance,
  createIncomingDelegationProposal,
  evaluateDelegationAdmission,
} = require('../delegation/admission/index.cjs');

function boundedId(prefix, ...parts) {
  return `${prefix}-${createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 20)}`;
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

function cleanProjection(value) {
  if (!value || typeof value !== 'object') return value;
  const { _revision, direction, transportState, localRole, workspaceId: projectionWorkspaceId, ...rest } = value;
  return rest;
}

function equalSemantic(left, right) {
  return digest(cleanProjection(left)) === digest(cleanProjection(right));
}

function normalizeTransportRows(response, key) {
  if (Array.isArray(response)) return response;
  return Array.isArray(response?.[key]) ? response[key] : [];
}

function receiptState(run) {
  if (!run) return 'uncertain';
  if (run.state === 'result_observed' || run.state === 'completed') return 'completed';
  if (run.state === 'failed') return 'failed';
  if (run.state === 'cancelled') return 'cancelled';
  if (run.recoveryReason) return 'uncertain';
  return 'running';
}

class S8ApplicationService extends S7ApplicationService {
  constructor(options = {}) {
    super(options);
    this.delegationEndpoint = options.delegationEndpoint || null;
    this.delegationTransport = options.delegationTransport || null;
    const names = [
      'delegationPeerBinding', 'delegationPolicy', 'delegationRequest', 'delegationAck',
      'delegationProposal', 'delegationAdmission', 'delegationHumanGate', 'delegationAcceptance',
      'delegatedExecutionBinding', 'delegationReceipt', 'delegationReceiptMirror',
      'delegationCancellation', 'delegationDivergence', 'delegationReceiptConsumption',
    ];
    this.s8Repositories = Object.fromEntries(names.map((name) => [name, new ProjectionRepository({ store: this.store, projectionType: name })]));
    Object.assign(this, this.s8Repositories);
    this.delegationGateService = new HumanGateService({ repository: this.delegationHumanGate, clock: this.clock });
  }

  appendS8Event({ type, workspaceId, aggregateType, aggregateId, idempotencyKey, payload = {} }) {
    return this.store.appendEvent({
      workspaceId,
      aggregateType,
      aggregateId,
      eventType: type,
      eventVersion: 1,
      idempotencyKey,
      occurredAt: this.clock(),
      payload,
      metadata: {
        source: 's8-application',
        delegationAuthority: 'destination-local',
        remoteWorkerControl: false,
        remoteHumanGateDecision: false,
      },
    }).event;
  }

  localDelegationRole(binding, workspaceId) {
    const localInstanceId = this.activeSourceInstance().id;
    if (binding.sourceInstanceId === localInstanceId && binding.sourceWorkspaceId === workspaceId) return 'source';
    if (binding.destinationInstanceId === localInstanceId && binding.destinationWorkspaceId === workspaceId) return 'destination';
    throw new Error('delegation_peer_binding_not_local_to_workspace');
  }

  recordPeerBinding(input) {
    this.requireS7Workspace(String(input?.workspaceId || ''));
    const candidate = createDelegationPeerBinding(input);
    const localRole = this.localDelegationRole(candidate, input.workspaceId);
    const existing = this.delegationPeerBinding.get(candidate.id);
    if (existing) {
      if (!equalSemantic(existing, candidate) || existing.workspaceId !== input.workspaceId || existing.localRole !== localRole) {
        throw new Error(`DelegationPeerBinding idempotency collision: ${candidate.id}`);
      }
      return existing;
    }
    const stored = this.delegationPeerBinding.save({ ...candidate, workspaceId: input.workspaceId, localRole }, 'delegation.peer_binding_recorded');
    this.appendS8Event({
      type: 'delegation.peer_binding_recorded', workspaceId: input.workspaceId, aggregateType: 'delegationPeerBinding', aggregateId: stored.id,
      idempotencyKey: `delegation.peer_binding_recorded:${stored.id}`, payload: { peerBindingId: stored.id, localRole, status: stored.status },
    });
    return stored;
  }

  recordDelegationPolicy(input) {
    const workspaceId = String(input?.workspaceId || '');
    this.requireS7Workspace(workspaceId);
    const peer = this.delegationPeerBinding.get(input.peerBindingId);
    if (!peer) throw new Error('peer_binding_missing');
    if (this.localDelegationRole(peer, workspaceId) !== 'destination') throw new Error('delegation_policy_must_be_recorded_by_destination');
    const candidate = createDelegationPolicySnapshot(input);
    if (candidate.destinationWorkspaceId !== workspaceId || candidate.peerBindingId !== peer.id) throw new Error('cross_workspace');
    const existing = this.delegationPolicy.get(candidate.id);
    if (existing) {
      if (!equalSemantic(existing, candidate) || existing.workspaceId !== workspaceId) throw new Error(`DelegationPolicy idempotency collision: ${candidate.id}`);
      return existing;
    }
    const stored = this.delegationPolicy.save({ ...candidate, workspaceId }, 'delegation.policy_recorded');
    this.appendS8Event({
      type: 'delegation.policy_recorded', workspaceId, aggregateType: 'delegationPolicy', aggregateId: stored.id,
      idempotencyKey: `delegation.policy_recorded:${stored.id}:${stored.version}`, payload: { policyId: stored.id, version: stored.version, status: stored.status },
    });
    return stored;
  }

  nextRequestSequence(peerBindingId) {
    const outbound = this.delegationRequest.list()
      .filter((item) => item.direction === 'outbound' && item.peerBindingId === peerBindingId)
      .sort((left, right) => Number(left.requestSequence) - Number(right.requestSequence));
    const previous = outbound.at(-1) || null;
    return Object.freeze({ sequence: previous ? Number(previous.requestSequence) + 1 : 1, previousDigest: previous?.requestDigest || null });
  }

  createDelegationRequest(input) {
    const workspaceId = String(input?.workspaceId || '');
    this.requireS7Workspace(workspaceId);
    const peer = this.delegationPeerBinding.get(input.peerBindingId);
    if (!peer || peer.status !== 'active') throw new Error('peer_binding_missing');
    if (this.localDelegationRole(peer, workspaceId) !== 'source') throw new Error('delegation_request_must_be_created_by_source');
    const next = this.nextRequestSequence(peer.id);
    const candidate = createDelegationRequest({
      ...input,
      id: input.id || boundedId('delegation-request', peer.id, next.sequence),
      sourceInstanceId: peer.sourceInstanceId,
      sourceWorkspaceId: peer.sourceWorkspaceId,
      destinationInstanceId: peer.destinationInstanceId,
      destinationWorkspaceId: peer.destinationWorkspaceId,
      requestSequence: next.sequence,
      previousRequestDigest: next.previousDigest,
      createdAt: input.createdAt || this.clock(),
    });
    const existing = this.delegationRequest.get(candidate.id);
    if (existing) {
      if (existing.requestDigest !== candidate.requestDigest || existing.direction !== 'outbound') throw new Error(`DelegationRequest idempotency collision: ${candidate.id}`);
      return existing;
    }
    const stored = this.delegationRequest.save({ ...candidate, workspaceId, direction: 'outbound', transportState: 'pending' }, 'delegation.request_created');
    this.appendS8Event({
      type: 'delegation.request_created', workspaceId, aggregateType: 'delegationRequest', aggregateId: stored.id,
      idempotencyKey: `delegation.request_created:${stored.id}:${stored.requestDigest}`, payload: {
        delegationRequestId: stored.id, peerBindingId: stored.peerBindingId, requestSequence: stored.requestSequence,
        requestDigest: stored.requestDigest, destinationInstanceId: stored.destinationInstanceId, destinationWorkspaceId: stored.destinationWorkspaceId,
      },
    });
    return stored;
  }

  requireDelegationTransport() {
    if (!this.delegationEndpoint || !this.delegationTransport) throw new Error('delegation_endpoint_unavailable');
    return this.delegationTransport;
  }

  async pushDelegationRequest(input) {
    const workspaceId = String(input?.workspaceId || '');
    this.requireS7Workspace(workspaceId);
    const request = this.delegationRequest.get(input.requestId);
    if (!request || request.workspaceId !== workspaceId || request.direction !== 'outbound') throw new Error('delegation_request_not_found');
    const transport = this.requireDelegationTransport();
    const response = await transport.submitRequest(cleanProjection(request));
    const ack = response?.ack || response || {};
    const state = ['accepted', 'duplicate', 'rejected', 'divergent'].includes(ack.state) ? ack.state : 'accepted';
    const reasonCode = ack.reasonCode || (state === 'duplicate' ? 'exact_duplicate' : 'transport_accepted');
    const ackId = boundedId('delegation-ack', request.id, request.requestDigest);
    const storedAck = this.delegationAck.save({
      id: ackId, workspaceId, requestId: request.id, requestDigest: request.requestDigest, state, reasonCode, observedAt: this.clock(),
    }, 'delegation.request_acknowledged');
    this.delegationRequest.save({ ...request, transportState: state === 'accepted' || state === 'duplicate' ? 'acknowledged' : state }, 'delegation.request_transport_state');
    this.appendS8Event({
      type: 'delegation.request_acknowledged', workspaceId, aggregateType: 'delegationRequest', aggregateId: request.id,
      idempotencyKey: `delegation.request_acknowledged:${request.id}:${request.requestDigest}:${state}`, payload: { requestId: request.id, state, reasonCode },
    });
    return freezeDeep({ networkRequested: true, ack: publicRecord(storedAck) });
  }

  localAuthorityForRequest(request) {
    const installations = this.installation.list()
      .filter((item) => item.workspaceId === request.destinationWorkspaceId
        && `${item.packageId}@${item.version}` === request.capabilityVersionId
        && item.status === 'installed')
      .sort((a, b) => a.id.localeCompare(b.id));
    const installation = installations[0] || null;
    const grants = installation ? this.grant.list()
      .filter((item) => item.workspaceId === request.destinationWorkspaceId
        && item.installationId === installation.id
        && item.status === 'active'
        && item.allowedActions?.includes(request.action)
        && item.allowedTargets?.includes(request.target))
      .sort((a, b) => a.id.localeCompare(b.id)) : [];
    const grant = grants[0] || null;
    const version = installation ? this.capabilityVersion.get(`${installation.packageId}@${installation.version}`) : null;
    const providerSnapshotId = version?.providerContractIds?.[0] || null;
    const provider = providerSnapshotId ? this.providerSnapshot.get(providerSnapshotId) : null;
    const providerCurrent = provider && provider.status === 'accepted' && (!provider.expiresAt || Date.parse(provider.expiresAt) > Date.parse(this.clock()));
    return Object.freeze({
      installation: installation ? { ...publicRecord(installation), capabilityVersionId: `${installation.packageId}@${installation.version}` } : null,
      grant: grant ? publicRecord(grant) : null,
      agent: grant ? this.agent.get(grant.agentId) : null,
      providerRequired: !!providerSnapshotId,
      providerAuthority: providerSnapshotId ? { id: providerSnapshotId, status: providerCurrent ? 'current' : 'stale', snapshotDigest: provider?.snapshotDigest || null } : null,
      resourceState: { status: 'current', lockDigest: digest(this.locks.list().filter((item) => item.workspaceId === request.destinationWorkspaceId)) },
      schedulingState: { status: 'current', policyId: this.activeSchedulingPolicy(request.destinationWorkspaceId)?.id || null },
    });
  }

  currentAdmission({ proposal, request, id = null }) {
    const peer = this.delegationPeerBinding.get(request.peerBindingId) || null;
    const policy = this.delegationPolicy.get(request.policyId) || null;
    const authority = this.localAuthorityForRequest(request);
    const pendingCount = this.delegationProposal.list().filter((item) => item.workspaceId === request.destinationWorkspaceId && ['received', 'inadmissible', 'waiting_human'].includes(item.state)).length;
    const acceptedNotStartedCount = this.delegatedExecutionBinding.list().filter((item) => item.workspaceId === request.destinationWorkspaceId && !item.localExecutionRunId).length;
    return evaluateDelegationAdmission({
      id: id || boundedId('delegation-admission', proposal.id, this.clock()),
      proposalId: proposal.id,
      request: cleanProjection(request),
      peerBinding: peer ? cleanProjection(peer) : null,
      policy: policy ? cleanProjection(policy) : null,
      localInstallation: authority.installation,
      localGrant: authority.grant,
      providerRequired: authority.providerRequired,
      providerAuthority: authority.providerAuthority,
      resourceState: authority.resourceState,
      schedulingState: authority.schedulingState,
      pendingCount,
      acceptedNotStartedCount,
      observedAt: this.clock(),
    });
  }

  recordDelegationDivergence({ workspaceId, requestId, state, reasonCode, observedDigest = null }) {
    const id = boundedId('delegation-divergence', workspaceId, requestId || 'unknown', reasonCode, observedDigest || 'none');
    const existing = this.delegationDivergence.get(id);
    if (existing) return existing;
    return this.delegationDivergence.save({ id, workspaceId, requestId: requestId || null, state, reasonCode, observedDigest, observedAt: this.clock() }, 'delegation.divergence_recorded');
  }

  requestDelegationGate({ proposal, request, admission }) {
    const gateId = boundedId('delegation-gate', proposal.id);
    const result = this.delegationGateService.request({
      id: gateId,
      workspaceId: proposal.workspaceId,
      taskId: proposal.id,
      executionRunId: proposal.id,
      actionClass: 'DELEGATION_ADMISSION',
      workerId: 'unassigned',
      capabilityAction: request.action,
      target: request.target,
      payloadPreview: {
        sourceInstanceId: request.sourceInstanceId,
        sourceWorkspaceId: request.sourceWorkspaceId,
        destinationWorkspaceId: request.destinationWorkspaceId,
        policyId: request.policyId,
        policyVersion: request.policyVersion,
        capabilityVersionId: request.capabilityVersionId,
        action: request.action,
        target: request.target,
        payloadClass: request.payloadClass,
        payloadDigest: request.payloadDigest,
        admissionSnapshotId: admission.id,
      },
      evidenceExpected: ['destination-local peer/policy/capability/resource/scheduling revalidation'],
    });
    return result.gate;
  }

  async pullDelegationInbox(input) {
    const workspaceId = String(input?.workspaceId || '');
    this.requireS7Workspace(workspaceId);
    const localInstanceId = this.activeSourceInstance().id;
    const transport = this.requireDelegationTransport();
    const response = await transport.readInbox({ destinationInstanceId: localInstanceId, destinationWorkspaceId: workspaceId, sinceSequence: 0 });
    const rows = normalizeTransportRows(response, 'requests');
    let accepted = 0;
    let duplicate = 0;
    let rejected = 0;
    for (const raw of rows) {
      let request;
      try {
        request = createDelegationRequest(raw);
        if (raw.requestDigest !== request.requestDigest) throw new Error('request_digest_conflict');
      } catch (error) {
        rejected += 1;
        this.recordDelegationDivergence({ workspaceId, requestId: raw?.id || null, state: 'rejected', reasonCode: error.message === 'request_digest_conflict' ? 'request_digest_conflict' : 'payload_schema_rejected', observedDigest: raw?.requestDigest || null });
        continue;
      }
      const peer = this.delegationPeerBinding.get(request.peerBindingId) || null;
      const existing = this.delegationRequest.get(request.id);
      const prior = this.delegationRequest.list().filter((item) => item.direction === 'inbound' && item.peerBindingId === request.peerBindingId && item.id !== request.id)
        .sort((a, b) => Number(a.requestSequence) - Number(b.requestSequence)).at(-1) || null;
      const classification = peer
        ? classifyDelegationRequestAppend({ peerBinding: cleanProjection(peer), lastSequence: Number(prior?.requestSequence || 0), lastRequestDigest: prior?.requestDigest || null, existingRequest: existing ? cleanProjection(existing) : null, request })
        : { state: 'rejected', reasonCode: 'peer_binding_missing' };
      if (classification.state === 'duplicate') {
        duplicate += 1;
        await transport.acknowledgeRequest({ requestId: request.id, requestDigest: request.requestDigest, state: 'duplicate', reasonCode: 'exact_duplicate' });
        continue;
      }
      if (classification.state !== 'accepted') {
        rejected += 1;
        this.recordDelegationDivergence({ workspaceId, requestId: request.id, state: classification.state, reasonCode: classification.reasonCode, observedDigest: request.requestDigest });
        await transport.acknowledgeRequest({ requestId: request.id, requestDigest: request.requestDigest, state: classification.state === 'divergent' ? 'divergent' : 'rejected', reasonCode: classification.reasonCode });
        continue;
      }
      const storedRequest = this.delegationRequest.save({ ...request, workspaceId, direction: 'inbound', transportState: 'received' }, 'delegation.request_received');
      let proposal = this.delegationProposal.get(boundedId('delegation-proposal', request.id));
      if (!proposal) {
        proposal = this.delegationProposal.save(createIncomingDelegationProposal({
          id: boundedId('delegation-proposal', request.id), delegationRequestId: request.id, peerBindingId: request.peerBindingId,
          policyId: request.policyId, workspaceId, state: 'received', receivedAt: this.clock(),
        }), 'delegation.proposal_received');
      }
      const admission = this.currentAdmission({ proposal, request: storedRequest });
      this.delegationAdmission.save(admission, 'delegation.admission_evaluated');
      const next = applyAdmissionToProposal(proposal, admission, this.clock());
      if (admission.admissible) {
        const gate = this.requestDelegationGate({ proposal: next, request: storedRequest, admission });
        proposal = this.delegationProposal.save({ ...next, humanGateId: gate.id }, 'delegation.human_gate_requested');
      } else {
        proposal = this.delegationProposal.save(next, 'delegation.proposal_inadmissible');
      }
      accepted += 1;
      await transport.acknowledgeRequest({ requestId: request.id, requestDigest: request.requestDigest, state: 'accepted', reasonCode: admission.admissible ? 'human_gate_required' : (admission.reasonCodes[0] || 'inadmissible') });
      this.appendS8Event({
        type: 'delegation.request_received', workspaceId, aggregateType: 'delegationProposal', aggregateId: proposal.id,
        idempotencyKey: `delegation.request_received:${request.id}:${request.requestDigest}`, payload: { requestId: request.id, proposalId: proposal.id, admissible: admission.admissible, reasonCodes: admission.reasonCodes },
      });
    }

    if (typeof transport.readCancellations === 'function') {
      const cancellationResponse = await transport.readCancellations({ destinationInstanceId: localInstanceId, destinationWorkspaceId: workspaceId, sinceSequence: 0 });
      for (const raw of normalizeTransportRows(cancellationResponse, 'cancellations')) {
        const existing = this.delegationCancellation.get(raw.id);
        if (existing) continue;
        const request = this.delegationRequest.get(raw.delegationRequestId);
        if (!request || request.workspaceId !== workspaceId || request.direction !== 'inbound') continue;
        this.delegationCancellation.save({ ...safeClone(raw), workspaceId, direction: 'inbound', state: 'pending_local_decision' }, 'delegation.cancellation_received');
      }
    }
    return freezeDeep({ networkRequested: true, accepted, duplicate, rejected });
  }

  latestAdmissionForProposal(proposalId) {
    return this.delegationAdmission.list().filter((item) => item.proposalId === proposalId)
      .sort((left, right) => String(right.observedAt).localeCompare(String(left.observedAt)))[0] || null;
  }

  createLocalDelegatedMission({ proposal, request, admission, acceptance }) {
    const existingBinding = this.delegatedExecutionBinding.list().find((item) => item.delegationRequestId === request.id) || null;
    if (existingBinding) return existingBinding;
    const authority = this.localAuthorityForRequest(request);
    if (!authority.installation || !authority.grant || !authority.agent) throw new Error('local_authority_missing_before_binding');
    const missionId = boundedId('delegated-mission', request.id);
    const stepId = boundedId('delegated-step', request.id);
    const mission = this.createMission({ id: missionId, workspaceId: proposal.workspaceId, title: `Delegated request ${request.id}`, objective: `Execute bounded delegated ${request.action}` }).mission;
    const revisionResult = this.createRevision({
      id: boundedId('delegated-revision', request.id),
      workspaceId: proposal.workspaceId,
      missionId: mission.id,
      revision: 1,
      objective: `Destination-local execution for ${request.id}`,
      terminalStepIds: [stepId],
      steps: [{
        id: stepId,
        name: `Delegated ${request.action}`,
        agentId: authority.agent.id,
        installationId: authority.installation.id,
        capabilityVersionId: request.capabilityVersionId,
        action: request.action,
        target: request.target,
        dependsOn: [],
        declaredInputs: [],
        declaredOutputs: ['delegation-result'],
        evidenceRequirements: ['local result text', 'submission count'],
        humanGatePolicy: 'action',
        resourceRequirements: [],
        priority: 'normal',
        payload: JSON.stringify(request.payload),
      }],
    });
    const start = this.startMission({ workspaceId: proposal.workspaceId, missionId: mission.id, revisionId: revisionResult.revision.id, runId: boundedId('delegated-mission-run', request.id) });
    const attempt = this.stepAttempt.list().find((item) => item.missionRunId === start.run.id && item.stepId === stepId) || null;
    const binding = createDelegatedExecutionBinding({
      id: boundedId('delegated-binding', request.id), proposal, acceptance, admission,
      localIdentity: {
        localMissionId: mission.id,
        localPlanStepId: stepId,
        localStepAttemptId: attempt?.id || null,
        localExecutionRunId: attempt?.executionRunId || null,
      },
      createdAt: this.clock(),
    });
    return this.delegatedExecutionBinding.save(binding, 'delegation.execution_bound');
  }

  approveDelegationProposal(input) {
    const workspaceId = String(input?.workspaceId || '');
    this.requireS7Workspace(workspaceId);
    let proposal = this.delegationProposal.get(input.proposalId);
    if (!proposal || proposal.workspaceId !== workspaceId) throw new Error('delegation_proposal_not_found');
    const existingBinding = this.delegatedExecutionBinding.list().find((item) => item.proposalId === proposal.id) || null;
    if (existingBinding) return freezeDeep({ proposal, binding: existingBinding, actionGate: this.humanGate.get(existingBinding.localExecutionRunId ? this.executionRun.get(existingBinding.localExecutionRunId)?.humanGateId : '') || null });
    if (proposal.state !== 'waiting_human') throw new Error('delegation proposal is not waiting_human');
    const request = this.delegationRequest.get(proposal.delegationRequestId);
    const admission = this.currentAdmission({ proposal, request });
    this.delegationAdmission.save(admission, 'delegation.admission_revalidated');
    if (!admission.admissible) {
      if (proposal.humanGateId) this.delegationGateService.expire(proposal.humanGateId);
      proposal = this.delegationProposal.save({ ...proposal, state: 'inadmissible', reasonCode: admission.reasonCodes[0] || 'inadmissible', updatedAt: this.clock() }, 'delegation.admission_became_stale');
      throw new Error(admission.reasonCodes[0] || 'delegation_admission_stale');
    }
    const gate = this.delegationHumanGate.get(proposal.humanGateId);
    if (!gate || gate.state !== 'requested') throw new Error('destination delegation HumanGate is not pending');
    this.delegationGateService.approve(gate.id);
    const acceptance = this.delegationAcceptance.save(createDelegationAcceptance({
      id: boundedId('delegation-acceptance', proposal.id), proposal, admission, humanGateId: gate.id, state: 'accepted', decidedAt: this.clock(),
    }), 'delegation.human_gate_accepted');
    const binding = this.createLocalDelegatedMission({ proposal, request, admission, acceptance });
    proposal = this.delegationProposal.save({ ...proposal, state: 'bound', reasonCode: 'destination_local_execution_bound', updatedAt: this.clock() }, 'delegation.execution_bound');
    const attempt = binding.localStepAttemptId ? this.stepAttempt.get(binding.localStepAttemptId) : null;
    const actionRun = attempt?.executionRunId ? this.executionRun.get(attempt.executionRunId) : null;
    const actionGate = actionRun?.humanGateId ? this.humanGate.get(actionRun.humanGateId) : null;
    this.appendS8Event({
      type: 'delegation.execution_bound', workspaceId, aggregateType: 'delegatedExecutionBinding', aggregateId: binding.id,
      idempotencyKey: `delegation.execution_bound:${binding.id}`, payload: { proposalId: proposal.id, requestId: request.id, bindingId: binding.id, localMissionId: binding.localMissionId, localStepAttemptId: binding.localStepAttemptId },
    });
    return freezeDeep({ proposal: publicRecord(proposal), acceptance: publicRecord(acceptance), binding: publicRecord(binding), actionGate: publicRecord(actionGate) });
  }

  rejectDelegationProposal(input) {
    const workspaceId = String(input?.workspaceId || '');
    let proposal = this.delegationProposal.get(input?.proposalId);
    if (!proposal || proposal.workspaceId !== workspaceId) throw new Error('delegation_proposal_not_found');
    if (proposal.state !== 'waiting_human') throw new Error('delegation proposal is not waiting_human');
    const admission = this.latestAdmissionForProposal(proposal.id);
    if (!admission?.admissible) throw new Error('current admissible snapshot is required');
    const gate = this.delegationHumanGate.get(proposal.humanGateId);
    this.delegationGateService.reject(gate.id);
    const acceptance = this.delegationAcceptance.save(createDelegationAcceptance({
      id: boundedId('delegation-rejection', proposal.id), proposal, admission, humanGateId: gate.id, state: 'rejected', decidedAt: this.clock(),
    }), 'delegation.human_gate_rejected');
    proposal = this.delegationProposal.save({ ...proposal, state: 'rejected', reasonCode: 'human_gate_rejected', updatedAt: this.clock() }, 'delegation.proposal_rejected');
    return freezeDeep({ proposal: publicRecord(proposal), acceptance: publicRecord(acceptance) });
  }

  async proposeDelegationCancellation(input) {
    const workspaceId = String(input?.workspaceId || '');
    const request = this.delegationRequest.get(input?.requestId);
    if (!request || request.workspaceId !== workspaceId || request.direction !== 'outbound') throw new Error('delegation_request_not_found');
    const proposal = createDelegationCancellationProposal({
      id: input.id || boundedId('delegation-cancel', request.id), delegationRequestId: request.id,
      reasonClass: input.reasonClass || 'source_withdrawal', createdAt: this.clock(),
    });
    const existing = this.delegationCancellation.get(proposal.id);
    const stored = existing || this.delegationCancellation.save({ ...proposal, workspaceId, direction: 'outbound', state: 'pending_transport' }, 'delegation.cancellation_proposed');
    const response = await this.requireDelegationTransport().submitCancellation(cleanProjection(stored));
    this.delegationCancellation.save({ ...stored, state: 'submitted' }, 'delegation.cancellation_submitted');
    return freezeDeep({ networkRequested: true, cancellationProposal: publicRecord(stored), response: safeClone(response || {}) });
  }

  resolveDelegationCancellation(input) {
    const workspaceId = String(input?.workspaceId || '');
    const cancellation = this.delegationCancellation.get(input?.cancellationId);
    if (!cancellation || cancellation.workspaceId !== workspaceId || cancellation.direction !== 'inbound') throw new Error('delegation_cancellation_not_found');
    if (cancellation.state !== 'pending_local_decision') return cancellation;
    const proposal = this.delegationProposal.list().find((item) => item.delegationRequestId === cancellation.delegationRequestId && item.workspaceId === workspaceId) || null;
    if (!proposal) throw new Error('delegation_proposal_not_found');
    const binding = this.delegatedExecutionBinding.list().find((item) => item.delegationRequestId === cancellation.delegationRequestId) || null;
    if (input.acceptedLocally === true) {
      const result = applyCancellationProposal({ proposal, executionBinding: binding, acceptedLocally: true, updatedAt: this.clock() });
      if (result.proposal !== proposal) this.delegationProposal.save(result.proposal, 'delegation.cancellation_accepted_locally');
      return this.delegationCancellation.save({ ...cancellation, state: result.reasonCode === 'post_start_remote_cancel_non_authoritative' ? 'non_authoritative_after_start' : 'accepted_locally', reasonCode: result.reasonCode }, 'delegation.cancellation_resolved');
    }
    return this.delegationCancellation.save({ ...cancellation, state: 'rejected_locally', reasonCode: 'destination_rejected_cancellation_proposal' }, 'delegation.cancellation_resolved');
  }

  createDelegationReceipt(binding) {
    const request = this.delegationRequest.get(binding.delegationRequestId);
    const run = binding.localExecutionRunId ? this.executionRun.get(binding.localExecutionRunId) : null;
    if (!request || !run) return null;
    const evidence = this.evidence.list().filter((item) => item.executionRunId === run.id).map((item) => ({ id: item.id, type: item.type, observedAt: item.observedAt }));
    const prior = this.delegationReceipt.list().filter((item) => item.delegationRequestId === request.id).sort((a, b) => Number(a.receiptRevision) - Number(b.receiptRevision));
    const revision = prior.length ? Number(prior.at(-1).receiptRevision) + 1 : 1;
    const base = {
      id: boundedId('delegation-receipt', request.id, revision),
      delegationRequestId: request.id,
      delegatedExecutionBindingId: binding.id,
      sourceInstanceId: request.sourceInstanceId,
      sourceWorkspaceId: request.sourceWorkspaceId,
      destinationInstanceId: request.destinationInstanceId,
      destinationWorkspaceId: request.destinationWorkspaceId,
      state: receiptState(run),
      resultClass: run.state === 'result_observed' ? 'bounded-local-result-observed' : null,
      resultSummary: { executionState: run.state, recoveryReason: run.recoveryReason || null },
      evidenceDigests: evidence.map((item) => digest(item)),
      receiptRevision: revision,
      observedAt: this.clock(),
    };
    return freezeDeep({ ...base, receiptDigest: digest(base) });
  }

  async publishDelegationReceipt(binding) {
    const candidate = this.createDelegationReceipt(binding);
    if (!candidate) return null;
    const existing = this.delegationReceipt.get(candidate.id);
    const stored = existing || this.delegationReceipt.save({ ...candidate, workspaceId: candidate.destinationWorkspaceId, direction: 'outbound', transportState: 'pending' }, 'delegation.receipt_recorded');
    if (this.delegationTransport && typeof this.delegationTransport.submitReceipt === 'function') {
      try {
        await this.delegationTransport.submitReceipt(cleanProjection(stored));
        this.delegationReceipt.save({ ...stored, transportState: 'submitted' }, 'delegation.receipt_submitted');
      } catch (error) {
        this.delegationReceipt.save({ ...stored, transportState: 'pending', transportReasonCode: 'transport_unavailable' }, 'delegation.receipt_transport_unavailable');
      }
    }
    return stored;
  }

  async approveHumanGate(input) {
    const result = await super.approveHumanGate(input);
    const gate = this.humanGate.get(input?.gateId);
    const binding = gate ? this.delegatedExecutionBinding.list().find((item) => item.localExecutionRunId === gate.executionRunId) : null;
    const delegationReceipt = binding ? await this.publishDelegationReceipt(binding) : null;
    return delegationReceipt ? Object.freeze({ ...result, delegationReceipt: publicRecord(delegationReceipt) }) : result;
  }

  async pullDelegationReceipts(input) {
    const workspaceId = String(input?.workspaceId || '');
    this.requireS7Workspace(workspaceId);
    const sourceInstanceId = this.activeSourceInstance().id;
    const response = await this.requireDelegationTransport().readReceipts({ sourceInstanceId, sourceWorkspaceId: workspaceId, sinceRevision: 0 });
    let accepted = 0;
    let duplicate = 0;
    let divergent = 0;
    for (const raw of normalizeTransportRows(response, 'receipts')) {
      if (raw.sourceInstanceId !== sourceInstanceId || raw.sourceWorkspaceId !== workspaceId) {
        divergent += 1;
        this.recordDelegationDivergence({ workspaceId, requestId: raw.delegationRequestId || null, state: 'rejected', reasonCode: 'cross_workspace_receipt', observedDigest: raw.receiptDigest || null });
        continue;
      }
      const safe = safeClone(raw);
      const key = boundedId('delegation-receipt-mirror', safe.delegationRequestId, safe.receiptRevision);
      const existing = this.delegationReceiptMirror.get(key);
      if (existing) {
        if (existing.receiptDigest === safe.receiptDigest) duplicate += 1;
        else {
          divergent += 1;
          this.recordDelegationDivergence({ workspaceId, requestId: safe.delegationRequestId, state: 'divergent', reasonCode: 'receipt_digest_conflict', observedDigest: safe.receiptDigest });
        }
        continue;
      }
      this.delegationReceiptMirror.save({ id: key, ...safe, workspaceId, direction: 'inbound' }, 'delegation.receipt_mirrored');
      accepted += 1;
    }
    return freezeDeep({ networkRequested: true, accepted, duplicate, divergent });
  }

  consumeDelegationReceipt(input) {
    const workspaceId = String(input?.workspaceId || '');
    const receipt = this.delegationReceiptMirror.get(input?.receiptMirrorId);
    if (!receipt || receipt.workspaceId !== workspaceId) throw new Error('delegation_receipt_not_found');
    if (receipt.state !== 'completed') throw new Error('delegation_receipt_not_completed');
    const request = this.delegationRequest.get(receipt.delegationRequestId);
    if (!request || request.direction !== 'outbound' || request.workspaceId !== workspaceId) throw new Error('delegation_source_request_not_found');
    const id = boundedId('delegation-receipt-consumption', request.id, receipt.receiptDigest);
    const existing = this.delegationReceiptConsumption.get(id);
    if (existing) return existing;
    if (request.sourceMissionId) {
      const mission = this.mission.get(request.sourceMissionId);
      if (!mission || mission.workspaceId !== workspaceId) throw new Error('source_mission_not_found');
      const currentRevision = this.missionRevision.get(mission.currentRevisionId);
      if (!currentRevision) throw new Error('source_mission_revision_missing');
      const plan = this.executionPlan.get(currentRevision.planId);
      if (request.sourcePlanStepId && !plan?.steps?.some((item) => item.id === request.sourcePlanStepId)) throw new Error('source_plan_step_not_current');
    }
    const stored = this.delegationReceiptConsumption.save({
      id, workspaceId, delegationRequestId: request.id, receiptMirrorId: receipt.id, receiptDigest: receipt.receiptDigest,
      sourceMissionId: request.sourceMissionId || null, sourcePlanStepId: request.sourcePlanStepId || null,
      state: 'consumed_once', consumedAt: this.clock(),
    }, 'delegation.receipt_consumed');
    this.appendS8Event({
      type: 'delegation.receipt_consumed', workspaceId, aggregateType: 'delegationReceiptConsumption', aggregateId: stored.id,
      idempotencyKey: `delegation.receipt_consumed:${stored.id}`, payload: { requestId: request.id, receiptDigest: receipt.receiptDigest, sourceMissionId: request.sourceMissionId || null, sourcePlanStepId: request.sourcePlanStepId || null },
    });
    return stored;
  }

  queryDelegationState(workspaceId) {
    if (typeof workspaceId !== 'string' || !workspaceId.trim()) throw new TypeError('workspaceId is required');
    const workspace = this.workspace.get(workspaceId);
    if (!workspace) return freezeDeep({
      workspaceId, found: false, peerBindings: [], policies: [], outboundRequests: [], incomingProposals: [], admissionSnapshots: [],
      humanGates: [], acceptances: [], executionBindings: [], receipts: [], cancellationProposals: [], divergences: [], receiptConsumptions: [],
    });
    const scoped = (repo) => repo.list().filter((item) => item.workspaceId === workspaceId).map(publicRecord);
    const receipts = [...scoped(this.delegationReceipt), ...scoped(this.delegationReceiptMirror)];
    return freezeDeep({
      workspaceId,
      found: true,
      localInstanceId: this.activeSourceInstance().id,
      endpointId: this.delegationEndpoint?.id || null,
      peerBindings: scoped(this.delegationPeerBinding),
      policies: scoped(this.delegationPolicy),
      outboundRequests: scoped(this.delegationRequest).filter((item) => item.direction === 'outbound'),
      incomingProposals: scoped(this.delegationProposal),
      admissionSnapshots: scoped(this.delegationAdmission),
      humanGates: scoped(this.delegationHumanGate),
      acceptances: scoped(this.delegationAcceptance),
      executionBindings: scoped(this.delegatedExecutionBinding),
      receipts,
      cancellationProposals: scoped(this.delegationCancellation),
      divergences: scoped(this.delegationDivergence),
      receiptConsumptions: scoped(this.delegationReceiptConsumption),
    });
  }

  queryOperatorCockpit(workspaceId) {
    const cockpit = super.queryOperatorCockpit(workspaceId);
    return Object.freeze({ ...cockpit, controlledDelegation: this.queryDelegationState(workspaceId) });
  }
}

module.exports = { S8ApplicationService, boundedId };
