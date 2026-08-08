'use strict';

function node(document, tag, text = null, className = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== null) element.textContent = String(text);
  return element;
}

function appendField(document, parent, label, value) {
  const row = node(document, 'p');
  row.append(node(document, 'strong', `${label}: `), document.createTextNode(value == null ? '—' : String(value)));
  parent.append(row);
}

function appendReasonList(document, parent, reasons) {
  const list = node(document, 'ul');
  for (const item of reasons || []) {
    const codes = Array.isArray(item.reasonCodes) ? item.reasonCodes.join(', ') : '—';
    list.append(node(document, 'li', `${item.candidateId || item.sourceId || 'item'} · ${codes}`));
  }
  parent.append(list);
}

function renderS6SchedulingPanel({ document, root, viewModel, onCompute = () => {}, onSelectProposal = () => {}, onRevalidate = () => {} }) {
  if (!document?.createElement || !root?.append) throw new TypeError('DOM document/root are required');
  while (root.firstChild) root.removeChild(root.firstChild);

  const heading = node(document, 'div', null, 'section-heading');
  heading.append(node(document, 'h3', 'Scheduling Policy & Assignment Explanation'));
  root.append(heading);

  const nav = node(document, 'nav', null, 'surface-nav');
  for (const surface of viewModel.surfaces || []) nav.append(node(document, 'span', surface));
  root.append(nav);

  if (!viewModel.found) {
    root.append(node(document, 'p', 'No scheduling state for the selected Workspace.'));
    return root;
  }

  const controls = node(document, 'div', null, 'action-row');
  const compute = node(document, 'button', 'Compute scheduling decision');
  compute.type = 'button';
  compute.dataset.action = 'compute-scheduling-decision';
  compute.addEventListener('click', onCompute);
  controls.append(compute);
  root.append(controls);

  const grid = node(document, 'section', null, 'grid three');

  const policyCard = node(document, 'article');
  policyCard.append(node(document, 'h4', 'Policy'));
  appendField(document, policyCard, 'Policy', viewModel.policy?.id);
  appendField(document, policyCard, 'Version', viewModel.policy?.version);
  appendField(document, policyCard, 'Global max active', viewModel.policy?.globalMaxActive);
  appendField(document, policyCard, 'Workspace max active', viewModel.policy?.workspaceMaxActive);
  appendField(document, policyCard, 'Reuse', viewModel.policy?.sessionReuse);

  const capacityCard = node(document, 'article');
  capacityCard.append(node(document, 'h4', 'Capacity'));
  appendField(document, capacityCard, 'Global active', viewModel.capacity?.globalActive);
  appendField(document, capacityCard, 'Workspace active', viewModel.capacity?.workspaceActive);
  appendField(document, capacityCard, 'Workers', viewModel.workers?.length || 0);
  appendField(document, capacityCard, 'Provider budgets', viewModel.providerCapacity?.length || 0);

  const queueCard = node(document, 'article');
  queueCard.append(node(document, 'h4', 'Eligible Queue'));
  const queueList = node(document, 'ol');
  for (const candidate of viewModel.eligibleQueue || []) {
    queueList.append(node(document, 'li', `${candidate.id || 'candidate'} · ${candidate.priority || 'priority'} · ${candidate.readySince || 'ready time unknown'}`));
  }
  queueCard.append(queueList);

  const selectedCard = node(document, 'article');
  selectedCard.append(node(document, 'h4', 'Selected Assignment'));
  appendField(document, selectedCard, 'Candidate', viewModel.selectedAssignment?.candidateId);
  appendField(document, selectedCard, 'Worker', viewModel.selectedAssignment?.workerId);
  appendField(document, selectedCard, 'Decision', viewModel.selectedAssignment?.decisionId);
  appendField(document, selectedCard, 'Digest', viewModel.selectedAssignment?.decisionDigest);

  const deferredCard = node(document, 'article');
  deferredCard.append(node(document, 'h4', 'Deferred Reasons'));
  appendReasonList(document, deferredCard, viewModel.deferred);

  const workerCard = node(document, 'article');
  workerCard.append(node(document, 'h4', 'Worker Compatibility'));
  const workerList = node(document, 'ul');
  for (const worker of viewModel.workers || []) {
    workerList.append(node(document, 'li', `${worker.workerId || 'worker'} · ${worker.status || 'unknown'} · ${worker.browserChannel || 'channel unknown'}`));
  }
  workerCard.append(workerList);

  const providerCard = node(document, 'article');
  providerCard.append(node(document, 'h4', 'Provider Capacity'));
  const providerList = node(document, 'ul');
  for (const provider of viewModel.providerCapacity || []) {
    providerList.append(node(document, 'li', `${provider.providerId || 'provider'} / ${provider.action || 'action'} · ${provider.status || 'unknown'} · ${provider.activeObserved ?? '—'}/${provider.maxActive ?? '—'}`));
  }
  providerCard.append(providerList);

  const evidenceCard = node(document, 'article');
  evidenceCard.append(node(document, 'h4', 'Decision Evidence'));
  appendField(document, evidenceCard, 'Decision', viewModel.decisionEvidence?.id);
  appendField(document, evidenceCard, 'Input digest', viewModel.decisionEvidence?.inputDigest);
  appendField(document, evidenceCard, 'Decision digest', viewModel.decisionEvidence?.decisionDigest);
  appendField(document, evidenceCard, 'Evaluated', viewModel.decisionEvidence?.evaluatedAt);
  appendField(document, evidenceCard, 'Reason', (viewModel.decisionEvidence?.reasonCodes || []).join(', '));

  const proposalCard = node(document, 'article');
  proposalCard.append(node(document, 'h4', 'Assignment Proposal Revalidation'));
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Assignment proposal');
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = 'Select proposal';
  select.append(empty);
  for (const proposal of viewModel.proposals || []) {
    const option = document.createElement('option');
    option.value = proposal.id;
    option.textContent = `${proposal.id} · ${proposal.state}`;
    if (viewModel.selectedProposal?.id === proposal.id) option.selected = true;
    select.append(option);
  }
  select.addEventListener('change', () => onSelectProposal(select.value || null));
  proposalCard.append(select);
  if (viewModel.selectedProposal) {
    appendField(document, proposalCard, 'State', viewModel.selectedProposal.state);
    appendField(document, proposalCard, 'Candidate', viewModel.selectedProposal.candidateId);
    appendField(document, proposalCard, 'Worker', viewModel.selectedProposal.workerId);
    const revalidate = node(document, 'button', 'Revalidate proposal');
    revalidate.type = 'button';
    revalidate.dataset.action = 'revalidate-assignment-proposal';
    revalidate.addEventListener('click', () => onRevalidate(viewModel.selectedProposal.id));
    proposalCard.append(revalidate);
  }

  grid.append(policyCard, capacityCard, queueCard, selectedCard, deferredCard, workerCard, providerCard, evidenceCard, proposalCard);
  root.append(grid);
  return root;
}

module.exports = { renderS6SchedulingPanel };
