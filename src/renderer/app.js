const api = window.aiExecutionOS;
const statusElement = document.getElementById('status');
let state = { workers: [], tasks: [], events: [] };
let s1State = null;
let activeWorkspaceId = 'workspace-a';

const BLOCKER_LABELS = Object.freeze({
  workspace_inactive: 'Workspace is inactive',
  agent_inactive: 'Agent is inactive',
  installation_missing_or_disabled: 'Capability is not installed or is disabled',
  grant_missing_or_revoked: 'Agent capability grant is missing or revoked',
  action_or_target_not_granted: 'Action or target is outside the Agent grant',
  provider_contract_unknown: 'Provider contract is not accepted',
  provider_contract_changed_or_expired: 'Provider contract changed or expired',
  dependency_unsatisfied: 'Task dependency is not satisfied',
  resource_conflict: 'An exclusive resource is already reserved',
  human_gate_required: 'Human approval is required',
  recovery_requires_review: 'Recovered execution requires human review',
});

function showStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.style.display = 'block';
  statusElement.style.borderColor = isError ? '#ff858b' : '#65d8ff';
  setTimeout(() => { statusElement.style.display = 'none'; }, 4200);
}

async function call(action, message = null) {
  try {
    const result = await action();
    await refresh();
    if (message) showStatus(message);
    return result;
  } catch (error) {
    showStatus(error.message || String(error), true);
    return null;
  }
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function actionButton(label, className, handler) {
  const button = element('button', label, className);
  button.addEventListener('click', handler);
  return button;
}

function workerCard(worker) {
  const card = element('div');
  card.append(
    element('strong', worker.id),
    element('p', `${worker.role} · ${worker.browserChannel} · ${worker.status}`),
    element('small', worker.lastKnownUrl || 'not started'),
  );
  const actions = element('div', undefined, 'card-actions');
  actions.append(
    actionButton('Start', '', () => call(() => api.startWorker(worker.id))),
    actionButton('Focus', 'secondary', () => call(() => api.focusWorker(worker.id))),
    actionButton('Pause', 'secondary', () => call(() => api.pauseWorker(worker.id))),
    actionButton('Resume', 'secondary', () => call(() => api.resumeWorker(worker.id))),
    actionButton('Stop', 'danger', () => call(() => api.stopWorker(worker.id))),
  );
  card.append(actions);
  return card;
}

function taskCard(task) {
  const card = element('div');
  card.append(
    element('strong', task.title),
    element('p', `${task.id} · ${task.state} · revision ${task.revision}`),
    element('small', JSON.stringify(task.payload)),
  );
  const label = element('label', 'Worker');
  const select = element('select');
  select.className = 'task-worker';
  for (const worker of state.workers) {
    const option = element('option', worker.id);
    option.value = worker.id;
    select.append(option);
  }
  label.append(select);
  card.append(label);
  card.append(actionButton('Review payload and submit to local test page', '', () => {
    const workerId = select.value;
    if (!workerId) return showStatus('Create a worker first', true);
    const payload = typeof task.payload === 'string' ? task.payload : JSON.stringify(task.payload);
    const accepted = window.confirm(`Authorized local test submission\n\nWorker: ${workerId}\nTask: ${task.id}\nPayload:\n${payload}`);
    if (!accepted) return;
    call(() => api.confirmLocalTask({ workerId, taskId: task.id, payload }));
  }));
  return card;
}

function renderWorkspaceSelector() {
  const select = document.getElementById('s1-workspace');
  const ids = [...select.options].map((option) => option.value);
  const nextIds = s1State.workspaces.map((workspace) => workspace.id);
  if (JSON.stringify(ids) !== JSON.stringify(nextIds)) {
    select.replaceChildren(...s1State.workspaces.map((workspace) => {
      const option = element('option', workspace.name);
      option.value = workspace.id;
      return option;
    }));
  }
  select.value = activeWorkspaceId;
  const active = s1State.workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  document.getElementById('s1-workspace-summary').textContent = active
    ? `${active.name} · ${s1State.agents.length} agent · ${s1State.installations.length} installation · ${s1State.tasks.length} task`
    : 'Unknown Workspace';
}

function renderS1Workers() {
  const select = document.getElementById('s1-worker');
  select.replaceChildren(...s1State.workers.map((worker) => {
    const option = element('option', `${worker.id} · ${worker.browserChannel} · ${worker.status}`);
    option.value = worker.id;
    return option;
  }));
}

function renderS1Tasks() {
  document.getElementById('s1-tasks').replaceChildren(...s1State.tasks.map((task) => {
    const card = element('div');
    card.append(
      element('strong', task.id),
      element('p', `${task.state} · ${task.capabilityAction}`),
      element('small', `Graph ${task.graphId} · Run ${task.executionRunId || 'not requested'}`),
    );
    return card;
  }));
  const blockers = s1State.tasks.flatMap((task) => (task.blockers || []).map((entry) => ({ task, entry })));
  document.getElementById('s1-blockers').replaceChildren(...blockers.map(({ task, entry }) => {
    const card = element('div');
    card.append(element('strong', BLOCKER_LABELS[entry.code] || entry.code), element('small', `Task ${task.id}`));
    return card;
  }));
  if (!blockers.length) document.getElementById('s1-blockers').append(element('p', 'No blockers'));
}

function renderS1Gates() {
  const cards = s1State.humanGates.map((gate) => {
    const card = element('div');
    card.append(
      element('strong', `${gate.capabilityAction} → ${gate.target}`),
      element('p', `${gate.state} · Worker ${gate.workerId}`),
      element('small', JSON.stringify(gate.payloadPreview || {})),
    );
    if (gate.state === 'requested') {
      const actions = element('div', undefined, 'card-actions');
      actions.append(
        actionButton('Reject', 'danger', () => call(() => api.s1.rejectHumanGate({ workspaceId: activeWorkspaceId, gateId: gate.id }), 'Gate rejected; no submission occurred')),
        actionButton('Approve once', '', () => call(() => api.s1.approveHumanGate({ workspaceId: activeWorkspaceId, gateId: gate.id }), 'Approved execution result observed')),
      );
      card.append(actions);
    }
    return card;
  });
  document.getElementById('s1-gates').replaceChildren(...cards);
  if (!cards.length) document.getElementById('s1-gates').append(element('p', 'No Human Gates'));
}

function renderS1Evidence() {
  const cards = s1State.evidence.map((evidence) => {
    const card = element('div');
    card.append(
      element('strong', evidence.type),
      element('p', `${evidence.taskId} / ${evidence.executionRunId} / ${evidence.workerId}`),
      element('small', JSON.stringify(evidence.result)),
    );
    return card;
  });
  document.getElementById('s1-evidence').replaceChildren(...cards);
  if (!cards.length) document.getElementById('s1-evidence').append(element('p', 'No evidence yet'));
  document.getElementById('s1-events').textContent = s1State.events.map((event) => JSON.stringify(event)).join('\n');
}

function renderS1() {
  renderWorkspaceSelector();
  renderS1Workers();
  renderS1Tasks();
  renderS1Gates();
  renderS1Evidence();
  document.getElementById('s1-marketplace').textContent = s1State.marketplace
    .map((version) => `${version.packageId}@${version.version} · ${version.status}`)
    .join('\n') || 'No capabilities';
  document.getElementById('s1-agent-summary').textContent = s1State.agents
    .map((agent) => `${agent.name} · ${agent.status}`)
    .join('\n') || 'No Agent';
}

async function refresh() {
  [state, s1State] = await Promise.all([api.getState(), api.s1.queryState(activeWorkspaceId)]);
  document.getElementById('workers').replaceChildren(...state.workers.map(workerCard));
  document.getElementById('tasks').replaceChildren(...state.tasks.map(taskCard));
  document.getElementById('events').textContent = state.events.map((event) => JSON.stringify(event)).join('\n');
  renderS1();
}

document.getElementById('refresh').addEventListener('click', () => call(refresh));
document.getElementById('s1-workspace').addEventListener('change', (event) => {
  activeWorkspaceId = event.target.value;
  call(refresh);
});
document.getElementById('s1-install').addEventListener('click', () => call(
  () => api.s1.installCapability({ workspaceId: activeWorkspaceId, packageId: 'local.form-submit', version: '1.0.0' }),
  'Capability installed in selected Workspace',
));
document.getElementById('s1-grant').addEventListener('click', () => {
  const installation = s1State.installations.find((item) => item.packageId === 'local.form-submit' && item.status === 'installed');
  const agent = s1State.agents[0];
  if (!installation || !agent) return showStatus('Install the capability and select an Agent first', true);
  call(() => api.s1.grantCapability({
    workspaceId: activeWorkspaceId,
    agentId: agent.id,
    installationId: installation.id,
    allowedActions: ['submit_payload'],
    allowedTargets: ['http://127.0.0.1:43119/task-form.html'],
  }), 'Capability granted to Agent');
});
document.getElementById('s1-provision').addEventListener('click', async () => {
  const worker = s1State.workers.find((item) => item.id === document.getElementById('s1-worker').value);
  if (!worker) return showStatus('No Worker binding in this Workspace', true);
  await call(async () => {
    const existing = state.workers.find((item) => item.id === worker.id);
    if (!existing) {
      await api.createWorker({ id: worker.id, projectId: 's1-local-project', role: 'implementation', browserChannel: worker.browserChannel });
    }
    const current = (await api.getState()).workers.find((item) => item.id === worker.id);
    if (!current || ['created', 'stopped', 'failed'].includes(current.status)) await api.startWorker(worker.id);
  }, 'Worker provisioned and started');
});
document.getElementById('s1-create-task').addEventListener('click', () => {
  const agent = s1State.agents[0];
  const installation = s1State.installations.find((item) => item.packageId === 'local.form-submit' && item.status === 'installed');
  const workerId = document.getElementById('s1-worker').value || 's1-worker-chromium';
  call(() => api.s1.createTask({
    id: document.getElementById('s1-task-id').value.trim(),
    workspaceId: activeWorkspaceId,
    agentId: agent?.id || (activeWorkspaceId === 'workspace-a' ? 'agent-a' : 'agent-b'),
    installationId: installation?.id || 'install-missing',
    capabilityAction: 'submit_payload',
    target: 'http://127.0.0.1:43119/task-form.html',
    workerId,
    payload: document.getElementById('s1-task-payload').value,
  }), 'Task created and evaluated');
});

document.getElementById('create-worker').addEventListener('click', () => call(() => api.createWorker({
  id: document.getElementById('worker-id').value.trim(),
  projectId: 's0-local-project',
  role: document.getElementById('worker-role').value,
  browserChannel: document.getElementById('browser-channel').value,
})));
document.getElementById('create-task').addEventListener('click', () => call(() => api.createTask({
  id: document.getElementById('task-id').value.trim(),
  projectId: 's0-local-project',
  title: document.getElementById('task-title').value.trim(),
  payload: document.getElementById('task-payload').value,
})));
document.getElementById('observe-pr').addEventListener('click', async () => {
  const repository = document.getElementById('github-repository').value.trim();
  const [owner, repo, extra] = repository.split('/');
  if (!owner || !repo || extra) return showStatus('Use owner/repository format', true);
  const number = Number(document.getElementById('github-pr-number').value);
  const result = await call(() => api.observePullRequest({ owner, repo, number }));
  if (result) showStatus(result.changed ? 'New GitHub state recorded' : 'GitHub state unchanged; no duplicate event created');
});

refresh().catch((error) => showStatus(error.message, true));
