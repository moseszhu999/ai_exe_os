'use strict';

const SURFACES = Object.freeze([
  'Sync Status',
  'Source Instance',
  'Endpoint / Mode',
  'Outbound Cursor',
  'Acknowledged Cursor',
  'Pending Envelopes',
  'Remote Sources',
  'Gap / Divergence',
  'Members / Roles',
  'Shared Workspace',
  'Remote Worker Presence',
]);

const SENSITIVE_KEY = /^(authorization|proxy-authorization|cookie|cookies|set-cookie|password|passwd|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|private[_ -]?key|profilePath|profileDir|profileDirectory|browserProfile|userData|userDataDir|storageState|processId|pid|ppid|body|responseBody|environment|env|debugEndpoint|controlHandle)$/i;
const SENSITIVE_STRING = /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sessionid|access_token|refresh_token|id_token)=)/i;

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

function sanitize(value, key = '', seen = new Set()) {
  if (SENSITIVE_KEY.test(key)) return '[redacted]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return SENSITIVE_STRING.test(value) ? '[redacted]' : value;
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  let output;
  if (Array.isArray(value)) output = value.map((item) => sanitize(item, '', seen));
  else output = Object.fromEntries(Object.entries(value).map(([nestedKey, nested]) => [nestedKey, sanitize(nested, nestedKey, seen)]));
  seen.delete(value);
  return output;
}

function list(value) { return freezeDeep(Array.isArray(value) ? [...value] : []); }

function createS7SyncViewModel(snapshot, activeWorkspaceId, selectedRemoteSourceId = null, selectedMembershipId = null) {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('S7 sync snapshot is required');
  const exactWorkspace = snapshot.workspaceId === activeWorkspaceId && snapshot.found === true;
  if (!exactWorkspace) {
    return freezeDeep({
      surfaces: SURFACES,
      activeWorkspaceId: activeWorkspaceId || null,
      found: false,
      configuration: null,
      sourceInstance: null,
      cursor: null,
      pendingEnvelopes: [],
      remoteSources: [],
      divergences: [],
      memberships: [],
      sharedWorkspaces: [],
      selectedRemoteSource: null,
      selectedMembership: null,
      remoteWorkerPresence: [],
    });
  }
  const safe = sanitize(snapshot);
  const remoteSources = list(safe.remoteSources);
  const memberships = list(safe.memberships);
  const sharedWorkspaces = list(safe.sharedWorkspaces);
  const selectedRemoteSource = remoteSources.find((item) => item.sourceInstanceId === selectedRemoteSourceId) || remoteSources[0] || null;
  const selectedMembership = memberships.find((item) => item.id === selectedMembershipId) || memberships.find((item) => item.status === 'active') || memberships[0] || null;
  const remoteWorkerPresence = [];
  for (const shared of sharedWorkspaces) {
    for (const record of shared.records || []) {
      if (record.recordClass === 'worker-presence.summary') remoteWorkerPresence.push(record.payload);
    }
  }
  return freezeDeep({
    surfaces: SURFACES,
    activeWorkspaceId,
    found: true,
    configuration: safe.configuration || null,
    sourceInstance: safe.sourceInstance || null,
    cursor: safe.cursor || null,
    pendingEnvelopes: list(safe.pendingEnvelopes),
    remoteSources,
    divergences: list(safe.divergences),
    memberships,
    sharedWorkspaces,
    selectedRemoteSource,
    selectedMembership,
    remoteWorkerPresence: list(remoteWorkerPresence),
  });
}

module.exports = { SURFACES, createS7SyncViewModel, sanitize };
