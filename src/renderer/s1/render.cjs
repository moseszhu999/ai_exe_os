'use strict';

function element(document, tag, className, text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null) node.textContent = String(text);
  return node;
}

function appendList(document, parent, items, emptyText, renderItem) {
  if (!items.length) {
    parent.append(element(document, 'p', 's1-empty', emptyText));
    return;
  }
  const list = element(document, 'div', 's1-list');
  for (const item of items) list.append(renderItem(item));
  parent.append(list);
}

function renderS1App({ document, root, model, controller }) {
  root.replaceChildren();
  const shell = element(document, 'section', 's1-shell');
  shell.dataset.workspaceId = model.activeWorkspace?.id || '';

  const nav = element(document, 'nav', 's1-navigation');
  for (const name of model.navigation) nav.append(element(document, 'button', 's1-nav-item', name));
  shell.append(nav);

  const header = element(document, 'header', 's1-header');
  header.append(element(document, 'h2', '', model.activeWorkspace?.name || 'Select a Workspace'));
  header.append(element(document, 'p', 's1-summary', `Agents ${model.counts.agents} · Tasks ${model.counts.tasks} · Waiting ${model.counts.waitingHuman} · Evidence ${model.counts.evidence}`));
  shell.append(header);

  const blockers = element(document, 'section', 's1-panel s1-blockers');
  blockers.append(element(document, 'h3', '', 'Blockers'));
  appendList(document, blockers, model.blockers, 'No blockers', (item) => {
    const row = element(document, 'article', 's1-blocker');
    row.append(element(document, 'strong', '', item.label));
    row.append(element(document, 'span', '', `Task ${item.taskId}`));
    return row;
  });
  shell.append(blockers);

  const gates = element(document, 'section', 's1-panel s1-gates');
  gates.append(element(document, 'h3', '', 'Human Gates'));
  appendList(document, gates, model.humanGates, 'No pending Human Gates', (gate) => {
    const card = element(document, 'article', 's1-gate-card');
    card.append(element(document, 'strong', '', `${gate.capabilityAction} → ${gate.target}`));
    card.append(element(document, 'p', '', `Agent ${gate.agentId || '—'} · Worker ${gate.workerId}`));
    card.append(element(document, 'pre', 's1-payload', JSON.stringify(gate.payloadPreview || {}, null, 2)));
    if (gate.state === 'requested') {
      const reject = element(document, 'button', 's1-reject', 'Reject');
      const approve = element(document, 'button', 's1-approve', 'Approve once');
      reject.addEventListener('click', () => controller.rejectHumanGate({ workspaceId: gate.workspaceId, gateId: gate.id }));
      approve.addEventListener('click', () => controller.approveHumanGate({ workspaceId: gate.workspaceId, gateId: gate.id }));
      card.append(reject, approve);
    }
    return card;
  });
  shell.append(gates);

  const evidence = element(document, 'section', 's1-panel s1-evidence');
  evidence.append(element(document, 'h3', '', 'Evidence'));
  appendList(document, evidence, model.evidence, 'No evidence yet', (item) => {
    const row = element(document, 'article', 's1-evidence-row');
    row.append(element(document, 'strong', '', item.type || 'evidence'));
    row.append(element(document, 'span', '', `${item.taskId || '—'} / ${item.executionRunId || '—'} / ${item.workerId || '—'}`));
    return row;
  });
  shell.append(evidence);
  root.append(shell);
  return shell;
}

module.exports = { renderS1App };
