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

function listCards(document, parent, rows, describe) {
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

function renderS7SyncPanel({ document, root, viewModel, onConfigure = () => {}, onPush = () => {}, onPull = () => {}, onSelectRemoteSource = () => {}, onSelectMembership = () => {} }) {
  if (!document?.createElement || !root?.append) throw new TypeError('DOM document/root are required');
  while (root.firstChild) root.removeChild(root.firstChild);

  const heading = node(document, 'div', null, 'section-heading');
  heading.append(node(document, 'h3', 'Collaboration & Sync Mirror'));
  root.append(heading);

  const nav = node(document, 'nav', null, 'surface-nav');
  for (const surface of viewModel.surfaces || []) nav.append(node(document, 'span', surface));
  root.append(nav);

  if (!viewModel.found) {
    root.append(node(document, 'p', 'No S7 sync state for the selected Workspace. Local execution remains independent.'));
    return root;
  }

  const controls = node(document, 'div', null, 'action-row');
  const configure = node(document, 'button', 'Configure optional sync');
  configure.type = 'button';
  configure.dataset.action = 'configure-sync';
  configure.addEventListener('click', onConfigure);
  const push = node(document, 'button', 'Push pending safe envelopes');
  push.type = 'button';
  push.dataset.action = 'push-pending-sync';
  push.addEventListener('click', onPush);
  const pull = node(document, 'button', 'Pull collaboration mirror');
  pull.type = 'button';
  pull.dataset.action = 'pull-shared-mirror';
  pull.addEventListener('click', onPull);
  controls.append(configure, push, pull);
  root.append(controls);

  const grid = node(document, 'section', null, 'grid three');

  const status = node(document, 'article');
  status.append(node(document, 'h4', 'Sync Status'));
  field(document, status, 'Mode', viewModel.configuration?.status);
  field(document, status, 'Endpoint', viewModel.configuration?.endpointId);
  field(document, status, 'Source instance', viewModel.sourceInstance?.instancePublicId || viewModel.sourceInstance?.id);
  field(document, status, 'Cursor status', viewModel.cursor?.status);
  field(document, status, 'Produced', viewModel.cursor?.lastProducedCursor);
  field(document, status, 'Acknowledged', viewModel.cursor?.lastAcknowledgedCursor);

  const pending = node(document, 'article');
  pending.append(node(document, 'h4', 'Pending Envelopes'));
  listCards(document, pending, viewModel.pendingEnvelopes, (item) => ({
    title: `${item.cursor ?? '—'} · ${item.recordClass || 'record'}`,
    detail: `${item.recordId || 'unknown'} · ${item.envelopeDigest || 'digest unavailable'}`,
  }));

  const divergence = node(document, 'article');
  divergence.append(node(document, 'h4', 'Gap / Divergence'));
  listCards(document, divergence, viewModel.divergences, (item) => ({
    title: item.reasonCode || 'sync divergence',
    detail: `${item.sourceInstanceId || 'source'} · cursor ${item.cursor ?? '—'}`,
  }));

  const remote = node(document, 'article');
  remote.append(node(document, 'h4', 'Remote Sources'));
  const remoteSelect = document.createElement('select');
  remoteSelect.setAttribute('aria-label', 'Remote source instance');
  const remoteEmpty = document.createElement('option');
  remoteEmpty.value = '';
  remoteEmpty.textContent = 'Select remote source';
  remoteSelect.append(remoteEmpty);
  for (const item of viewModel.remoteSources || []) {
    const option = document.createElement('option');
    option.value = item.sourceInstanceId;
    option.textContent = `${item.sourceInstanceId} · cursor ${item.lastCursor ?? '—'}`;
    if (viewModel.selectedRemoteSource?.sourceInstanceId === item.sourceInstanceId) option.selected = true;
    remoteSelect.append(option);
  }
  remoteSelect.addEventListener('change', () => onSelectRemoteSource(remoteSelect.value || null));
  remote.append(remoteSelect);
  field(document, remote, 'Selected cursor', viewModel.selectedRemoteSource?.lastCursor);
  field(document, remote, 'Status', viewModel.selectedRemoteSource?.status || viewModel.selectedRemoteSource?.syncStatus);

  const members = node(document, 'article');
  members.append(node(document, 'h4', 'Members / Roles'));
  const memberSelect = document.createElement('select');
  memberSelect.setAttribute('aria-label', 'Workspace membership');
  const memberEmpty = document.createElement('option');
  memberEmpty.value = '';
  memberEmpty.textContent = 'Select membership';
  memberSelect.append(memberEmpty);
  for (const item of viewModel.memberships || []) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = `${item.subjectId || item.id} · ${item.teamRoleId} · ${item.status}`;
    if (viewModel.selectedMembership?.id === item.id) option.selected = true;
    memberSelect.append(option);
  }
  memberSelect.addEventListener('change', () => onSelectMembership(memberSelect.value || null));
  members.append(memberSelect);
  field(document, members, 'Selected role', viewModel.selectedMembership?.teamRoleId);
  field(document, members, 'Membership status', viewModel.selectedMembership?.status);

  const shared = node(document, 'article');
  shared.append(node(document, 'h4', 'Shared Workspace'));
  listCards(document, shared, viewModel.sharedWorkspaces, (item) => ({
    title: `${item.remoteSourceInstanceId || 'remote source'} · ${item.syncStatus || 'unknown'}`,
    detail: `${(item.records || []).length} visible records · cursor ${item.syncCursor ?? '—'}`,
  }));

  const presence = node(document, 'article');
  presence.append(node(document, 'h4', 'Remote Worker Presence'));
  listCards(document, presence, viewModel.remoteWorkerPresence, (item) => ({
    title: item.workerPublicId || 'remote worker',
    detail: `${item.statusClass || 'unknown'} · ${item.browserChannelClass || 'unknown'} · ${item.role || 'role unknown'}`,
  }));
  presence.append(node(document, 'p', 'Presence is read-only. S7 v1 exposes no remote Worker control.'));

  grid.append(status, pending, divergence, remote, members, shared, presence);
  root.append(grid);
  return root;
}

module.exports = { renderS7SyncPanel };
