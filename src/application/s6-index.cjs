'use strict';

const { createHash } = require('node:crypto');
const { S5ApplicationService } = require('./s5-index.cjs');
const { ProjectionRepository } = require('./projection-repository.cjs');
const {
  createSchedulingPolicySnapshot,
  rankSchedulingCandidates,
} = require('../scheduling/policy/index.cjs');
const {
  createConcurrencyBudget,
  createProviderCapacitySnapshot,
  createWorkerCapacitySnapshot,
  evaluateCandidateCapacity,
  providerCapacityReason,
} = require('../scheduling/capacity/index.cjs');
const {
  computeSchedulingDecision,
  createAssignmentProposal,
  deriveSchedulingCandidates,
  revalidateAssignmentProposal,
} = require('../scheduling/orchestration/index.cjs');

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function semanticDigest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')}`;
}

function boundedId(prefix, ...parts) {
  return `${prefix}-${createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 20)}`;
}

function safeObject(input, label) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError(`${label} must be a plain object`);
  return input;
}

function resourceParts(requirement) {
  if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement)) return null;
  const type = String(requirement.type || '').trim();
  const key = String(requirement.key || '').trim();
  if (!type || !key) return null;
  return { type, key };
}

function resourceIdentifier(resource) {
  const parts = resourceParts(resource);
  if (!parts) return null;
  return boundedId('resource', parts.type, parts.key);
}

function isLocalTarget(target) {
  const value = String(target || '');
  return value.startsWith('local://') || value.startsWith('http://127.0.0.1:') || value.startsWith('http://localhost:');
}

function workerRuntimeStatus(worker) {
  if (worker?.status === 'idle') return 'eligible';
  if (worker?.status === 'draining') return 'draining';
  return 'unavailable';
}

function activeWorkerStatus(worker) {
  return worker?.status === 'active' || worker?.status === 'waiting_human';
}

class S6ApplicationService extends S5ApplicationService {
  constructor(options = {}) {
    super(options);
    this.schedulingPolicy = new ProjectionRepository({ store: this.store, projectionType: 'schedulingPolicy' });
    this.providerCapacitySnapshot = new ProjectionRepository({ store: this.store, projectionType: 'providerCapacitySnapshot' });
    this.schedulingDecision = new ProjectionRepository({ store: this.store, projectionType: 'schedulingDecision' });
    this.assignmentProposal = new ProjectionRepository({ store: this.store, projectionType: 'assignmentProposal' });
  }

  appendS6Event({ type, workspaceId, aggregateType, aggregateId, idempotencyKey, payload = {} }) {
    return this.store.appendEvent({
      workspaceId,
      aggregateType,
      aggregateId,
      eventType: type,
      eventVersion: 1,
      idempotencyKey,
      occurredAt: this.clock(),
      payload,
      metadata: { source: 's6-application', executionAuthority: 'none' },
    }).event;
  }

  requireS6Workspace(workspaceId) {
    const workspace = this.workspace.get(workspaceId);
    if (!workspace || workspace.status !== 'active') throw new Error(`Workspace not found or inactive: ${workspaceId}`);
    return workspace;
  }

  activeSchedulingPolicy(workspaceId) {
    const active = this.schedulingPolicy.list().filter((item) => item.workspaceId === workspaceId && item.status === 'active');
    if (active.length > 1) throw new Error(`Multiple active SchedulingPolicySnapshots for Workspace: ${workspaceId}`);
    return active[0] || null;
  }

  recordSchedulingPolicy(input) {
    safeObject(input, 'Scheduling policy input');
    this.requireS6Workspace(input.workspaceId);
    const candidate = createSchedulingPolicySnapshot(input);
    const existing = this.schedulingPolicy.get(candidate.id);
    if (existing) {
      if (existing.digest !== candidate.digest) throw new Error(`SchedulingPolicySnapshot idempotency collision: ${candidate.id}`);
      return existing;
    }
    const active = this.activeSchedulingPolicy(candidate.workspaceId);
    if (active) throw new Error(`Workspace already has an active SchedulingPolicySnapshot: ${active.id}`);
    const stored = this.schedulingPolicy.save(candidate, 'scheduling.policy_recorded');
    this.appendS6Event({
      type: 'scheduling.policy_recorded',
      workspaceId: stored.workspaceId,
      aggregateType: 'schedulingPolicy',
      aggregateId: stored.id,
      idempotencyKey: `scheduling.policy_recorded:${stored.id}:${stored.digest}`,
      payload: { policyId: stored.id, digest: stored.digest, version: stored.version },
    });
    return stored;
  }

  recordProviderCapacity(input) {
    safeObject(input, 'Provider capacity input');
    this.requireS6Workspace(input.workspaceId);
    const candidate = createProviderCapacitySnapshot(input);
    const existing = this.providerCapacitySnapshot.get(candidate.id);
    if (existing) {
      if (existing.digest !== candidate.digest) throw new Error(`ProviderCapacitySnapshot idempotency collision: ${candidate.id}`);
      return existing;
    }
    const stored = this.providerCapacitySnapshot.save(candidate, 'scheduling.provider_capacity_recorded');
    this.appendS6Event({
      type: 'scheduling.provider_capacity_recorded',
      workspaceId: stored.workspaceId,
      aggregateType: 'providerCapacitySnapshot',
      aggregateId: stored.id,
      idempotencyKey: `scheduling.provider_capacity_recorded:${stored.id}:${stored.digest}`,
      payload: {
        capacityId: stored.id,
        providerId: stored.providerId,
        action: stored.action,
        status: stored.status,
        digest: stored.digest,
      },
    });
    return stored;
  }

  latestProviderCapacities(workspaceId) {
    const latest = new Map();
    for (const snapshot of this.providerCapacitySnapshot.list().filter((item) => item.workspaceId === workspaceId)) {
      const key = `${snapshot.providerId}:${snapshot.action}`;
      const current = latest.get(key);
      if (!current || String(snapshot.observedAt).localeCompare(String(current.observedAt)) > 0
        || (snapshot.observedAt === current.observedAt && snapshot.id.localeCompare(current.id) > 0)) {
        latest.set(key, snapshot);
      }
    }
    return Object.freeze([...latest.values()]);
  }

  safeWorkerSnapshots(workspaceId) {
    const bindings = this.workerBinding.list().filter((item) => item.workspaceId === workspaceId);
    const liveById = new Map(this.workerManager.list().map((item) => [item.id, item]));
    return Object.freeze(bindings.map((binding) => {
      const live = liveById.get(binding.id) || null;
      const browserChannel = ['chrome', 'chromium'].includes(live?.browserChannel)
        ? live.browserChannel
        : (['chrome', 'chromium'].includes(binding.browserChannel) ? binding.browserChannel : 'chromium');
      return createWorkerCapacitySnapshot({
        workerId: binding.id,
        workspaceId,
        status: workerRuntimeStatus(live),
        browserChannel,
        activeAssignmentCount: activeWorkerStatus(live) ? 1 : 0,
        reusableSession: live?.status === 'idle',
        safeCompatibilityKeys: [`profile-worker-${binding.id}`],
      });
    }));
  }

  concurrencyBudgets(workspaceId, policy) {
    const live = this.workerManager.list();
    const workspaceWorkerIds = new Set(this.workerBinding.list().filter((item) => item.workspaceId === workspaceId).map((item) => item.id));
    const globalActive = live.filter(activeWorkerStatus).length;
    const workspaceActive = live.filter((item) => workspaceWorkerIds.has(item.id) && activeWorkerStatus(item)).length;
    const observedAt = this.clock();
    return Object.freeze({
      globalBudget: createConcurrencyBudget({
        id: boundedId('budget-global', policy.id, observedAt),
        scope: 'global',
        maxActive: policy.globalMaxActive,
        activeObserved: globalActive,
        status: 'current',
        observedAt,
      }),
      workspaceBudget: createConcurrencyBudget({
        id: boundedId('budget-workspace', workspaceId, policy.id, observedAt),
        workspaceId,
        scope: 'workspace',
        maxActive: policy.workspaceMaxActive,
        activeObserved: workspaceActive,
        status: 'current',
        observedAt,
      }),
    });
  }

  blockedResourceIds() {
    return Object.freeze(this.locks.list().map((lock) => resourceIdentifier({ type: lock.resourceType, key: lock.resourceKey })).filter(Boolean));
  }

  sourceRecordForStep({ workspaceId, run, step }) {
    const binding = this.stepBinding.get(step.bindingId);
    if (!binding || binding.workspaceId !== workspaceId) {
      return {
        id: boundedId('schedcand', run.id, step.id),
        workspaceId,
        workspaceStatus: this.workspace.get(workspaceId)?.status || 'missing',
        readyState: 'blocked',
        missionState: run.state,
        dependenciesSatisfied: step.state === 'ready',
        authorityValid: false,
        humanGateClear: false,
        executionIdentityCurrent: false,
        resourceRequirementsDeclared: false,
        providerUseAccepted: false,
        priorEffectState: 'none',
        sourceKind: 'plan_step',
        sourceId: step.id,
        executionIdentity: boundedId('execidentity', run.id, step.id),
        readySince: run.startedAt || run.createdAt || this.clock(),
        priority: 'normal',
        requiredResources: [],
        providerRequirement: null,
        workerRequirements: {},
      };
    }

    let authorityValid = false;
    let providerUseAccepted = false;
    try {
      this.validateBinding(binding);
      authorityValid = true;
      providerUseAccepted = true;
    } catch {
      authorityValid = false;
      providerUseAccepted = false;
    }

    const resourcePartsList = (step.resourceRequirements || []).map(resourceParts);
    const resourceRequirementsDeclared = resourcePartsList.every(Boolean);
    const requiredResources = resourceRequirementsDeclared
      ? resourcePartsList.map((resource) => resourceIdentifier(resource))
      : [];
    const providerSnapshot = this.providerSnapshot.get(binding.providerSnapshotId);
    const providerRequirement = isLocalTarget(binding.target) ? null : {
      providerId: providerSnapshot?.providerId || 'unknown-provider',
      action: binding.action,
    };
    const latestAttempt = this.latestAttempt(run.id, step.id);
    const priorEffectState = latestAttempt?.recoveryReason || latestAttempt?.state === 'waiting_human' ? 'uncertain' : 'none';
    const executionIdentity = boundedId('execidentity', run.id, step.id, binding.id);
    const workerRequirements = {};
    if (step.workerId) workerRequirements.exactProfileClass = `worker-${step.workerId}`;

    return {
      id: boundedId('schedcand', run.id, step.id),
      workspaceId,
      workspaceStatus: this.workspace.get(workspaceId)?.status || 'missing',
      readyState: step.state,
      missionState: run.state === 'running' ? 'active' : run.state,
      dependenciesSatisfied: step.state === 'ready',
      authorityValid,
      humanGateClear: step.humanGatePolicy === 'never',
      executionIdentityCurrent: !latestAttempt,
      resourceRequirementsDeclared,
      providerUseAccepted,
      priorEffectState,
      sourceKind: 'plan_step',
      sourceId: step.id,
      executionIdentity,
      readySince: run.startedAt || run.createdAt || this.clock(),
      priority: ['critical', 'high', 'normal', 'low'].includes(step.priority) ? step.priority : 'normal',
      requiredResources,
      providerRequirement,
      workerRequirements,
    };
  }

  deriveCanonicalSchedulingRecords(workspaceId) {
    this.requireS6Workspace(workspaceId);
    const missionState = this.queryMissionState(workspaceId);
    const records = [];
    for (const run of missionState.missionRuns || []) {
      if (run.state !== 'running') continue;
      const plan = (missionState.plans || []).find((item) => item.id === run.planId);
      if (!plan) continue;
      for (const step of plan.steps || []) {
        records.push(this.sourceRecordForStep({ workspaceId, run, step }));
      }
    }
    return Object.freeze(records);
  }

  authorityDigestForRecord(record) {
    return semanticDigest({
      workspaceId: record.workspaceId,
      sourceId: record.sourceId,
      executionIdentity: record.executionIdentity,
      workspaceStatus: record.workspaceStatus,
      readyState: record.readyState,
      missionState: record.missionState,
      dependenciesSatisfied: record.dependenciesSatisfied,
      authorityValid: record.authorityValid,
      humanGateClear: record.humanGateClear,
      executionIdentityCurrent: record.executionIdentityCurrent,
      resourceRequirementsDeclared: record.resourceRequirementsDeclared,
      providerUseAccepted: record.providerUseAccepted,
      priorEffectState: record.priorEffectState,
      requiredResources: record.requiredResources,
      providerRequirement: record.providerRequirement,
      workerRequirements: record.workerRequirements,
    });
  }

  schedulingInputs(workspaceId, policy) {
    const sourceRecords = this.deriveCanonicalSchedulingRecords(workspaceId);
    const derived = deriveSchedulingCandidates(sourceRecords);
    const workers = this.safeWorkerSnapshots(workspaceId);
    const providerCapacities = this.latestProviderCapacities(workspaceId);
    const budgets = this.concurrencyBudgets(workspaceId, policy);
    const blockedResources = this.blockedResourceIds();
    const capacitySnapshot = Object.freeze({
      digest: semanticDigest({
        globalBudgetDigest: budgets.globalBudget.digest,
        workspaceBudgetDigest: budgets.workspaceBudget.digest,
        providerCapacityDigests: providerCapacities.map((item) => item.digest).sort(),
        workers,
        blockedResources,
      }),
      globalBudget: budgets.globalBudget,
      workspaceBudget: budgets.workspaceBudget,
      providerCapacities,
      blockedResources,
    });
    return Object.freeze({ sourceRecords, derived, workers, providerCapacities, budgets, blockedResources, capacitySnapshot });
  }

  evaluateCapacityFromInputs(inputs, candidate, evaluatedAt) {
    return evaluateCandidateCapacity({
      candidate,
      globalBudget: inputs.budgets.globalBudget,
      workspaceBudget: inputs.budgets.workspaceBudget,
      providerCapacities: inputs.providerCapacities,
      workers: inputs.workers,
      blockedResources: inputs.blockedResources,
      evaluatedAt,
    });
  }

  computeSchedulingDecisionForWorkspace(input) {
    safeObject(input, 'Scheduling decision input');
    const workspaceId = input.workspaceId;
    this.requireS6Workspace(workspaceId);
    const policy = this.activeSchedulingPolicy(workspaceId);
    if (!policy) throw new Error(`No active SchedulingPolicySnapshot for Workspace: ${workspaceId}`);
    const evaluatedAt = this.clock();
    const inputs = this.schedulingInputs(workspaceId, policy);
    const workspaceActiveCounts = { [workspaceId]: inputs.budgets.workspaceBudget.activeObserved };
    const decisionId = input.id || boundedId('scheddecision', workspaceId, policy.id, evaluatedAt, this.schedulingDecision.list().length);
    const decision = computeSchedulingDecision({
      id: decisionId,
      policy,
      candidates: inputs.derived.candidates,
      workers: inputs.workers,
      capacitySnapshot: inputs.capacitySnapshot,
      evaluatedAt,
      rankCandidates: ({ policy: rankPolicy, candidates, evaluatedAt: rankAt }) => rankSchedulingCandidates({
        policy: rankPolicy,
        candidates,
        evaluatedAt: rankAt,
        workspaceActiveCounts,
      }),
      evaluateCapacity: ({ candidate, evaluatedAt: capacityAt }) => this.evaluateCapacityFromInputs(inputs, candidate, capacityAt),
    });
    const existing = this.schedulingDecision.get(decision.id);
    if (existing) {
      if (existing.decisionDigest !== decision.decisionDigest) throw new Error(`SchedulingDecision idempotency collision: ${decision.id}`);
      return Object.freeze({ decision: existing, proposal: this.assignmentProposal.list().find((item) => item.decisionId === existing.id) || null, inputs });
    }
    const storedDecision = this.schedulingDecision.save({ ...decision, workspaceId }, 'scheduling.decision_recorded');
    this.appendS6Event({
      type: 'scheduling.decision_recorded',
      workspaceId,
      aggregateType: 'schedulingDecision',
      aggregateId: storedDecision.id,
      idempotencyKey: `scheduling.decision_recorded:${storedDecision.id}:${storedDecision.decisionDigest}`,
      payload: {
        decisionId: storedDecision.id,
        policySnapshotId: storedDecision.policySnapshotId,
        inputDigest: storedDecision.inputDigest,
        decisionDigest: storedDecision.decisionDigest,
        selectedCandidateId: storedDecision.selectedCandidateId,
        selectedWorkerId: storedDecision.selectedWorkerId,
        reasonCodes: storedDecision.reasonCodes,
      },
    });

    let storedProposal = null;
    if (storedDecision.selectedCandidateId) {
      const candidate = inputs.derived.candidates.find((item) => item.id === storedDecision.selectedCandidateId);
      const sourceRecord = inputs.sourceRecords.find((item) => item.id === storedDecision.selectedCandidateId);
      const proposal = createAssignmentProposal({
        id: input.proposalId || boundedId('assignment', storedDecision.id, storedDecision.selectedCandidateId, storedDecision.selectedWorkerId),
        decision: storedDecision,
        candidate,
        authoritySnapshotDigest: this.authorityDigestForRecord(sourceRecord),
      });
      storedProposal = this.assignmentProposal.save(proposal, 'scheduling.assignment_proposed');
      this.appendS6Event({
        type: 'scheduling.assignment_proposed',
        workspaceId,
        aggregateType: 'assignmentProposal',
        aggregateId: storedProposal.id,
        idempotencyKey: `scheduling.assignment_proposed:${storedProposal.id}`,
        payload: {
          proposalId: storedProposal.id,
          decisionId: storedProposal.decisionId,
          candidateId: storedProposal.candidateId,
          workerId: storedProposal.workerId,
          state: storedProposal.state,
        },
      });
    }
    return Object.freeze({ decision: storedDecision, proposal: storedProposal, inputs });
  }

  revalidateSchedulingProposal(input) {
    safeObject(input, 'Scheduling proposal revalidation input');
    const workspaceId = input.workspaceId;
    this.requireS6Workspace(workspaceId);
    const proposal = this.assignmentProposal.get(input.proposalId);
    if (!proposal) throw new Error(`AssignmentProposal not found: ${input.proposalId}`);
    if (proposal.workspaceId !== workspaceId) throw new Error('Cross-Workspace AssignmentProposal access denied');
    if (proposal.state !== 'proposed') return proposal;
    const policy = this.activeSchedulingPolicy(workspaceId);
    if (!policy) throw new Error(`No active SchedulingPolicySnapshot for Workspace: ${workspaceId}`);
    const inputs = this.schedulingInputs(workspaceId, policy);
    const sourceRecord = inputs.sourceRecords.find((item) => item.id === proposal.candidateId) || null;
    const candidate = inputs.derived.candidates.find((item) => item.id === proposal.candidateId) || null;
    const capacity = candidate ? this.evaluateCapacityFromInputs(inputs, candidate, this.clock()) : null;
    const provider = candidate ? providerCapacityReason(candidate, inputs.providerCapacities, this.clock()) : { allowed: false };
    const resourceAvailable = candidate
      ? !candidate.requiredResources.some((resourceId) => inputs.blockedResources.includes(resourceId))
      : false;
    const current = {
      authoritySnapshotDigest: sourceRecord ? this.authorityDigestForRecord(sourceRecord) : proposal.authoritySnapshotDigest,
      executionIdentity: sourceRecord?.executionIdentity || proposal.executionIdentity,
      candidateReady: Boolean(candidate),
      resourceAvailable,
      providerCapacityCurrent: candidate?.providerRequirement ? provider.allowed === true : true,
      humanGateClear: sourceRecord?.humanGateClear === true,
      priorEffectCertain: sourceRecord ? sourceRecord.priorEffectState !== 'uncertain' : false,
    };
    if (capacity && capacity.eligible !== true && capacity.reasonCodes.some((code) => code === 'global_capacity_exhausted' || code === 'workspace_capacity_exhausted' || code === 'no_compatible_worker')) {
      current.candidateReady = false;
    }
    const result = revalidateAssignmentProposal({ proposal, current });
    const stored = this.assignmentProposal.save(result, 'scheduling.proposal_revalidated');
    this.appendS6Event({
      type: 'scheduling.proposal_revalidated',
      workspaceId,
      aggregateType: 'assignmentProposal',
      aggregateId: stored.id,
      idempotencyKey: `scheduling.proposal_revalidated:${stored.id}:${stored._revision}`,
      payload: { proposalId: stored.id, state: stored.state, reasonCode: stored.reasonCode },
    });
    return stored;
  }

  querySchedulingState(workspaceId) {
    if (typeof workspaceId !== 'string' || !workspaceId.trim()) throw new TypeError('workspaceId is required');
    const workspace = this.workspace.get(workspaceId);
    if (!workspace) {
      return Object.freeze({
        workspaceId,
        found: false,
        policy: null,
        capacity: null,
        eligibleQueue: Object.freeze([]),
        deferred: Object.freeze([]),
        workers: Object.freeze([]),
        providerCapacity: Object.freeze([]),
        decisions: Object.freeze([]),
        proposals: Object.freeze([]),
      });
    }
    const policy = this.activeSchedulingPolicy(workspaceId);
    const workers = this.safeWorkerSnapshots(workspaceId);
    const providerCapacity = this.latestProviderCapacities(workspaceId);
    const decisions = this.schedulingDecision.list().filter((item) => item.workspaceId === workspaceId);
    const proposals = this.assignmentProposal.list().filter((item) => item.workspaceId === workspaceId);
    let eligibleQueue = [];
    let deferred = [];
    let capacity = null;
    if (policy) {
      const inputs = this.schedulingInputs(workspaceId, policy);
      eligibleQueue = rankSchedulingCandidates({
        policy,
        candidates: inputs.derived.candidates,
        evaluatedAt: this.clock(),
        workspaceActiveCounts: { [workspaceId]: inputs.budgets.workspaceBudget.activeObserved },
      });
      const latestDecision = [...decisions].sort((left, right) => String(right.evaluatedAt).localeCompare(String(left.evaluatedAt)))[0] || null;
      deferred = [...inputs.derived.deferred, ...(latestDecision?.deferred || [])];
      capacity = Object.freeze({
        globalActive: inputs.budgets.globalBudget.activeObserved,
        globalMaxActive: inputs.budgets.globalBudget.maxActive,
        workspaceActive: inputs.budgets.workspaceBudget.activeObserved,
        workspaceMaxActive: inputs.budgets.workspaceBudget.maxActive,
        blockedResourceCount: inputs.blockedResources.length,
      });
    }
    return Object.freeze({
      workspaceId,
      found: workspace.status === 'active',
      policy,
      capacity,
      eligibleQueue: Object.freeze(eligibleQueue),
      deferred: Object.freeze(deferred),
      workers,
      providerCapacity,
      decisions: Object.freeze(decisions),
      proposals: Object.freeze(proposals),
    });
  }

  queryOperatorCockpit(workspaceId) {
    const cockpit = super.queryOperatorCockpit(workspaceId);
    return Object.freeze({ ...cockpit, scheduling: this.querySchedulingState(workspaceId) });
  }
}

module.exports = {
  S6ApplicationService,
  activeWorkerStatus,
  boundedId,
  isLocalTarget,
  resourceIdentifier,
  semanticDigest,
};
