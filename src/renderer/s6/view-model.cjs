'use strict';

const SENSITIVE_KEY = /^(password|passwd|authorization|proxy-authorization|cookie|cookies|set-cookie|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|private[_ -]?key|profilePath|profileDir|profileDirectory|browserProfile|userData|userDataDir|storageState|processId|pid|ppid|body|responseBody|environment|env)$/i;
const SENSITIVE_STRING = /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sessionid|access_token|refresh_token)=)/i;

const SURFACES = Object.freeze([
  'Policy',
  'Capacity',
  'Eligible Queue',
  'Selected Assignment',
  'Deferred Reasons',
  'Worker Compatibility',
  'Provider Capacity',
  'Decision Evidence',
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

function freezeList(value) {
  return Object.freeze(Array.isArray(value) ? [...value] : []);
}

function createS6SchedulingViewModel(snapshot, activeWorkspaceId, selectedProposalId = null) {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('S6 scheduling snapshot is required');
  const exactWorkspace = snapshot.workspaceId === activeWorkspaceId && snapshot.found === true;
  if (!exactWorkspace) {
    return Object.freeze({
      surfaces: SURFACES,
      activeWorkspaceId: activeWorkspaceId || null,
      found: false,
      policy: null,
      capacity: null,
      eligibleQueue: Object.freeze([]),
      selectedAssignment: null,
      deferred: Object.freeze([]),
      workers: Object.freeze([]),
      providerCapacity: Object.freeze([]),
      decisions: Object.freeze([]),
      proposals: Object.freeze([]),
      selectedProposal: null,
      decisionEvidence: null,
    });
  }

  const safe = sanitize(snapshot);
  const decisions = freezeList(safe.decisions);
  const proposals = freezeList(safe.proposals);
  const latestDecision = [...decisions].sort((a, b) => String(b.evaluatedAt || '').localeCompare(String(a.evaluatedAt || '')))[0] || safe.decision || null;
  const selectedProposal = proposals.find((item) => item.id === selectedProposalId)
    || proposals.find((item) => item.state === 'proposed')
    || proposals[0]
    || null;
  const selectedAssignment = latestDecision && latestDecision.selectedCandidateId
    ? Object.freeze({
        candidateId: latestDecision.selectedCandidateId,
        workerId: latestDecision.selectedWorkerId || null,
        decisionId: latestDecision.id || null,
        decisionDigest: latestDecision.decisionDigest || null,
      })
    : null;

  return Object.freeze({
    surfaces: SURFACES,
    activeWorkspaceId,
    found: true,
    policy: safe.policy ? Object.freeze(safe.policy) : null,
    capacity: safe.capacity ? Object.freeze(safe.capacity) : null,
    eligibleQueue: freezeList(safe.eligibleQueue || safe.candidates),
    selectedAssignment,
    deferred: freezeList(safe.deferred || latestDecision?.deferred),
    workers: freezeList(safe.workers),
    providerCapacity: freezeList(safe.providerCapacity),
    decisions,
    proposals,
    selectedProposal: selectedProposal ? Object.freeze(selectedProposal) : null,
    decisionEvidence: latestDecision ? Object.freeze({
      id: latestDecision.id || null,
      inputDigest: latestDecision.inputDigest || null,
      decisionDigest: latestDecision.decisionDigest || null,
      evaluatedAt: latestDecision.evaluatedAt || null,
      reasonCodes: freezeList(latestDecision.reasonCodes),
    }) : null,
  });
}

module.exports = { SURFACES, createS6SchedulingViewModel, sanitize };
