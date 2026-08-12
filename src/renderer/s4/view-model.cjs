'use strict';

const SENSITIVE_KEY = /^(password|passwd|authorization|cookie|cookies|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|private[_ -]?key|profilePath|profileDir|profileDirectory|browserProfile|userData|userDataDir|storageState|processId|pid|ppid)$/i;
const SENSITIVE_STRING = /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sessionid|access_token|refresh_token)=)/i;

const SURFACES = Object.freeze([
  'Cockpit / Overview', 'Projects & Workspaces', 'Missions / Execution Graph', 'Workers & Sessions',
  'Agents / Capabilities / Provider Use', 'Human Gate Inbox', 'Blockers & Recovery', 'GitHub Delivery', 'Evidence & Event Lineage',
]);

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

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) freezeDeep(nested);
  return value;
}

function createS4CockpitViewModel(snapshot, activeWorkspaceId, selectedWorkerId = null) {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('S4 cockpit snapshot is required');
  const exactWorkspace = snapshot.workspaceId === activeWorkspaceId && snapshot.found === true;
  if (!exactWorkspace) {
    return Object.freeze({
      surfaces: SURFACES, activeWorkspaceId: activeWorkspaceId || null, workspace: null, found: false,
      missions: Object.freeze([]), workers: Object.freeze([]), humanGates: Object.freeze([]), attention: Object.freeze([]),
      github: Object.freeze({ repositories: [], pullRequests: [], deliveryGates: [], deliveryEvidence: [] }),
      evidence: Object.freeze([]), events: Object.freeze([]), selectedWorker: null,
      controls: Object.freeze({ canFocus: false, canStop: false, canPause: false, canResume: false }),
    });
  }

  const safe = sanitize(snapshot);
  const workers = Array.isArray(safe.workers) ? safe.workers : [];
  const selectedWorker = workers.find((item) => item.workerId === selectedWorkerId) || workers[0] || null;
  const managementPortfolio = safe.managementPortfolio && typeof safe.managementPortfolio === 'object'
    ? freezeDeep(safe.managementPortfolio)
    : null;
  return Object.freeze({
    surfaces: SURFACES,
    activeWorkspaceId,
    workspace: safe.workspace || null,
    found: true,
    projects: Object.freeze([...(safe.projects || [])]),
    missions: Object.freeze([...(safe.missions || [])]),
    workers: Object.freeze(workers),
    agents: Object.freeze([...(safe.agents || [])]),
    installations: Object.freeze([...(safe.installations || [])]),
    providerSnapshots: Object.freeze([...(safe.providerSnapshots || [])]),
    humanGates: Object.freeze([...(safe.humanGates || [])]),
    attention: Object.freeze([...(safe.attention || [])]),
    github: Object.freeze(safe.github || { repositories: [], pullRequests: [], deliveryGates: [], deliveryEvidence: [] }),
    evidence: Object.freeze([...(safe.evidence || [])]),
    events: Object.freeze([...(safe.events || [])]),
    selectedWorker: selectedWorker ? Object.freeze(selectedWorker) : null,
    controls: Object.freeze({
      canFocus: Boolean(selectedWorker?.controls?.canFocus),
      canStop: Boolean(selectedWorker?.controls?.canStop),
      canPause: Boolean(selectedWorker?.controls?.canPause),
      canResume: Boolean(selectedWorker?.controls?.canResume),
    }),
    ...(managementPortfolio ? { managementPortfolio } : {}),
  });
}

module.exports = { SURFACES, createS4CockpitViewModel, sanitize };
