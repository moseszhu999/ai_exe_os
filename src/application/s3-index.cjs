'use strict';

const base = require('./s3-application-service.cjs');
const { createRepositoryBinding } = require('../domain/github-repository-model.cjs');

class S3ApplicationService extends base.S3ApplicationService {
  bindPullRequest(input) {
    const result = super.bindPullRequest(input);
    if (!input?.planStepId) return result;

    const id = base.boundedId('repobinding', input.workspaceId, input.repositoryRegistrationId, input.planStepId);
    const candidate = createRepositoryBinding({
      id,
      workspaceId: input.workspaceId,
      repositoryRegistrationId: input.repositoryRegistrationId,
      planStepId: input.planStepId,
      createdAt: this.clock(),
    });
    const existing = this.repositoryBinding.get(id);
    let repositoryBinding = existing;
    if (existing) {
      const fields = ['workspaceId', 'repositoryRegistrationId', 'missionRunId', 'planStepId'];
      if (!fields.every((field) => (existing[field] ?? null) === (candidate[field] ?? null))) {
        throw new Error(`RepositoryBinding idempotency collision: ${id}`);
      }
    } else {
      repositoryBinding = this.repositoryBinding.save(candidate, 'github.repository_bound');
      this.appendS3Event({
        type: 'github.repository_bound',
        workspaceId: repositoryBinding.workspaceId,
        aggregateType: 'repositoryBinding',
        aggregateId: repositoryBinding.id,
        idempotencyKey: `github.repository_bound:${repositoryBinding.id}`,
        payload: {
          repositoryBindingId: repositoryBinding.id,
          repositoryRegistrationId: repositoryBinding.repositoryRegistrationId,
          planStepId: repositoryBinding.planStepId,
        },
      });
    }
    return Object.freeze({ ...result, repositoryBinding });
  }

  persistObservation(repository, record, reason) {
    const result = super.persistObservation(repository, record, reason);
    if (!result.changed) return result;

    if (repository.projectionType === 'checkObservation') {
      this.appendS3Event({
        type: 'github.checks_observed',
        workspaceId: result.record.workspaceId,
        aggregateType: 'pullRequestBinding',
        aggregateId: result.record.pullRequestBindingId,
        idempotencyKey: `github.checks_observed:${result.record.pullRequestBindingId}:${result.record.digest}`,
        payload: {
          pullRequestBindingId: result.record.pullRequestBindingId,
          headSha: result.record.headSha,
          digest: result.record.digest,
          checkCount: Array.isArray(result.record.checks) ? result.record.checks.length : 0,
        },
      });
    }

    if (repository.projectionType === 'reviewThreadObservation') {
      this.appendS3Event({
        type: 'github.review_threads_observed',
        workspaceId: result.record.workspaceId,
        aggregateType: 'pullRequestBinding',
        aggregateId: result.record.pullRequestBindingId,
        idempotencyKey: `github.review_threads_observed:${result.record.pullRequestBindingId}:${result.record.digest}`,
        payload: {
          pullRequestBindingId: result.record.pullRequestBindingId,
          headSha: result.record.headSha,
          digest: result.record.digest,
          threadCount: Array.isArray(result.record.threads) ? result.record.threads.length : 0,
          resolutionAvailable: result.record.resolutionAvailable === true,
        },
      });
    }
    return result;
  }

  async observeDelivery(input) {
    const gateBefore = this.deliveryGate.list().find((item) => item.workspaceId === input?.workspaceId && item.pullRequestBindingId === input?.pullRequestBindingId) || null;
    const beforeDigest = gateBefore?.evaluationDigest || null;
    const result = await super.observeDelivery(input);
    const gateAfter = result.gate;
    if (gateAfter?.evaluationDigest && gateAfter.evaluationDigest !== beforeDigest) {
      this.appendS3Event({
        type: 'github.delivery_gate_changed',
        workspaceId: gateAfter.workspaceId,
        aggregateType: 'deliveryGate',
        aggregateId: gateAfter.id,
        idempotencyKey: `github.delivery_gate_changed:${gateAfter.id}:${gateAfter.evaluationDigest}`,
        payload: {
          gateId: gateAfter.id,
          state: gateAfter.state,
          blockerCodes: (gateAfter.blockers || []).map((item) => item.code),
          evaluatedHeadSha: gateAfter.evaluatedHeadSha,
          evaluatedBaseSha: gateAfter.evaluatedBaseSha,
          evaluationDigest: gateAfter.evaluationDigest,
        },
      });
    }
    return result;
  }
}

module.exports = {
  ...base,
  S3ApplicationService,
};
