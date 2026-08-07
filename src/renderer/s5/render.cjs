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

function renderS5ProviderPanel({ document, root, viewModel, onSelectBinding = () => {}, onObserve = () => {} }) {
  if (!document?.createElement || !root?.append) throw new TypeError('DOM document/root are required');
  while (root.firstChild) root.removeChild(root.firstChild);

  const heading = node(document, 'div', null, 'section-heading');
  heading.append(node(document, 'h3', 'Approved Provider Observation'));
  root.append(heading);

  const nav = node(document, 'nav', null, 'surface-nav');
  for (const surface of viewModel.surfaces || []) nav.append(node(document, 'span', surface));
  root.append(nav);

  if (!viewModel.found) {
    root.append(node(document, 'p', 'No provider state for the selected Workspace.'));
    return root;
  }

  const summary = node(document, 'section', null, 'grid three');
  const adapterCard = node(document, 'article');
  adapterCard.append(node(document, 'h4', 'Provider Adapters'));
  for (const adapter of viewModel.adapters || []) {
    const item = node(document, 'div', null, 'provider-adapter');
    appendField(document, item, 'Adapter', adapter.id);
    appendField(document, item, 'Provider', adapter.provider);
    appendField(document, item, 'Version', adapter.version);
    appendField(document, item, 'Action', adapter.action || adapter.actions?.[0]?.id);
    adapterCard.append(item);
  }

  const bindingCard = node(document, 'article');
  bindingCard.append(node(document, 'h4', 'Approved Targets'));
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Approved provider target');
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = 'Select approved binding';
  select.append(empty);
  for (const binding of viewModel.bindings || []) {
    const option = document.createElement('option');
    option.value = binding.id;
    option.textContent = `${binding.provider} · ${binding.exactTarget}`;
    if (viewModel.selectedBinding?.id === binding.id) option.selected = true;
    select.append(option);
  }
  select.addEventListener('change', () => onSelectBinding(select.value || null));
  bindingCard.append(select);
  if (viewModel.selectedBinding) {
    appendField(document, bindingCard, 'Contract', viewModel.selectedBinding.providerContractId);
    appendField(document, bindingCard, 'Action', viewModel.selectedBinding.action);
    appendField(document, bindingCard, 'Status', viewModel.selectedBinding.status);
    const observe = node(document, 'button', 'Observe selected approved target');
    observe.type = 'button';
    observe.dataset.action = 'observe-approved-provider';
    observe.addEventListener('click', () => onObserve(viewModel.selectedBinding.id));
    bindingCard.append(observe);
  }

  const evidenceCard = node(document, 'article');
  evidenceCard.append(node(document, 'h4', 'Provider Observations & Evidence'));
  if (!viewModel.latestObservation) evidenceCard.append(node(document, 'p', 'No canonical provider observation yet.'));
  else {
    appendField(document, evidenceCard, 'State', viewModel.latestObservation.state);
    appendField(document, evidenceCard, 'Method', viewModel.latestObservation.method);
    appendField(document, evidenceCard, 'Status code', viewModel.latestObservation.statusCode);
    appendField(document, evidenceCard, 'Observed', viewModel.latestObservation.observedAt);
    appendField(document, evidenceCard, 'Evidence', viewModel.latestObservation.evidenceDigest || viewModel.latestObservation.normalizerDigest);
    appendField(document, evidenceCard, 'Failure', viewModel.latestObservation.failureCode);
  }

  summary.append(adapterCard, bindingCard, evidenceCard);
  root.append(summary);
  return root;
}

module.exports = { renderS5ProviderPanel };
