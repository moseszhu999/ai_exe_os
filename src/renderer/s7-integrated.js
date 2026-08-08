(() => {
  'use strict';

  const bridge = window.aiExecutionOS?.s7?.sync;
  const cockpit = document.getElementById('s4-cockpit');
  if (!bridge || !cockpit) return;

  const sensitiveKey = /^(authorization|proxy-authorization|cookie|cookies|set-cookie|password|passwd|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|private[_ -]?key|profilePath|profileDir|profileDirectory|browserProfile|userData|userDataDir|storageState|processId|pid|ppid|body|responseBody|environment|env|debugEndpoint|controlHandle)$/i;
  const sensitiveString = /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sessionid|access_token|refresh_token|id_token)=)/i;
  const safe = (value, key = '', seen = new Set()) => {
    if (sensitiveKey.test(key)) return '[redacted]';
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return sensitiveString.test(value) ? '[redacted]' : value;
    if (typeof value !== 'object') return value;
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const output = Array.isArray(value)
      ? value.map((item) => safe(item, '', seen))
      : Object.fromEntries(Object.entries(value).map(([nestedKey, nested]) => [nestedKey, safe(nested, nestedKey, seen)]));
    seen.delete(value);
    return output;
  };
  const el = (tag, text = null, className = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== null) node.textContent = String(text);
    return node;
  };
  const card = (container, title, detail) => {
    const node = el('div', null, 'card');
    node.append(el('strong', title), el('p', detail));
    container.append(node);
  };
  const currentWorkspaceId = () => document.querySelector('#s1-workspace')?.value || 'workspace-a';

  let snapshot = null;
  let pending = false;

  const panel = el('section', null, 'mission-shell');
  panel.id = 's7-sync-panel';
  panel.setAttribute('aria-label', 'S7 optional collaboration and sync mirror');

  const heading = el('div', null, 'section-heading');
  const headingText = el('div');
  headingText.append(el('p', 'S7 optional collaboration mirror', 'eyebrow'), el('h2', 'Collaboration & Sync'));
  const summary = el('strong', 'Sync disabled / unavailable');
  summary.id = 's7-summary';
  heading.append(headingText, summary);
  panel.append(heading);

  const nav = el('nav', null, 'surface-nav');
  for (const name of ['Sync Status','Source Instance','Endpoint / Mode','Outbound Cursor','Acknowledged Cursor','Pending Envelopes','Remote Sources','Gap / Divergence','Members / Roles','Shared Workspace','Remote Worker Presence']) nav.append(el('span', name));
  panel.append(nav);

  const controls = el('section', null, 'grid three');
  const configCard = el('article');
  configCard.append(el('h3', 'Sync Status / Endpoint Mode'));
  const mode = document.createElement('select');
  mode.id = 's7-sync-mode';
  mode.setAttribute('aria-label', 'S7 sync mode');
  for (const value of ['disabled', 'enabled', 'paused']) {
    const option = el('option', value);
    option.value = value;
    mode.append(option);
  }
  const configure = el('button', 'Record sync mode');
  configure.id = 's7-configure';
  configure.type = 'button';
  const configState = el('pre', 'No SyncConfiguration.');
  configState.id = 's7-config-state';
  configCard.append(mode, configure, configState);

  const actionCard = el('article');
  actionCard.append(el('h3', 'Explicit Sync Actions'));
  const push = el('button', 'Push pending safe envelopes');
  push.id = 's7-push';
  push.type = 'button';
  const pull = el('button', 'Pull collaboration mirror', 'secondary');
  pull.id = 's7-pull';
  pull.type = 'button';
  const actionState = el('pre', 'No sync network action in this process.');
  actionState.id = 's7-action-state';
  actionCard.append(push, pull, actionState);

  const memberCard = el('article');
  memberCard.append(el('h3', 'Local Collaboration Visibility'));
  const role = document.createElement('select');
  role.id = 's7-team-role';
  role.setAttribute('aria-label', 'Local operator TeamRole');
  for (const value of ['owner-view', 'operator-view', 'reviewer-view', 'observer-view']) {
    const option = el('option', value);
    option.value = value;
    role.append(option);
  }
  const recordMembership = el('button', 'Record local operator visibility');
  recordMembership.id = 's7-record-membership';
  recordMembership.type = 'button';
  const memberState = el('pre', 'No local collaboration membership.');
  memberState.id = 's7-member-state';
  memberCard.append(role, recordMembership, memberState);
  controls.append(configCard, actionCard, memberCard);
  panel.append(controls);

  const detail = el('section', null, 'grid three');
  const cursorCard = el('article'); cursorCard.append(el('h3', 'Source / Cursor'));
  const cursorState = el('pre', 'No source identity / cursor.'); cursorState.id = 's7-cursor'; cursorCard.append(cursorState);
  const pendingCard = el('article'); pendingCard.append(el('h3', 'Pending Envelopes'));
  const pendingList = el('div', null, 'cards'); pendingList.id = 's7-pending'; pendingCard.append(pendingList);
  const remoteCard = el('article'); remoteCard.append(el('h3', 'Remote Sources'));
  const remoteList = el('div', null, 'cards'); remoteList.id = 's7-remote-sources'; remoteCard.append(remoteList);
  const divergenceCard = el('article'); divergenceCard.append(el('h3', 'Gap / Divergence'));
  const divergenceList = el('div', null, 'cards'); divergenceList.id = 's7-divergence'; divergenceCard.append(divergenceList);
  const sharedCard = el('article'); sharedCard.append(el('h3', 'Shared Workspace'));
  const sharedList = el('div', null, 'cards'); sharedList.id = 's7-shared'; sharedCard.append(sharedList);
  const presenceCard = el('article'); presenceCard.append(el('h3', 'Remote Worker Presence'));
  const presenceList = el('div', null, 'cards'); presenceList.id = 's7-presence'; presenceCard.append(presenceList, el('p', 'Read-only presence. S7 exposes no remote Worker control.'));
  detail.append(cursorCard, pendingCard, remoteCard, divergenceCard, sharedCard, presenceCard);
  panel.append(detail);

  cockpit.append(panel);

  function render() {
    const data = safe(snapshot || {});
    const enabled = data.configuration?.status === 'enabled';
    summary.textContent = data.found
      ? `${data.configuration?.status || 'disabled'} · ${data.remoteSources?.length || 0} remote source(s) · ${data.pendingEnvelopes?.length || 0} pending`
      : 'Workspace sync state unavailable';
    mode.value = data.configuration?.status || 'disabled';
    configState.textContent = data.configuration ? JSON.stringify(data.configuration, null, 2) : 'No SyncConfiguration. Endpoint identity is configured only by the main process.';
    configure.disabled = pending || !data.found;
    push.disabled = pending || !enabled;
    pull.disabled = pending || !enabled;

    const localMembership = (data.memberships || []).find((item) => item.subjectId === 'local-operator' && item.status === 'active') || null;
    if (localMembership?.teamRoleId) role.value = localMembership.teamRoleId;
    memberState.textContent = localMembership ? JSON.stringify(localMembership, null, 2) : 'No active local-operator membership. Remote record payloads remain hidden.';
    recordMembership.disabled = pending || !data.found;

    cursorState.textContent = JSON.stringify({
      sourceInstance: data.sourceInstance || null,
      cursor: data.cursor || null,
    }, null, 2);

    pendingList.replaceChildren();
    for (const item of data.pendingEnvelopes || []) card(pendingList, `${item.cursor} · ${item.recordClass}`, `${item.recordId} · ${item.envelopeDigest}`);
    if (!(data.pendingEnvelopes || []).length) pendingList.append(el('p', 'No pending collaboration-safe envelope.'));

    remoteList.replaceChildren();
    for (const item of data.remoteSources || []) card(remoteList, item.sourceInstanceId, `${item.status || 'unknown'} · cursor ${item.lastCursor ?? '—'}`);
    if (!(data.remoteSources || []).length) remoteList.append(el('p', 'No remote source mirrored.'));

    divergenceList.replaceChildren();
    for (const item of data.divergences || []) card(divergenceList, item.reasonCode || 'divergence', `${item.sourceInstanceId || 'source'} · cursor ${item.cursor ?? '—'}`);
    if (!(data.divergences || []).length) divergenceList.append(el('p', 'No recorded gap/divergence.'));

    sharedList.replaceChildren();
    presenceList.replaceChildren();
    let presenceCount = 0;
    for (const shared of data.sharedWorkspaces || []) {
      card(sharedList, `${shared.remoteSourceInstanceId} · ${shared.syncStatus}`, `${(shared.records || []).length} visible record(s) · cursor ${shared.syncCursor}`);
      for (const record of shared.records || []) {
        if (record.recordClass !== 'worker-presence.summary') continue;
        const worker = record.payload || {};
        card(presenceList, worker.workerPublicId || record.recordId, `${worker.statusClass || 'unknown'} · ${worker.browserChannelClass || 'unknown'} · ${worker.role || 'unknown'}`);
        presenceCount += 1;
      }
    }
    if (!(data.sharedWorkspaces || []).length) sharedList.append(el('p', localMembership ? 'No remote SharedWorkspaceSnapshot yet.' : 'Record a local collaboration membership to view remote mirror payloads.'));
    if (!presenceCount) presenceList.append(el('p', 'No visible remote Worker presence.'));
  }

  async function refresh() {
    snapshot = await bridge.queryState(currentWorkspaceId());
    render();
  }

  async function action(command, target) {
    if (pending) return;
    pending = true;
    render();
    try {
      const result = await command();
      target.textContent = JSON.stringify(safe(result), null, 2);
      await refresh();
    } catch (error) {
      target.textContent = error.message || String(error);
    } finally {
      pending = false;
      render();
    }
  }

  configure.addEventListener('click', () => action(() => bridge.configureSync({ workspaceId: currentWorkspaceId(), status: mode.value }), configState));
  push.addEventListener('click', () => action(() => bridge.pushPending({ workspaceId: currentWorkspaceId() }), actionState));
  pull.addEventListener('click', () => action(() => bridge.pullMirror({ workspaceId: currentWorkspaceId() }), actionState));
  recordMembership.addEventListener('click', () => action(() => bridge.recordMembership({
    workspaceId: currentWorkspaceId(),
    subjectId: 'local-operator',
    teamRoleId: role.value,
    status: 'active',
  }), memberState));
  document.querySelector('#s1-workspace')?.addEventListener('change', () => refresh().catch((error) => { summary.textContent = error.message; }));
  document.querySelector('#refresh')?.addEventListener('click', () => refresh().catch((error) => { summary.textContent = error.message; }));
  queueMicrotask(() => refresh().catch((error) => { summary.textContent = error.message; }));
})();
