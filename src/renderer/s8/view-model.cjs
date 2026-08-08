'use strict';

const SURFACES = Object.freeze([
  'Delegation / Overview',
  'Peer Bindings',
  'Policies',
  'Outbound Requests',
  'Incoming Proposals',
  'Admission Evidence',
  'Local HumanGate',
  'Local Execution Binding',
  'Receipts / Evidence',
  'Cancellation Proposal',
  'Divergence / Replay / Rejection Reasons',
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

function createS8DelegationViewModel(snapshot, activeWorkspaceId, selectedProposalId = null, selectedRequestId = null) {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('S8 delegation snapshot is required');
  const exactWorkspace = snapshot.workspaceId === activeWorkspaceId && snapshot.found === true;
  if (!exactWorkspace) {
    return freezeDeep({
      surfaces: SURFACES,
      activeWorkspaceId: activeWorkspaceId || null,
      found: false,
      peerBindings: [], policies: [], outboundRequests: [], incomingProposals: [], admissionSnapshots: [],
      acceptances: [], executionBindings: [], receipts: [], cancellationProposals: [], divergences: [],
      selectedProposal: null, selectedRequest: null, selectedAdmission: null, selectedAcceptance: null,
      selectedExecutionBinding: null, selectedReceipt: null,
    });
  }
  const safe = sanitize(snapshot);
  const peerBindings = list(safe.peerBindings);
  const policies = list(safe.policies);
  const outboundRequests = list(safe.outboundRequests);
  const incomingProposals = list(safe.incomingProposals);
  const admissionSnapshots = list(safe.admissionSnapshots);
  const acceptances = list(safe.acceptances);
  const executionBindings = list(safe.executionBindings);
  const receipts = list(safe.receipts);
  const cancellationProposals = list(safe.cancellationProposals);
  const divergences = list(safe.divergences);
  const selectedProposal = incomingProposals.find((item) => item.id === selectedProposalId) || incomingProposals[0] || null;
  const selectedRequest = outboundRequests.find((item) => item.id === selectedRequestId)
    || outboundRequests.find((item) => item.id === selectedProposal?.delegationRequestId)
    || outboundRequests[0]
    || null;
  const selectedAdmission = admissionSnapshots.find((item) => item.proposalId === selectedProposal?.id) || null;
  const selectedAcceptance = acceptances.find((item) => item.proposalId === selectedProposal?.id) || null;
  const selectedExecutionBinding = executionBindings.find((item) => item.proposalId === selectedProposal?.id) || null;
  const selectedReceipt = receipts.find((item) => item.delegationRequestId === (selectedProposal?.delegationRequestId || selectedRequest?.id)) || null;
  return freezeDeep({
    surfaces: SURFACES,
    activeWorkspaceId,
    found: true,
    peerBindings,
    policies,
    outboundRequests,
    incomingProposals,
    admissionSnapshots,
    acceptances,
    executionBindings,
    receipts,
    cancellationProposals,
    divergences,
    selectedProposal,
    selectedRequest,
    selectedAdmission,
    selectedAcceptance,
    selectedExecutionBinding,
    selectedReceipt,
  });
}

module.exports = { SURFACES, createS8DelegationViewModel, sanitize };
