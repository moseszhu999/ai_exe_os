'use strict';

const { createHash } = require('node:crypto');
const { assertSafeIdentifier } = require('./identifiers.cjs');
const { deepFreeze, requiredText } = require('./workspace-model.cjs');

const RUN_STATES = new Set([
  'created', 'running', 'paused', 'waiting_human', 'blocked',
  'recovery_required', 'completed', 'cancelled', 'failed',
]);

const RUN_TRANSITIONS = Object.freeze({
  created: new Set(['running', 'cancelled']),
  running: new Set(['paused', 'waiting_human', 'blocked', 'recovery_required', 'completed', 'cancelled', 'failed']),
  paused: new Set(['running', 'cancelled']),
  waiting_human: new Set(['running', 'recovery_required', 'cancelled', 'failed']),
  blocked: new Set(['running', 'paused', 'cancelled', 'failed']),
  recovery_required: new Set(['running', 'cancelled', 'failed']),
  completed: new Set(),
  cancelled: new Set(),
  failed: new Set(),
});

function digestRevision({ workspaceId, missionId, revision, objective, planId }) {
  return `sha256:${createHash('sha256').update(JSON.stringify({ workspaceId, missionId, revision, objective, planId })).digest('hex')}`;
}

function createMission(input) {
  return deepFreeze({
    id: assertSafeIdentifier(input?.id, 'mission id'),
    workspaceId: assertSafeIdentifier(input?.workspaceId, 'workspace id'),
    title: requiredText(input?.title, 'mission title'),
    status: 'draft',
    currentRevisionId: input?.currentRevisionId || null,
    createdAt: input?.createdAt || new Date().toISOString(),
    updatedAt: input?.updatedAt || input?.createdAt || new Date().toISOString(),
  });
}

function createMissionRevision(input) {
  const revision = input?.revision;
  if (!Number.isInteger(revision) || revision < 1) throw new TypeError('mission revision must be a positive integer');
  const record = {
    id: assertSafeIdentifier(input?.id, 'mission revision id'),
    missionId: assertSafeIdentifier(input?.missionId, 'mission id'),
    workspaceId: assertSafeIdentifier(input?.workspaceId, 'workspace id'),
    revision,
    objective: requiredText(input?.objective, 'mission objective', 2000),
    planId: assertSafeIdentifier(input?.planId, 'execution plan id'),
    createdAt: input?.createdAt || new Date().toISOString(),
    frozenAt: null,
  };
  return deepFreeze({ ...record, contentDigest: digestRevision(record) });
}

function freezeMissionRevision(revision, occurredAt = new Date().toISOString()) {
  if (!revision || typeof revision !== 'object') throw new TypeError('mission revision is required');
  if (revision.frozenAt) return revision;
  return deepFreeze({ ...revision, frozenAt: occurredAt });
}

function assertRevisionSemanticMatch(existing, candidate) {
  if (!existing) return candidate;
  const existingDigest = existing.contentDigest || digestRevision(existing);
  const candidateDigest = candidate.contentDigest || digestRevision(candidate);
  if (existingDigest !== candidateDigest) throw new Error(`Mission revision idempotency collision: ${existing.id}`);
  return existing;
}

function createMissionRun(input) {
  return deepFreeze({
    id: assertSafeIdentifier(input?.id, 'mission run id'),
    workspaceId: assertSafeIdentifier(input?.workspaceId, 'workspace id'),
    missionId: assertSafeIdentifier(input?.missionId, 'mission id'),
    missionRevisionId: assertSafeIdentifier(input?.missionRevisionId, 'mission revision id'),
    planId: assertSafeIdentifier(input?.planId, 'execution plan id'),
    state: 'created',
    version: 0,
    lastReason: 'created',
    createdAt: input?.createdAt || new Date().toISOString(),
    updatedAt: input?.createdAt || new Date().toISOString(),
  });
}

function transitionMissionRun(run, nextState, reason, occurredAt = new Date().toISOString()) {
  if (!run || typeof run !== 'object' || !RUN_STATES.has(run.state)) throw new TypeError('valid mission run is required');
  if (!RUN_STATES.has(nextState)) throw new Error(`Unsupported mission run state: ${nextState}`);
  if (run.state === nextState) return run;
  if (!RUN_TRANSITIONS[run.state]?.has(nextState)) throw new Error(`Invalid S2 mission transition: ${run.state} -> ${nextState}`);
  return deepFreeze({
    ...run,
    state: nextState,
    version: (run.version || 0) + 1,
    lastReason: requiredText(reason, 'mission transition reason', 200),
    updatedAt: occurredAt,
  });
}

module.exports = {
  assertRevisionSemanticMatch,
  createMission,
  createMissionRevision,
  createMissionRun,
  freezeMissionRevision,
  transitionMissionRun,
};
