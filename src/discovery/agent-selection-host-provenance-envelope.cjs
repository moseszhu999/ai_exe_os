'use strict';

const { createHash } = require('node:crypto');
const { deepFreeze, requiredText } = require('../domain/workspace-model.cjs');
const { COLLECTION_SCHEMA } = require('./agent-selection-host-collector.cjs');
const { SHA256_PATTERN } = require('./agent-selection-observation-receipt.cjs');

const PROVENANCE_ENVELOPE_SCHEMA = 'ado.selection.host-provenance-envelope.v1';
const PROVENANCE_STATUS = 'unverified';
const SUPPORTED_SURFACES = new Set([
  'chatgpt_app',
  'mcp_client',
  'mcp_registry_consumer',
  'llm_web_discovery',
  'internal_eval_host',
]);

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

function utcTimestamp(value, label) {
  const normalized = requiredText(value, label, 40);
  if (!normalized.endsWith('Z') || !Number.isFinite(Date.parse(normalized))) {
    throw new Error(`${label} must be an ISO-8601 UTC timestamp`);
  }
  return normalized;
}

function sha256(value, label) {
  const normalized = requiredText(value, label, 160);
  if (!SHA256_PATTERN.test(normalized)) throw new Error(`${label} must be a sha256 digest`);
  return normalized;
}

function safeOpaqueRef(value, label) {
  const normalized = requiredText(value, label, 240);
  if (/@[^/\s]+\.[A-Za-z]{2,}/.test(normalized)) throw new Error(`${label} must not contain email-like PII`);
  if (/bearer|password|secret|token=|api[_-]?key|cookie|session=|jwt/i.test(normalized)) {
    throw new Error(`${label} must not contain secret/session-like material`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9:._@/-]*$/.test(normalized)) {
    throw new Error(`${label} contains invalid characters`);
  }
  return normalized;
}

function normalizeCollection(value) {
  const collection = assertPlainObject(value, 'collection');
  const allowed = new Set([
    'schema',
    'collectorId',
    'fixtureRef',
    'observations',
    'collectionBoundary',
    'collectionDigest',
  ]);
  assertAllowedKeys(collection, allowed, 'collection');
  for (const key of allowed) {
    if (!Object.hasOwn(collection, key)) throw new Error(`collection is missing required field: ${key}`);
  }
  if (collection.schema !== COLLECTION_SCHEMA) throw new Error(`collection schema must be ${COLLECTION_SCHEMA}`);
  requiredText(collection.collectorId, 'collection collectorId', 120);
  assertPlainObject(collection.fixtureRef, 'collection fixtureRef');
  if (!Array.isArray(collection.observations) || collection.observations.length === 0) {
    throw new Error('collection observations must be a non-empty array');
  }
  assertPlainObject(collection.collectionBoundary, 'collection collectionBoundary');
  if (collection.collectionBoundary.externalHostProvenanceVerifiedByThisModule !== false) {
    throw new Error('collection must not claim external host provenance verification');
  }
  if (collection.collectionBoundary.rawHostResponseStored !== false) {
    throw new Error('collection must not store raw host response');
  }
  if (collection.collectionBoundary.responseDigestBound !== true) {
    throw new Error('collection must bind response digests');
  }
  const supplied = sha256(collection.collectionDigest, 'collection collectionDigest');
  const unsigned = { ...collection };
  delete unsigned.collectionDigest;
  if (digest(unsigned) !== supplied) throw new Error('collection integrity mismatch');
  return collection;
}

function normalizeExternalAttestation(value) {
  if (value == null) return null;
  const input = assertPlainObject(value, 'externalAttestation');
  const allowed = new Set([
    'attestation_ref',
    'verifier_ref',
    'key_ref',
    'signature_algorithm',
    'signature',
    'issued_at',
    'valid_until',
  ]);
  assertAllowedKeys(input, allowed, 'externalAttestation');
  for (const key of allowed) {
    if (!Object.hasOwn(input, key)) throw new Error(`externalAttestation is missing required field: ${key}`);
  }
  const issuedAt = utcTimestamp(input.issued_at, 'externalAttestation issued_at');
  const validUntil = utcTimestamp(input.valid_until, 'externalAttestation valid_until');
  if (Date.parse(validUntil) <= Date.parse(issuedAt)) {
    throw new Error('externalAttestation valid_until must be after issued_at');
  }
  const signature = requiredText(input.signature, 'externalAttestation signature', 4096);
  if (!/^[A-Za-z0-9+/=_-]+$/.test(signature)) {
    throw new Error('externalAttestation signature must be bounded encoded text');
  }
  return deepFreeze({
    attestation_ref: safeOpaqueRef(input.attestation_ref, 'externalAttestation attestation_ref'),
    verifier_ref: safeOpaqueRef(input.verifier_ref, 'externalAttestation verifier_ref'),
    key_ref: safeOpaqueRef(input.key_ref, 'externalAttestation key_ref'),
    signature_algorithm: requiredText(input.signature_algorithm, 'externalAttestation signature_algorithm', 80),
    signature,
    issued_at: issuedAt,
    valid_until: validUntil,
  });
}

function createAgentSelectionHostProvenanceEnvelope(inputValue) {
  const input = assertPlainObject(inputValue, 'host provenance envelope input');
  const allowed = new Set([
    'collection',
    'surface',
    'hostName',
    'hostVersion',
    'modelName',
    'observedAt',
    'captureSetRef',
    'externalAttestation',
  ]);
  assertAllowedKeys(input, allowed, 'host provenance envelope input');

  const collection = normalizeCollection(input.collection);
  const surface = requiredText(input.surface, 'surface', 80);
  if (!SUPPORTED_SURFACES.has(surface)) throw new Error(`Unsupported surface: ${surface}`);
  const externalAttestation = normalizeExternalAttestation(input.externalAttestation);

  const payload = {
    schema: PROVENANCE_ENVELOPE_SCHEMA,
    provenanceStatus: PROVENANCE_STATUS,
    collectionRef: {
      schema: COLLECTION_SCHEMA,
      collectorId: collection.collectorId,
      collectionDigest: collection.collectionDigest,
      fixtureDigest: sha256(collection.fixtureRef.fixtureDigest, 'collection fixtureDigest'),
      observationCount: collection.observations.length,
    },
    host: {
      surface,
      hostName: requiredText(input.hostName, 'hostName', 120),
      hostVersion: requiredText(input.hostVersion, 'hostVersion', 160),
      modelName: requiredText(input.modelName, 'modelName', 160),
    },
    observedAt: utcTimestamp(input.observedAt, 'observedAt'),
    captureSetRef: safeOpaqueRef(input.captureSetRef, 'captureSetRef'),
    externalAttestation,
    provenanceBoundary: {
      collectionIntegrityVerifiedByThisModule: true,
      externalSignatureVerificationPerformedByThisModule: false,
      externalTrustRootConfiguredByThisModule: false,
      externalHostProvenanceVerified: false,
      rankingClaimCreated: false,
      registryPublicationPerformed: false,
      paymentPerformed: false,
      domainWritePerformed: false,
      executionAuthorized: false,
    },
  };

  return deepFreeze({ ...payload, envelopeDigest: digest(payload) });
}

module.exports = {
  PROVENANCE_ENVELOPE_SCHEMA,
  PROVENANCE_STATUS,
  SUPPORTED_SURFACES,
  createAgentSelectionHostProvenanceEnvelope,
};
