'use strict';

const {
  END_MARKER,
  PAYLOAD_FIELDS,
  START_MARKER,
  parseControllerAttestationEnvelope,
  sourceDigestFor,
} = require('./controller-attestation-envelope.cjs');

const CONTROLLER_ADOPTION_SOURCE_SCHEMA = 'aiexe.controller-adoption-source.v1';
const DEFAULT_PROSE = 'AIEXE Controller attestation. The marked JSON block is authoritative; surrounding prose is not.';

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a plain object`);
  return value;
}

function requiredText(value, label, maxLength = 400) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const text = value.trim();
  if (!text) throw new TypeError(`${label} must not be empty`);
  if (text.length > maxLength) throw new TypeError(`${label} is too long`);
  return text;
}

function normalizePayload(payload) {
  plainObject(payload, 'controller adoption payload');
  const allowed = new Set(PAYLOAD_FIELDS);
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) throw new Error(`controller adoption payload contains unsupported field: ${key}`);
  }
  const normalized = {};
  for (const key of PAYLOAD_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) throw new Error(`controller adoption payload missing required field: ${key}`);
    normalized[key] = payload[key];
  }
  return normalized;
}

function buildControllerAdoptionSource(input) {
  plainObject(input, 'controller adoption source input');
  const allowed = new Set(['payload', 'sourceKind', 'sourceRef', 'prose']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`controller adoption source input contains unsupported field: ${key}`);
  }

  const sourceKind = requiredText(input.sourceKind, 'controller source kind', 80);
  const sourceRef = requiredText(input.sourceRef, 'controller source ref', 320);
  const prose = input.prose == null ? DEFAULT_PROSE : requiredText(input.prose, 'controller source prose', 1200);
  const payload = normalizePayload(input.payload);
  const body = `${prose}\n\n${START_MARKER}\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n${END_MARKER}`;
  const sourceDigest = sourceDigestFor(body);
  const envelope = parseControllerAttestationEnvelope({
    body,
    sourceKind,
    sourceRef,
    sourceDigest,
  });

  return freezeDeep({
    schema: CONTROLLER_ADOPTION_SOURCE_SCHEMA,
    adoptionMode: 'out-of-band-structured-envelope',
    externalRepositoryFrameworkRequired: false,
    externalRepositoryWriteRequiredByThisBuilder: false,
    crossRepositoryCredentialRequiredByThisBuilder: false,
    factExtraction: 'marked-json-only',
    llmFactGenerationAllowed: false,
    readOnly: true,
    writeAuthority: 'none',
    sourceKind,
    sourceRef,
    sourceDigest,
    body,
    envelope,
  });
}

module.exports = {
  CONTROLLER_ADOPTION_SOURCE_SCHEMA,
  DEFAULT_PROSE,
  buildControllerAdoptionSource,
};
