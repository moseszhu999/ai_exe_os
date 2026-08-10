'use strict';

const { S8ApplicationService: S8DelegationApplicationService, boundedId } = require('./s8-index.cjs');
const {
  createDelegatedExecutionBinding,
  createDelegationAcceptance,
  evaluateDelegationAdmission,
} = require('../delegation/admission/index.cjs');
const { assertProviderSnapshotAllows } = require('../domain/provider-contract-snapshot.cjs');
const { digest } = require('../sync/envelope/index.cjs');
const { publicRecord } = require('./s7-index.cjs');

const DELEGATION_PAYLOAD_BINDING = 'delegation_payload_json_v1';

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

function resolveDestinationRuntimeIntent({ request, installation, version }) {
  if (!request || !installation || !version) return null;
  if (`${installation.packageId}@${installation.version}` !== request.capabilityVersionId) return null;
  if (installation.integrityDigest !== version.integrityDigest || version.status !== 'available') return null;
  const exact = (version.delegatedActionBindings || []).find((binding) => (
    binding.sourceAction === request.action && binding.sourceTarget === request.target
  )) || null;
  if (exact) {
    return freezeDeep({
      mode: 'capability_binding',
      sourceAction: request.action,
      sourceTarget: request.target,
      runtimeAction: exact.runtimeAction,
      runtimeTarget: exact.runtimeTarget,
      payloadBinding: exact.payloadBinding,
    });
  }
  return freezeDeep({
    mode: 'direct_native',
    sourceAction: request.action,
    sourceTarget: request.target,
    runtimeAction: request.action,
    runtimeTarget: request.target,
    payloadBinding: DELEGATION_PAYLOAD_BINDING,
  });
}

function providerAllowsRuntimeAction({ provider, runtimeIntent, now }) {
  if (!provider || !runtimeIntent) return false;
  try {
    assertProviderSnapshotAllows({ snapshot: provider, action: runtimeIntent.runtimeAction, now });
    return true;
  } catch (error) {
    return false;
  }
}

function assertDestinationRuntimeAuthority(authority) {
  if (!authority?.installation || !authority.version || !authority.runtimeIntent) {
    throw new Error('destination_runtime_binding_unavailable');
  }
  if (authority.runtimeIntent.mode === 'capability_binding' && authority.runtimeIntent.payloadBinding !== DELEGATION_PAYLOAD_BINDING) {
    throw new Error('destination_payload_binding_unsupported');
  }
  if (!authority.grant || !authority.agent) throw new Error('local_authority_missing_before_binding');
  if (authority.providerRequired && (!authority.providerAuthority || authority.providerAuthority.status !== 'current' || !authority.providerActionAllowed)) {
    throw new Error('destination_runtime_provider_action_not_allowed');
  }
  return authority;
}

class S8DestinationAuthorityApplicationService extends S8DelegationApplicationService {
  localAuthorityForRequest(request) {
    const installations = this.installation.list()
      .filter((item) => item.workspaceId === request.destinationWorkspaceId
        && `${item.packageId}@${item.version}` === request.capabilityVersionId
        && item.status === 'installed')
      .sort((a, b) => a.id.localeCompare(b.id));
    const installation = installations[0] || null;
    const version = installation ? this.capabilityVersion.get(`${installation.packageId}@${installation.version}`) : null;
    const runtimeIntent = resolveDestinationRuntimeIntent({ request, installation, version });
    const grants = installation && runtimeIntent ? this.grant.list()
      .filter((item) => item.workspaceId === request.destinationWorkspaceId
        && item.installationId === installation.id
        && item.status === 'active'
        && item.allowedActions?.includes(runtimeIntent.runtimeAction)
        && item.allowedTargets?.includes(runtimeIntent.runtimeTarget))
      .sort((a, b) => a.id.localeCompare(b.id)) : [];
    const grant = grants[0] || null;
    const providerSnapshotId = version?.providerContractIds?.[0] || null;
    const provider = providerSnapshotId ? this.providerSnapshot.get(providerSnapshotId) : null;
    const observedAt = new Date(this.clock());
    const providerCurrent = provider && provider.status === 'accepted' && (!provider.expiresAt || Date.parse(provider.expiresAt) > observedAt.getTime());
    const providerActionAllowed = providerSnapshotId
      ? providerCurrent && providerAllowsRuntimeAction({ provider, runtimeIntent, now: observedAt })
      : true;
    return freezeDeep({
      installation: installation ? { ...publicRecord(installation), capabilityVersionId: `${installation.packageId}@${installation.version}` } : null,
      version: version ? publicRecord(version) : null,
      runtimeIntent,
      grant: grant ? publicRecord(grant) : null,
      agent: grant ? this.agent.get(grant.agentId) : null,
      providerRequired: !!providerSnapshotId,
      providerAuthority: providerSnapshotId ? { id: providerSnapshotId, status: providerCurrent ? 'current' : 'stale', snapshotDigest: provider?.snapshotDigest || null } : null,
      providerActionAllowed,
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
      localRuntimeIntent: authority.runtimeIntent,
      providerRequired: authority.providerRequired,
      providerAuthority: authority.providerAuthority,
      resourceState: authority.resourceState,
      schedulingState: authority.schedulingState,
      pendingCount,
      acceptedNotStartedCount,
      observedAt: this.clock(),
    });
  }

  requestDelegationGate({ proposal, request, admission }) {
    const gateId = boundedId('delegation-gate', proposal.id);
    const existing = this.delegationHumanGate.get(gateId);
    if (existing) return existing;
    const gate = freezeDeep({
      id: gateId,
      workspaceId: proposal.workspaceId,
      proposalId: proposal.id,
      delegationRequestId: request.id,
      admissionSnapshotId: admission.id,
      state: 'requested',
      actionClass: 'DELEGATION_ADMISSION',
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
      requestedAt: this.clock(),
      decidedAt: null,
    });
    const stored = this.delegationHumanGate.save(gate, 'delegation.human_gate_requested');
    this.appendS8Event({
      type: 'delegation.human_gate_requested',
      workspaceId: proposal.workspaceId,
      aggregateType: 'delegationHumanGate',
      aggregateId: stored.id,
      idempotencyKey: `delegation.human_gate_requested:${stored.id}`,
      payload: {
        proposalId: proposal.id,
        delegationRequestId: request.id,
        admissionSnapshotId: admission.id,
        actionClass: stored.actionClass,
      },
    });
    return stored;
  }

  decideDelegationGate(gate, state) {
    if (!gate || gate.state !== 'requested') throw new Error('destination delegation HumanGate is not pending');
    if (!['approved', 'rejected'].includes(state)) throw new Error('invalid destination delegation gate decision');
    return this.delegationHumanGate.save(freezeDeep({
      ...gate,
      state,
      decidedAt: this.clock(),
    }), state === 'approved' ? 'delegation.human_gate_approved' : 'delegation.human_gate_rejected');
  }

  createLocalDelegatedMission({ proposal, request, admission, acceptance, authority = null }) {
    const existingBinding = this.delegatedExecutionBinding.list().find((item) => item.delegationRequestId === request.id) || null;
    if (existingBinding) return existingBinding;
    const localAuthority = assertDestinationRuntimeAuthority(authority || this.localAuthorityForRequest(request));
    const runtimeIntent = localAuthority.runtimeIntent;
    const missionId = boundedId('delegated-mission', request.id);
    const stepId = boundedId('delegated-step', request.id);
    const mission = this.createMission({
      id: missionId,
      workspaceId: proposal.workspaceId,
      title: `Delegated request ${request.id}`,
      objective: `Execute bounded delegated ${request.action}`,
    }).mission;
    const revisionResult = this.createRevision({
      id: boundedId('delegated-revision', request.id),
      workspaceId: proposal.workspaceId,
      missionId: mission.id,
      revision: 1,
      objective: `Destination-local execution for ${request.id}`,
      terminalStepIds: [stepId],
      steps: [{
        id: stepId,
        name: runtimeIntent.mode === 'capability_binding'
          ? `Delegated ${request.action} via ${runtimeIntent.runtimeAction}`
          : `Delegated ${request.action}`,
        agentId: localAuthority.agent.id,
        installationId: localAuthority.installation.id,
        capabilityVersionId: request.capabilityVersionId,
        action: runtimeIntent.runtimeAction,
        target: runtimeIntent.runtimeTarget,
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
    const start = this.startMission({
      workspaceId: proposal.workspaceId,
      missionId: mission.id,
      revisionId: revisionResult.revision.id,
      runId: boundedId('delegated-mission-run', request.id),
    });
    const attempt = this.stepAttempt.list().find((item) => item.missionRunId === start.run.id && item.stepId === stepId) || null;
    const binding = createDelegatedExecutionBinding({
      id: boundedId('delegated-binding', request.id),
      proposal,
      acceptance,
      admission,
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
    if (existingBinding) {
      return freezeDeep({ proposal: publicRecord(proposal), binding: publicRecord(existingBinding), actionGate: null });
    }
    if (proposal.state !== 'waiting_human') throw new Error('delegation proposal is not waiting_human');
    const request = this.delegationRequest.get(proposal.delegationRequestId);
    const admission = this.currentAdmission({ proposal, request });
    this.delegationAdmission.save(admission, 'delegation.admission_revalidated');
    if (!admission.admissible) {
      const oldGate = proposal.humanGateId ? this.delegationHumanGate.get(proposal.humanGateId) : null;
      if (oldGate?.state === 'requested') this.delegationHumanGate.save(freezeDeep({ ...oldGate, state: 'expired', decidedAt: this.clock() }), 'delegation.human_gate_expired');
      proposal = this.delegationProposal.save({ ...proposal, state: 'inadmissible', reasonCode: admission.reasonCodes[0] || 'inadmissible', updatedAt: this.clock() }, 'delegation.admission_became_stale');
      throw new Error(admission.reasonCodes[0] || 'delegation_admission_stale');
    }
    const runtimeAuthority = assertDestinationRuntimeAuthority(this.localAuthorityForRequest(request));
    const gate = this.delegationHumanGate.get(proposal.humanGateId);
    this.decideDelegationGate(gate, 'approved');
    const acceptance = this.delegationAcceptance.save(createDelegationAcceptance({
      id: boundedId('delegation-acceptance', proposal.id),
      proposal,
      admission,
      humanGateId: gate.id,
      state: 'accepted',
      decidedAt: this.clock(),
    }), 'delegation.human_gate_accepted');
    const binding = this.createLocalDelegatedMission({ proposal, request, admission, acceptance, authority: runtimeAuthority });
    proposal = this.delegationProposal.save({ ...proposal, state: 'bound', reasonCode: 'destination_local_execution_bound', updatedAt: this.clock() }, 'delegation.execution_bound');
    this.appendS8Event({
      type: 'delegation.execution_bound',
      workspaceId,
      aggregateType: 'delegatedExecutionBinding',
      aggregateId: binding.id,
      idempotencyKey: `delegation.execution_bound:${binding.id}`,
      payload: {
        proposalId: proposal.id,
        requestId: request.id,
        bindingId: binding.id,
        localMissionId: binding.localMissionId,
        localStepAttemptId: binding.localStepAttemptId,
        runtimeBindingMode: runtimeAuthority.runtimeIntent.mode,
        runtimeAction: runtimeAuthority.runtimeIntent.runtimeAction,
      },
    });
    return freezeDeep({
      proposal: publicRecord(proposal),
      acceptance: publicRecord(acceptance),
      binding: publicRecord(binding),
      actionGate: null,
    });
  }

  rejectDelegationProposal(input) {
    const workspaceId = String(input?.workspaceId || '');
    this.requireS7Workspace(workspaceId);
    let proposal = this.delegationProposal.get(input?.proposalId);
    if (!proposal || proposal.workspaceId !== workspaceId) throw new Error('delegation_proposal_not_found');
    if (proposal.state !== 'waiting_human') throw new Error('delegation proposal is not waiting_human');
    const admission = this.latestAdmissionForProposal(proposal.id);
    if (!admission?.admissible) throw new Error('current admissible snapshot is required');
    const gate = this.delegationHumanGate.get(proposal.humanGateId);
    this.decideDelegationGate(gate, 'rejected');
    const acceptance = this.delegationAcceptance.save(createDelegationAcceptance({
      id: boundedId('delegation-rejection', proposal.id),
      proposal,
      admission,
      humanGateId: gate.id,
      state: 'rejected',
      decidedAt: this.clock(),
    }), 'delegation.human_gate_rejected');
    proposal = this.delegationProposal.save({ ...proposal, state: 'rejected', reasonCode: 'human_gate_rejected', updatedAt: this.clock() }, 'delegation.proposal_rejected');
    return freezeDeep({ proposal: publicRecord(proposal), acceptance: publicRecord(acceptance) });
  }
}

module.exports = {
  DELEGATION_PAYLOAD_BINDING,
  S8ApplicationService: S8DestinationAuthorityApplicationService,
  S8DestinationAuthorityApplicationService,
  resolveDestinationRuntimeIntent,
};