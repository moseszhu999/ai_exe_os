(() => {
  'use strict';

  const bridge = window.aiExecutionOS?.s6?.scheduling;
  const cockpit = document.getElementById('s4-cockpit');
  if (!bridge || !cockpit) return;

  const sensitiveKey = /^(password|passwd|authorization|proxy-authorization|cookie|cookies|set-cookie|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|private[_ -]?key|profilePath|profileDir|profileDirectory|browserProfile|userData|userDataDir|storageState|processId|pid|ppid|body|responseBody|environment|env)$/i;
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
  const currentWorkspaceId = () => document.querySelector('#s1-workspace')?.value || 'workspace-a';

  let snapshot = null;
  let selectedProposalId = null;
  let pending = false;

  const panel = el('section', null, 'mission-shell');
  panel.id = 's6-scheduling-panel';
  panel.setAttribute('aria-label', 'S6 scheduling policy and assignment explanation');

  const heading = el('div', null, 'section-heading');
  const headingText = el('div');
  headingText.append(el('p', 'S6 deterministic bounded utilization', 'eyebrow'), el('h2', 'Scheduling Policy & Assignment Explanation'));
  const summary = el('strong', 'No SchedulingPolicySnapshot');
  summary.id = 's6-summary';
  heading.append(headingText, summary);
  panel.append(heading);

  const nav = el('nav', null, 'surface-nav');
  for (const surface of ['Policy', 'Capacity', 'Eligible Queue', 'Selected Assignment', 'Deferred Reasons', 'Worker Compatibility', 'Provider Capacity', 'Decision Evidence']) nav.append(el('span', surface));
  panel.append(nav);

  const controls = el('section', null, 'grid three');
  const policyCard = el('article');
  policyCard.append(el('h3', 'Policy'));
  const policyInputs = {};
  const numberInput = (label, key, value, min = 1) => {
    const wrapper = el('label', label);
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(min);
    input.value = String(value);
    input.dataset.s6Policy = key;
    wrapper.append(input);
    policyInputs[key] = input;
    policyCard.append(wrapper);
  };
  numberInput('Global max active ', 'globalMaxActive', 2);
  numberInput('Workspace max active ', 'workspaceMaxActive', 1);
  numberInput('Aging interval seconds ', 'agingIntervalSeconds', 60);
  numberInput('Max priority boost steps ', 'maxPriorityBoostSteps', 2, 0);
  const recordPolicy = el('button', 'Record immutable bounded policy');
  recordPolicy.type = 'button';
  recordPolicy.id = 's6-record-policy';
  policyCard.append(recordPolicy);
  const policyState = el('pre', 'No policy recorded.');
  policyState.id = 's6-policy-state';
  policyCard.append(policyState);

  const decisionCard = el('article');
  decisionCard.append(el('h3', 'Selected Assignment'));
  const compute = el('button', 'Compute scheduling decision');
  compute.type = 'button';
  compute.id = 's6-compute-decision';
  const selected = el('pre', 'No scheduling decision yet.');
  selected.id = 's6-selected-assignment';
  decisionCard.append(compute, selected);

  const proposalCard = el('article');
  proposalCard.append(el('h3', 'Assignment Proposal Revalidation'));
  const proposalSelect = document.createElement('select');
  proposalSelect.id = 's6-proposal-select';
  proposalSelect.setAttribute('aria-label', 'Assignment proposal');
  const revalidate = el('button', 'Revalidate proposal');
  revalidate.type = 'button';
  revalidate.id = 's6-revalidate-proposal';
  const proposalState = el('pre', 'No proposal.');
  proposalState.id = 's6-proposal-state';
  proposalCard.append(proposalSelect, revalidate, proposalState);
  controls.append(policyCard, decisionCard, proposalCard);
  panel.append(controls);

  const detail = el('section', null, 'grid three');
  const queueCard = el('article'); queueCard.append(el('h3', 'Eligible Queue'));
  const queue = el('div', null, 'cards'); queue.id = 's6-eligible-queue'; queueCard.append(queue);
  const deferredCard = el('article'); deferredCard.append(el('h3', 'Deferred Reasons'));
  const deferred = el('div', null, 'cards'); deferred.id = 's6-deferred'; deferredCard.append(deferred);
  const capacityCard = el('article'); capacityCard.append(el('h3', 'Capacity'));
  const capacity = el('pre', 'No capacity snapshot.'); capacity.id = 's6-capacity'; capacityCard.append(capacity);
  const workerCard = el('article'); workerCard.append(el('h3', 'Worker Compatibility'));
  const workers = el('div', null, 'cards'); workers.id = 's6-workers'; workerCard.append(workers);
  const providerCard = el('article'); providerCard.append(el('h3', 'Provider Capacity'));
  const providers = el('div', null, 'cards'); providers.id = 's6-provider-capacity'; providerCard.append(providers);
  const evidenceCard = el('article'); evidenceCard.append(el('h3', 'Decision Evidence'));
  const evidence = el('pre', 'No decision evidence.'); evidence.id = 's6-decision-evidence'; evidenceCard.append(evidence);
  detail.append(queueCard, deferredCard, capacityCard, workerCard, providerCard, evidenceCard);
  panel.append(detail);

  cockpit.append(panel);

  function card(container, title, detailText) {
    const node = el('div', null, 'card');
    node.append(el('strong', title), el('p', detailText));
    container.append(node);
  }

  function latestDecision(data) {
    return [...(data.decisions || [])].sort((left, right) => String(right.evaluatedAt || '').localeCompare(String(left.evaluatedAt || '')))[0] || null;
  }

  function selectedProposal(data) {
    return (data.proposals || []).find((item) => item.id === selectedProposalId)
      || (data.proposals || []).find((item) => item.state === 'proposed')
      || data.proposals?.[0]
      || null;
  }

  function render() {
    const data = safe(snapshot || {});
    const decision = latestDecision(data);
    const proposal = selectedProposal(data);
    if (proposal) selectedProposalId = proposal.id;

    summary.textContent = data.policy
      ? `${data.policy.id} · ${data.eligibleQueue?.length || 0} eligible · ${data.deferred?.length || 0} deferred`
      : 'No SchedulingPolicySnapshot';
    policyState.textContent = data.policy ? JSON.stringify(data.policy, null, 2) : 'No policy recorded.';
    recordPolicy.disabled = pending || !data.found || Boolean(data.policy);
    compute.disabled = pending || !data.found || !data.policy;
    selected.textContent = decision ? JSON.stringify({
      decisionId: decision.id,
      selectedCandidateId: decision.selectedCandidateId,
      selectedWorkerId: decision.selectedWorkerId,
      reasonCodes: decision.reasonCodes,
      decisionDigest: decision.decisionDigest,
    }, null, 2) : 'No scheduling decision yet.';

    proposalSelect.replaceChildren();
    const empty = el('option', 'Select assignment proposal'); empty.value = ''; proposalSelect.append(empty);
    for (const item of data.proposals || []) {
      const option = el('option', `${item.id} · ${item.state}`);
      option.value = item.id;
      proposalSelect.append(option);
    }
    if (selectedProposalId) proposalSelect.value = selectedProposalId;
    proposalState.textContent = proposal ? JSON.stringify(proposal, null, 2) : 'No proposal.';
    revalidate.disabled = pending || !proposal || proposal.state !== 'proposed';

    queue.replaceChildren();
    for (const item of data.eligibleQueue || []) card(queue, item.id, `${item.priority || 'normal'} · rank ${item.effectivePriorityRank ?? '—'} · ready ${item.readySince || '—'}`);
    if (!(data.eligibleQueue || []).length) queue.append(el('p', 'No canonical ready candidate.'));

    deferred.replaceChildren();
    for (const item of data.deferred || []) card(deferred, item.candidateId || item.sourceId || 'candidate', (item.reasonCodes || []).join(', ') || 'deferred');
    if (!(data.deferred || []).length) deferred.append(el('p', 'No deferred candidate.'));

    capacity.textContent = data.capacity ? JSON.stringify(data.capacity, null, 2) : 'No capacity snapshot.';
    workers.replaceChildren();
    for (const item of data.workers || []) card(workers, item.workerId, `${item.status} · ${item.browserChannel} · active ${item.activeAssignmentCount}`);
    if (!(data.workers || []).length) workers.append(el('p', 'No same-Workspace Worker binding.'));
    providers.replaceChildren();
    for (const item of data.providerCapacity || []) card(providers, `${item.providerId} / ${item.action}`, `${item.status} · ${item.activeObserved}/${item.maxActive}`);
    if (!(data.providerCapacity || []).length) providers.append(el('p', 'No explicit provider capacity snapshot; provider work fails closed.'));
    evidence.textContent = decision ? JSON.stringify({
      id: decision.id,
      policySnapshotId: decision.policySnapshotId,
      inputDigest: decision.inputDigest,
      decisionDigest: decision.decisionDigest,
      evaluatedAt: decision.evaluatedAt,
      reasonCodes: decision.reasonCodes,
    }, null, 2) : 'No decision evidence.';
  }

  async function refresh() {
    snapshot = await bridge.queryState(currentWorkspaceId());
    render();
  }

  async function action(command) {
    if (pending) return;
    pending = true;
    render();
    try {
      await command();
      await refresh();
    } finally {
      pending = false;
      render();
    }
  }

  recordPolicy.addEventListener('click', () => action(() => bridge.recordPolicy({
    id: `s6-policy-${currentWorkspaceId()}-v1`,
    workspaceId: currentWorkspaceId(),
    version: '1.0.0',
    status: 'active',
    globalMaxActive: Number(policyInputs.globalMaxActive.value),
    workspaceMaxActive: Number(policyInputs.workspaceMaxActive.value),
    priorityOrder: ['critical', 'high', 'normal', 'low'],
    fairness: {
      mode: 'bounded-aging',
      agingIntervalSeconds: Number(policyInputs.agingIntervalSeconds.value),
      maxPriorityBoostSteps: Number(policyInputs.maxPriorityBoostSteps.value),
    },
    sessionReuse: 'compatible-only',
    createdAt: new Date().toISOString(),
  })).catch((error) => { policyState.textContent = error.message; }));

  compute.addEventListener('click', () => action(() => bridge.computeDecision({ workspaceId: currentWorkspaceId() }))
    .catch((error) => { selected.textContent = error.message; }));
  proposalSelect.addEventListener('change', () => { selectedProposalId = proposalSelect.value || null; render(); });
  revalidate.addEventListener('click', () => action(() => bridge.revalidateProposal({ workspaceId: currentWorkspaceId(), proposalId: selectedProposalId }))
    .catch((error) => { proposalState.textContent = error.message; }));
  document.querySelector('#s1-workspace')?.addEventListener('change', () => { selectedProposalId = null; refresh().catch((error) => { summary.textContent = error.message; }); });
  document.querySelector('#refresh')?.addEventListener('click', () => refresh().catch((error) => { summary.textContent = error.message; }));
  queueMicrotask(() => refresh().catch((error) => { summary.textContent = error.message; }));
})();

if (!document.querySelector('script[data-s7-sync]')) {
  const s7Script = document.createElement('script');
  s7Script.src = 's7-integrated.js';
  s7Script.dataset.s7Sync = 'true';
  document.body.append(s7Script);
}
