'use strict';

const { createHash } = require('node:crypto');

const EXECUTION_OPERATION_GRANT_SCHEMA = 'execution.operation-grant.v1';
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,239}$/;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function digest(value) { return `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`; }
function ref(value, label) { if (typeof value !== 'string' || !REF_RE.test(value.trim())) throw new TypeError(`${label} must be an opaque ref`); return value.trim(); }
function sha(value, label) { if (typeof value !== 'string' || !DIGEST_RE.test(value)) throw new TypeError(`${label} must be sha256 digest`); return value; }
function instant(value, label) { if (typeof value !== 'string' || !value.includes('T') || !Number.isFinite(Date.parse(value))) throw new TypeError(`${label} must be ISO instant`); return value; }

function normalizeOperationGrant(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('operation grant must be an object');
  if (value.schema !== EXECUTION_OPERATION_GRANT_SCHEMA) throw new Error('unsupported operation grant schema');
  const issuedAt = instant(value.issuedAt, 'issuedAt');
  const expiresAt = instant(value.expiresAt, 'expiresAt');
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) throw new Error('expiresAt must be after issuedAt');
  if (!Number.isInteger(value.maxUses) || value.maxUses < 1) throw new Error('maxUses must be at least one');
  if (!Number.isInteger(value.uses) || value.uses < 0 || value.uses > value.maxUses) throw new Error('uses is outside maxUses');
  if (!['active', 'revoked', 'expired', 'exhausted'].includes(value.status)) throw new Error('unsupported operation grant status');
  const normalized = {
    schema: EXECUTION_OPERATION_GRANT_SCHEMA,
    grantRef: ref(value.grantRef, 'grantRef'), sourceApprovalRef: ref(value.sourceApprovalRef, 'sourceApprovalRef'), organizationRef: ref(value.organizationRef, 'organizationRef'), actorRef: ref(value.actorRef, 'actorRef'), automationRef: ref(value.automationRef, 'automationRef'), jobRef: ref(value.jobRef, 'jobRef'), operationRef: ref(value.operationRef, 'operationRef'), targetRef: ref(value.targetRef, 'targetRef'),
    commandDigest: sha(value.commandDigest, 'commandDigest'), cwdDigest: sha(value.cwdDigest, 'cwdDigest'), envDigest: sha(value.envDigest, 'envDigest'), configDigest: sha(value.configDigest, 'configDigest'), capabilityDigest: sha(value.capabilityDigest, 'capabilityDigest'), issuedAt, expiresAt, maxUses: value.maxUses, uses: value.uses, status: value.status, revokedAt: value.revokedAt == null ? null : instant(value.revokedAt, 'revokedAt'),
  };
  return Object.freeze(normalized);
}

function createOperationGrant(input) {
  return normalizeOperationGrant({ ...input, schema: EXECUTION_OPERATION_GRANT_SCHEMA, uses: input.uses ?? 0, revokedAt: input.revokedAt ?? null });
}

function assertOperationGrantMatches(grant, invocation) {
  const value = normalizeOperationGrant(grant);
  const fields = ['organizationRef', 'actorRef', 'automationRef', 'jobRef', 'operationRef', 'targetRef', 'commandDigest', 'cwdDigest', 'envDigest', 'configDigest', 'capabilityDigest'];
  for (const field of fields) if (value[field] !== invocation[field]) throw new Error(`grant ${field.replace(/([A-Z])/g, ' $1').toLowerCase()} drift`);
  return Object.freeze({ grantRef: value.grantRef, sourceApprovalRef: value.sourceApprovalRef, useDigest: operationGrantUseDigest(value, invocation) });
}

function operationGrantUseDigest(grant, invocation) { return digest({ grantRef: grant.grantRef, invocation: canonical(invocation) }); }

module.exports = { EXECUTION_OPERATION_GRANT_SCHEMA, createOperationGrant, normalizeOperationGrant, assertOperationGrantMatches, operationGrantUseDigest };
