'use strict';

const { createHash } = require('node:crypto');
const { createExternalControllerAttestation } = require('./external-controller-attestation.cjs');

const CONTROLLER_ATTESTATION_ENVELOPE_SCHEMA = 'aiexe.external-controller-attestation-envelope.v1';
const START_MARKER = '<!-- aiexe.external-controller-attestation.v1 -->';
const END_MARKER = '<!-- /aiexe.external-controller-attestation.v1 -->';
const PAYLOAD_FIELDS = Object.freeze([
  'projectId',
  'controllerId',
  'repository',
  'exactHeadSha',
  'domainStatus',
  'owner',
  'milestone',
  'blockerCodes',
  'evidenceRefs',
  'observedAt',
]);

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a plain object`);
  return value;
}

function requiredText(value, label, maxLength = 100000) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const text = value.trim();
  if (!text) throw new TypeError(`${label} must not be empty`);
  if (text.length > maxLength) throw new TypeError(`${label} is too long`);
  return text;
}

function sourceDigestFor(body) {
  if (typeof body !== 'string') throw new TypeError('controller source body must be a string');
  return `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
}

function exactDigest(value) {
  const text = requiredText(value, 'controller source digest', 80).toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/.test(text)) throw new TypeError('controller source digest must be sha256:<64 hex chars>');
  return text;
}

function count(haystack, needle) {
  let total = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    total += 1;
    index += needle.length;
  }
  return total;
}

function extractStructuredPayload(body) {
  if (count(body, START_MARKER) !== 1 || count(body, END_MARKER) !== 1) {
    throw new Error('controller source must contain exactly one attestation marker pair');
  }
  const start = body.indexOf(START_MARKER) + START_MARKER.length;
  const end = body.indexOf(END_MARKER, start);
  if (end < start) throw new Error('controller attestation markers are out of order');
  const marked = body.slice(start, end).trim();
  const match = /^```json\s*\n([\s\S]*?)\n```$/.exec(marked);
  if (!match) throw new Error('controller attestation marker must contain exactly one fenced JSON object');

  let payload;
  try {
    payload = JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`controller attestation JSON is invalid: ${error.message}`);
  }
  plainObject(payload, 'controller attestation payload');
  const allowed = new Set(PAYLOAD_FIELDS);
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) throw new Error(`controller attestation payload contains unsupported field: ${key}`);
  }
  for (const key of PAYLOAD_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) throw new Error(`controller attestation payload missing required field: ${key}`);
  }
  return payload;
}

function parseControllerAttestationEnvelope(input) {
  plainObject(input, 'controller attestation envelope input');
  const allowed = new Set(['body', 'sourceKind', 'sourceRef', 'sourceDigest']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`controller attestation envelope input contains unsupported field: ${key}`);
  }

  const body = typeof input.body === 'string' ? input.body : (() => { throw new TypeError('controller source body must be a string'); })();
  const sourceRef = requiredText(input.sourceRef, 'controller source ref', 320);
  const sourceDigest = exactDigest(input.sourceDigest);
  const computedDigest = sourceDigestFor(body);
  if (sourceDigest !== computedDigest) throw new Error('controller source digest mismatch');

  const payload = extractStructuredPayload(body);
  const attestation = createExternalControllerAttestation({
    ...payload,
    sourceKind: input.sourceKind,
    sourceRef,
    sourceDigest,
  });

  return freezeDeep({
    schema: CONTROLLER_ATTESTATION_ENVELOPE_SCHEMA,
    transport: 'out-of-band',
    sourceKind: attestation.sourceKind,
    sourceRef,
    sourceDigest,
    sourceDigestVerified: true,
    surroundingProseAuthoritative: false,
    factExtraction: 'marked-json-only',
    llmFactGenerationAllowed: false,
    readOnly: true,
    writeAuthority: 'none',
    attestation,
  });
}

module.exports = {
  CONTROLLER_ATTESTATION_ENVELOPE_SCHEMA,
  END_MARKER,
  PAYLOAD_FIELDS,
  START_MARKER,
  parseControllerAttestationEnvelope,
  sourceDigestFor,
};
