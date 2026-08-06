const api = window.aiExecutionOS;
const statusElement = document.getElementById('status');
let state = { workers: [], tasks: [], events: [] };

function showStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.style.display = 'block';
  statusElement.style.borderColor = isError ? '#ff858b' : '#65d8ff';
  setTimeout(() => { statusElement.style.display = 'none'; }, 4200);
}

async function call(action) {
  try {
    const result = await action();
    await refresh();
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

async function refresh() {
  state = await api.getState();
  document.getElementById('workers').replaceChildren(...state.workers.map(workerCard));
  document.getElementById('tasks').replaceChildren(...state.tasks.map(taskCard));
  document.getElementById('events').textContent = state.events.map((event) => JSON.stringify(event)).join('\n');
}

document.getElementById('refresh').addEventListener('click', () => call(refresh));
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
