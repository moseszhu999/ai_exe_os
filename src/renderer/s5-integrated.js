(() => {
  'use strict';

  const bridge = window.aiExecutionOS?.s5?.provider;
  const cockpit = document.getElementById('s4-cockpit');
  if (!bridge || !cockpit) return;

  const sensitiveKey = /^(password|passwd|authorization|proxy-authorization|cookie|cookies|set-cookie|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|private[_ -]?key|profilePath|profileDir|profileDirectory|browserProfile|userData|userDataDir|storageState|processId|pid|ppid|body|responseBody)$/i;
  const sensitiveString = /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\b(?:sessionid|access_token|refresh_token)=)/i;
  const safe = (value, key = '') => {
    if (sensitiveKey.test(key)) return '[redacted]';
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return sensitiveString.test(value) ? '[redacted]' : value;
    if (Array.isArray(value)) return value.map((item) => safe(item));
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([nestedKey, nested]) => [nestedKey, safe(nested, nestedKey)]));
    return value;
  };
  const el = (tag, text = null, className = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== null) node.textContent = String(text);
    return node;
  };
  const field = (parent, label, value) => parent.append(el('p', `${label}: ${value == null ? '—' : value}`));

  let snapshot = null;
  let selectedBindingId = null;
  let pending = false;

  const panel = el('section', null, 'grid three');
  panel.id = 's5-provider-panel';
  panel.setAttribute('aria-label', 'S5 approved provider observation');

  const adapterCard = el('article');
  adapterCard.append(el('h3', 'Approved Provider Adapters'));
  const adapters = el('div', null, 'cards');
  adapters.id = 's5-adapters';
  adapterCard.append(adapters);

  const targetCard = el('article');
  targetCard.append(el('h3', 'Approved Targets'));
  const bindingSelect = document.createElement('select');
  bindingSelect.id = 's5-binding-select';
  bindingSelect.setAttribute('aria-label', 'Approved provider target');
  targetCard.append(bindingSelect);
  const bindingDetail = el('pre', 'No approved target bound');
  bindingDetail.id = 's5-binding-detail';
  targetCard.append(bindingDetail);
  const observeButton = el('button', 'Observe selected approved target');
  observeButton.type = 'button';
  observeButton.id = 's5-observe';
  targetCard.append(observeButton);

  const evidenceCard = el('article');
  evidenceCard.append(el('h3', 'Provider Observations & Evidence'));
  const observationDetail = el('pre', 'No canonical provider observation yet.');
  observationDetail.id = 's5-observation';
  const methodAudit = el('pre', 'No provider request in this process.');
  methodAudit.id = 's5-method-audit';
  evidenceCard.append(observationDetail, methodAudit);

  panel.append(adapterCard, targetCard, evidenceCard);
  cockpit.append(panel);

  function currentBinding(data) {
    return (data?.bindings || []).find((item) => item.id === selectedBindingId) || data?.bindings?.[0] || null;
  }

  function latestObservation(data, bindingId) {
    return (data?.observations || [])
      .filter((item) => item.bindingId === bindingId)
      .sort((left, right) => String(right.observedAt).localeCompare(String(left.observedAt)))[0] || null;
  }

  function render() {
    const data = safe(snapshot || {});
    adapters.replaceChildren();
    for (const adapter of data.adapters || []) {
      const card = el('div', null, 'card');
      field(card, 'Adapter', adapter.id);
      field(card, 'Provider', adapter.provider);
      field(card, 'Version', adapter.version);
      field(card, 'Action', adapter.actions?.[0]?.id || 'observe_public_deployment');
      adapters.append(card);
    }

    bindingSelect.replaceChildren();
    const empty = el('option', 'Select approved provider binding');
    empty.value = '';
    bindingSelect.append(empty);
    for (const binding of data.bindings || []) {
      const option = el('option', `${binding.provider} · ${binding.exactTarget}`);
      option.value = binding.id;
      bindingSelect.append(option);
    }
    const binding = currentBinding(data);
    if (!selectedBindingId || !(data.bindings || []).some((item) => item.id === selectedBindingId)) selectedBindingId = binding?.id || null;
    if (selectedBindingId) bindingSelect.value = selectedBindingId;
    const selected = currentBinding(data);
    bindingDetail.textContent = selected ? JSON.stringify(safe({
      id: selected.id,
      provider: selected.provider,
      adapterId: selected.adapterId,
      providerContractId: selected.providerContractId,
      action: selected.action,
      exactTarget: selected.exactTarget,
      status: selected.status,
    }), null, 2) : 'No approved target bound';
    observeButton.disabled = pending || !data.found || !selected || selected.status !== 'active';

    const observation = selected ? latestObservation(data, selected.id) : null;
    observationDetail.textContent = observation ? JSON.stringify(safe(observation), null, 2) : 'No canonical provider observation yet.';
    methodAudit.textContent = data.methodAudit?.length
      ? `Method audit · current process\n${JSON.stringify(safe(data.methodAudit), null, 2)}`
      : 'No provider request in this process.';
  }

  async function refresh() {
    const workspaceId = document.querySelector('#s1-workspace')?.value || 'workspace-a';
    snapshot = await bridge.queryState(workspaceId);
    render();
  }

  async function observe() {
    if (pending || !selectedBindingId || !snapshot?.workspaceId) return;
    pending = true;
    render();
    try {
      await bridge.observe({ workspaceId: snapshot.workspaceId, bindingId: selectedBindingId });
      await refresh();
    } finally {
      pending = false;
      render();
    }
  }

  bindingSelect.addEventListener('change', () => { selectedBindingId = bindingSelect.value || null; render(); });
  observeButton.addEventListener('click', () => observe().catch((error) => { observationDetail.textContent = error.message; }));
  document.querySelector('#s1-workspace')?.addEventListener('change', () => { selectedBindingId = null; refresh().catch((error) => { observationDetail.textContent = error.message; }); });
  document.querySelector('#refresh')?.addEventListener('click', () => refresh().catch((error) => { observationDetail.textContent = error.message; }));
  queueMicrotask(() => refresh().catch((error) => { observationDetail.textContent = error.message; }));
})();

if (!document.querySelector('script[data-s6-scheduling]')) {
  const s6Script = document.createElement('script');
  s6Script.src = 's6-integrated.js';
  s6Script.dataset.s6Scheduling = 'true';
  document.body.append(s6Script);
}
