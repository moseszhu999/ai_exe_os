'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RECORD_CLASSES,
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
} = require('../src/sync/envelope/index.cjs');

function envelope(cursor, overrides = {}) {
  return createSyncEnvelope({
    id: `env-${cursor}`,
    workspaceId: 'workspace-a',
    sourceInstanceId: 'source-a',
    cursor,
    schemaVersion: '1',
    recordClass: 'mission.summary',
    recordId: 'mission-a',
    recordRevision: cursor,
    payload: { id: 'mission-a', state: 'running', nested: { safe: true } },
    previousEnvelopeDigest: cursor === 1 ? null : overrides.previousEnvelopeDigest,
    createdAt: `2026-08-08T00:0${cursor}:00.000Z`,
    ...overrides,
  });
}

test('declares a finite collaboration record allowlist', () => {
  assert.ok(RECORD_CLASSES.includes('workspace.summary'));
  assert.ok(RECORD_CLASSES.includes('worker-presence.summary'));
  assert.equal(RECORD_CLASSES.includes('execution.command'), false);
});

test('SyncSourceInstance is stable, opaque and immutable', () => {
  const value = createSyncSourceInstance({ id: 'source-a', instancePublicId: 'public-a', createdAt: '2026-08-08T00:00:00Z' });
  assert.deepEqual(value, {
    id: 'source-a', instancePublicId: 'public-a', status: 'active', createdAt: '2026-08-08T00:00:00.000Z',
  });
  assert.equal(Object.isFrozen(value), true);
  assert.throws(() => createSyncSourceInstance({ id: 'source-a', status: 'unknown', createdAt: '2026-08-08T00:00:00Z' }), /Invalid/);
});

test('collaboration payload recursively rejects forbidden fields and sensitive-looking values', () => {
  assert.deepEqual(assertCollaborationPayload('mission.summary', { id: 'm1', details: { status: 'running' } }), { id: 'm1', details: { status: 'running' } });
  for (const payload of [
    { token: 'secret' },
    { nested: { cookie: 'a=b' } },
    { nested: [{ profilePath: '/private/profile' }] },
    { harmless: 'Bearer abcdefghijklmnopqrstuvwxyz' },
    { harmless: '-----BEGIN PRIVATE KEY-----' },
  ]) {
    assert.throws(() => assertCollaborationPayload('mission.summary', payload), /forbidden|sensitive-looking/);
  }
  assert.throws(() => assertCollaborationPayload('unknown.summary', { id: 'x' }), /unsupported collaboration record class/);
});

test('semantic payload key order produces identical payload and envelope digests when semantic fields match', () => {
  const first = createSyncEnvelope({
    id: 'env-one', workspaceId: 'workspace-a', sourceInstanceId: 'source-a', cursor: 1,
    recordClass: 'mission.summary', recordId: 'mission-a', recordRevision: 1,
    payload: { b: 2, a: 1 }, previousEnvelopeDigest: null, createdAt: '2026-08-08T00:01:00Z',
  });
  const second = createSyncEnvelope({
    id: 'env-one', workspaceId: 'workspace-a', sourceInstanceId: 'source-a', cursor: 1,
    recordClass: 'mission.summary', recordId: 'mission-a', recordRevision: 1,
    payload: { a: 1, b: 2 }, previousEnvelopeDigest: null, createdAt: '2026-08-08T00:01:00Z',
  });
  assert.equal(first.payloadDigest, second.payloadDigest);
  assert.equal(first.envelopeDigest, second.envelopeDigest);
  assert.match(first.envelopeDigest, /^sha256:[a-f0-9]{64}$/);
});

test('cursor one has no predecessor and later cursor requires one', () => {
  assert.throws(() => envelope(1, { previousEnvelopeDigest: `sha256:${'a'.repeat(64)}` }), /cursor 1/);
  assert.throws(() => envelope(2, { previousEnvelopeDigest: null }), /requires previousEnvelopeDigest/);
});

test('append classification accepts exact next cursor and duplicate is idempotent', () => {
  const first = envelope(1);
  const accepted = classifyEnvelopeAppend({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', lastCursor: 0, lastEnvelopeDigest: null, envelope: first });
  assert.equal(accepted.state, 'accepted');
  const duplicate = classifyEnvelopeAppend({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', lastCursor: 1, lastEnvelopeDigest: first.envelopeDigest, existingEnvelope: first, envelope: first });
  assert.equal(duplicate.state, 'duplicate');
  assert.equal(duplicate.reasonCode, 'exact_duplicate');
});

test('envelope id reuse with a new digest is divergent', () => {
  const first = envelope(1);
  const conflict = createSyncEnvelope({ ...first, payload: { id: 'mission-a', state: 'completed' }, payloadDigest: undefined, envelopeDigest: undefined });
  const result = classifyEnvelopeAppend({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', lastCursor: 1, lastEnvelopeDigest: first.envelopeDigest, existingEnvelope: first, envelope: conflict });
  assert.equal(result.state, 'divergent');
  assert.equal(result.reasonCode, 'envelope_id_digest_conflict');
});

test('cursor gaps and previous digest mismatches fail closed', () => {
  const first = envelope(1);
  const third = envelope(3, { previousEnvelopeDigest: first.envelopeDigest });
  const gap = classifyEnvelopeAppend({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', lastCursor: 1, lastEnvelopeDigest: first.envelopeDigest, envelope: third });
  assert.deepEqual(gap, { state: 'gap', reasonCode: 'cursor_gap', cursor: 3, expectedCursor: 2 });
  const secondWrong = envelope(2, { previousEnvelopeDigest: `sha256:${'b'.repeat(64)}` });
  const mismatch = classifyEnvelopeAppend({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', lastCursor: 1, lastEnvelopeDigest: first.envelopeDigest, envelope: secondWrong });
  assert.equal(mismatch.state, 'divergent');
  assert.equal(mismatch.reasonCode, 'previous_digest_mismatch');
});

test('cross-Workspace and unknown source envelopes fail closed', () => {
  const first = envelope(1);
  assert.equal(classifyEnvelopeAppend({ workspaceId: 'workspace-b', sourceInstanceId: 'source-a', envelope: first }).reasonCode, 'cross_workspace');
  assert.equal(classifyEnvelopeAppend({ workspaceId: 'workspace-a', sourceInstanceId: 'source-b', envelope: first }).reasonCode, 'unknown_source');
});

test('SyncCursor advances monotonically and acknowledgement cannot outrun production', () => {
  const empty = createSyncCursor({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', lastProducedCursor: 0, lastAcknowledgedCursor: 0, status: 'current', updatedAt: '2026-08-08T00:00:00Z' });
  const first = envelope(1);
  const produced = advanceSyncCursor({ cursor: empty, envelope: first, observedAt: '2026-08-08T00:01:00Z' });
  assert.equal(produced.lastProducedCursor, 1);
  assert.equal(produced.lastAcknowledgedCursor, 0);
  const acked = acknowledgeCursor({ cursor: produced, envelope: first, state: 'accepted', observedAt: '2026-08-08T00:02:00Z' });
  assert.equal(acked.lastAcknowledgedCursor, 1);
  assert.throws(() => createSyncCursor({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', lastProducedCursor: 1, lastAcknowledgedCursor: 2, lastEnvelopeDigest: first.envelopeDigest, status: 'current', updatedAt: '2026-08-08T00:00:00Z' }), /cannot exceed/);
});

test('SyncAck and SyncDivergence are bounded immutable evidence', () => {
  const ack = createSyncAck({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', cursor: 1, envelopeDigest: `sha256:${'a'.repeat(64)}`, state: 'accepted', observedAt: '2026-08-08T00:00:00Z' });
  assert.equal(Object.isFrozen(ack), true);
  const divergence = createSyncDivergence({ workspaceId: 'workspace-a', sourceInstanceId: 'source-a', cursor: 2, envelopeId: 'env-2', expectedDigest: `sha256:${'a'.repeat(64)}`, observedDigest: `sha256:${'b'.repeat(64)}`, reasonCode: 'digest_mismatch', observedAt: '2026-08-08T00:00:00Z' });
  assert.equal(divergence.reasonCode, 'digest_mismatch');
  assert.equal(Object.isFrozen(divergence), true);
});

test('digest helper is stable across object key order', () => {
  assert.equal(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }));
});
