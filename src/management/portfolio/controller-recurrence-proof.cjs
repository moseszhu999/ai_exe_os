'use strict';

const { CONTROLLER_ATTESTATION_ENVELOPE_SCHEMA } = require('./controller-attestation-envelope.cjs');
const { ENRICHED_OBSERVATION_SCHEMA } = require('./domain-controller-receipt.cjs');

const CONTROLLER_RECURRING_STRUCTURED_PROOF_SCHEMA = 'aiexe.controller-recurring-structured-proof.v1';

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a plain object`);
  return value;
}

function requiredText(value, label, maxLength = 500) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const text = value.trim();
  if (!text) throw new TypeError(`${label} must not be empty`);
  if (text.length > maxLength) throw new TypeError(`${label} is too long`);
  return text;
}

function exactDigest(value) {
  const text = requiredText(value, 'recurrence source digest', 80).toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/.test(text)) throw new TypeError('recurrence source digest must be sha256:<64 hex chars>');
  return text;
}

function exactSha(value) {
  const text = requiredText(value, 'recurrence exact head sha', 64).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(text)) throw new TypeError('recurrence exact head sha must be a 40-character git SHA');
  return text;
}

function isoInstant(value, label) {
  const text = requiredText(value, label, 80);
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new TypeError(`${label} must be an ISO timestamp`);
  return { text, ms };
}

function normalizeAcceptedCycle(raw, expectedProjectId, expectedRepository) {
  plainObject(raw, 'recurrence cycle');
  const allowed = new Set(['envelope', 'enrichedObservation']);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new Error(`recurrence cycle contains unsupported field: ${key}`);
  }

  const envelope = raw.envelope;
  if (
    envelope?.schema !== CONTROLLER_ATTESTATION_ENVELOPE_SCHEMA
    || envelope?.sourceDigestVerified !== true
    || envelope?.readOnly !== true
    || envelope?.writeAuthority !== 'none'
  ) {
    throw new Error('recurrence cycle requires a canonical digest-verified Controller envelope');
  }

  const enriched = raw.enrichedObservation;
  if (
    enriched?.schema !== ENRICHED_OBSERVATION_SCHEMA
    || enriched?.readOnly !== true
    || enriched?.writeAuthority !== 'none'
  ) {
    throw new Error('recurrence cycle requires a canonical enriched read-only observation');
  }
  if (enriched?.domainReceipt?.accepted !== true || enriched?.domainReceipt?.reason !== 'accepted_exact_head_current') {
    throw new Error('recurrence cycle requires an exact-head current accepted Domain receipt');
  }

  const attestation = envelope.attestation;
  const receipt = enriched.domainReceipt.receipt;
  if (!attestation || !receipt) throw new Error('recurrence cycle is missing canonical attestation or receipt');

  const projectId = requiredText(attestation.projectId, 'recurrence project id', 120);
  const repository = requiredText(attestation.canonicalReceipt?.repository, 'recurrence repository', 200);
  if (projectId !== expectedProjectId || enriched.projectId !== expectedProjectId || receipt.projectId !== expectedProjectId) {
    throw new Error('recurrence cycle project binding mismatch');
  }
  if (repository !== expectedRepository || enriched.source?.repository !== expectedRepository || receipt.repository !== expectedRepository) {
    throw new Error('recurrence cycle repository binding mismatch');
  }

  const sourceRef = requiredText(envelope.sourceRef, 'recurrence source ref', 320);
  const sourceDigest = exactDigest(envelope.sourceDigest);
  const exactHeadSha = exactSha(receipt.exactHeadSha);
  const observedAt = isoInstant(receipt.observedAt, 'recurrence observed at');

  if (attestation.sourceRef !== sourceRef || attestation.sourceDigest !== sourceDigest) {
    throw new Error('recurrence cycle envelope and attestation source binding mismatch');
  }
  if (attestation.canonicalReceipt.exactHeadSha !== exactHeadSha) {
    throw new Error('recurrence cycle envelope and accepted receipt head mismatch');
  }
  if (attestation.canonicalReceipt.observedAt !== observedAt.text) {
    throw new Error('recurrence cycle envelope and accepted receipt time mismatch');
  }
  if (enriched.source.headSha !== exactHeadSha) {
    throw new Error('recurrence cycle accepted observation is not bound to the attested exact head');
  }

  return freezeDeep({
    projectId,
    repository,
    sourceKind: requiredText(envelope.sourceKind, 'recurrence source kind', 80),
    sourceRef,
    sourceDigest,
    exactHeadSha,
    observedAt: observedAt.text,
    observedAtMs: observedAt.ms,
    acceptanceReason: enriched.domainReceipt.reason,
    readOnly: true,
    writeAuthority: 'none',
  });
}

function buildControllerRecurringStructuredProof(input) {
  plainObject(input, 'controller recurring structured proof input');
  const allowed = new Set(['projectId', 'repository', 'cycles']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`controller recurring structured proof input contains unsupported field: ${key}`);
  }

  const projectId = requiredText(input.projectId, 'recurrence project id', 120);
  const repository = requiredText(input.repository, 'recurrence repository', 200);
  if (!Array.isArray(input.cycles) || input.cycles.length < 2) {
    throw new TypeError('recurring structured proof requires at least two accepted cycles');
  }

  const cycles = input.cycles.map((cycle) => normalizeAcceptedCycle(cycle, projectId, repository));
  for (let index = 1; index < cycles.length; index += 1) {
    if (cycles[index].observedAtMs <= cycles[index - 1].observedAtMs) {
      throw new Error('recurrence cycle observedAt values must be strictly increasing');
    }
  }

  const sourceRefs = cycles.map((cycle) => cycle.sourceRef);
  const sourceDigests = cycles.map((cycle) => cycle.sourceDigest);
  if (new Set(sourceRefs).size !== sourceRefs.length) {
    throw new Error('recurrence proof requires distinct source refs across cycles');
  }
  if (new Set(sourceDigests).size !== sourceDigests.length) {
    throw new Error('recurrence proof requires changed source bodies with distinct digests');
  }

  return freezeDeep({
    schema: CONTROLLER_RECURRING_STRUCTURED_PROOF_SCHEMA,
    evidenceClass: 'VERIFIED_RECURRING_STRUCTURED_CONTROLLER_SOURCE',
    projectId,
    repository,
    cycleCount: cycles.length,
    firstObservedAt: cycles[0].observedAt,
    lastObservedAt: cycles[cycles.length - 1].observedAt,
    sourceRefs: Object.freeze([...sourceRefs]),
    sourceDigests: Object.freeze([...sourceDigests]),
    exactHeadShas: Object.freeze(cycles.map((cycle) => cycle.exactHeadSha)),
    allCyclesAcceptedExactHeadCurrent: true,
    distinctSourceRefs: true,
    distinctSourceDigests: true,
    strictlyIncreasingObservedAt: true,
    readOnly: true,
    writeAuthority: 'none',
    proven: true,
    cycles,
  });
}

module.exports = {
  CONTROLLER_RECURRING_STRUCTURED_PROOF_SCHEMA,
  buildControllerRecurringStructuredProof,
};
