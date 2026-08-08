'use strict';

const { assertSafeIdentifier } = require('../../domain/identifiers.cjs');
const { requiredText } = require('../../domain/workspace-model.cjs');

const TEAM_ROLES = Object.freeze(['owner-view', 'operator-view', 'reviewer-view', 'observer-view']);
const MEMBERSHIP_STATES = Object.freeze(['active', 'suspended', 'revoked']);
const SYNC_STATES = Object.freeze(['disabled', 'enabled', 'paused', 'current', 'stale', 'gap', 'divergent', 'unavailable']);

const ALL_CLASSES = Object.freeze([
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

const ROLE_CLASSES = Object.freeze({
  'owner-view': ALL_CLASSES,
  'operator-view': ALL_CLASSES,
  'reviewer-view': Object.freeze([
    'workspace.summary', 'mission.summary', 'plan-step.summary', 'human-gate.summary',
    'github-delivery.summary', 'evidence.summary', 'scheduling.summary',
  ]),
  'observer-view': Object.freeze(['workspace.summary', 'mission.summary', 'scheduling.summary']),
});

const FIELD_POLICY = Object.freeze({
  'workspace.summary': Object.freeze(['id', 'name', 'status', 'projectId', 'updatedAt']),
  'mission.summary': Object.freeze(['id', 'title', 'status', 'revision', 'runId', 'updatedAt']),
  'plan-step.summary': Object.freeze(['id', 'missionId', 'name', 'state', 'priority', 'updatedAt']),
  'human-gate.summary': Object.freeze(['id', 'missionId', 'stepId', 'state', 'reasonCode', 'requestedAt', 'updatedAt']),
  'scheduling.summary': Object.freeze(['id', 'policyId', 'selectedCandidateId', 'selectedWorkerPublicId', 'reasonCodes', 'inputDigest', 'decisionDigest', 'evaluatedAt']),
  'github-delivery.summary': Object.freeze(['id', 'repository', 'pullRequestNumber', 'headSha', 'state', 'gateState', 'observedAt']),
  'provider-observation.summary': Object.freeze(['id', 'provider', 'action', 'state', 'statusCode', 'targetClass', 'observedAt', 'evidenceDigest']),
  'evidence.summary': Object.freeze(['id', 'type', 'state', 'digest', 'observedAt', 'sourceClass']),
  'worker-presence.summary': Object.freeze(['workerPublicId', 'workspaceId', 'statusClass', 'browserChannelClass', 'role', 'observedAt']),
});

const OBSERVER_FIELDS = Object.freeze({
  'workspace.summary': Object.freeze(['id', 'name', 'status', 'updatedAt']),
  'mission.summary': Object.freeze(['id', 'title', 'status', 'updatedAt']),
  'scheduling.summary': Object.freeze(['id', 'reasonCodes', 'evaluatedAt']),
});

const REVIEWER_FIELDS = Object.freeze({
  'workspace.summary': FIELD_POLICY['workspace.summary'],
  'mission.summary': FIELD_POLICY['mission.summary'],
  'plan-step.summary': FIELD_POLICY['plan-step.summary'],
  'human-gate.summary': FIELD_POLICY['human-gate.summary'],
  'github-delivery.summary': FIELD_POLICY['github-delivery.summary'],
  'evidence.summary': FIELD_POLICY['evidence.summary'],
  'scheduling.summary': Object.freeze(['id', 'policyId', 'reasonCodes', 'inputDigest', 'decisionDigest', 'evaluatedAt']),
});

const AUTHORITY_SHAPED_KEY = /^(approve|approvedBy|reject|rejectedBy|start|stop|pause|resume|retry|execute|command|control|providerWrite|mutation|capabilityGrant|resourceRelease|resourceAcquire)$/i;
const FORBIDDEN_MIRROR_KEY = /^(authorization|cookie|token|secret|password|privateKey|profilePath|profileDir|userData|userDataDir|storageState|processId|pid|ppid|debugEndpoint|controlHandle)$/i;

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

function createTeamRole(input) {
  const id = assertSafeIdentifier(input?.id, 'team role id');
  if (!TEAM_ROLES.includes(id)) throw new Error(`Unsupported TeamRole: ${id}`);
  return freezeDeep({
    id,
    visibilityOnly: true,
    recordClasses: [...ROLE_CLASSES[id]],
  });
}

function createWorkspaceMembership(input) {
  const status = input?.status || 'active';
  if (!MEMBERSHIP_STATES.includes(status)) throw new Error('Invalid WorkspaceMembership status');
  const teamRoleId = assertSafeIdentifier(input?.teamRoleId, 'team role id');
  if (!TEAM_ROLES.includes(teamRoleId)) throw new Error(`Unsupported TeamRole: ${teamRoleId}`);
  return freezeDeep({
    id: assertSafeIdentifier(input?.id, 'workspace membership id'),
    workspaceId: assertSafeIdentifier(input?.workspaceId, 'workspace id'),
    subjectId: assertSafeIdentifier(input?.subjectId, 'membership subject id'),
    teamRoleId,
    status,
    createdAt: isoInstant(input?.createdAt || new Date().toISOString(), 'membership createdAt'),
  });
}

function accessDecision({ membership, workspaceId, recordClass }) {
  if (!membership) return freezeDeep({ allowed: false, reasonCode: 'membership_missing' });
  if (membership.workspaceId !== workspaceId) return freezeDeep({ allowed: false, reasonCode: 'cross_workspace_membership' });
  if (membership.status !== 'active') return freezeDeep({ allowed: false, reasonCode: `membership_${membership.status}` });
  if (!TEAM_ROLES.includes(membership.teamRoleId)) return freezeDeep({ allowed: false, reasonCode: 'team_role_unknown' });
  if (!ROLE_CLASSES[membership.teamRoleId].includes(recordClass)) return freezeDeep({ allowed: false, reasonCode: 'record_class_hidden' });
  return freezeDeep({ allowed: true, reasonCode: 'visible', teamRoleId: membership.teamRoleId });
}

function fieldsForRole(teamRoleId, recordClass) {
  if (teamRoleId === 'observer-view') return OBSERVER_FIELDS[recordClass] || [];
  if (teamRoleId === 'reviewer-view') return REVIEWER_FIELDS[recordClass] || [];
  return FIELD_POLICY[recordClass] || [];
}

function assertNoAuthorityShape(value, trail = '$', seen = new Set()) {
  if (value === null || value === undefined || typeof value !== 'object') return;
  if (seen.has(value)) throw new Error(`circular mirror payload at ${trail}`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoAuthorityShape(item, `${trail}[${index}]`, seen));
  } else {
    for (const [key, nested] of Object.entries(value)) {
      if (AUTHORITY_SHAPED_KEY.test(key)) throw new Error(`execution-authority-shaped mirror field ${trail}.${key}`);
      if (FORBIDDEN_MIRROR_KEY.test(key)) throw new Error(`forbidden mirror field ${trail}.${key}`);
      assertNoAuthorityShape(nested, `${trail}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function projectRecordForMembership({ membership, workspaceId, recordClass, payload }) {
  const decision = accessDecision({ membership, workspaceId, recordClass });
  if (!decision.allowed) return freezeDeep({ found: false, reasonCode: decision.reasonCode, recordClass, payload: null });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('mirror payload must be an object');
  assertNoAuthorityShape(payload);
  const allowedFields = fieldsForRole(membership.teamRoleId, recordClass);
  const projected = {};
  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) projected[field] = payload[field];
  }
  return freezeDeep({ found: true, reasonCode: 'visible', recordClass, payload: projected });
}

function createSharedWorkspaceSnapshot(input, membership) {
  const workspaceId = assertSafeIdentifier(input?.workspaceId, 'workspace id');
  if (!membership || membership.workspaceId !== workspaceId || membership.status !== 'active') {
    return freezeDeep({
      found: false,
      workspaceId,
      reasonCode: !membership ? 'membership_missing' : membership.workspaceId !== workspaceId ? 'cross_workspace_membership' : `membership_${membership.status}`,
      remoteSourceInstanceId: null,
      syncCursor: null,
      syncStatus: null,
      records: [],
      observedAt: null,
    });
  }
  const syncStatus = requiredText(input.syncStatus, 'shared syncStatus', 40);
  if (!SYNC_STATES.includes(syncStatus)) throw new Error(`Invalid SharedWorkspace sync status: ${syncStatus}`);
  const records = Array.isArray(input.records) ? input.records : (() => { throw new TypeError('SharedWorkspace records must be an array'); })();
  const visible = [];
  for (const record of records) {
    if (!record || typeof record !== 'object') throw new TypeError('SharedWorkspace record must be an object');
    const projected = projectRecordForMembership({
      membership,
      workspaceId,
      recordClass: requiredText(record.recordClass, 'recordClass', 80),
      payload: record.payload,
    });
    if (projected.found) visible.push(freezeDeep({
      recordClass: projected.recordClass,
      recordId: assertSafeIdentifier(record.recordId, 'shared record id'),
      recordRevision: Number(record.recordRevision || 1),
      payload: projected.payload,
    }));
  }
  return freezeDeep({
    found: true,
    workspaceId,
    reasonCode: 'visible',
    remoteSourceInstanceId: assertSafeIdentifier(input.remoteSourceInstanceId, 'remote source instance id'),
    syncCursor: Number(input.syncCursor || 0),
    syncStatus,
    records: visible,
    observedAt: isoInstant(input.observedAt || new Date().toISOString(), 'shared workspace observedAt'),
  });
}

function createRemoteWorkerPresence(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('RemoteWorkerPresence input is required');
  assertNoAuthorityShape(input);
  const statusClass = requiredText(input.statusClass, 'remote worker statusClass', 40);
  if (!['available', 'busy', 'paused', 'offline', 'unknown'].includes(statusClass)) throw new Error('Invalid remote worker statusClass');
  const browserChannelClass = requiredText(input.browserChannelClass || 'unknown', 'remote worker browserChannelClass', 40);
  if (!['chrome', 'chromium', 'unknown'].includes(browserChannelClass)) throw new Error('Invalid remote worker browserChannelClass');
  return freezeDeep({
    workerPublicId: assertSafeIdentifier(input.workerPublicId, 'remote worker public id'),
    workspaceId: assertSafeIdentifier(input.workspaceId, 'workspace id'),
    statusClass,
    browserChannelClass,
    role: requiredText(input.role || 'unknown', 'remote worker role', 80),
    observedAt: isoInstant(input.observedAt || new Date().toISOString(), 'remote worker observedAt'),
  });
}

module.exports = {
  ALL_CLASSES,
  AUTHORITY_SHAPED_KEY,
  FIELD_POLICY,
  FORBIDDEN_MIRROR_KEY,
  MEMBERSHIP_STATES,
  ROLE_CLASSES,
  TEAM_ROLES,
  accessDecision,
  assertNoAuthorityShape,
  createRemoteWorkerPresence,
  createSharedWorkspaceSnapshot,
  createTeamRole,
  createWorkspaceMembership,
  fieldsForRole,
  projectRecordForMembership,
};
