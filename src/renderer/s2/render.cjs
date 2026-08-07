'use strict';

function element(documentRef, tag, text, className = '') {
  const node = documentRef.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function renderS2Mission(container, viewModel, controller, documentRef = globalThis.document) {
  if (!container || !documentRef?.createElement) throw new TypeError('container and document are required');
  container.textContent = '';
  const root = element(documentRef, 'section', null, 's2-mission');
  const header = element(documentRef, 'header', null, 's2-mission__header');
  header.append(element(documentRef, 'h2', viewModel.selectedMission?.title || 'Missions'));
  header.append(element(documentRef, 'p', viewModel.activeWorkspace ? `Workspace: ${viewModel.activeWorkspace.name || viewModel.activeWorkspace.id}` : 'No Workspace'));
  root.append(header);

  const nav = element(documentRef, 'nav', null, 's2-mission__nav');
  for (const item of viewModel.navigation || []) nav.append(element(documentRef, 'span', item, 's2-mission__nav-item'));
  root.append(nav);

  const controls = element(documentRef, 'div', null, 's2-mission__controls');
  const run = viewModel.selectedRun;
  if (run) {
    for (const [action, enabled] of [['pauseMission', viewModel.controls.canPause], ['resumeMission', viewModel.controls.canResume], ['cancelMission', viewModel.controls.canCancel]]) {
      const button = element(documentRef, 'button', action.replace('Mission', ''), `s2-mission__${action}`);
      button.disabled = !enabled;
      button.addEventListener('click', () => controller[action]({ workspaceId: viewModel.activeWorkspace.id, missionId: run.missionId, runId: run.id }));
      controls.append(button);
    }
  }
  root.append(controls);

  const graph = element(documentRef, 'section', null, 's2-mission__graph');
  graph.append(element(documentRef, 'h3', 'Execution Plan'));
  for (const node of viewModel.graph?.nodes || []) {
    const card = element(documentRef, 'article', null, `s2-step s2-step--${node.state}`);
    card.dataset.stepId = node.id;
    card.append(element(documentRef, 'strong', node.name));
    card.append(element(documentRef, 'span', node.state));
    graph.append(card);
  }
  for (const edge of viewModel.graph?.edges || []) graph.append(element(documentRef, 'div', `${edge.fromStepId} → ${edge.toStepId}`, 's2-edge'));
  root.append(graph);

  const blockers = element(documentRef, 'section', null, 's2-mission__blockers');
  blockers.append(element(documentRef, 'h3', 'Blockers / Recovery'));
  for (const blocker of viewModel.blockers || []) blockers.append(element(documentRef, 'p', `${blocker.stepId}: ${blocker.label}`));
  root.append(blockers);

  const handoffs = element(documentRef, 'section', null, 's2-mission__handoffs');
  handoffs.append(element(documentRef, 'h3', 'Agent Handoffs'));
  for (const handoff of viewModel.handoffs || []) {
    handoffs.append(element(documentRef, 'p', `${handoff.fromStepAttemptId} / ${handoff.output?.outputName || handoff.output?.id} → ${handoff.toStepId}.${handoff.inputName}`));
  }
  root.append(handoffs);

  const checkpoints = element(documentRef, 'section', null, 's2-mission__checkpoints');
  checkpoints.append(element(documentRef, 'h3', 'Checkpoints'));
  for (const checkpoint of viewModel.checkpoints || []) checkpoints.append(element(documentRef, 'p', `${checkpoint.id}: ${checkpoint.projectionDigest || ''}`));
  root.append(checkpoints);

  const timeline = element(documentRef, 'section', null, 's2-mission__timeline');
  timeline.append(element(documentRef, 'h3', 'Run Timeline'));
  for (const event of viewModel.timeline || []) timeline.append(element(documentRef, 'p', event.type || event.eventType || 'event'));
  root.append(timeline);

  container.append(root);
  return root;
}

module.exports = { renderS2Mission };
