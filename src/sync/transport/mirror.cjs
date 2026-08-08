'use strict';

const { assertSafeIdentifier } = require('../../domain/identifiers.cjs');

const DEFAULT_RECORD_CLASSES = new Set([
  'workspace.summary', 'mission.summary', 'plan-step.summary', 'human-gate.summary',
  'scheduling.summary', 'github-delivery.summary', 'provider-observation.summary',
  'evidence.summary', 'worker-presence.summary',
]);
const MAX_REQUEST_BYTES = 128 * 1024;

function json(response, statusCode, body) {
  const encoded = Buffer.from(`${JSON.stringify(body)}\n`, 'utf8');
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': encoded.byteLength,
    'cache-control': 'no-store',
  });
  response.end(encoded);
}

function sourceKey(workspaceId, sourceInstanceId) { return `${workspaceId}:${sourceInstanceId}`; }
function recordKey(recordClass, recordId) { return `${recordClass}:${recordId}`; }

class ProjectOwnedSyncMirror {
  constructor({ allowedRecordClasses = DEFAULT_RECORD_CLASSES } = {}) {
    this.allowedRecordClasses = new Set(allowedRecordClasses);
    this.sources = new Map();
    this.recordsByWorkspace = new Map();
  }

  registerSource({ workspaceId, sourceInstanceId }) {
    const workspace = assertSafeIdentifier(workspaceId, 'workspace id');
    const source = assertSafeIdentifier(sourceInstanceId, 'source instance id');
    const key = sourceKey(workspace, source);
    if (!this.sources.has(key)) this.sources.set(key, { workspaceId: workspace, sourceInstanceId: source, lastCursor: 0, lastEnvelopeDigest: null, envelopesById: new Map() });
    return Object.freeze({ workspaceId: workspace, sourceInstanceId: source, registered: true });
  }

  requireSource(workspaceId, sourceInstanceId) {
    const state = this.sources.get(sourceKey(workspaceId, sourceInstanceId));
    if (!state) throw Object.assign(new Error('unknown_source'), { statusCode: 403, reasonCode: 'unknown_source' });
    return state;
  }

  appendEnvelopes({ workspaceId, sourceInstanceId, envelopes }) {
    const workspace = assertSafeIdentifier(workspaceId, 'workspace id');
    const source = assertSafeIdentifier(sourceInstanceId, 'source instance id');
    if (!Array.isArray(envelopes) || envelopes.length < 1) throw Object.assign(new Error('invalid_envelopes'), { statusCode: 400, reasonCode: 'invalid_envelopes' });
    const state = this.requireSource(workspace, source);
    const acks = [];
    for (const envelope of envelopes) {
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw Object.assign(new Error('invalid_envelope'), { statusCode: 400, reasonCode: 'invalid_envelope' });
      if (envelope.workspaceId !== workspace) throw Object.assign(new Error('cross_workspace'), { statusCode: 409, reasonCode: 'cross_workspace' });
      if (envelope.sourceInstanceId !== source) throw Object.assign(new Error('unknown_source'), { statusCode: 409, reasonCode: 'unknown_source' });
      if (!this.allowedRecordClasses.has(envelope.recordClass)) throw Object.assign(new Error('unsupported_record_class'), { statusCode: 400, reasonCode: 'unsupported_record_class' });
      if (typeof envelope.envelopeDigest !== 'string' || !envelope.envelopeDigest.startsWith('sha256:')) throw Object.assign(new Error('invalid_envelope_digest'), { statusCode: 400, reasonCode: 'invalid_envelope_digest' });
      const existing = state.envelopesById.get(envelope.id);
      if (existing) {
        if (existing.envelopeDigest !== envelope.envelopeDigest) throw Object.assign(new Error('envelope_id_digest_conflict'), { statusCode: 409, reasonCode: 'envelope_id_digest_conflict' });
        acks.push({ cursor: existing.cursor, envelopeDigest: existing.envelopeDigest, state: 'duplicate', reasonCode: 'exact_duplicate' });
        continue;
      }
      const expectedCursor = state.lastCursor + 1;
      if (!Number.isInteger(envelope.cursor) || envelope.cursor !== expectedCursor) {
        const reasonCode = envelope.cursor > expectedCursor ? 'cursor_gap' : 'cursor_reuse_or_regression';
        throw Object.assign(new Error(reasonCode), { statusCode: 409, reasonCode, expectedCursor });
      }
      if (state.lastCursor === 0) {
        if (envelope.previousEnvelopeDigest != null) throw Object.assign(new Error('unexpected_previous_digest'), { statusCode: 409, reasonCode: 'unexpected_previous_digest' });
      } else if (envelope.previousEnvelopeDigest !== state.lastEnvelopeDigest) {
        throw Object.assign(new Error('previous_digest_mismatch'), { statusCode: 409, reasonCode: 'previous_digest_mismatch' });
      }
      const stored = Object.freeze(JSON.parse(JSON.stringify(envelope)));
      state.envelopesById.set(stored.id, stored);
      state.lastCursor = stored.cursor;
      state.lastEnvelopeDigest = stored.envelopeDigest;
      const workspaceRecords = this.recordsByWorkspace.get(workspace) || new Map();
      const perSource = workspaceRecords.get(source) || new Map();
      const key = recordKey(stored.recordClass, stored.recordId);
      const previous = perSource.get(key);
      if (!previous || Number(stored.recordRevision) > Number(previous.recordRevision)) perSource.set(key, stored);
      workspaceRecords.set(source, perSource);
      this.recordsByWorkspace.set(workspace, workspaceRecords);
      acks.push({ cursor: stored.cursor, envelopeDigest: stored.envelopeDigest, state: 'accepted', reasonCode: 'append_current' });
    }
    return Object.freeze({ workspaceId: workspace, sourceInstanceId: source, lastCursor: state.lastCursor, lastEnvelopeDigest: state.lastEnvelopeDigest, acks: Object.freeze(acks) });
  }

  readCursor({ workspaceId, sourceInstanceId }) {
    const state = this.requireSource(workspaceId, sourceInstanceId);
    return Object.freeze({ workspaceId: state.workspaceId, sourceInstanceId: state.sourceInstanceId, lastCursor: state.lastCursor, lastEnvelopeDigest: state.lastEnvelopeDigest });
  }

  readMirror({ workspaceId, sinceCursor = 0 }) {
    const workspace = assertSafeIdentifier(workspaceId, 'workspace id');
    const cursor = Number(sinceCursor);
    if (!Number.isInteger(cursor) || cursor < 0) throw Object.assign(new Error('invalid_since_cursor'), { statusCode: 400, reasonCode: 'invalid_since_cursor' });
    const workspaceRecords = this.recordsByWorkspace.get(workspace) || new Map();
    const sources = [];
    for (const [sourceInstanceId, records] of workspaceRecords.entries()) {
      const sourceState = this.sources.get(sourceKey(workspace, sourceInstanceId));
      const visible = [...records.values()].filter((envelope) => envelope.cursor > cursor).map((envelope) => ({
        workspaceId: envelope.workspaceId,
        sourceInstanceId: envelope.sourceInstanceId,
        cursor: envelope.cursor,
        recordClass: envelope.recordClass,
        recordId: envelope.recordId,
        recordRevision: envelope.recordRevision,
        payload: envelope.payload,
        payloadDigest: envelope.payloadDigest,
        envelopeDigest: envelope.envelopeDigest,
        createdAt: envelope.createdAt,
      }));
      sources.push({ sourceInstanceId, lastCursor: sourceState?.lastCursor || 0, records: visible });
    }
    return Object.freeze({ workspaceId: workspace, sinceCursor: cursor, sources: Object.freeze(sources) });
  }
}

async function readRequestJson(request, maxBytes = MAX_REQUEST_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error('request_too_large'), { statusCode: 413, reasonCode: 'request_too_large' });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('invalid_json'), { statusCode: 400, reasonCode: 'invalid_json' }); }
}

function createMirrorRequestHandler(mirror, { basePath = '/v1/sync/' } = {}) {
  if (!mirror || typeof mirror.appendEnvelopes !== 'function') throw new TypeError('ProjectOwnedSyncMirror is required');
  const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
  return async function syncMirrorHandler(request, response) {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (!url.pathname.startsWith(normalizedBase)) return json(response, 404, { error: 'not_found' });
      const operation = url.pathname.slice(normalizedBase.length);
      if (operation === 'append') {
        if (request.method !== 'POST') return json(response, 405, { error: 'method_not_allowed' });
        const type = String(request.headers['content-type'] || '').toLowerCase();
        if (!type.startsWith('application/json')) return json(response, 415, { error: 'json_required' });
        const body = await readRequestJson(request);
        return json(response, 200, mirror.appendEnvelopes(body));
      }
      if (operation === 'cursor') {
        if (request.method !== 'GET') return json(response, 405, { error: 'method_not_allowed' });
        return json(response, 200, mirror.readCursor({ workspaceId: url.searchParams.get('workspaceId'), sourceInstanceId: url.searchParams.get('sourceInstanceId') }));
      }
      if (operation === 'mirror') {
        if (request.method !== 'GET') return json(response, 405, { error: 'method_not_allowed' });
        return json(response, 200, mirror.readMirror({ workspaceId: url.searchParams.get('workspaceId'), sinceCursor: Number(url.searchParams.get('sinceCursor') || 0) }));
      }
      return json(response, 404, { error: 'not_found' });
    } catch (error) {
      return json(response, error.statusCode || 500, { error: error.reasonCode || 'sync_mirror_error', reasonCode: error.reasonCode || 'sync_mirror_error' });
    }
  };
}

module.exports = {
  DEFAULT_RECORD_CLASSES,
  MAX_REQUEST_BYTES,
  ProjectOwnedSyncMirror,
  createMirrorRequestHandler,
  readRequestJson,
};
