'use strict';

const { createHash } = require('node:crypto');
const { evaluateExecutionAuthorizationV1 } = require('../../authorization/execution-authorization-v1.cjs');
const { assertSafeIdentifier } = require('../../domain/identifiers.cjs');
const { deepFreeze, requiredText } = require('../../domain/workspace-model.cjs');
const { canonicalize } = require('./index.cjs');
const {
  ANTHROPIC_API_VERSION,
  executeProviderAdapterPlan,
} = require('./executor.cjs');
const {
  MCP_STABLE_PROTOCOL_VERSION,
  executeMcpProviderAdapterPlan,
} = require('./mcp-executor.cjs');

const PROVIDER_EXECUTION_ATTEMPT_SCHEMA = 'provider.execution.attempt.v1';
const PROVIDER_EXECUTION_OUTCOME_SCHEMA = 'provider.execution.outcome.v1';
const OUTCOMES = Object.freeze(['success', 'known_failure', 'uncertain']);
const MAX_IDEMPOTENCY_KEY_CHARS = 180;

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
  return Object.freeze({ text, timestamp });
}

function normalizeIdempotencyKey(value) {
  const key = requiredText(value, 'provider execution idempotency key', MAX_IDEMPOTENCY_KEY_CHARS);
  if (!/^idem\.[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)) {
    throw new Error('provider execution idempotency key must be an opaque idem.* identifier');
  }
  return key;
}

function protocolVersionForPlan(plan) {
  if (plan.protocolFamily === 'anthropic.messages') return ANTHROPIC_API_VERSION;
  if (plan.protocolFamily === 'mcp') return MCP_STABLE_PROTOCOL_VERSION;
  return null;
}

function planContext(plan) {
  const input = assertPlainObject(plan, 'provider adapter plan');
  const requestId = assertSafeIdentifier(input.requestId, 'plan request id');
  const requestDigest = assertDigest(input.requestDigest, 'plan request digest');
  const planDigest = assertDigest(input.planDigest, 'plan digest');
  const providerId = assertSafeIdentifier(input.providerId, 'plan provider id');
  const providerContractId = assertSafeIdentifier(input.providerContractId, 'plan provider contract id');
  const protocolFamily = requiredText(input.protocolFamily, 'plan protocol family', 80);
  const protocolOperation = requiredText(input.protocolCall?.protocolOperation, 'plan protocol operation', 120);
  const semanticOperationId = assertSafeIdentifier(input.semanticOperation?.operationId, 'plan semantic operation id');
  const riskClass = requiredText(input.semanticOperation?.riskClass, 'plan risk class', 40);
  const endpointRef = assertSafeIdentifier(input.transportBinding?.endpointRef, 'plan endpoint ref');
  const networkPolicyRef = input.transportBinding?.networkPolicyRef == null
    ? null
    : assertSafeIdentifier(input.transportBinding.networkPolicyRef, 'plan network policy ref');
  const credentialRefs = Array.isArray(input.transportBinding?.credentialRefs)
    ? input.transportBinding.credentialRefs.map((ref) => assertSafeIdentifier(ref, 'plan credential ref'))
    : [];
  return deepFreeze({
    requestId,
    requestDigest,
    planDigest,
    providerId,
    providerContractId,
    protocolFamily,
    protocolVersion: protocolVersionForPlan(input),
    protocolOperation,
    semanticOperationId,
    riskClass,
    endpointRef,
    networkPolicyRef,
    credentialRefs,
  });
}

function buildAttempt({ context, attemptId, idempotencyKey, createdAt, priorAttemptRef, reviewedRetry }) {
  const id = assertSafeIdentifier(attemptId, 'provider execution attempt id');
  const key = normalizeIdempotencyKey(idempotencyKey);
  const created = iso(createdAt, 'provider execution attempt createdAt').text;
  const prior = priorAttemptRef == null ? null : requiredText(priorAttemptRef, 'prior attempt ref', 80);
  if (prior && !/^provattempt_[a-f0-9]{24}$/.test(prior)) throw new Error('prior attempt ref is invalid');
  const core = {
    schema: PROVIDER_EXECUTION_ATTEMPT_SCHEMA,
    attemptId: id,
    requestId: context.requestId,
    requestDigest: context.requestDigest,
    planDigest: context.planDigest,
    idempotencyKeyDigest: digest(key),
    priorAttemptRef: prior,
    reviewedRetry: reviewedRetry === true,
    createdAt: created,
  };
  const attemptDigest = digest(core);
  return deepFreeze({
    ...core,
    attemptRef: `provattempt_${attemptDigest.slice(7, 31)}`,
    attemptDigest,
  });
}

function createInitialProviderExecutionAttempt({ plan, attemptId, idempotencyKey, createdAt }) {
  const context = planContext(plan);
  return buildAttempt({
    context,
    attemptId,
    idempotencyKey,
    createdAt,
    priorAttemptRef: null,
    reviewedRetry: false,
  });
}

function normalizeOutcome(value, label = 'provider execution outcome') {
  const outcome = assertPlainObject(value, label);
  if (outcome.schema !== PROVIDER_EXECUTION_OUTCOME_SCHEMA) throw new Error(`${label} schema is unsupported`);
  if (!OUTCOMES.includes(outcome.outcome)) throw new Error(`${label} outcome is unsupported`);
  const supplied = assertDigest(outcome.outcomeDigest, `${label} digest`);
  const base = { ...outcome };
  delete base.outcomeDigest;
  if (digest(base) !== supplied) throw new Error(`${label} digest mismatch`);
  return outcome;
}

function createReviewedProviderRetryAttempt({ priorOutcome, attemptId, idempotencyKey, createdAt }) {
  const prior = normalizeOutcome(priorOutcome, 'prior provider execution outcome');
  if (prior.outcome !== 'uncertain') throw new Error('reviewed retry v1 requires a prior uncertain outcome');
  if (prior.retry?.reviewedRetryRequired !== true) throw new Error('prior uncertain outcome does not require reviewed retry');
  const context = deepFreeze({
    requestId: prior.requestId,
    requestDigest: prior.requestDigest,
    planDigest: prior.planDigest,
  });
  const next = buildAttempt({
    context,
    attemptId,
    idempotencyKey,
    createdAt,
    priorAttemptRef: prior.attemptRef,
    reviewedRetry: true,
  });
  if (next.attemptRef === prior.attemptRef) throw new Error('reviewed retry must use a new attempt identity');
  if (next.idempotencyKeyDigest === prior.retry.idempotencyKeyDigest) {
    throw new Error('reviewed retry must use a new runtime idempotency key');
  }
  return next;
}

function assertAttemptMatchesPlan(attempt, plan) {
  const value = assertPlainObject(attempt, 'provider execution attempt');
  if (value.schema !== PROVIDER_EXECUTION_ATTEMPT_SCHEMA) throw new Error('provider execution attempt schema is unsupported');
  const supplied = assertDigest(value.attemptDigest, 'provider execution attempt digest');
  const base = { ...value };
  delete base.attemptRef;
  delete base.attemptDigest;
  if (digest(base) !== supplied) throw new Error('provider execution attempt digest mismatch');
  if (value.attemptRef !== `provattempt_${supplied.slice(7, 31)}`) throw new Error('provider execution attempt ref mismatch');
  const context = planContext(plan);
  if (value.requestId !== context.requestId) throw new Error('provider execution attempt requestId does not match exact plan');
  if (value.requestDigest !== context.requestDigest) throw new Error('provider execution attempt requestDigest does not match exact plan');
  if (value.planDigest !== context.planDigest) throw new Error('provider execution attempt planDigest does not match exact plan');
  return value;
}

function automaticInitialAttempt(plan, at) {
  const context = planContext(plan);
  const seed = digest({
    requestId: context.requestId,
    planDigest: context.planDigest,
    createdAt: at,
  });
  return createInitialProviderExecutionAttempt({
    plan,
    attemptId: `attempt-${seed.slice(7, 23)}`,
    idempotencyKey: `idem.${seed.slice(7, 39)}`,
    createdAt: at,
  });
}

function authorizationEvidence(authorizationRequest) {
  const decision = evaluateExecutionAuthorizationV1(assertPlainObject(authorizationRequest, 'execution authorization request'));
  if (decision.decision !== 'allow') throw new Error('uncertain outcome cannot bind a non-allow authorization decision');
  return Object.freeze({
    authorizationDecisionRef: decision.decisionRef,
    authorizationEvidenceDigest: decision.decisionEvidenceDigest,
  });
}

function buildOutcome({ attempt, context, authorization, receipt, outcome, knownFailureKind, completedAt, uncertainty }) {
  if (!OUTCOMES.includes(outcome)) throw new Error(`Unsupported provider execution outcome: ${outcome}`);
  const completed = iso(completedAt, 'provider execution outcome completedAt').text;
  const core = {
    schema: PROVIDER_EXECUTION_OUTCOME_SCHEMA,
    attemptRef: attempt.attemptRef,
    attemptDigest: attempt.attemptDigest,
    requestId: context.requestId,
    requestDigest: context.requestDigest,
    planDigest: context.planDigest,
    providerId: context.providerId,
    providerContractId: context.providerContractId,
    protocolFamily: context.protocolFamily,
    protocolVersion: receipt?.protocolVersion ?? context.protocolVersion,
    protocolOperation: context.protocolOperation,
    semanticOperationId: context.semanticOperationId,
    riskClass: context.riskClass,
    authorizationDecisionRef: receipt?.authorizationDecisionRef || authorization?.authorizationDecisionRef || null,
    authorizationEvidenceDigest: receipt?.authorizationEvidenceDigest || authorization?.authorizationEvidenceDigest || null,
    endpointRef: context.endpointRef,
    credentialRefs: context.credentialRefs,
    networkPolicyRef: context.networkPolicyRef,
    startedAt: attempt.createdAt,
    completedAt: completed,
    outcome,
    knownFailureKind: knownFailureKind || null,
    statusCode: receipt?.statusCode ?? null,
    providerRequestId: receipt?.providerRequestId ?? null,
    responseDigest: receipt?.responseDigest ?? null,
    uncertainty: uncertainty || null,
    retry: {
      automaticRetryPerformed: false,
      reviewedRetryRequired: outcome === 'uncertain',
      reviewedRetry: attempt.reviewedRetry,
      priorAttemptRef: attempt.priorAttemptRef,
      idempotencyKeyDigest: attempt.idempotencyKeyDigest,
    },
  };
  const outcomeDigest = digest(core);
  return deepFreeze({ ...core, outcomeDigest });
}

class ProviderExecutionUncertainError extends Error {
  constructor(message, outcome) {
    super(message);
    this.name = 'ProviderExecutionUncertainError';
    this.outcome = outcome;
  }
}

function wrapSingleEffectPort(effect, label, state) {
  if (typeof effect !== 'function') throw new TypeError(`${label} is required`);
  return async (request) => {
    state.invocations += 1;
    if (state.invocations !== 1) throw new Error('provider execution attempted more than one network effect in one attempt');
    state.started = true;
    return effect(request);
  };
}

function resolveAttempt({ plan, executionAttempt, at }) {
  const attempt = executionAttempt || automaticInitialAttempt(plan, at);
  return assertAttemptMatchesPlan(attempt, plan);
}

function completionTime(clock, fallback) {
  if (!clock || typeof clock.now !== 'function') return fallback;
  return iso(clock.now(), 'provider execution outcome clock').text;
}

function outcomeFromKnownResult({ attempt, plan, result, completedAt }) {
  const context = planContext(plan);
  const receipt = assertPlainObject(result.receipt, 'provider execution receipt');
  const success = result.ok === true;
  return buildOutcome({
    attempt,
    context,
    receipt,
    authorization: null,
    outcome: success ? 'success' : 'known_failure',
    knownFailureKind: success ? null : requiredText(receipt.outcome, 'provider receipt outcome', 60),
    completedAt,
    uncertainty: null,
  });
}

function uncertainOutcome({ attempt, plan, authorizationRequest, completedAt }) {
  return buildOutcome({
    attempt,
    context: planContext(plan),
    authorization: authorizationEvidence(authorizationRequest),
    receipt: null,
    outcome: 'uncertain',
    knownFailureKind: null,
    completedAt,
    uncertainty: Object.freeze({
      classification: 'transport_exception_after_effect_port_entry',
      effectMayHaveOccurred: true,
      reasonCode: 'TRANSPORT_RESULT_UNKNOWN',
    }),
  });
}

async function executeModelProviderAttempt({
  executionAttempt,
  outcomeClock = { now: () => new Date().toISOString() },
  ...input
}) {
  const at = input.at || input.authorizationRequest?.observedAt;
  const attempt = resolveAttempt({ plan: input.plan, executionAttempt, at });
  const state = { started: false, invocations: 0 };
  const transport = assertPlainObject(input.transport, 'transport');
  const wrappedTransport = Object.freeze({
    invoke: wrapSingleEffectPort(transport.invoke?.bind(transport), 'transport.invoke', state),
  });
  try {
    const result = await executeProviderAdapterPlan({ ...input, transport: wrappedTransport });
    const completedAt = completionTime(outcomeClock, at);
    return deepFreeze({
      ...result,
      attempt,
      executionOutcome: outcomeFromKnownResult({ attempt, plan: input.plan, result, completedAt }),
    });
  } catch (error) {
    if (!state.started) throw error;
    if (state.invocations !== 1) throw error;
    const completedAt = completionTime(outcomeClock, at);
    const outcome = uncertainOutcome({
      attempt,
      plan: input.plan,
      authorizationRequest: input.authorizationRequest,
      completedAt,
    });
    throw new ProviderExecutionUncertainError('provider transport failed', outcome);
  }
}

async function executeMcpProviderAttempt({
  executionAttempt,
  outcomeClock = { now: () => new Date().toISOString() },
  ...input
}) {
  const at = input.at || input.authorizationRequest?.observedAt;
  const attempt = resolveAttempt({ plan: input.plan, executionAttempt, at });
  const state = { started: false, invocations: 0 };
  const mcpTransport = assertPlainObject(input.mcpTransport, 'mcpTransport');
  const wrappedMcpTransport = Object.freeze({
    invokeTool: wrapSingleEffectPort(mcpTransport.invokeTool?.bind(mcpTransport), 'mcpTransport.invokeTool', state),
  });
  try {
    const result = await executeMcpProviderAdapterPlan({ ...input, mcpTransport: wrappedMcpTransport });
    const completedAt = completionTime(outcomeClock, at);
    return deepFreeze({
      ...result,
      attempt,
      executionOutcome: outcomeFromKnownResult({ attempt, plan: input.plan, result, completedAt }),
    });
  } catch (error) {
    if (!state.started) throw error;
    if (state.invocations !== 1) throw error;
    const completedAt = completionTime(outcomeClock, at);
    const outcome = uncertainOutcome({
      attempt,
      plan: input.plan,
      authorizationRequest: input.authorizationRequest,
      completedAt,
    });
    throw new ProviderExecutionUncertainError('MCP transport failed', outcome);
  }
}

module.exports = {
  PROVIDER_EXECUTION_ATTEMPT_SCHEMA,
  PROVIDER_EXECUTION_OUTCOME_SCHEMA,
  ProviderExecutionUncertainError,
  createInitialProviderExecutionAttempt,
  createReviewedProviderRetryAttempt,
  executeModelProviderAttempt,
  executeMcpProviderAttempt,
};
