(() => {
  'use strict';

  const bridge = window.aiExecutionOS?.s4?.console;
  if (!bridge) return;

  const sensitiveKey = /^(password|passwd|authorization|cookie|cookies|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|private[_ -]?key|profilePath|profileDir|profileDirectory|browserProfile|userData|userDataDir|storageState|processId|pid|ppid)$/i;
  const sensitiveString = /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sessionid|access_token|refresh_token)=)/i;
  const safe = (value, key = '') => {
    if (sensitiveKey.test(key)) return '[redacted]';
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return sensitiveString.test(value) ? '[redacted]' : value;
    if (Array.isArray(value)) return value.map((item) => safe(item));
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, safe(v, k)]));
    return value;
  };

  const el = (tag, text = null, className = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== null) node.textContent = String(text);
    return node;
  };

  let snapshot = null;
  let selectedWorkerId = null;
  let pending = false;

  const shell = el('section', null, 'mission-shell');
  shell.id = 's4-cockpit';
  shell.setAttribute('aria-labelledby', 's4-heading');
  const heading = el('div', null, 'section-heading');
  const headingText = el('div');
  headingText.append(el('p', 'S4 multi-session operator console', 'eyebrow'), el('h2', 'Operator Cockpit'));
  headingText.querySelector('h2').id = 's4-heading';
  const summary = el('strong', 'No Workspace selected');
  summary.id = 's4-summary';
  heading.append(headingText, summary);
  shell.append(heading);

  const nav = el('nav', null, 'surface-nav');
  nav.id = 's4-navigation';
  for (const name of ['Cockpit / Overview','Projects & Workspaces','Missions / Execution Graph','Workers & Sessions','Agents / Capabilities / Provider Use','Human Gate Inbox','Blockers & Recovery','GitHub Delivery','Evidence & Event Lineage']) nav.append(el('span', name));
  shell.append(nav);

  const grid = el('section', null, 'grid three');
  const workersCard = el('article');
  workersCard.append(el('h3', 'Workers & Sessions'));
  const workerSelect = document.createElement('select');
  workerSelect.id = 's4-worker-select';
  workersCard.append(workerSelect);
  const workerState = el('pre', 'No Worker selected');
  workerState.id = 's4-worker-state';
  workersCard.append(workerState);

  const controlCard = el('article');
  controlCard.append(el('h3', 'Selected Worker Control'));
  const controlButtons = {};
  for (const [name, label] of [['focusWorker','Focus'],['pauseWorker','Pause'],['resumeWorker','Resume'],['stopWorker','Stop selected Worker']]) {
    const button = el('button', label, name === 'stopWorker' ? 'danger' : 'secondary');
    button.type = 'button';
    button.id = `s4-${name}`;
    button.addEventListener('click', () => control(name));
    controlCard.append(button);
    controlButtons[name] = button;
  }

  const attentionCard = el('article');
  attentionCard.append(el('h3', 'Human Gate / Blockers / Recovery'));
  const attention = el('div', null, 'cards');
  attention.id = 's4-attention';
  attentionCard.append(attention);
  grid.append(workersCard, controlCard, attentionCard);
  shell.append(grid);

  const detailGrid = el('section', null, 'grid three');
  const missions = el('article'); missions.append(el('h3', 'Missions / Execution Graph'));
  const missionList = el('div', null, 'cards'); missionList.id = 's4-missions'; missions.append(missionList);
  const github = el('article'); github.append(el('h3', 'GitHub Delivery · Read-Only'));
  const githubList = el('div', null, 'cards'); githubList.id = 's4-github'; github.append(githubList);
  const lineage = el('article'); lineage.append(el('h3', 'Evidence & Event Lineage'));
  const lineageList = el('pre', 'No attention lineage'); lineageList.id = 's4-lineage'; lineage.append(lineageList);
  detailGrid.append(missions, github, lineage);
  shell.append(detailGrid);

  document.querySelector('main').insertBefore(shell, document.querySelector('.mission-shell'));

  function card(container, title, detail) {
    const node = el('div', null, 'card');
    node.append(el('strong', title), el('p', detail));
    container.append(node);
  }

  function selectedWorker() {
    return (snapshot?.workers || []).find((worker) => worker.workerId === selectedWorkerId) || null;
  }

  function render() {
    const data = safe(snapshot || {});
    summary.textContent = data.found ? `Workspace ${data.workspaceId} · ${data.workers?.length || 0} Worker(s) · ${data.attention?.length || 0} attention` : `Workspace unavailable: ${data.workspaceId || 'none'}`;
    workerSelect.replaceChildren();
    for (const worker of data.workers || []) {
      const option = el('option', `${worker.workerId} · ${worker.browserChannel || 'runtime'} · ${worker.status}`);
      option.value = worker.workerId;
      workerSelect.append(option);
    }
    if (!selectedWorkerId || !(data.workers || []).some((worker) => worker.workerId === selectedWorkerId)) selectedWorkerId = data.workers?.[0]?.workerId || null;
    if (selectedWorkerId) workerSelect.value = selectedWorkerId;
    const worker = selectedWorker();
    workerState.textContent = worker ? JSON.stringify(safe(worker), null, 2) : 'No Worker selected';
    const controls = worker?.controls || {};
    controlButtons.focusWorker.disabled = pending || !controls.canFocus;
    controlButtons.stopWorker.disabled = pending || !controls.canStop;
    controlButtons.pauseWorker.disabled = pending || !controls.canPause;
    controlButtons.resumeWorker.disabled = pending || !controls.canResume;

    attention.replaceChildren();
    for (const item of data.attention || []) card(attention, item.code, `${item.sourceKind} · ${item.aggregateId || 'unknown'}${item.provenanceAvailable ? '' : ' · provenance unavailable'}`);
    missionList.replaceChildren();
    for (const mission of data.missions || []) card(missionList, mission.title || mission.missionId, `${mission.state} · ${(mission.steps || []).length} step(s)`);
    githubList.replaceChildren();
    for (const gate of data.github?.deliveryGates || []) card(githubList, gate.id, `${gate.state} · ${(gate.blockers || []).map((item) => item.code).join(', ') || 'no blockers'}`);
    const firstAttention = data.attention?.[0];
    lineageList.textContent = firstAttention ? JSON.stringify(data.lineage?.[firstAttention.id] || { available: false, missingProvenance: true }, null, 2) : 'No attention lineage';
  }

  async function refresh() {
    const workspaceId = document.querySelector('#s1-workspace')?.value || 'workspace-a';
    snapshot = await bridge.query(workspaceId);
    render();
  }

  async function control(name) {
    if (pending || !selectedWorkerId || !snapshot?.workspaceId) return;
    pending = true;
    render();
    try {
      await bridge[name]({ workspaceId: snapshot.workspaceId, workerId: selectedWorkerId });
      await refresh();
    } finally {
      pending = false;
      render();
    }
  }

  workerSelect.addEventListener('change', () => { selectedWorkerId = workerSelect.value || null; render(); });
  document.querySelector('#s1-workspace')?.addEventListener('change', () => { selectedWorkerId = null; refresh().catch((error) => { summary.textContent = error.message; }); });
  document.querySelector('#refresh')?.addEventListener('click', () => refresh().catch((error) => { summary.textContent = error.message; }));
  queueMicrotask(() => refresh().catch((error) => { summary.textContent = error.message; }));
})();
