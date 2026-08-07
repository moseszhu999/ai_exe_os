'use strict';

const { createHash } = require('node:crypto');
const { assertSafeIdentifier, assertSafeGitHubName } = require('./identifiers.cjs');
const { deepFreeze } = require('./workspace-model.cjs');

function semanticDigest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function createRepositoryRegistration(input) {
  const record = {
    id: assertSafeIdentifier(input?.id, 'repository registration id'),
    workspaceId: assertSafeIdentifier(input?.workspaceId, 'workspace id'),
    provider: 'github',
    owner: assertSafeGitHubName(input?.owner, 'GitHub owner'),
    repository: assertSafeGitHubName(input?.repository, 'GitHub repository'),
    visibilityHint: input?.visibilityHint === undefined ? null : normalizeVisibility(input.visibilityHint),
    status: 'active',
    createdAt: input?.createdAt || new Date().toISOString(),
  };
  return deepFreeze({ ...record, semanticDigest: registrationDigest(record) });
}

function normalizeVisibility(value) {
  if (!['public', 'private', 'unknown'].includes(value)) throw new TypeError('visibilityHint must be public, private, or unknown');
  return value;
}

function registrationDigest(record) {
  return semanticDigest({
    workspaceId: record.workspaceId,
    provider: 'github',
    owner: record.owner,
    repository: record.repository,
  });
}

function assertRepositoryRegistrationSemanticMatch(existing, candidate) {
  if (!existing) return candidate;
  if (existing.semanticDigest !== candidate.semanticDigest) {
    throw new Error(`Repository registration idempotency collision: ${candidate.id}`);
  }
  return existing;
}

function archiveRepositoryRegistration(registration, occurredAt = new Date().toISOString()) {
  assertRepositoryRegistration(registration);
  if (registration.status === 'archived') return registration;
  return deepFreeze({ ...registration, status: 'archived', archivedAt: occurredAt });
}

function assertRepositoryRegistration(registration) {
  if (!registration || typeof registration !== 'object') throw new TypeError('repository registration is required');
  assertSafeIdentifier(registration.id, 'repository registration id');
  assertSafeIdentifier(registration.workspaceId, 'workspace id');
  assertSafeGitHubName(registration.owner, 'GitHub owner');
  assertSafeGitHubName(registration.repository, 'GitHub repository');
  if (!['active', 'archived'].includes(registration.status)) throw new Error('Unsupported repository registration status');
  return registration;
}

function createRepositoryBinding(input) {
  const workspaceId = assertSafeIdentifier(input?.workspaceId, 'workspace id');
  const registrationId = assertSafeIdentifier(input?.repositoryRegistrationId, 'repository registration id');
  const missionRunId = input?.missionRunId ? assertSafeIdentifier(input.missionRunId, 'mission run id') : null;
  const planStepId = input?.planStepId ? assertSafeIdentifier(input.planStepId, 'plan step id') : null;
  if (!missionRunId && !planStepId) throw new TypeError('repository binding requires missionRunId or planStepId');
  return deepFreeze({
    id: assertSafeIdentifier(input?.id, 'repository binding id'),
    workspaceId,
    repositoryRegistrationId: registrationId,
    missionRunId,
    planStepId,
    createdAt: input?.createdAt || new Date().toISOString(),
  });
}

function assertRepositoryWorkspace(expectedWorkspaceId, ...records) {
  const expected = assertSafeIdentifier(expectedWorkspaceId, 'workspace id');
  for (const record of records) {
    if (!record || record.workspaceId !== expected) throw new Error('Cross-Workspace GitHub repository reference denied');
  }
  return expected;
}

module.exports = {
  archiveRepositoryRegistration,
  assertRepositoryRegistration,
  assertRepositoryRegistrationSemanticMatch,
  assertRepositoryWorkspace,
  createRepositoryBinding,
  createRepositoryRegistration,
  registrationDigest,
};
