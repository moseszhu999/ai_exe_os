'use strict';

const SENSITIVE_KEY = /^(password|passwd|authorization|proxy-authorization|cookie|cookies|set-cookie|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|private[_ -]?key|profilePath|profileDir|profileDirectory|browserProfile|userData|userDataDir|storageState|processId|pid|ppid|body|responseBody)$/i;
const SENSITIVE_STRING = /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sessionid|access_token|refresh_token)=)/i;

const SURFACES = Object.freeze(['Provider Adapters', 'Approved Targets', 'Provider Observations & Evidence']);

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

function createS5ProviderViewModel(snapshot, activeWorkspaceId, selectedBindingId = null) {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('S5 provider snapshot is required');
  const exactWorkspace = snapshot.workspaceId === activeWorkspaceId && snapshot.found === true;
  if (!exactWorkspace) {
    return Object.freeze({
      surfaces: SURFACES,
      activeWorkspaceId: activeWorkspaceId || null,
      found: false,
      adapters: Object.freeze([]),
      contracts: Object.freeze([]),
      bindings: Object.freeze([]),
      observations: Object.freeze([]),
      selectedBinding: null,
      latestObservation: null,
    });
  }
  const safe = sanitize(snapshot);
  const bindings = Array.isArray(safe.bindings) ? safe.bindings : [];
  const observations = Array.isArray(safe.observations) ? safe.observations : [];
  const selectedBinding = bindings.find((item) => item.id === selectedBindingId) || bindings[0] || null;
  const latestObservation = selectedBinding
    ? observations.filter((item) => item.bindingId === selectedBinding.id).sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt)))[0] || null
    : null;
  return Object.freeze({
    surfaces: SURFACES,
    activeWorkspaceId,
    found: true,
    adapters: Object.freeze([...(safe.adapters || [])]),
    contracts: Object.freeze([...(safe.contracts || [])]),
    bindings: Object.freeze(bindings),
    observations: Object.freeze(observations),
    selectedBinding: selectedBinding ? Object.freeze(selectedBinding) : null,
    latestObservation: latestObservation ? Object.freeze(latestObservation) : null,
  });
}

module.exports = { SURFACES, createS5ProviderViewModel, sanitize };
