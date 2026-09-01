'use strict';

const { createHash } = require('node:crypto');
const { deepFreeze, requiredText } = require('../domain/workspace-model.cjs');
const {
  PROVENANCE_ENVELOPE_SCHEMA,
  PROVENANCE_STATUS,
} = require('./agent-selection-host-provenance-envelope.cjs');
const { SHA256_PATTERN } = require('./agent-selection-observation-receipt.cjs');

const VERIFICATION_REQUEST_SCHEMA = 'ado.selection.host-provenance-verification-request.v1';
const VERIFICATION_PURPOSE = 'external-host-provenance';
const REQUEST_STATUS = 'pending_external_verification';
const DECISION_VOCABULARY = Object.freeze(['verified', 'denied', 'unknown']);
const MIN_MAX_ATTESTATION_AGE_SECONDS = 60;
const MAX_MAX_ATTESTATION_AGE_SECONDS = 7 * 24 * 60 * 60;

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function assertAllowedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field: ${key}`);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}

function requireDigest(value, label) {
  const normalized = requiredText(value, label, 160);
  if (!SHA256_PATTERN.test(normalized)) throw new Error(`${label} must be a sha256 digest`);
  return normalized;
}

function utcTimestamp(value, label) {
  const normalized = requiredText(value, label, 40);
  if (!normalized.endsWith('Z') || !Number.isFinite(Date.parse(normalized))) {
    throw new Error(`${label} must be an ISO-8601 UTC timestamp`);
  }
  return normalized;
}

function safePolicyRef(value) {
  const normalized = requiredText(value, 'verifierPolicyRef', 200);
  if (/@[^/\s]+\.[A-Za-z]{2,}/.test(normalized)) throw new Error('verifierPolicyRef must not contain email-like PII');
  if (/bearer|password|secret|token=|api[_-]?key|cookie|session=|jwt|private[_-]?key/i.test(normalized)) {
    throw new Error('verifierPolicyRef must not contain secret/session-like material');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9:._@/-]*$/.test(normalized)) {
    throw new Error('verifierPolicyRef contains invalid characters');
  }
  return normalized;
}

function normalizeEnvelope(value) {
  const envelope = assertPlainObject(value, 'envelope');
  const allowed = new Set([
    'schema',
    'provenanceStatus',
    'collectionRef',
    'host',
    'observedAt',
    'captureSetRef',
    'externalAttestation',
    'provenanceBoundary',
    'envelopeDigest',
  ]);
  assertAllowedKeys(envelope, allowed, 'envelope');
  for (const key of allowed) {
    if (!Object.hasOwn(envelope, key)) throw new Error(`envelope is missing required field: ${key}`);
  }
  if (envelope.schema !== PROVENANCE_ENVELOPE_SCHEMA) {
    throw new Error(`envelope schema must be ${PROVENANCE_ENVELOPE_SCHEMA}`);
  }
  if (envelope.provenanceStatus !== PROVENANCE_STATUS || envelope.provenanceStatus !== 'unverified') {
    throw new Error('verification request requires an unverified provenance envelope');
  }
  assertPlainObject(envelope.collectionRef, 'envelope collectionRef');
  assertPlainObject(envelope.host, 'envelope host');
  assertPlainObject(envelope.provenanceBoundary, 'envelope provenanceBoundary');
  if (envelope.provenanceBoundary.collectionIntegrityVerifiedByThisModule !== true) {
    throw new Error('envelope collection integrity must be verified before requesting external verification');
  }
  if (envelope.provenanceBoundary.externalSignatureVerificationPerformedByThisModule !== false ||
      envelope.provenanceBoundary.externalTrustRootConfiguredByThisModule !== false ||
      envelope.provenanceBoundary.externalHostProvenanceVerified !== false) {
    throw new Error('envelope must not claim local external-host verification authority');
  }
  const suppliedDigest = requireDigest(envelope.envelopeDigest, 'envelope envelopeDigest');
  const unsigned = { ...envelope };
  delete unsigned.envelopeDigest;
  if (digest(unsigned) !== suppliedDigest) throw new Error('envelope integrity mismatch');
  return envelope;
}

function normalizeMaxAge(value) {
  if (!Number.isInteger(value) ||
      value < MIN_MAX_ATTESTATION_AGE_SECONDS ||
      value > MAX_MAX_ATTESTATION_AGE_SECONDS) {
    throw new Error(
      `maxAttestationAgeSeconds must be an integer between ${MIN_MAX_ATTESTATION_AGE_SECONDS} and ${MAX_MAX_ATTESTATION_AGE_SECONDS}`,
    );
  }
  return value;
}

function createAgentSelectionHostProvenanceVerificationRequest(inputValue) {
  const input = assertPlainObject(inputValue, 'verification request input');
  const allowed = new Set([
    'envelope',
    'verifierPolicyRef',
    'maxAttestationAgeSeconds',
    'requestedAt',
  ]);
  assertAllowedKeys(input, allowed, 'verification request input');
  for (const key of allowed) {
    if (!Object.hasOwn(input, key)) throw new Error(`verification request input is missing required field: ${key}`);
  }

  const envelope = normalizeEnvelope(input.envelope);
  const requestedAt = utcTimestamp(input.requestedAt, 'requestedAt');
  const observedAt = utcTimestamp(envelope.observedAt, 'envelope observedAt');
  if (Date.parse(requestedAt) < Date.parse(observedAt)) {
    throw new Error('requestedAt must not be earlier than envelope observedAt');
  }

  const payload = {
    schema: VERIFICATION_REQUEST_SCHEMA,
    purpose: VERIFICATION_PURPOSE,
    requestStatus: REQUEST_STATUS,
    envelopeRef: {
      schema: PROVENANCE_ENVELOPE_SCHEMA,
      envelopeDigest: envelope.envelopeDigest,
      provenanceStatus: 'unverified',
      collectionDigest: requireDigest(envelope.collectionRef.collectionDigest, 'envelope collectionDigest'),
      fixtureDigest: requireDigest(envelope.collectionRef.fixtureDigest, 'envelope fixtureDigest'),
      observationCount: envelope.collectionRef.observationCount,
    },
    expectedHost: {
      surface: requiredText(envelope.host.surface, 'envelope host surface', 80),
      hostName: requiredText(envelope.host.hostName, 'envelope hostName', 120),
      hostVersion: requiredText(envelope.host.hostVersion, 'envelope hostVersion', 160),
      modelName: requiredText(envelope.host.modelName, 'envelope modelName', 160),
    },
    observedAt,
    requestedAt,
    verifierPolicy: {
      verifierPolicyRef: safePolicyRef(input.verifierPolicyRef),
      maxAttestationAgeSeconds: normalizeMaxAge(input.maxAttestationAgeSeconds),
      decisionVocabulary: DECISION_VOCABULARY,
      requireExternalAttestation: true,
      externalAttestationPresent: envelope.externalAttestation !== null,
    },
    requestBoundary: {
      externalVerificationPerformedByThisModule: false,
      verificationDecisionCreatedByThisModule: false,
      externalTrustRootConfiguredByThisModule: false,
      publicKeyEmbeddedByThisModule: false,
      transportCredentialsOwnedByThisModule: false,
      networkPerformedByThisModule: false,
      externalHostProvenanceVerified: false,
      rankingClaimCreated: false,
      registryPublicationPerformed: false,
      paymentPerformed: false,
      domainWritePerformed: false,
      executionAuthorized: false,
    },
  };

  return deepFreeze({ ...payload, requestDigest: digest(payload) });
}

module.exports = {
  VERIFICATION_REQUEST_SCHEMA,
  VERIFICATION_PURPOSE,
  REQUEST_STATUS,
  DECISION_VOCABULARY,
  MIN_MAX_ATTESTATION_AGE_SECONDS,
  MAX_MAX_ATTESTATION_AGE_SECONDS,
  createAgentSelectionHostProvenanceVerificationRequest,
};
