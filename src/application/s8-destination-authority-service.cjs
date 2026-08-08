'use strict';

const { S8ApplicationService: S8DelegationApplicationService, boundedId } = require('./s8-index.cjs');
const { createDelegationAcceptance } = require('../delegation/admission/index.cjs');
const { publicRecord } = require('./s7-index.cjs');

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

class S8DestinationAuthorityApplicationService extends S8DelegationApplicationService {
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

  approveDelegationProposal(input) {
    const workspaceId = String(input?.workspaceId || '');
    this.requireS7Workspace(workspaceId);
    let proposal = this.delegationProposal.get(input.proposalId);
    if (!proposal || proposal.workspaceId !== workspaceId) throw new Error('delegation_proposal_not_found');
    const existingBinding = this.delegatedExecutionBinding.list().find((item) => item.proposalId === proposal.id) || null;
    if (existingBinding) {
      const existingAttempt = existingBinding.localStepAttemptId ? this.stepAttempt.get(existingBinding.localStepAttemptId) : null;
      const existingRun = existingAttempt?.executionRunId ? this.executionRun.get(existingAttempt.executionRunId) : null;
      const existingActionGate = existingRun?.humanGateId ? this.humanGate.get(existingRun.humanGateId) : null;
      return freezeDeep({ proposal: publicRecord(proposal), binding: publicRecord(existingBinding), actionGate: publicRecord(existingActionGate) });
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
    const binding = this.createLocalDelegatedMission({ proposal, request, admission, acceptance });
    proposal = this.delegationProposal.save({ ...proposal, state: 'bound', reasonCode: 'destination_local_execution_bound', updatedAt: this.clock() }, 'delegation.execution_bound');
    const attempt = binding.localStepAttemptId ? this.stepAttempt.get(binding.localStepAttemptId) : null;
    const actionRun = attempt?.executionRunId ? this.executionRun.get(attempt.executionRunId) : null;
    const actionGate = actionRun?.humanGateId ? this.humanGate.get(actionRun.humanGateId) : null;
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
      },
    });
    return freezeDeep({
      proposal: publicRecord(proposal),
      acceptance: publicRecord(acceptance),
      binding: publicRecord(binding),
      actionGate: publicRecord(actionGate),
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
  S8ApplicationService: S8DestinationAuthorityApplicationService,
  S8DestinationAuthorityApplicationService,
};
