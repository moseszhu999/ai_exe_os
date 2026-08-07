'use strict';

const { createHash } = require('node:crypto');
const { S2ApplicationService } = require('./s2-index.cjs');
const { ProjectionRepository } = require('./projection-repository.cjs');
const { assertSafeIdentifier } = require('../domain/identifiers.cjs');
const {
  assertRepositoryRegistrationSemanticMatch,
  assertRepositoryWorkspace,
  createRepositoryBinding,
  createRepositoryRegistration,
} = require('../domain/github-repository-model.cjs');
const {
  createBranchReservation,
  createPathOwnershipClaim,
  findOwnershipConflicts,
} = require('../domain/github-ownership-model.cjs');
const {
  assertMergeOrderAcyclic,
  assertPullRequestBindingSemanticMatch,
  createDeliveryEvidence,
  createMergeOrderConstraint,
  createPullRequestBinding,
  createRepairProposal: createRepairProposalRecord,
  supersedePullRequestBinding,
} = require('../domain/github-delivery-model.cjs');
const { GitHubObservationAdapter, semanticDigest } = require('../main/github-observation/github-observation-adapter.cjs');
const {
  createExactHeadReadyEvidence,
  createMergeObservedEvidence,
  evaluateDeliveryGate,
  proposeRepair,
} = require('../orchestration/github-delivery/delivery-gate.cjs');

function boundedId(prefix, ...parts) {
  return `${prefix}-${createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 20)}`;
}

function requiredChecks(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError('requiredCheckNames must be an array');
  return [...new Set(value.map((item) => {
    const name = String(item || '').trim();
    if (!name || name.length > 100 || /[\0\r\n]/.test(name)) throw new TypeError('required check name must be bounded text');
    return name;
  }))].sort();
}

function sameFields(left, right, fields) {
  return fields.every((field) => JSON.stringify(left?.[field] ?? null) === JSON.stringify(right?.[field] ?? null));
}

class S3ApplicationService extends S2ApplicationService {
  constructor(options = {}) {
    super(options);
    this.githubObservation = options.githubObservationAdapter || new GitHubObservationAdapter({
      token: options.githubToken || null,
      clock: this.clock,
    });
    this.s3Repositories = Object.fromEntries([
      'repositoryRegistration', 'repositoryBinding', 'branchReservation', 'pathOwnershipClaim',
      'pullRequestBinding', 'pullRequestSnapshot', 'checkObservation', 'reviewThreadObservation',
      'mergeOrderConstraint', 'deliveryGate', 'deliveryEvidence', 'repairProposal', 'deliveryDependency',
    ].map((name) => [name, new ProjectionRepository({ store: this.store, projectionType: name })]));
    Object.assign(this, this.s3Repositories);
  }

  appendS3Event({ type, workspaceId, aggregateType, aggregateId, idempotencyKey, payload = {} }) {
    return this.store.appendEvent({
      workspaceId,
      aggregateType,
      aggregateId,
      eventType: type,
      eventVersion: 1,
      idempotencyKey,
      occurredAt: this.clock(),
      payload,
      metadata: { source: 's3-application', provider: 'github', providerMode: 'read_only' },
    }).event;
  }

  requireWorkspaceRecord(repository, id, workspaceId, label) {
    const record = repository.get(id);
    if (!record) throw new Error(`${label} not found: ${id}`);
    if (record.workspaceId !== workspaceId) throw new Error(`Cross-Workspace ${label} access denied`);
    return record;
  }

  registerRepository(input) {
    this.require(this.workspace, input.workspaceId, 'Workspace');
    const id = input.id || boundedId('githubrepo', input.workspaceId, input.owner, input.repository);
    const candidate = createRepositoryRegistration({ ...input, id, createdAt: this.clock() });
    const existing = this.repositoryRegistration.get(id);
    if (existing) return assertRepositoryRegistrationSemanticMatch(existing, candidate);
    const stored = this.repositoryRegistration.save(candidate, 'github.repository_registered');
    this.appendS3Event({
      type: 'github.repository_registered', workspaceId: stored.workspaceId,
      aggregateType: 'repositoryRegistration', aggregateId: stored.id,
      idempotencyKey: `github.repository_registered:${stored.id}:${stored.semanticDigest}`,
      payload: { registrationId: stored.id, owner: stored.owner, repository: stored.repository },
    });
    return stored;
  }

  reserveBranch(input) {
    const registration = this.requireWorkspaceRecord(this.repositoryRegistration, input.repositoryRegistrationId, input.workspaceId, 'RepositoryRegistration');
    if (registration.status !== 'active') throw new Error('RepositoryRegistration is not active');
    const id = input.id || boundedId('githubbranch', registration.id, input.branch, input.ownerId);
    const candidate = createBranchReservation({ ...input, id, createdAt: this.clock() });
    assertRepositoryWorkspace(input.workspaceId, registration, candidate);
    const existing = this.branchReservation.get(id);
    if (existing) {
      if (!sameFields(existing, candidate, ['workspaceId','repositoryRegistrationId','branch','mode','ownerKind','ownerId'])) {
        throw new Error(`Branch reservation idempotency collision: ${id}`);
      }
      return existing;
    }
    const conflicts = findOwnershipConflicts({ reservations: [...this.branchReservation.list(), candidate], claims: [] });
    if (conflicts.some((item) => item.rightId === candidate.id || item.leftId === candidate.id)) throw new Error('Branch reservation ownership conflict');
    const stored = this.branchReservation.save(candidate, 'github.branch_reserved');
    this.appendS3Event({
      type: 'github.branch_reserved', workspaceId: stored.workspaceId,
      aggregateType: 'branchReservation', aggregateId: stored.id,
      idempotencyKey: `github.branch_reserved:${stored.id}`,
      payload: { reservationId: stored.id, repositoryRegistrationId: registration.id, branch: stored.branch, mode: stored.mode },
    });
    return stored;
  }

  claimPaths(input) {
    const reservation = this.requireWorkspaceRecord(this.branchReservation, input.branchReservationId, input.workspaceId, 'BranchReservation');
    const registration = this.requireWorkspaceRecord(this.repositoryRegistration, reservation.repositoryRegistrationId, input.workspaceId, 'RepositoryRegistration');
    if (reservation.state !== 'active' || registration.status !== 'active') throw new Error('Repository or branch reservation is inactive');
    if (!Array.isArray(input.paths) || input.paths.length < 1) throw new TypeError('paths must contain at least one repository-relative prefix');
    const created = [];
    for (const pathPrefix of input.paths) {
      const id = boundedId('githubpath', reservation.id, input.ownerId, String(pathPrefix));
      const candidate = createPathOwnershipClaim({
        id, workspaceId: input.workspaceId, repositoryRegistrationId: registration.id,
        branchReservationId: reservation.id, pathPrefix, mode: input.mode || reservation.mode,
        ownerId: input.ownerId, createdAt: this.clock(),
      });
      const existing = this.pathOwnershipClaim.get(id);
      if (existing) {
        if (!sameFields(existing, candidate, ['workspaceId','repositoryRegistrationId','branchReservationId','pathPrefix','mode','ownerId'])) {
          throw new Error(`Path ownership idempotency collision: ${id}`);
        }
        created.push(existing);
        continue;
      }
      const conflicts = findOwnershipConflicts({ claims: [...this.pathOwnershipClaim.list(), candidate] });
      if (conflicts.some((item) => item.rightId === candidate.id || item.leftId === candidate.id)) throw new Error(`Path ownership conflict: ${candidate.pathPrefix}`);
      const stored = this.pathOwnershipClaim.save(candidate, 'github.path_claimed');
      this.appendS3Event({
        type: 'github.path_claimed', workspaceId: stored.workspaceId,
        aggregateType: 'pathOwnershipClaim', aggregateId: stored.id,
        idempotencyKey: `github.path_claimed:${stored.id}`,
        payload: { claimId: stored.id, pathPrefix: stored.pathPrefix, ownerId: stored.ownerId, mode: stored.mode },
      });
      created.push(stored);
    }
    return Object.freeze(created);
  }

  bindPullRequest(input) {
    const registration = this.requireWorkspaceRecord(this.repositoryRegistration, input.repositoryRegistrationId, input.workspaceId, 'RepositoryRegistration');
    if (registration.status !== 'active') throw new Error('RepositoryRegistration is not active');
    if (input.planStepId) {
      const found = this.executionPlan.list().some((plan) => plan.workspaceId === input.workspaceId && plan.steps?.some((step) => step.id === input.planStepId));
      if (!found) throw new Error('Bound S2 PlanStep was not found in Workspace');
    }
    const id = input.id || boundedId('githubpr', registration.id, input.number, input.expectedHeadSha);
    const candidate = createPullRequestBinding({ ...input, id, createdAt: this.clock() });
    assertRepositoryWorkspace(input.workspaceId, registration, candidate);
    const existing = this.pullRequestBinding.get(id);
    const binding = existing ? assertPullRequestBindingSemanticMatch(existing, candidate) : this.pullRequestBinding.save(candidate, 'github.pull_request_bound');
    if (!existing) {
      this.appendS3Event({
        type: 'github.pull_request_bound', workspaceId: binding.workspaceId,
        aggregateType: 'pullRequestBinding', aggregateId: binding.id,
        idempotencyKey: `github.pull_request_bound:${binding.id}:${binding.semanticDigest}`,
        payload: { pullRequestBindingId: binding.id, repositoryRegistrationId: registration.id, number: binding.number, expectedHeadSha: binding.expectedHeadSha },
      });
    }
    const gateId = input.deliveryGateId || boundedId('deliverygate', binding.id);
    const config = {
      id: gateId, workspaceId: binding.workspaceId, pullRequestBindingId: binding.id,
      requiredCheckNames: requiredChecks(input.requiredCheckNames),
      requireNoUnresolvedThreads: input.requireNoUnresolvedThreads !== false,
      requireCurrentBase: input.requireCurrentBase !== false,
      requireOwnershipClear: input.requireOwnershipClear !== false,
      state: 'waiting', blockers: [], evaluatedHeadSha: null, evaluatedBaseSha: null,
      evaluationDigest: null, lastEvaluatedAt: null, createdAt: this.clock(),
    };
    const existingGate = this.deliveryGate.get(gateId);
    if (existingGate) {
      if (!sameFields(existingGate, config, ['workspaceId','pullRequestBindingId','requiredCheckNames','requireNoUnresolvedThreads','requireCurrentBase','requireOwnershipClear'])) {
        throw new Error(`DeliveryGate idempotency collision: ${gateId}`);
      }
    } else {
      this.deliveryGate.save(config, 'github.delivery_gate_created');
    }
    return Object.freeze({ binding, gate: this.deliveryGate.get(gateId) });
  }

  addMergeOrderConstraint(input) {
    const predecessor = this.requireWorkspaceRecord(this.pullRequestBinding, input.predecessorPullRequestBindingId, input.workspaceId, 'Predecessor PullRequestBinding');
    const successor = this.requireWorkspaceRecord(this.pullRequestBinding, input.successorPullRequestBindingId, input.workspaceId, 'Successor PullRequestBinding');
    if (predecessor.repositoryRegistrationId !== successor.repositoryRegistrationId) throw new Error('Merge-order bindings must use the same registered repository');
    const id = input.id || boundedId('mergeorder', predecessor.id, successor.id);
    const candidate = createMergeOrderConstraint({
      id, workspaceId: input.workspaceId, repositoryRegistrationId: predecessor.repositoryRegistrationId,
      predecessorPullRequestBindingId: predecessor.id, successorPullRequestBindingId: successor.id, createdAt: this.clock(),
    });
    const existing = this.mergeOrderConstraint.get(id);
    if (existing) return existing;
    assertMergeOrderAcyclic([...this.mergeOrderConstraint.list(), candidate]);
    const stored = this.mergeOrderConstraint.save(candidate, 'github.merge_order_created');
    this.appendS3Event({
      type: 'github.merge_order_created', workspaceId: stored.workspaceId,
      aggregateType: 'mergeOrderConstraint', aggregateId: stored.id,
      idempotencyKey: `github.merge_order_created:${stored.id}`,
      payload: { constraintId: stored.id, predecessorPullRequestBindingId: predecessor.id, successorPullRequestBindingId: successor.id },
    });
    return stored;
  }

  declareMissionDeliveryDependency(input) {
    const binding = this.requireWorkspaceRecord(this.pullRequestBinding, input.pullRequestBindingId, input.workspaceId, 'PullRequestBinding');
    const mission = this.require(this.mission, input.missionId, 'Mission');
    const revision = this.require(this.missionRevision, input.revisionId || mission.currentRevisionId, 'MissionRevision');
    if (mission.workspaceId !== input.workspaceId || revision.workspaceId !== input.workspaceId || revision.missionId !== mission.id) {
      throw new Error('Cross-Workspace or mismatched Mission delivery dependency denied');
    }
    const runId = assertSafeIdentifier(input.runId || boundedId('deliveryrun', binding.id, revision.id), 'delivery dependency run id');
    const id = input.id || boundedId('deliverydep', binding.id, revision.id, runId);
    const candidate = Object.freeze({
      id, workspaceId: input.workspaceId, pullRequestBindingId: binding.id,
      missionId: mission.id, revisionId: revision.id, runId,
      state: 'waiting', evidenceId: null, releasedAt: null, createdAt: this.clock(),
    });
    const existing = this.deliveryDependency.get(id);
    if (existing) {
      if (!sameFields(existing, candidate, ['workspaceId','pullRequestBindingId','missionId','revisionId','runId'])) throw new Error(`DeliveryDependency idempotency collision: ${id}`);
      return existing;
    }
    if (this.missionRun.get(runId)) throw new Error('Delivery-dependent Mission run already exists; dependency must be declared before execution');
    return this.deliveryDependency.save(candidate, 'github.delivery_dependency_declared');
  }

  async observeCompatibilityPullRequest(input) {
    return this.githubObservation.observePullRequest(input);
  }

  persistObservation(repository, record, reason) {
    const existing = repository.get(record.id);
    if (existing?.digest === record.digest) return Object.freeze({ record: existing, changed: false });
    return Object.freeze({ record: repository.save(record, reason), changed: true });
  }

  ownershipConflicts(workspaceId, repositoryRegistrationId) {
    return findOwnershipConflicts({
      reservations: this.branchReservation.list().filter((item) => item.workspaceId === workspaceId && item.repositoryRegistrationId === repositoryRegistrationId),
      claims: this.pathOwnershipClaim.list().filter((item) => item.workspaceId === workspaceId && item.repositoryRegistrationId === repositoryRegistrationId),
    });
  }

  async observeDelivery(input) {
    const binding = this.requireWorkspaceRecord(this.pullRequestBinding, input.pullRequestBindingId, input.workspaceId, 'PullRequestBinding');
    const registration = this.requireWorkspaceRecord(this.repositoryRegistration, binding.repositoryRegistrationId, input.workspaceId, 'RepositoryRegistration');
    const gate = this.deliveryGate.list().find((item) => item.workspaceId === input.workspaceId && item.pullRequestBindingId === binding.id);
    if (!gate) throw new Error('DeliveryGate not found for PullRequestBinding');

    const providerSnapshot = await this.githubObservation.observePullRequest({ owner: registration.owner, repo: registration.repository, number: binding.number });
    let baseObservation = null;
    let checksObservation = null;
    let reviewObservation = null;
    if (providerSnapshot.headSha) {
      checksObservation = await this.githubObservation.observeChecks({ owner: registration.owner, repo: registration.repository, sha: providerSnapshot.headSha });
      reviewObservation = await this.githubObservation.observeReviewThreads({ owner: registration.owner, repo: registration.repository, number: binding.number, headSha: providerSnapshot.headSha });
    }
    if (providerSnapshot.baseSha && providerSnapshot.headSha) {
      baseObservation = await this.githubObservation.compare({ owner: registration.owner, repo: registration.repository, base: providerSnapshot.baseSha, head: providerSnapshot.headSha });
    }

    const snapshotRecord = {
      id: boundedId('prsnapshot', binding.id), workspaceId: input.workspaceId, pullRequestBindingId: binding.id,
      ...providerSnapshot, baseObservation,
      digest: semanticDigest({ pullRequest: providerSnapshot.digest, base: baseObservation?.digest || null }),
    };
    const snapshotPersist = this.persistObservation(this.pullRequestSnapshot, snapshotRecord, 'github.pull_request_observed');
    if (snapshotPersist.changed) this.appendS3Event({
      type: 'github.pull_request_observed', workspaceId: input.workspaceId,
      aggregateType: 'pullRequestBinding', aggregateId: binding.id,
      idempotencyKey: `github.pull_request_observed:${binding.id}:${snapshotRecord.digest}`,
      payload: { pullRequestBindingId: binding.id, headSha: providerSnapshot.headSha, baseSha: providerSnapshot.baseSha, digest: snapshotRecord.digest },
    });

    let checkRecord = null;
    if (checksObservation) {
      checkRecord = this.persistObservation(this.checkObservation, {
        id: boundedId('checkobs', binding.id), workspaceId: input.workspaceId, pullRequestBindingId: binding.id, ...checksObservation,
      }, 'github.checks_observed').record;
    }
    let reviewRecord = null;
    if (reviewObservation) {
      reviewRecord = this.persistObservation(this.reviewThreadObservation, {
        id: boundedId('reviewobs', binding.id), workspaceId: input.workspaceId, pullRequestBindingId: binding.id, ...reviewObservation,
      }, 'github.reviews_observed').record;
    }

    const gateResult = evaluateDeliveryGate({
      registration, binding, pullRequestSnapshot: snapshotPersist.record, gate,
      checksObservation: checkRecord, reviewObservation: reviewRecord, baseObservation,
      ownershipConflicts: gate.requireOwnershipClear ? this.ownershipConflicts(input.workspaceId, registration.id) : [],
      mergeOrderConstraints: this.mergeOrderConstraint.list().filter((item) => item.workspaceId === input.workspaceId),
      deliveryEvidence: this.deliveryEvidence.list().filter((item) => item.workspaceId === input.workspaceId),
    });
    const evaluationDigest = semanticDigest({
      state: gateResult.state, blockers: gateResult.blockers,
      evaluatedHeadSha: gateResult.evaluatedHeadSha, evaluatedBaseSha: gateResult.evaluatedBaseSha,
    });
    let storedGate = gate;
    if (gate.evaluationDigest !== evaluationDigest) {
      storedGate = this.deliveryGate.save({
        ...gate, state: gateResult.state, blockers: gateResult.blockers,
        evaluatedHeadSha: gateResult.evaluatedHeadSha, evaluatedBaseSha: gateResult.evaluatedBaseSha,
        evaluationDigest, lastEvaluatedAt: this.clock(),
      }, 'github.delivery_gate_evaluated');
      this.appendS3Event({
        type: 'github.delivery_gate_evaluated', workspaceId: input.workspaceId,
        aggregateType: 'deliveryGate', aggregateId: gate.id,
        idempotencyKey: `github.delivery_gate_evaluated:${gate.id}:${evaluationDigest}`,
        payload: { gateId: gate.id, state: storedGate.state, blockerCodes: storedGate.blockers.map((item) => item.code), headSha: storedGate.evaluatedHeadSha },
      });
    }

    let evidence = null;
    if (gateResult.state === 'ready' && providerSnapshot.headSha && providerSnapshot.baseSha) {
      if (providerSnapshot.merged && providerSnapshot.mergeCommitSha) {
        const derived = createMergeObservedEvidence({
          id: boundedId('deliverymerge', binding.id, providerSnapshot.mergeCommitSha), workspaceId: input.workspaceId,
          binding, snapshot: snapshotPersist.record, checksObservation: checkRecord, reviewObservation: reviewRecord, observedAt: this.clock(),
        });
        evidence = this.storeDeliveryEvidence(derived, gate.id);
        const currentBinding = this.pullRequestBinding.get(binding.id);
        if (currentBinding.state === 'active') this.pullRequestBinding.save(supersedePullRequestBinding(currentBinding, this.clock(), 'merged'), 'github.pull_request_merged');
        if (storedGate.state !== 'satisfied') storedGate = this.deliveryGate.save({ ...storedGate, state: 'satisfied', satisfiedEvidenceId: evidence.id, satisfiedAt: this.clock() }, 'github.delivery_gate_satisfied');
        this.releaseDeliveryDependencies(binding, evidence);
      } else {
        const derived = createExactHeadReadyEvidence({
          id: boundedId('deliveryready', binding.id, providerSnapshot.headSha), workspaceId: input.workspaceId,
          binding, snapshot: snapshotPersist.record, checksObservation: checkRecord, reviewObservation: reviewRecord, observedAt: this.clock(),
        });
        evidence = this.storeDeliveryEvidence(derived, gate.id);
      }
    }

    return Object.freeze({
      binding: this.pullRequestBinding.get(binding.id), snapshot: snapshotPersist.record,
      checks: checkRecord, reviews: reviewRecord, base: baseObservation,
      gate: storedGate, evidence, state: this.queryGitHubDeliveryState(input.workspaceId),
    });
  }

  storeDeliveryEvidence(derived, gateId) {
    const existing = this.deliveryEvidence.get(derived.id);
    if (existing) return existing;
    const record = createDeliveryEvidence({
      ...derived,
      payload: { gateId, provider: 'github', providerMode: 'read_only' },
    });
    const stored = this.deliveryEvidence.save(record, 'github.delivery_evidence_recorded');
    this.appendS3Event({
      type: 'github.delivery_evidence_recorded', workspaceId: stored.workspaceId,
      aggregateType: 'deliveryEvidence', aggregateId: stored.id,
      idempotencyKey: `github.delivery_evidence_recorded:${stored.id}`,
      payload: { evidenceId: stored.id, pullRequestBindingId: stored.pullRequestBindingId, kind: stored.kind, headSha: stored.headSha, mergeCommitSha: stored.mergeCommitSha },
    });
    return stored;
  }

  releaseDeliveryDependencies(binding, evidence) {
    if (evidence.kind !== 'merge_observed') return [];
    const released = [];
    for (const dependency of this.deliveryDependency.list().filter((item) => item.workspaceId === binding.workspaceId && item.pullRequestBindingId === binding.id && item.state === 'waiting')) {
      const started = super.startMission({
        workspaceId: dependency.workspaceId, missionId: dependency.missionId,
        revisionId: dependency.revisionId, runId: dependency.runId,
      });
      const stored = this.deliveryDependency.save({
        ...dependency, state: 'released', evidenceId: evidence.id,
        missionRunId: started.run.id, releasedAt: this.clock(),
      }, 'github.delivery_dependency_released');
      this.appendS3Event({
        type: 'github.delivery_dependency_released', workspaceId: stored.workspaceId,
        aggregateType: 'deliveryDependency', aggregateId: stored.id,
        idempotencyKey: `github.delivery_dependency_released:${stored.id}:${evidence.id}`,
        payload: { dependencyId: stored.id, evidenceId: evidence.id, missionRunId: started.run.id },
      });
      released.push(stored);
    }
    return Object.freeze(released);
  }

  createRepairProposal(input) {
    const binding = this.requireWorkspaceRecord(this.pullRequestBinding, input.pullRequestBindingId, input.workspaceId, 'PullRequestBinding');
    const gate = this.deliveryGate.list().find((item) => item.workspaceId === input.workspaceId && item.pullRequestBindingId === binding.id);
    if (!gate || !Array.isArray(gate.blockers) || gate.blockers.length < 1) throw new Error('RepairProposal requires a blocked/stale DeliveryGate');
    const id = input.id || boundedId('repairproposal', binding.id, gate.evaluationDigest || gate.blockers[0].code);
    const existing = this.repairProposal.get(id);
    if (existing) return existing;
    const proposed = proposeRepair({ id, workspaceId: input.workspaceId, binding, gateResult: { blockers: gate.blockers } });
    const record = createRepairProposalRecord({ ...proposed, createdAt: this.clock() });
    const stored = this.repairProposal.save(record, 'github.repair_proposed');
    this.appendS3Event({
      type: 'github.repair_proposed', workspaceId: stored.workspaceId,
      aggregateType: 'repairProposal', aggregateId: stored.id,
      idempotencyKey: `github.repair_proposed:${stored.id}`,
      payload: { repairProposalId: stored.id, pullRequestBindingId: stored.pullRequestBindingId, reasonCode: stored.reasonCode },
    });
    return stored;
  }

  queryGitHubDeliveryState(workspaceId = 'workspace-a') {
    const base = super.queryMissionState(workspaceId);
    const scoped = (repository) => repository.list().filter((item) => item.workspaceId === workspaceId);
    return Object.freeze({
      workspaces: base.workspaces,
      repositories: scoped(this.repositoryRegistration),
      repositoryBindings: scoped(this.repositoryBinding),
      branchReservations: scoped(this.branchReservation),
      pathOwnershipClaims: scoped(this.pathOwnershipClaim),
      pullRequestBindings: scoped(this.pullRequestBinding),
      pullRequestSnapshots: scoped(this.pullRequestSnapshot),
      checkObservations: scoped(this.checkObservation),
      reviewThreadObservations: scoped(this.reviewThreadObservation),
      deliveryGates: scoped(this.deliveryGate),
      mergeOrderConstraints: scoped(this.mergeOrderConstraint),
      deliveryEvidence: scoped(this.deliveryEvidence),
      repairProposals: scoped(this.repairProposal),
      deliveryDependencies: scoped(this.deliveryDependency),
      githubEvents: this.store.listEvents({ workspaceId }).filter((event) => event.eventType.startsWith('github.')).slice(-300),
      activeWorkspaceId: workspaceId,
      s2: base,
    });
  }
}

module.exports = { S3ApplicationService, boundedId, requiredChecks };
