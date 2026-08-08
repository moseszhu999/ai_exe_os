'use strict';

function node(document, tag, text = null, className = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== null) element.textContent = String(text);
  return element;
}

function field(document, parent, label, value) {
  const row = node(document, 'p');
  row.append(node(document, 'strong', `${label}: `), document.createTextNode(value == null ? '—' : String(value)));
  parent.append(row);
}

function cards(document, parent, rows, describe) {
  const container = node(document, 'div', null, 'cards');
  for (const row of rows || []) {
    const card = node(document, 'div', null, 'card');
    const description = describe(row);
    card.append(node(document, 'strong', description.title), node(document, 'p', description.detail));
    container.append(card);
  }
  if (!(rows || []).length) container.append(node(document, 'p', 'None.'));
  parent.append(container);
}

function renderS8DelegationPanel({
  document,
  root,
  viewModel,
  onPushRequest = () => {},
  onPullInbox = () => {},
  onApproveLocalProposal = () => {},
  onRejectLocalProposal = () => {},
  onProposeCancellation = () => {},
  onPullReceipts = () => {},
  onSelectProposal = () => {},
  onSelectRequest = () => {},
}) {
  if (!document?.createElement || !root?.append) throw new TypeError('DOM document/root are required');
  while (root.firstChild) root.removeChild(root.firstChild);

  const heading = node(document, 'div', null, 'section-heading');
  heading.append(node(document, 'h3', 'Controlled Remote Execution Delegation'));
  root.append(heading);

  const nav = node(document, 'nav', null, 'surface-nav');
  for (const surface of viewModel.surfaces || []) nav.append(node(document, 'span', surface));
  root.append(nav);

  if (!viewModel.found) {
    root.append(node(document, 'p', 'No S8 delegation state for the selected Workspace. Remote collaboration remains non-executable.'));
    return root;
  }

  const controls = node(document, 'div', null, 'action-row');
  const push = node(document, 'button', 'Push selected delegation request');
  push.type = 'button'; push.dataset.action = 'push-delegation-request'; push.addEventListener('click', onPushRequest);
  const pullInbox = node(document, 'button', 'Pull delegation inbox');
  pullInbox.type = 'button'; pullInbox.dataset.action = 'pull-delegation-inbox'; pullInbox.addEventListener('click', onPullInbox);
  const pullReceipts = node(document, 'button', 'Pull delegation receipts');
  pullReceipts.type = 'button'; pullReceipts.dataset.action = 'pull-delegation-receipts'; pullReceipts.addEventListener('click', onPullReceipts);
  const cancel = node(document, 'button', 'Propose pre-start cancellation');
  cancel.type = 'button'; cancel.dataset.action = 'propose-delegation-cancellation'; cancel.addEventListener('click', onProposeCancellation);
  controls.append(push, pullInbox, pullReceipts, cancel);
  root.append(controls);

  const grid = node(document, 'section', null, 'grid three');

  const overview = node(document, 'article');
  overview.append(node(document, 'h4', 'Delegation / Overview'));
  field(document, overview, 'Peer bindings', viewModel.peerBindings.length);
  field(document, overview, 'Policies', viewModel.policies.length);
  field(document, overview, 'Outbound requests', viewModel.outboundRequests.length);
  field(document, overview, 'Incoming proposals', viewModel.incomingProposals.length);
  field(document, overview, 'Execution bindings', viewModel.executionBindings.length);
  field(document, overview, 'Receipts', viewModel.receipts.length);

  const peers = node(document, 'article');
  peers.append(node(document, 'h4', 'Peer Bindings / Policies'));
  cards(document, peers, viewModel.peerBindings, (item) => ({
    title: `${item.id || 'peer'} · ${item.status || 'unknown'}`,
    detail: `${item.sourceInstanceId || 'source'} / ${item.sourceWorkspaceId || 'workspace'} → ${item.destinationInstanceId || 'destination'} / ${item.destinationWorkspaceId || 'workspace'}`,
  }));
  cards(document, peers, viewModel.policies, (item) => ({
    title: `${item.id || 'policy'} · ${item.version || 'version unknown'}`,
    detail: `${item.status || 'unknown'} · ${item.allowedActions?.join(', ') || 'no actions'} · ${item.allowedTargets?.length || 0} targets`,
  }));

  const outbound = node(document, 'article');
  outbound.append(node(document, 'h4', 'Outbound Requests'));
  const requestSelect = document.createElement('select');
  requestSelect.setAttribute('aria-label', 'Outbound delegation request');
  const requestEmpty = document.createElement('option'); requestEmpty.value = ''; requestEmpty.textContent = 'Select outbound request'; requestSelect.append(requestEmpty);
  for (const item of viewModel.outboundRequests || []) {
    const option = document.createElement('option');
    option.value = item.id; option.textContent = `${item.id} · ${item.action || 'action'} · ${item.target || 'target'}`;
    if (viewModel.selectedRequest?.id === item.id) option.selected = true;
    requestSelect.append(option);
  }
  requestSelect.addEventListener('change', () => onSelectRequest(requestSelect.value || null));
  outbound.append(requestSelect);
  field(document, outbound, 'Request digest', viewModel.selectedRequest?.requestDigest);
  field(document, outbound, 'Destination', viewModel.selectedRequest?.destinationInstanceId);
  field(document, outbound, 'Policy', viewModel.selectedRequest?.policyId);

  const incoming = node(document, 'article');
  incoming.append(node(document, 'h4', 'Incoming Proposals'));
  const proposalSelect = document.createElement('select');
  proposalSelect.setAttribute('aria-label', 'Incoming delegation proposal');
  const proposalEmpty = document.createElement('option'); proposalEmpty.value = ''; proposalEmpty.textContent = 'Select incoming proposal'; proposalSelect.append(proposalEmpty);
  for (const item of viewModel.incomingProposals || []) {
    const option = document.createElement('option');
    option.value = item.id; option.textContent = `${item.id} · ${item.state || 'state unknown'} · ${item.reasonCode || 'no reason'}`;
    if (viewModel.selectedProposal?.id === item.id) option.selected = true;
    proposalSelect.append(option);
  }
  proposalSelect.addEventListener('change', () => onSelectProposal(proposalSelect.value || null));
  incoming.append(proposalSelect);
  field(document, incoming, 'State', viewModel.selectedProposal?.state);
  field(document, incoming, 'Reason', viewModel.selectedProposal?.reasonCode);

  const admission = node(document, 'article');
  admission.append(node(document, 'h4', 'Admission Evidence'));
  field(document, admission, 'Admissible', viewModel.selectedAdmission?.admissible);
  field(document, admission, 'Admission digest', viewModel.selectedAdmission?.admissionDigest);
  field(document, admission, 'Local installation', viewModel.selectedAdmission?.capabilityInstallationId);
  field(document, admission, 'Local grant', viewModel.selectedAdmission?.agentCapabilityGrantId);
  field(document, admission, 'Reasons', viewModel.selectedAdmission?.reasonCodes?.join(', '));

  const gate = node(document, 'article');
  gate.append(node(document, 'h4', 'Local HumanGate'));
  field(document, gate, 'Gate', viewModel.selectedAcceptance?.humanGateId);
  field(document, gate, 'Decision', viewModel.selectedAcceptance?.state || viewModel.selectedProposal?.state);
  gate.append(node(document, 'p', 'Only the destination-local operator may decide this delegation gate. Accepting delegation does not bypass any existing action HumanGate.'));
  if (viewModel.selectedProposal?.state === 'waiting_human') {
    const accept = node(document, 'button', 'Accept locally'); accept.type = 'button'; accept.dataset.action = 'approve-local-delegation'; accept.addEventListener('click', onApproveLocalProposal);
    const reject = node(document, 'button', 'Reject locally'); reject.type = 'button'; reject.dataset.action = 'reject-local-delegation'; reject.addEventListener('click', onRejectLocalProposal);
    gate.append(accept, reject);
  }

  const binding = node(document, 'article');
  binding.append(node(document, 'h4', 'Local Execution Binding'));
  field(document, binding, 'Binding', viewModel.selectedExecutionBinding?.id);
  field(document, binding, 'Local Task', viewModel.selectedExecutionBinding?.localTaskId);
  field(document, binding, 'Local StepAttempt', viewModel.selectedExecutionBinding?.localStepAttemptId);
  field(document, binding, 'Local ExecutionRun', viewModel.selectedExecutionBinding?.localExecutionRunId);
  binding.append(node(document, 'p', 'Execution remains governed by this destination instance’s S6/S2/S1 scheduler, ResourceLocks, HumanGates and Worker runtime.'));

  const receipts = node(document, 'article');
  receipts.append(node(document, 'h4', 'Receipts / Evidence'));
  cards(document, receipts, viewModel.receipts, (item) => ({
    title: `${item.delegationRequestId || 'request'} · ${item.state || 'unknown'}`,
    detail: `${item.receiptDigest || 'digest unavailable'} · ${(item.evidenceDigests || []).length} evidence digests`,
  }));

  const cancellation = node(document, 'article');
  cancellation.append(node(document, 'h4', 'Cancellation Proposal'));
  cards(document, cancellation, viewModel.cancellationProposals, (item) => ({
    title: item.id || 'cancellation proposal',
    detail: `${item.delegationRequestId || 'request'} · ${item.reasonClass || 'reason unknown'}`,
  }));
  cancellation.append(node(document, 'p', 'Remote cancellation is proposal-only before local binding and non-authoritative after execution starts.'));

  const divergence = node(document, 'article');
  divergence.append(node(document, 'h4', 'Divergence / Replay / Rejection Reasons'));
  cards(document, divergence, viewModel.divergences, (item) => ({
    title: item.reasonCode || 'delegation issue',
    detail: `${item.requestId || item.proposalId || 'record'} · ${item.state || 'rejected'}`,
  }));

  grid.append(overview, peers, outbound, incoming, admission, gate, binding, receipts, cancellation, divergence);
  root.append(grid);
  return root;
}

module.exports = { renderS8DelegationPanel };
