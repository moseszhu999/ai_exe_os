'use strict';

function text(document, tag, value, className = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value === null || value === undefined ? '—' : String(value);
  return element;
}

function section(document, title, items, formatter) {
  const root = document.createElement('section');
  root.append(text(document, 'h3', title));
  const list = document.createElement('ul');
  if (!items.length) list.append(text(document, 'li', 'No items'));
  for (const item of items) list.append(text(document, 'li', formatter(item)));
  root.append(list);
  return root;
}

function listBlock(document, title, items, formatter) {
  const root = document.createElement('div');
  root.append(text(document, 'h4', title));
  const list = document.createElement('ul');
  if (!items.length) list.append(text(document, 'li', 'No items'));
  for (const item of items) list.append(text(document, 'li', formatter(item)));
  root.append(list);
  return root;
}

function renderManagementPortfolio(document, managementPortfolio) {
  if (!managementPortfolio) return null;
  const root = document.createElement('section');
  root.append(text(document, 'h3', 'CEO Portfolio / Management Read Model'));
  root.append(text(document, 'p', `Status: ${managementPortfolio.reasonCode || 'unknown'} · READ-ONLY · authority: ${managementPortfolio.managementAuthority || 'observe-and-propose'}`));
  if (!managementPortfolio.available || !managementPortfolio.view) return root;

  const view = managementPortfolio.view;
  const counts = view.counts || {};
  root.append(text(document, 'p', `Health: ${view.portfolioHealth || 'unknown'} · Cards: ${counts.cardCount ?? 0} · Attention: ${counts.attentionCardCount ?? 0} · Stale: ${counts.staleCardCount ?? 0}`));
  root.append(text(document, 'p', `Observed: ${view.observedAt || 'unknown'} · source truth: ${view.sourceTruthAuthority || 'external'} · write authority: ${view.writeAuthority || 'none'}`));
  root.append(listBlock(document, 'Portfolio projects', view.projects || [], (item) => `${item.managementProjectId} · ${item.health} · cards ${item.cardCount} · attention ${item.attentionCardCount}`));
  root.append(listBlock(document, 'Owner attention', view.ownerAttention || [], (item) => `${item.managementProjectId} · ${item.title} · ${item.health} · ${item.reasonCode}`));
  root.append(listBlock(document, 'CEO decision proposals', view.decisions?.decisions || [], (item) => `${item.urgency} · ${item.decisionKind} · ${item.decisionLabel} · proposal-only`));
  return root;
}

function controlButton(document, label, enabled, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.disabled = !enabled;
  if (enabled && typeof onClick === 'function') button.addEventListener('click', onClick);
  return button;
}

function renderS4Cockpit(root, viewModel, handlers = {}) {
  if (!root?.ownerDocument) throw new TypeError('root DOM node is required');
  const document = root.ownerDocument;
  root.replaceChildren();
  root.append(text(document, 'h2', 'Operator Cockpit'));
  root.append(text(document, 'p', viewModel.found ? `Workspace: ${viewModel.activeWorkspaceId}` : `Workspace unavailable: ${viewModel.activeWorkspaceId || 'none'}`));
  if (!viewModel.found) return root;

  const managementPortfolio = renderManagementPortfolio(document, viewModel.managementPortfolio);
  if (managementPortfolio) root.append(managementPortfolio);
  root.append(section(document, 'Missions / Execution Graph', viewModel.missions, (item) => `${item.title || item.missionId} · ${item.state}`));
  root.append(section(document, 'Workers & Sessions', viewModel.workers, (item) => `${item.workerId} · ${item.browserChannel || 'runtime'} · ${item.status}`));
  root.append(section(document, 'Human Gate Inbox', viewModel.humanGates, (item) => `${item.id} · ${item.state}`));
  root.append(section(document, 'Blockers & Recovery', viewModel.attention, (item) => `${item.code} · ${item.aggregateId || 'unknown'}${item.provenanceAvailable ? '' : ' · provenance unavailable'}`));
  root.append(section(document, 'GitHub Delivery', viewModel.github.deliveryGates || [], (item) => `${item.id} · ${item.state}`));
  root.append(section(document, 'Evidence & Event Lineage', viewModel.evidence, (item) => `${item.id} · ${item.type || item.kind || 'evidence'}`));

  const controls = document.createElement('section');
  controls.append(text(document, 'h3', 'Selected Worker Control'));
  controls.append(text(document, 'p', viewModel.selectedWorker ? `${viewModel.selectedWorker.workerId} · ${viewModel.selectedWorker.status}` : 'No Worker selected'));
  controls.append(controlButton(document, 'Focus selected Worker', viewModel.controls.canFocus, handlers.focusWorker));
  controls.append(controlButton(document, 'Pause selected Worker', viewModel.controls.canPause, handlers.pauseWorker));
  controls.append(controlButton(document, 'Resume selected Worker', viewModel.controls.canResume, handlers.resumeWorker));
  controls.append(controlButton(document, 'Stop selected Worker', viewModel.controls.canStop, handlers.stopWorker));
  root.append(controls);

  root.append(text(document, 'p', 'GitHub provider mode: READ-ONLY'));
  return root;
}

module.exports = { renderS4Cockpit, renderManagementPortfolio };
