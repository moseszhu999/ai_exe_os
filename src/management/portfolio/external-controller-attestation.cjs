'use strict';

const {
  DOMAIN_RECEIPT_SCHEMA,
  createDomainControllerReceipt,
  enrichGithubObservationWithDomainReceipt,
} = require('./domain-controller-receipt.cjs');

const EXTERNAL_ATTESTATION_SCHEMA = 'aiexe.external-controller-attestation.v1';
const EXTERNAL_ATTESTATION_PROJECTION_SCHEMA = 'aiexe.external-controller-attestation-projection.v1';
const SOURCE_KINDS = Object.freeze([
  'automation-receipt',
  'canonical-status',
  'controller-handoff',
  'coordinator-issue',
  'current-handoff',
]);

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function requiredText(value, label, maxLength = 320) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const text = value.trim();
  if (!text) throw new TypeError(`${label} must not be empty`);
  if (text.length > maxLength) throw new TypeError(`${label} is too long`);
  return text;
}

function exactEnum(value, allowed, label) {
  const text = requiredText(value, label, 80);
  if (!allowed.includes(text)) throw new TypeError(`${label} must be one of: ${allowed.join(', ')}`);
  return text;
}

function optionalSha256(value) {
  if (value == null) return null;
  const text = requiredText(value, 'source digest', 80).toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/.test(text)) {
    throw new TypeError('source digest must be sha256:<64 hex chars>');
  }
  return text;
}

function isoInstant(value, label) {
  const text = requiredText(value, label, 80);
  if (!Number.isFinite(Date.parse(text))) throw new TypeError(`${label} must be an ISO timestamp`);
  return text;
}

function uniqueTextList(value, label, maxLength = 320) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const rows = value.map((item) => requiredText(item, label, maxLength));
  if (new Set(rows).size !== rows.length) throw new Error(`${label} must not contain duplicates`);
  return Object.freeze([...rows].sort());
}

function createExternalControllerAttestation(input) {
  plainObject(input, 'external controller attestation');
  const allowed = new Set([
    'projectId', 'controllerId', 'repository', 'exactHeadSha', 'domainStatus',
    'owner', 'milestone', 'blockerCodes', 'evidenceRefs', 'observedAt',
    'sourceKind', 'sourceRef', 'sourceDigest',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`external controller attestation contains unsupported field: ${key}`);
  }

  const sourceKind = exactEnum(input.sourceKind, SOURCE_KINDS, 'source kind');
  const sourceRef = requiredText(input.sourceRef, 'source ref', 320);
  const sourceDigest = optionalSha256(input.sourceDigest);
  const observedAt = isoInstant(input.observedAt, 'attestation observed at');
  const evidenceRefs = uniqueTextList(input.evidenceRefs, 'attestation evidence ref', 320);

  const receipt = createDomainControllerReceipt({
    projectId: input.projectId,
    controllerId: input.controllerId,
    repository: input.repository,
    exactHeadSha: input.exactHeadSha,
    domainStatus: input.domainStatus,
    owner: input.owner,
    milestone: input.milestone,
    blockerCodes: input.blockerCodes,
    evidenceRefs: [...new Set([sourceRef, ...evidenceRefs])].sort(),
    observedAt,
  });

  return freezeDeep({
    schema: EXTERNAL_ATTESTATION_SCHEMA,
    projectId: receipt.projectId,
    sourceKind,
    sourceRef,
    sourceDigest,
    observedAt,
    readOnly: true,
    writeAuthority: 'none',
    factExtraction: 'explicit-structured-fields-only',
    llmFactGenerationAllowed: false,
    domainRepositoryMutationRequired: false,
    canonicalReceipt: receipt,
  });
}

function projectExternalControllerAttestation(input) {
  plainObject(input, 'external attestation projection');
  const allowed = new Set(['attestation']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`external attestation projection contains unsupported field: ${key}`);
  }
  const attestation = input.attestation;
  if (attestation?.schema !== EXTERNAL_ATTESTATION_SCHEMA || attestation?.readOnly !== true) {
    throw new Error('canonical external controller attestation required');
  }
  if (attestation?.canonicalReceipt?.schema !== DOMAIN_RECEIPT_SCHEMA) {
    throw new Error('external controller attestation must contain a canonical domain receipt');
  }

  return freezeDeep({
    schema: EXTERNAL_ATTESTATION_PROJECTION_SCHEMA,
    projectId: attestation.projectId,
    sourceKind: attestation.sourceKind,
    sourceRef: attestation.sourceRef,
    sourceDigest: attestation.sourceDigest,
    readOnly: true,
    writeAuthority: 'none',
    domainRepositoryMutationRequired: false,
    receipt: attestation.canonicalReceipt,
  });
}

function enrichGithubObservationWithExternalAttestation(input) {
  plainObject(input, 'external attestation enrichment');
  const allowed = new Set(['observation', 'attestation', 'now', 'freshnessWindowMinutes']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`external attestation enrichment contains unsupported field: ${key}`);
  }

  const projection = projectExternalControllerAttestation({ attestation: input.attestation });
  return enrichGithubObservationWithDomainReceipt({
    observation: input.observation,
    receipt: projection.receipt,
    now: input.now,
    freshnessWindowMinutes: input.freshnessWindowMinutes,
  });
}

module.exports = {
  EXTERNAL_ATTESTATION_PROJECTION_SCHEMA,
  EXTERNAL_ATTESTATION_SCHEMA,
  SOURCE_KINDS,
  createExternalControllerAttestation,
  enrichGithubObservationWithExternalAttestation,
  projectExternalControllerAttestation,
};
