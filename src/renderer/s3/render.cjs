'use strict';

function node(document, tag, text, className) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function appendJson(document, parent, value) {
  const pre = node(document, 'pre', JSON.stringify(value ?? null, null, 2), 's3-json');
  parent.appendChild(pre);
}

function section(document, title, items, renderItem = null) {
  const wrapper = node(document, 'section', null, 's3-surface');
  wrapper.appendChild(node(document, 'h3', title));
  if (!Array.isArray(items) || items.length === 0) {
    wrapper.appendChild(node(document, 'p', 'No records', 's3-empty'));
    return wrapper;
  }
  const list = node(document, 'div', null, 's3-list');
  for (const item of items) {
    const card = node(document, 'article', null, 's3-card');
    if (renderItem) renderItem(card, item);
    else appendJson(document, card, item);
    list.appendChild(card);
  }
  wrapper.appendChild(list);
  return wrapper;
}

function renderS3GitHubDelivery(container, viewModel, actions = {}) {
  if (!container?.ownerDocument) throw new TypeError('S3 renderer requires a DOM container');
  if (!viewModel || typeof viewModel !== 'object') throw new TypeError('S3 view model is required');
  const document = container.ownerDocument;
  while (container.firstChild) container.removeChild(container.firstChild);

  const header = node(document, 'header', null, 's3-header');
  header.appendChild(node(document, 'h2', 'GitHub Delivery Evidence'));
  header.appendChild(node(document, 'p', `Workspace: ${viewModel.activeWorkspace?.name || viewModel.activeWorkspace?.id || 'none'}`));
  header.appendChild(node(document, 'p', 'Provider mode: READ-ONLY — no GitHub write operation is exposed.', 's3-readonly'));
  container.appendChild(header);

  const navigation = node(document, 'nav', null, 's3-navigation');
  navigation.setAttribute('aria-label', 'S3 GitHub delivery surfaces');
  for (const label of viewModel.navigation || []) navigation.appendChild(node(document, 'span', label, 's3-nav-item'));
  container.appendChild(navigation);

  const exact = node(document, 'section', null, 's3-exact-head');
  exact.appendChild(node(document, 'h3', 'Exact Head'));
  exact.appendChild(node(document, 'p', `Expected: ${viewModel.exactHead?.expected || 'unbound'}`));
  exact.appendChild(node(document, 'p', `Observed: ${viewModel.exactHead?.observed || 'unobserved'}`));
  exact.appendChild(node(document, 'p', `Match: ${viewModel.exactHead?.matches ? 'YES' : 'NO'}`));
  container.appendChild(exact);

  const controls = node(document, 'div', null, 's3-controls');
  const observe = node(document, 'button', 'Refresh Read-Only GitHub Evidence');
  observe.type = 'button';
  observe.disabled = !viewModel.controls?.canObserve;
  observe.addEventListener('click', () => actions.observeDelivery?.());
  controls.appendChild(observe);
  const repair = node(document, 'button', 'Create Local Repair Proposal');
  repair.type = 'button';
  repair.disabled = !viewModel.controls?.canProposeRepair;
  repair.addEventListener('click', () => actions.createRepairProposal?.());
  controls.appendChild(repair);
  container.appendChild(controls);

  container.appendChild(section(document, 'Repositories', viewModel.repositories));
  container.appendChild(section(document, 'Ownership', [
    ...(viewModel.branchReservations || []),
    ...(viewModel.pathOwnershipClaims || []),
  ]));
  container.appendChild(section(document, 'Pull Requests', viewModel.pullRequestBindings));
  container.appendChild(section(document, 'Checks', viewModel.checkObservations));
  container.appendChild(section(document, 'Review Threads', viewModel.reviewThreadObservations));
  container.appendChild(section(document, 'Delivery Gates', viewModel.deliveryGates));
  container.appendChild(section(document, 'Merge Order', viewModel.mergeOrderConstraints));
  container.appendChild(section(document, 'Delivery Evidence', viewModel.deliveryEvidence));
  container.appendChild(section(document, 'Repair Proposals', viewModel.repairProposals));

  const blockers = section(document, 'Blockers', viewModel.blockers, (card, blocker) => {
    card.appendChild(node(document, 'strong', blocker.label || blocker.code));
    card.appendChild(node(document, 'p', blocker.code));
    if (blocker.detail !== undefined) appendJson(document, card, blocker.detail);
  });
  container.appendChild(blockers);
  return container;
}

module.exports = { renderS3GitHubDelivery };
