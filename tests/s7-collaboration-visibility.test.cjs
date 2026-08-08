'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TEAM_ROLES,
  accessDecision,
  assertNoAuthorityShape,
  createRemoteWorkerPresence,
  createSharedWorkspaceSnapshot,
  createTeamRole,
  createWorkspaceMembership,
  projectRecordForMembership,
} = require('../src/sync/collaboration/index.cjs');

function membership(role = 'owner-view', overrides = {}) {
  return createWorkspaceMembership({
    id: `membership-${role}`,
    workspaceId: 'workspace-a',
    subjectId: 'subject-a',
    teamRoleId: role,
    status: 'active',
    createdAt: '2026-08-08T00:00:00Z',
    ...overrides,
  });
}

test('TeamRole is a fixed visibility-only contract', () => {
  assert.deepEqual(TEAM_ROLES, ['owner-view', 'operator-view', 'reviewer-view', 'observer-view']);
  const role = createTeamRole({ id: 'operator-view' });
  assert.equal(role.visibilityOnly, true);
  assert.ok(role.recordClasses.includes('worker-presence.summary'));
  assert.throws(() => createTeamRole({ id: 'remote-admin' }), /Unsupported TeamRole/);
});

test('membership is Workspace-scoped and revoked/suspended access fails closed', () => {
  assert.equal(accessDecision({ membership: null, workspaceId: 'workspace-a', recordClass: 'mission.summary' }).reasonCode, 'membership_missing');
  assert.equal(accessDecision({ membership: membership(), workspaceId: 'workspace-b', recordClass: 'mission.summary' }).reasonCode, 'cross_workspace_membership');
  assert.equal(accessDecision({ membership: membership('owner-view', { status: 'revoked' }), workspaceId: 'workspace-a', recordClass: 'mission.summary' }).reasonCode, 'membership_revoked');
  assert.equal(accessDecision({ membership: membership('owner-view', { status: 'suspended' }), workspaceId: 'workspace-a', recordClass: 'mission.summary' }).reasonCode, 'membership_suspended');
});

test('observer and reviewer roles expose only declared record classes', () => {
  assert.equal(accessDecision({ membership: membership('observer-view'), workspaceId: 'workspace-a', recordClass: 'mission.summary' }).allowed, true);
  assert.equal(accessDecision({ membership: membership('observer-view'), workspaceId: 'workspace-a', recordClass: 'worker-presence.summary' }).reasonCode, 'record_class_hidden');
  assert.equal(accessDecision({ membership: membership('reviewer-view'), workspaceId: 'workspace-a', recordClass: 'human-gate.summary' }).allowed, true);
  assert.equal(accessDecision({ membership: membership('reviewer-view'), workspaceId: 'workspace-a', recordClass: 'provider-observation.summary' }).reasonCode, 'record_class_hidden');
});

test('field projection trims collaboration-safe payload by TeamRole', () => {
  const payload = {
    id: 'mission-a', title: 'Mission A', status: 'running', revision: 2, runId: 'run-a', updatedAt: '2026-08-08T00:00:00Z', extraInternal: 'must-not-cross',
  };
  const owner = projectRecordForMembership({ membership: membership('owner-view'), workspaceId: 'workspace-a', recordClass: 'mission.summary', payload });
  const observer = projectRecordForMembership({ membership: membership('observer-view'), workspaceId: 'workspace-a', recordClass: 'mission.summary', payload });
  assert.deepEqual(owner.payload, {
    id: 'mission-a', title: 'Mission A', status: 'running', revision: 2, runId: 'run-a', updatedAt: '2026-08-08T00:00:00Z',
  });
  assert.deepEqual(observer.payload, { id: 'mission-a', title: 'Mission A', status: 'running', updatedAt: '2026-08-08T00:00:00Z' });
  assert.equal('extraInternal' in owner.payload, false);
});

test('reviewer sees HumanGate status but no command authority fields', () => {
  const projected = projectRecordForMembership({
    membership: membership('reviewer-view'), workspaceId: 'workspace-a', recordClass: 'human-gate.summary',
    payload: { id: 'gate-a', missionId: 'mission-a', stepId: 'step-a', state: 'requested', reasonCode: 'external_write', requestedAt: '2026-08-08T00:00:00Z' },
  });
  assert.equal(projected.found, true);
  assert.equal(projected.payload.state, 'requested');
  assert.throws(() => projectRecordForMembership({
    membership: membership('reviewer-view'), workspaceId: 'workspace-a', recordClass: 'human-gate.summary',
    payload: { id: 'gate-a', state: 'requested', approve: true },
  }), /execution-authority-shaped/);
});

test('mirror payload rejects execution-control and forbidden runtime fields recursively', () => {
  for (const value of [
    { start: true },
    { nested: { retry: true } },
    { nested: [{ controlHandle: 'remote-handle' }] },
    { profilePath: '/private/profile' },
    { processId: 123 },
  ]) assert.throws(() => assertNoAuthorityShape(value), /authority-shaped|forbidden mirror/);
});

test('SharedWorkspaceSnapshot requires active exact-Workspace membership and filters hidden classes', () => {
  const records = [
    { recordClass: 'workspace.summary', recordId: 'workspace-a', recordRevision: 1, payload: { id: 'workspace-a', name: 'A', status: 'active', projectId: 'project-a', updatedAt: '2026-08-08T00:00:00Z' } },
    { recordClass: 'mission.summary', recordId: 'mission-a', recordRevision: 2, payload: { id: 'mission-a', title: 'M', status: 'running', revision: 2, updatedAt: '2026-08-08T00:00:00Z' } },
    { recordClass: 'worker-presence.summary', recordId: 'worker-a', recordRevision: 1, payload: { workerPublicId: 'worker-a', workspaceId: 'workspace-a', statusClass: 'available', browserChannelClass: 'chrome', role: 'implementation', observedAt: '2026-08-08T00:00:00Z' } },
  ];
  const observer = createSharedWorkspaceSnapshot({ workspaceId: 'workspace-a', remoteSourceInstanceId: 'source-b', syncCursor: 3, syncStatus: 'current', records, observedAt: '2026-08-08T00:01:00Z' }, membership('observer-view'));
  assert.equal(observer.found, true);
  assert.deepEqual(observer.records.map((item) => item.recordClass), ['workspace.summary', 'mission.summary']);
  const missing = createSharedWorkspaceSnapshot({ workspaceId: 'workspace-a', remoteSourceInstanceId: 'source-b', syncCursor: 3, syncStatus: 'current', records, observedAt: '2026-08-08T00:01:00Z' }, null);
  assert.equal(missing.found, false);
  assert.deepEqual(missing.records, []);
});

test('cross-Workspace membership cannot read SharedWorkspaceSnapshot', () => {
  const result = createSharedWorkspaceSnapshot({ workspaceId: 'workspace-b', remoteSourceInstanceId: 'source-b', syncCursor: 1, syncStatus: 'current', records: [], observedAt: '2026-08-08T00:01:00Z' }, membership());
  assert.equal(result.found, false);
  assert.equal(result.reasonCode, 'cross_workspace_membership');
});

test('RemoteWorkerPresence is presence-only and rejects profile/process/control material', () => {
  const presence = createRemoteWorkerPresence({ workerPublicId: 'worker-a', workspaceId: 'workspace-a', statusClass: 'available', browserChannelClass: 'chrome', role: 'implementation', observedAt: '2026-08-08T00:00:00Z' });
  assert.equal(presence.statusClass, 'available');
  assert.equal(Object.isFrozen(presence), true);
  for (const forbidden of [
    { profilePath: '/private/profile' },
    { pid: 123 },
    { controlHandle: 'handle' },
    { start: true },
  ]) {
    assert.throws(() => createRemoteWorkerPresence({ workerPublicId: 'worker-a', workspaceId: 'workspace-a', statusClass: 'available', browserChannelClass: 'chrome', role: 'implementation', observedAt: '2026-08-08T00:00:00Z', ...forbidden }), /forbidden mirror|authority-shaped/);
  }
});
