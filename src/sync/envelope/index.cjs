'use strict';

const { createHash } = require('node:crypto');
const { assertSafeIdentifier } = require('../../domain/identifiers.cjs');
const { requiredText } = require('../../domain/workspace-model.cjs');

const RECORD_CLASSES = Object.freeze([
  'workspace.summary',
  'mission.summary',
  'plan-step.summary',
  'human-gate.summary',
  'scheduling.summary',
  'github-delivery.summary',
  'provider-observation.summary',
  'evidence.summary',
  'worker-presence.summary',
]);

const FORBIDDEN_KEY = /^(authorization|proxy-authorization|cookie|cookies|set-cookie|password|passwd|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|private[_ -]?key|profilePath|profileDir|profileDirectory|browserProfile|userData|userDataDir|storageState|processId|pid|ppid|body|responseBody|wallet|seed|signingMaterial)$/i;
const SENSITIVE_STRING = /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sessionid|access_token|refresh_token|id_token)=|\b(?:seed phrase|mnemonic)\b)/i;
const MAX_DEPTH = 8;
const MAX_OBJECT_KEYS = 128;
const MAX_ARRAY_ITEMS = 256;
const MAX_STRING_LENGTH = 4096;
const MAX_PAYLOAD_BYTES = 64 * 1024;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')}`;
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

function isoInstant(value, label) {
  const text = requiredText(value, label, 40);
  const time = Date.parse(text);
  if (!Number.isFinite(time)) throw new TypeError(`${label} must be ISO-compatible`);
  return new Date(time).toISOString();
}

function positiveInteger(value, label, { allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < (allowZero ? 0 : 1)) {
    throw new TypeError(`${label} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`);
  }
  return number;
}

function safeClone(value, trail = '$', depth = 0, seen = new Set()) {
  if (depth > MAX_DEPTH) throw new Error(`collaboration payload exceeds maximum depth at ${trail}`);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`non-finite number at ${trail}`);
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) throw new Error(`string too long at ${trail}`);
    if (SENSITIVE_STRING.test(value)) throw new Error(`sensitive-looking value at ${trail}`);
    return value;
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new Error(`unsupported collaboration payload value at ${trail}`);
  }
  if (typeof value !== 'object') throw new Error(`unsupported collaboration payload value at ${trail}`);
  if (seen.has(value)) throw new Error(`circular collaboration payload at ${trail}`);
  seen.add(value);
  let output;
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) throw new Error(`array too large at ${trail}`);
    output = value.map((item, index) => safeClone(item, `${trail}[${index}]`, depth + 1, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error(`non-plain object at ${trail}`);
    const entries = Object.entries(value);
    if (entries.length > MAX_OBJECT_KEYS) throw new Error(`object too large at ${trail}`);
    output = {};
    for (const [key, nested] of entries) {
      if (FORBIDDEN_KEY.test(key)) throw new Error(`forbidden collaboration field ${trail}.${key}`);
      output[key] = safeClone(nested, `${trail}.${key}`, depth + 1, seen);
    }
  }
  seen.delete(value);
  return output;
}

function assertCollaborationPayload(recordClass, payload) {
  if (!RECORD_CLASSES.includes(recordClass)) throw new Error(`unsupported collaboration record class: ${recordClass}`);
  const safe = safeClone(payload);
  const bytes = Buffer.byteLength(JSON.stringify(stableValue(safe)), 'utf8');
  if (bytes > MAX_PAYLOAD_BYTES) throw new Error(`collaboration payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
  return freezeDeep(safe);
}

function createSyncSourceInstance(input) {
  const status = input?.status || 'active';
  if (!['active', 'retired'].includes(status)) throw new Error('Invalid SyncSourceInstance status');
  return freezeDeep({
    id: assertSafeIdentifier(input?.id, 'sync source instance id'),
    instancePublicId: assertSafeIdentifier(input?.instancePublicId || input?.id, 'sync source public id'),
    status,
    createdAt: isoInstant(input?.createdAt || new Date().toISOString(), 'sync source createdAt'),
  });
}

function createSyncEnvelope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('SyncEnvelope input is required');
  const cursor = positiveInteger(input.cursor, 'SyncEnvelope cursor');
  const previousEnvelopeDigest = input.previousEnvelopeDigest == null ? null : requiredText(input.previousEnvelopeDigest, 'previousEnvelopeDigest', 100);
  if (cursor === 1 && previousEnvelopeDigest !== null) throw new Error('cursor 1 must not have previousEnvelopeDigest');
  if (cursor > 1 && previousEnvelopeDigest === null) throw new Error('cursor > 1 requires previousEnvelopeDigest');
  const recordClass = requiredText(input.recordClass, 'recordClass', 80);
  const payload = assertCollaborationPayload(recordClass, input.payload);
  const payloadDigest = digest(payload);
  const base = {
    id: assertSafeIdentifier(input.id, 'sync envelope id'),
    workspaceId: assertSafeIdentifier(input.workspaceId, 'workspace id'),
    sourceInstanceId: assertSafeIdentifier(input.sourceInstanceId, 'source instance id'),
    cursor,
    schemaVersion: requiredText(input.schemaVersion || '1', 'sync schema version', 40),
    recordClass,
    recordId: assertSafeIdentifier(input.recordId, 'sync record id'),
    recordRevision: positiveInteger(input.recordRevision ?? 1, 'sync record revision'),
    payload,
    payloadDigest,
    previousEnvelopeDigest,
    createdAt: isoInstant(input.createdAt || new Date().toISOString(), 'sync envelope createdAt'),
  };
  return freezeDeep({ ...base, envelopeDigest: digest(base) });
}

function createSyncCursor(input) {
  const status = input?.status || 'current';
  if (!['current', 'stale', 'gap', 'divergent', 'unavailable'].includes(status)) throw new Error('Invalid SyncCursor status');
  const produced = positiveInteger(input?.lastProducedCursor ?? 0, 'lastProducedCursor', { allowZero: true });
  const acknowledged = positiveInteger(input?.lastAcknowledgedCursor ?? 0, 'lastAcknowledgedCursor', { allowZero: true });
  if (acknowledged > produced) throw new Error('acknowledged cursor cannot exceed produced cursor');
  const lastEnvelopeDigest = input?.lastEnvelopeDigest == null ? null : requiredText(input.lastEnvelopeDigest, 'lastEnvelopeDigest', 100);
  if (produced === 0 && lastEnvelopeDigest !== null) throw new Error('empty cursor cannot have lastEnvelopeDigest');
  if (produced > 0 && lastEnvelopeDigest === null) throw new Error('produced cursor requires lastEnvelopeDigest');
  return freezeDeep({
    workspaceId: assertSafeIdentifier(input.workspaceId, 'workspace id'),
    sourceInstanceId: assertSafeIdentifier(input.sourceInstanceId, 'source instance id'),
    lastProducedCursor: produced,
    lastAcknowledgedCursor: acknowledged,
    lastEnvelopeDigest,
    status,
    updatedAt: isoInstant(input.updatedAt || new Date().toISOString(), 'sync cursor updatedAt'),
  });
}

function classifyEnvelopeAppend({ workspaceId, sourceInstanceId, lastCursor = 0, lastEnvelopeDigest = null, existingEnvelope = null, envelope }) {
  if (!envelope || typeof envelope !== 'object') throw new TypeError('envelope is required');
  if (envelope.workspaceId !== workspaceId) return freezeDeep({ state: 'rejected', reasonCode: 'cross_workspace' });
  if (envelope.sourceInstanceId !== sourceInstanceId) return freezeDeep({ state: 'rejected', reasonCode: 'unknown_source' });
  if (existingEnvelope) {
    if (existingEnvelope.id !== envelope.id) throw new Error('existingEnvelope id mismatch');
    if (existingEnvelope.envelopeDigest === envelope.envelopeDigest) {
      return freezeDeep({ state: 'duplicate', reasonCode: 'exact_duplicate', cursor: envelope.cursor, envelopeDigest: envelope.envelopeDigest });
    }
    return freezeDeep({ state: 'divergent', reasonCode: 'envelope_id_digest_conflict', cursor: envelope.cursor });
  }
  if (envelope.cursor <= lastCursor) return freezeDeep({ state: 'divergent', reasonCode: 'cursor_reuse_or_regression', cursor: envelope.cursor, expectedCursor: lastCursor + 1 });
  if (envelope.cursor > lastCursor + 1) return freezeDeep({ state: 'gap', reasonCode: 'cursor_gap', cursor: envelope.cursor, expectedCursor: lastCursor + 1 });
  if (lastCursor === 0) {
    if (envelope.previousEnvelopeDigest !== null) return freezeDeep({ state: 'divergent', reasonCode: 'unexpected_previous_digest', cursor: envelope.cursor });
  } else if (envelope.previousEnvelopeDigest !== lastEnvelopeDigest) {
    return freezeDeep({ state: 'divergent', reasonCode: 'previous_digest_mismatch', cursor: envelope.cursor, expectedPreviousDigest: lastEnvelopeDigest });
  }
  return freezeDeep({ state: 'accepted', reasonCode: 'append_current', cursor: envelope.cursor, envelopeDigest: envelope.envelopeDigest });
}

function advanceSyncCursor({ cursor, envelope, acknowledged = false, observedAt }) {
  const result = classifyEnvelopeAppend({
    workspaceId: cursor.workspaceId,
    sourceInstanceId: cursor.sourceInstanceId,
    lastCursor: cursor.lastProducedCursor,
    lastEnvelopeDigest: cursor.lastEnvelopeDigest,
    envelope,
  });
  if (result.state !== 'accepted') throw new Error(`cannot advance cursor: ${result.reasonCode}`);
  return createSyncCursor({
    workspaceId: cursor.workspaceId,
    sourceInstanceId: cursor.sourceInstanceId,
    lastProducedCursor: envelope.cursor,
    lastAcknowledgedCursor: acknowledged ? envelope.cursor : cursor.lastAcknowledgedCursor,
    lastEnvelopeDigest: envelope.envelopeDigest,
    status: 'current',
    updatedAt: observedAt || new Date().toISOString(),
  });
}

function acknowledgeCursor({ cursor, envelope, state = 'accepted', observedAt }) {
  if (!['accepted', 'duplicate'].includes(state)) throw new Error('only accepted/duplicate envelopes may advance acknowledgement');
  if (envelope.workspaceId !== cursor.workspaceId || envelope.sourceInstanceId !== cursor.sourceInstanceId) throw new Error('acknowledgement scope mismatch');
  if (envelope.cursor > cursor.lastProducedCursor) throw new Error('cannot acknowledge unproduced cursor');
  if (envelope.cursor < cursor.lastAcknowledgedCursor) throw new Error('acknowledgement cursor regression');
  return createSyncCursor({
    ...cursor,
    lastAcknowledgedCursor: envelope.cursor,
    updatedAt: observedAt || new Date().toISOString(),
  });
}

function createSyncAck(input) {
  const state = input?.state;
  if (!['accepted', 'duplicate', 'rejected', 'divergent'].includes(state)) throw new Error('Invalid SyncAck state');
  return freezeDeep({
    workspaceId: assertSafeIdentifier(input.workspaceId, 'workspace id'),
    sourceInstanceId: assertSafeIdentifier(input.sourceInstanceId, 'source instance id'),
    cursor: positiveInteger(input.cursor, 'sync ack cursor'),
    envelopeDigest: requiredText(input.envelopeDigest, 'sync ack envelopeDigest', 100),
    state,
    reasonCode: input.reasonCode == null ? null : assertSafeIdentifier(input.reasonCode, 'sync ack reason code'),
    observedAt: isoInstant(input.observedAt || new Date().toISOString(), 'sync ack observedAt'),
  });
}

function createSyncDivergence(input) {
  return freezeDeep({
    workspaceId: assertSafeIdentifier(input.workspaceId, 'workspace id'),
    sourceInstanceId: assertSafeIdentifier(input.sourceInstanceId, 'source instance id'),
    cursor: positiveInteger(input.cursor, 'sync divergence cursor'),
    envelopeId: assertSafeIdentifier(input.envelopeId, 'sync envelope id'),
    expectedDigest: input.expectedDigest == null ? null : requiredText(input.expectedDigest, 'expectedDigest', 100),
    observedDigest: input.observedDigest == null ? null : requiredText(input.observedDigest, 'observedDigest', 100),
    reasonCode: assertSafeIdentifier(input.reasonCode, 'sync divergence reason code'),
    observedAt: isoInstant(input.observedAt || new Date().toISOString(), 'sync divergence observedAt'),
  });
}

module.exports = {
  FORBIDDEN_KEY,
  MAX_PAYLOAD_BYTES,
  RECORD_CLASSES,
  SENSITIVE_STRING,
  acknowledgeCursor,
  advanceSyncCursor,
  assertCollaborationPayload,
  classifyEnvelopeAppend,
  createSyncAck,
  createSyncCursor,
  createSyncDivergence,
  createSyncEnvelope,
  createSyncSourceInstance,
  digest,
  safeClone,
  stableValue,
};
