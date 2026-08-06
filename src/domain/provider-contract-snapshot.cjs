'use strict';

const { createHash } = require('node:crypto');
const { assertSafeIdentifier } = require('./identifiers.cjs');
const { deepFreeze, requiredText } = require('./workspace-model.cjs');

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function normalizeActions(values, label) {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  const result = values.map((value) => assertSafeIdentifier(value, label));
  if (new Set(result).size !== result.length) throw new Error(`${label} must be unique`);
  return result.sort();
}

function createProviderContractSnapshot(input) {
  const status = input?.status;
  if (!['accepted', 'blocked'].includes(status)) throw new Error('Provider contract status must be accepted or blocked');
  const reviewedAt = requiredText(input?.reviewedAt, 'reviewedAt', 40);
  const expiresAt = requiredText(input?.expiresAt, 'expiresAt', 40);
  if (!Number.isFinite(Date.parse(reviewedAt)) || !Number.isFinite(Date.parse(expiresAt))) {
    throw new Error('Provider contract dates must be ISO-compatible');
  }
  const snapshot = {
    contractId: assertSafeIdentifier(input?.contractId, 'provider contract id'),
    providerId: assertSafeIdentifier(input?.providerId, 'provider id'),
    surfaceId: assertSafeIdentifier(input?.surfaceId, 'provider surface id'),
    status,
    reviewedAt,
    expiresAt,
    governingTermsDigest: requiredText(input?.governingTermsDigest, 'governing terms digest', 100),
    permittedActions: normalizeActions(input?.permittedActions || [], 'permitted action'),
    prohibitedActions: normalizeActions(input?.prohibitedActions || [], 'prohibited action'),
  };
  const canonical = JSON.stringify(stableValue(snapshot));
  return deepFreeze({ ...snapshot, snapshotDigest: `sha256:${createHash('sha256').update(canonical).digest('hex')}` });
}

function assertProviderSnapshotAllows({ snapshot, action, now = new Date() }) {
  if (!snapshot || snapshot.status !== 'accepted') throw new Error('Provider contract is unknown or blocked');
  const normalizedAction = assertSafeIdentifier(action, 'provider action');
  if (Date.parse(snapshot.expiresAt) <= now.getTime()) throw new Error('Provider contract changed or expired');
  if (snapshot.prohibitedActions.includes(normalizedAction)) throw new Error('Provider action is prohibited');
  if (!snapshot.permittedActions.includes(normalizedAction)) throw new Error('Provider action is not permitted');
  return true;
}

module.exports = { assertProviderSnapshotAllows, createProviderContractSnapshot };
