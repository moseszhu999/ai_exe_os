'use strict';

const { createHash } = require('node:crypto');
const { assertSafeIdentifier } = require('../../domain/identifiers.cjs');
const { deepFreeze, requiredText } = require('../../domain/workspace-model.cjs');
const { canonicalize } = require('./index.cjs');
const {
  PROVIDER_EXECUTION_ATTEMPT_SCHEMA,
  PROVIDER_EXECUTION_OUTCOME_SCHEMA,
  ProviderExecutionUncertainError,
  assertAttemptMatchesPlan,
  normalizeOutcome,
  executeModelProviderAttempt,
  executeMcpProviderAttempt,
} = require('./execution-outcome.cjs');

const PROVIDER_EXECUTION_CLAIM_SCHEMA = 'provider.execution.claim.v1';
const PROVIDER_EXECUTION_CLAIM_PROJECTION = 'providerExecutionClaim';
const RECOVERY_REASON = 'PROCESS_RESTART_WITH_UNFINISHED_PROVIDER_CLAIM';
const CLAIM_STATUSES = Object.freeze(['claimed', 'success', 'known_failure', 'uncertain', 'recovery_required']);

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}

function assertDigest(value, label) {
  const text = requiredText(value, label, 80);
  if (!/^sha256:[a-f0-9]{64}$/.test(text)) throw new Error(`${label} must be a sha256 digest`);
  return text;
}

function iso(value, label) {
  const text = requiredText(value, label, 80);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp) || !text.includes('T')) throw new TypeError(`${label} must be an ISO-8601 instant`);
  return text;
}

function requireAttempt(value) {
  const attempt = assertPlainObject(value, 'provider execution attempt');
  if (attempt.schema !== PROVIDER_EXECUTION_ATTEMPT_SCHEMA) throw new Error('provider execution attempt schema is unsupported');
  assertSafeIdentifier(attempt.attemptId, 'provider execution attempt id');
  assertSafeIdentifier(attempt.requestId, 'provider execution request id');
  assertDigest(attempt.requestDigest, 'provider execution request digest');
  assertDigest(attempt.planDigest, 'provider execution plan digest');
  assertDigest(attempt.attemptDigest, 'provider execution attempt digest');
  assertDigest(attempt.idempotencyKeyDigest, 'provider execution idempotency key digest');
  if (!/^provattempt_[a-f0-9]{24}$/.test(attempt.attemptRef || '')) throw new Error('provider execution attemptRef is invalid');
  if (attempt.attemptRef !== `provattempt_${attempt.attemptDigest.slice(7, 31)}`) throw new Error('provider execution attemptRef does not match attemptDigest');
  if (typeof attempt.reviewedRetry !== 'boolean') throw new Error('provider execution reviewedRetry must be boolean');
  if (attempt.reviewedRetry && !/^provattempt_[a-f0-9]{24}$/.test(attempt.priorAttemptRef || '')) {
    throw new Error('reviewed retry claim requires exact priorAttemptRef');
  }
  if (!attempt.reviewedRetry && attempt.priorAttemptRef != null) throw new Error('initial attempt claim must not declare priorAttemptRef');
  iso(attempt.createdAt, 'provider execution attempt createdAt');
  return attempt;
}

function claimSemanticKey(attempt) {
  const normalized = requireAttempt(attempt);
  return normalized.reviewedRetry
    ? `provider-reviewed-retry:${normalized.priorAttemptRef}`
    : `provider-initial-request:${normalized.requestDigest}`;
}

function claimRecord({ workspaceId, attempt, claimedAt }) {
  const normalized = requireAttempt(attempt);
  const workspace = assertSafeIdentifier(workspaceId, 'provider execution claim workspaceId');
  const record = {
    id: normalized.attemptRef,
    workspaceId: workspace,
    schema: PROVIDER_EXECUTION_CLAIM_SCHEMA,
    attemptRef: normalized.attemptRef,
    attemptDigest: normalized.attemptDigest,
    attemptId: normalized.attemptId,
    requestId: normalized.requestId,
    requestDigest: normalized.requestDigest,
    planDigest: normalized.planDigest,
    idempotencyKeyDigest: normalized.idempotencyKeyDigest,
    priorAttemptRef: normalized.priorAttemptRef || null,
    reviewedRetry: normalized.reviewedRetry,
    claimSemanticKey: claimSemanticKey(normalized),
    status: 'claimed',
    claimedAt: iso(claimedAt, 'provider execution claim claimedAt'),
    outcomeClass: null,
    outcomeDigest: null,
    completedAt: null,
    recoveryReason: null,
    effectMayHaveOccurred: null,
    reviewedRetryRequired: false,
  };
  return deepFreeze(record);
}

function sameClaimAttempt(existingEvent, expected) {
  const existing = existingEvent?.payload?.claim;
  return !!existing
    && existing.schema === PROVIDER_EXECUTION_CLAIM_SCHEMA
    && existing.workspaceId === expected.workspaceId
    && existing.attemptRef === expected.attemptRef
    && existing.attemptDigest === expected.attemptDigest
    && existing.requestId === expected.requestId
    && existing.requestDigest === expected.requestDigest
    && existing.planDigest === expected.planDigest
    && existing.idempotencyKeyDigest === expected.idempotencyKeyDigest
    && (existing.priorAttemptRef || null) === expected.priorAttemptRef
    && existing.reviewedRetry === expected.reviewedRetry
    && existing.claimSemanticKey === expected.claimSemanticKey;
}

function normalizeClaimProjection(projection) {
  if (!projection) return null;
  const record = assertPlainObject(projection.data, 'provider execution claim projection');
  if (record.schema !== PROVIDER_EXECUTION_CLAIM_SCHEMA) throw new Error('provider execution claim projection schema is unsupported');
  if (!CLAIM_STATUSES.includes(record.status)) throw new Error('provider execution claim status is unsupported');
  return Object.freeze({ ...structuredClone(record), _projectionVersion: projection.version });
}

class ProviderExecutionClaimNotAcquiredError extends Error {
  constructor(message, claim) {
    super(message);
    this.name = 'ProviderExecutionClaimNotAcquiredError';
    this.claim = claim;
  }
}

class ProviderExecutionAttemptClaimGate {
  constructor({ store, clock = () => new Date().toISOString() }) {
    if (!store || typeof store.appendWithProjection !== 'function'
      || typeof store.getEventByIdempotencyKey !== 'function'
      || typeof store.getProjection !== 'function'
      || typeof store.listProjections !== 'function') {
      throw new TypeError('persistent provider claim gate requires the canonical SQLite event/projection store');
    }
    if (typeof clock !== 'function') throw new TypeError('persistent provider claim clock must be a function');
    this.store = store;
    this.clock = clock;
  }

  get(attemptRef) {
    return normalizeClaimProjection(this.store.getProjection(PROVIDER_EXECUTION_CLAIM_PROJECTION, attemptRef));
  }

  list(workspaceId = null) {
    const workspace = workspaceId == null ? null : assertSafeIdentifier(workspaceId, 'provider execution claim workspaceId');
    return this.store.listProjections({ projectionType: PROVIDER_EXECUTION_CLAIM_PROJECTION, workspaceId: workspace })
      .map(normalizeClaimProjection);
  }

  acquire({ workspaceId, attempt, plan }) {
    const normalizedAttempt = assertAttemptMatchesPlan(requireAttempt(attempt), plan);
    const expected = claimRecord({ workspaceId, attempt: normalizedAttempt, claimedAt: this.clock() });
    const idempotencyKey = expected.claimSemanticKey;
    const existingEvent = this.store.getEventByIdempotencyKey(idempotencyKey);
    if (existingEvent) {
      if (!sameClaimAttempt(existingEvent, expected)) {
        throw new Error(`Provider execution persistent claim collision: ${idempotencyKey}`);
      }
      return Object.freeze({ acquired: false, duplicate: true, claim: this.get(expected.attemptRef) || expected });
    }

    try {
      const stored = this.store.appendWithProjection({
        event: {
          workspaceId: expected.workspaceId,
          aggregateType: PROVIDER_EXECUTION_CLAIM_PROJECTION,
          aggregateId: expected.attemptRef,
          eventType: 'provider.execution.claimed',
          eventVersion: 1,
          idempotencyKey,
          occurredAt: expected.claimedAt,
          payload: { claim: expected },
          metadata: { source: 'provider-runtime-p3.1' },
        },
        projection: {
          projectionType: PROVIDER_EXECUTION_CLAIM_PROJECTION,
          projectionId: expected.attemptRef,
          workspaceId: expected.workspaceId,
          version: 1,
          data: expected,
        },
      });
      if (!stored.created) {
        const racedEvent = this.store.getEventByIdempotencyKey(idempotencyKey);
        if (!sameClaimAttempt(racedEvent, expected)) {
          throw new Error(`Provider execution persistent claim collision: ${idempotencyKey}`);
        }
        return Object.freeze({ acquired: false, duplicate: true, claim: this.get(expected.attemptRef) || expected });
      }
      return Object.freeze({ acquired: true, duplicate: false, claim: normalizeClaimProjection(stored.projection) || expected });
    } catch (error) {
      const racedEvent = this.store.getEventByIdempotencyKey(idempotencyKey);
      if (racedEvent && sameClaimAttempt(racedEvent, expected)) {
        return Object.freeze({ acquired: false, duplicate: true, claim: this.get(expected.attemptRef) || expected });
      }
      throw error;
    }
  }

  effectClaim({ workspaceId }) {
    return ({ attempt, plan }) => {
      const result = this.acquire({ workspaceId, attempt, plan });
      if (!result.acquired) {
        throw new ProviderExecutionClaimNotAcquiredError('provider execution attempt already persistently claimed', result.claim);
      }
      return result.claim;
    };
  }

  recordOutcome({ workspaceId, attempt, outcome }) {
    const normalizedAttempt = requireAttempt(attempt);
    const normalizedOutcome = normalizeOutcome(outcome, 'persistent provider execution outcome');
    if (normalizedOutcome.schema !== PROVIDER_EXECUTION_OUTCOME_SCHEMA) throw new Error('provider execution outcome schema is unsupported');
    if (normalizedOutcome.attemptRef !== normalizedAttempt.attemptRef
      || normalizedOutcome.attemptDigest !== normalizedAttempt.attemptDigest
      || normalizedOutcome.requestId !== normalizedAttempt.requestId
      || normalizedOutcome.requestDigest !== normalizedAttempt.requestDigest
      || normalizedOutcome.planDigest !== normalizedAttempt.planDigest) {
      throw new Error('provider execution outcome does not match persistent attempt claim');
    }
    const workspace = assertSafeIdentifier(workspaceId, 'provider execution claim workspaceId');
    const currentProjection = this.store.getProjection(PROVIDER_EXECUTION_CLAIM_PROJECTION, normalizedAttempt.attemptRef);
    if (!currentProjection) throw new Error('provider execution outcome requires an existing persistent claim');
    if (currentProjection.workspaceId !== workspace) throw new Error('provider execution outcome Workspace does not match persistent claim');
    const current = normalizeClaimProjection(currentProjection);
    if (current.status !== 'claimed') {
      if (current.outcomeDigest === normalizedOutcome.outcomeDigest && current.outcomeClass === normalizedOutcome.outcome) return current;
      throw new Error('provider execution persistent claim already has a different terminal outcome');
    }
    const completedAt = iso(normalizedOutcome.completedAt, 'provider execution outcome completedAt');
    const next = deepFreeze({
      ...currentProjection.data,
      status: normalizedOutcome.outcome,
      outcomeClass: normalizedOutcome.outcome,
      outcomeDigest: normalizedOutcome.outcomeDigest,
      completedAt,
      recoveryReason: null,
      effectMayHaveOccurred: normalizedOutcome.outcome === 'uncertain'
        ? normalizedOutcome.uncertainty?.effectMayHaveOccurred === true
        : false,
      reviewedRetryRequired: normalizedOutcome.retry?.reviewedRetryRequired === true,
    });
    const idempotencyKey = `provider-outcome:${normalizedAttempt.attemptRef}:${normalizedOutcome.outcomeDigest}`;
    const existingEvent = this.store.getEventByIdempotencyKey(idempotencyKey);
    if (existingEvent) return this.get(normalizedAttempt.attemptRef);
    const stored = this.store.appendWithProjection({
      event: {
        workspaceId: workspace,
        aggregateType: PROVIDER_EXECUTION_CLAIM_PROJECTION,
        aggregateId: normalizedAttempt.attemptRef,
        eventType: 'provider.execution.outcome_recorded',
        eventVersion: 1,
        idempotencyKey,
        occurredAt: completedAt,
        payload: {
          attemptRef: normalizedAttempt.attemptRef,
          outcomeClass: normalizedOutcome.outcome,
          outcomeDigest: normalizedOutcome.outcomeDigest,
        },
        metadata: { source: 'provider-runtime-p3.1' },
      },
      projection: {
        projectionType: PROVIDER_EXECUTION_CLAIM_PROJECTION,
        projectionId: normalizedAttempt.attemptRef,
        workspaceId: workspace,
        version: currentProjection.version + 1,
        data: next,
      },
    });
    return normalizeClaimProjection(stored.projection);
  }

  recoverUnfinishedClaims({ workspaceId = null } = {}) {
    const claims = this.list(workspaceId).filter((claim) => claim.status === 'claimed');
    const recovered = [];
    for (const claim of claims) {
      const currentProjection = this.store.getProjection(PROVIDER_EXECUTION_CLAIM_PROJECTION, claim.attemptRef);
      if (!currentProjection || currentProjection.data.status !== 'claimed') continue;
      const recoveredAt = iso(this.clock(), 'provider claim recoveredAt');
      const next = deepFreeze({
        ...currentProjection.data,
        status: 'recovery_required',
        outcomeClass: 'uncertain',
        outcomeDigest: null,
        completedAt: recoveredAt,
        recoveryReason: RECOVERY_REASON,
        effectMayHaveOccurred: true,
        reviewedRetryRequired: true,
      });
      const idempotencyKey = `provider-claim-recovery:${claim.attemptRef}`;
      const existingEvent = this.store.getEventByIdempotencyKey(idempotencyKey);
      if (existingEvent) {
        const existing = this.get(claim.attemptRef);
        if (existing) recovered.push(existing);
        continue;
      }
      const stored = this.store.appendWithProjection({
        event: {
          workspaceId: claim.workspaceId,
          aggregateType: PROVIDER_EXECUTION_CLAIM_PROJECTION,
          aggregateId: claim.attemptRef,
          eventType: 'provider.execution.claim_recovery_required',
          eventVersion: 1,
          idempotencyKey,
          occurredAt: recoveredAt,
          payload: {
            attemptRef: claim.attemptRef,
            reasonCode: RECOVERY_REASON,
            effectMayHaveOccurred: true,
          },
          metadata: { source: 'provider-runtime-p3.1' },
        },
        projection: {
          projectionType: PROVIDER_EXECUTION_CLAIM_PROJECTION,
          projectionId: claim.attemptRef,
          workspaceId: claim.workspaceId,
          version: currentProjection.version + 1,
          data: next,
        },
      });
      recovered.push(normalizeClaimProjection(stored.projection));
    }
    return Object.freeze(recovered);
  }
}

async function executePersistedModelProviderAttempt({ claimGate, workspaceId, ...input }) {
  if (!(claimGate instanceof ProviderExecutionAttemptClaimGate)) throw new TypeError('claimGate must be ProviderExecutionAttemptClaimGate');
  try {
    const result = await executeModelProviderAttempt({
      ...input,
      effectClaim: claimGate.effectClaim({ workspaceId }),
    });
    const persistentClaim = claimGate.recordOutcome({ workspaceId, attempt: result.attempt, outcome: result.executionOutcome });
    return deepFreeze({ ...result, persistentClaim, persistentDuplicate: false });
  } catch (error) {
    if (error instanceof ProviderExecutionClaimNotAcquiredError) {
      return deepFreeze({
        ok: false,
        result: null,
        receipt: null,
        attempt: null,
        executionOutcome: null,
        persistentClaim: error.claim,
        persistentDuplicate: true,
      });
    }
    if (error instanceof ProviderExecutionUncertainError) {
      const attempt = input.executionAttempt || null;
      if (!attempt) throw new Error('persistent provider execution requires explicit executionAttempt for uncertain outcome recording');
      const persistentClaim = claimGate.recordOutcome({ workspaceId, attempt, outcome: error.outcome });
      error.persistentClaim = persistentClaim;
    }
    throw error;
  }
}

async function executePersistedMcpProviderAttempt({ claimGate, workspaceId, ...input }) {
  if (!(claimGate instanceof ProviderExecutionAttemptClaimGate)) throw new TypeError('claimGate must be ProviderExecutionAttemptClaimGate');
  try {
    const result = await executeMcpProviderAttempt({
      ...input,
      effectClaim: claimGate.effectClaim({ workspaceId }),
    });
    const persistentClaim = claimGate.recordOutcome({ workspaceId, attempt: result.attempt, outcome: result.executionOutcome });
    return deepFreeze({ ...result, persistentClaim, persistentDuplicate: false });
  } catch (error) {
    if (error instanceof ProviderExecutionClaimNotAcquiredError) {
      return deepFreeze({
        ok: false,
        result: null,
        receipt: null,
        attempt: null,
        executionOutcome: null,
        persistentClaim: error.claim,
        persistentDuplicate: true,
      });
    }
    if (error instanceof ProviderExecutionUncertainError) {
      const attempt = input.executionAttempt || null;
      if (!attempt) throw new Error('persistent MCP execution requires explicit executionAttempt for uncertain outcome recording');
      const persistentClaim = claimGate.recordOutcome({ workspaceId, attempt, outcome: error.outcome });
      error.persistentClaim = persistentClaim;
    }
    throw error;
  }
}

module.exports = {
  PROVIDER_EXECUTION_CLAIM_SCHEMA,
  PROVIDER_EXECUTION_CLAIM_PROJECTION,
  RECOVERY_REASON,
  ProviderExecutionClaimNotAcquiredError,
  ProviderExecutionAttemptClaimGate,
  claimSemanticKey,
  executePersistedModelProviderAttempt,
  executePersistedMcpProviderAttempt,
};
