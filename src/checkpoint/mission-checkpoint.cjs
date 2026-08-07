'use strict';

const { createHash } = require('node:crypto');

function canonicalize(value) {
  if (Array.isArray(value)) {
    const items = value.map(canonicalize);
    if (items.length > 0 && items.every((item) => item && typeof item === 'object' && !Array.isArray(item) && typeof item.id === 'string')) {
      return items.sort((a, b) => a.id.localeCompare(b.id));
    }
    return items;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalDigest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}

function createMissionCheckpoint(input) {
  if (!Number.isInteger(input?.canonicalEventSequence) || input.canonicalEventSequence < 0) throw new TypeError('canonicalEventSequence must be a non-negative integer');
  const projectionState = structuredClone(input?.projectionState || {});
  const projectionDigest = canonicalDigest(projectionState);
  return Object.freeze({
    id: String(input.id), workspaceId: String(input.workspaceId), missionRunId: String(input.missionRunId),
    canonicalEventSequence: input.canonicalEventSequence, projectionDigest,
    readyStepIds: Object.freeze([...(input.readyStepIds || [])].sort()),
    activeAttemptIds: Object.freeze([...(input.activeAttemptIds || [])].sort()),
    recoveryRequiredAttemptIds: Object.freeze([...(input.recoveryRequiredAttemptIds || [])].sort()),
    createdAt: input.createdAt || new Date().toISOString(),
  });
}

function verifyMissionCheckpoint(checkpoint, { canonicalEventSequence, projectionState }) {
  if (!checkpoint) throw new TypeError('checkpoint is required');
  const digest = canonicalDigest(projectionState || {});
  const blockers = [];
  if (checkpoint.canonicalEventSequence !== canonicalEventSequence) blockers.push({ code: 'checkpoint_sequence_mismatch' });
  if (checkpoint.projectionDigest !== digest) blockers.push({ code: 'checkpoint_projection_mismatch' });
  return Object.freeze({ valid: blockers.length === 0, blockers: Object.freeze(blockers), projectionDigest: digest });
}

module.exports = { canonicalDigest, canonicalize, createMissionCheckpoint, verifyMissionCheckpoint };
