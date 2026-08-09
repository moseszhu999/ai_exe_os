(() => {
  'use strict';

  const bridge = window.aiExecutionOS?.s8?.delegation;
  if (!bridge) return;

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

  let initialized = false;
  let snapshot = null;
  let pending = false;
  let selectedProposalId = null;
  let selectedRequestId = null;
  let selectedCancellationId = null;
  let selectedReceiptMirrorId = null;

  function init() {
    if (initialized) return;
    const cockpit = document.getElementById('s4-cockpit');
    if (!cockpit) {
      setTimeout(init, 25);
      return;
    }
    initialized = true;

    const panel = el('section', null, 'mission-shell');
    panel.id = 's8-delegation-panel';
    panel.setAttribute('aria-label', 'S8 controlled remote execution delegation');
    const heading = el('div', null, 'section-heading');
    const headingText = el('div');
    headingText.append(el('p', 'S8 controlled delegation · destination remains sovereign', 'eyebrow'), el('h2', 'Controlled Remote Execution Delegation'));
    const summary = el('strong', 'No delegation state'); summary.id = 's8-summary';
    heading.append(headingText, summary);
    panel.append(heading);

    const nav = el('nav', null, 'surface-nav');
    for (const name of ['Delegation / Overview','Peer Bindings','Policies','Outbound Requests','Incoming Proposals','Admission Evidence','Local HumanGate','Local Execution Binding','Receipts / Evidence','Cancellation Proposal','Divergence / Replay / Rejection Reasons']) nav.append(el('span', name));
    panel.append(nav);

    const controls = el('section', null, 'grid three');
    const transportCard = el('article');
    transportCard.append(el('h3', 'Explicit transport actions'));
    const push = el('button', 'Push selected request'); push.id = 's8-push-request'; push.type = 'button';
    const pullInbox = el('button', 'Pull incoming proposals', 'secondary'); pullInbox.id = 's8-pull-inbox'; pullInbox.type = 'button';
    const pullReceipts = el('button', 'Pull receipts', 'secondary'); pullReceipts.id = 's8-pull-receipts'; pullReceipts.type = 'button';
    const transportState = el('pre', 'No delegation network action in this process.'); transportState.id = 's8-transport-state';
    transportCard.append(push, pullInbox, pullReceipts, transportState);

    const gateCard = el('article');
    gateCard.append(el('h3', 'Destination-local delegation gate'));
    const proposalSelect = document.createElement('select'); proposalSelect.id = 's8-proposal-select'; proposalSelect.setAttribute('aria-label', 'Incoming delegation proposal');
    const approve = el('button', 'Accept proposal locally'); approve.id = 's8-approve-local'; approve.type = 'button';
    const reject = el('button', 'Reject proposal locally', 'danger'); reject.id = 's8-reject-local'; reject.type = 'button';
    const gateAuthorityNote = el('p', 'Remote source cannot decide this gate.'); gateAuthorityNote.id = 's8-gate-authority-note';
    const gateState = el('pre', 'No incoming proposal selected.'); gateState.id = 's8-gate-state';
    gateCard.append(proposalSelect, approve, reject, gateAuthorityNote, gateState);

    const cancellationCard = el('article');
    cancellationCard.append(el('h3', 'Cancellation proposal'));
    const cancellationSelect = document.createElement('select'); cancellationSelect.id = 's8-cancellation-select'; cancellationSelect.setAttribute('aria-label', 'Incoming delegation cancellation proposal');
    const acceptCancel = el('button', 'Accept pre-start cancellation locally'); acceptCancel.id = 's8-accept-cancellation'; acceptCancel.type = 'button';
    const rejectCancel = el('button', 'Reject cancellation locally', 'secondary'); rejectCancel.id = 's8-reject-cancellation'; rejectCancel.type = 'button';
    const proposeCancel = el('button', 'Propose cancellation for selected outbound request', 'secondary'); proposeCancel.id = 's8-propose-cancellation'; proposeCancel.type = 'button';
    const cancellationState = el('pre', 'Post-start remote cancellation is non-authoritative.'); cancellationState.id = 's8-cancellation-state';
    cancellationCard.append(cancellationSelect, acceptCancel, rejectCancel, proposeCancel, cancellationState);
    controls.append(transportCard, gateCard, cancellationCard);
    panel.append(controls);

    const grid = el('section', null, 'grid three');
    const peerCard = el('article'); peerCard.append(el('h3', 'Peer Bindings / Policies')); const peerList = el('div', null, 'cards'); peerList.id = 's8-peers'; peerCard.append(peerList);
    const requestCard = el('article'); requestCard.append(el('h3', 'Outbound Requests')); const requestSelect = document.createElement('select'); requestSelect.id = 's8-request-select'; requestSelect.setAttribute('aria-label', 'Outbound delegation request'); const requestState = el('pre', 'No outbound request.'); requestState.id = 's8-request-state'; requestCard.append(requestSelect, requestState);
    const admissionCard = el('article'); admissionCard.append(el('h3', 'Admission Evidence')); const admissionState = el('pre', 'No admission snapshot.'); admissionState.id = 's8-admission-state'; admissionCard.append(admissionState);
    const bindingCard = el('article'); bindingCard.append(el('h3', 'Local Execution Binding')); const bindingState = el('pre', 'No delegated execution binding.'); bindingState.id = 's8-binding-state'; bindingCard.append(bindingState, el('p', 'Actual execution remains under this destination instance’s S6/S2/S1 scheduler, ResourceLocks and action HumanGate.'));
    const receiptCard = el('article'); receiptCard.append(el('h3', 'Receipts / Evidence')); const receiptSelect = document.createElement('select'); receiptSelect.id = 's8-receipt-select'; receiptSelect.setAttribute('aria-label', 'Delegation receipt'); const consumeReceipt = el('button', 'Consume selected completed receipt locally', 'secondary'); consumeReceipt.id = 's8-consume-receipt'; consumeReceipt.type = 'button'; const receiptList = el('div', null, 'cards'); receiptList.id = 's8-receipts'; receiptCard.append(receiptSelect, consumeReceipt, receiptList);
    const divergenceCard = el('article'); divergenceCard.append(el('h3', 'Divergence / Replay / Rejection')); const divergenceList = el('div', null, 'cards'); divergenceList.id = 's8-divergence'; divergenceCard.append(divergenceList);
    grid.append(peerCard, requestCard, admissionCard, bindingCard, receiptCard, divergenceCard);
    panel.append(grid);
    cockpit.append(panel);

    function render() {
      const data = safe(snapshot || {});
      summary.textContent = data.found
        ? `${data.peerBindings?.length || 0} peer(s) · ${data.outboundRequests?.length || 0} outbound · ${data.incomingProposals?.length || 0} incoming · ${data.executionBindings?.length || 0} bound`
        : 'Workspace delegation state unavailable';
      push.disabled = pending || !selectedRequestId;
      pullInbox.disabled = pending || !data.endpointId;
      pullReceipts.disabled = pending || !data.endpointId;

      peerList.replaceChildren();
      for (const item of data.peerBindings || []) card(peerList, `${item.id} · ${item.localRole || 'role'} · ${item.status}`, `${item.sourceInstanceId}/${item.sourceWorkspaceId} → ${item.destinationInstanceId}/${item.destinationWorkspaceId}`);
      for (const item of data.policies || []) card(peerList, `${item.id} · ${item.version}`, `${item.status} · ${(item.allowedActions || []).join(', ')} · ${(item.allowedTargets || []).length} target(s)`);
      if (!(data.peerBindings || []).length && !(data.policies || []).length) peerList.append(el('p', 'No local delegation peer/policy record.'));

      requestSelect.replaceChildren(el('option', 'Select outbound request'));
      requestSelect.firstChild.value = '';
      for (const item of data.outboundRequests || []) {
        const option = el('option', `${item.id} · ${item.transportState || 'pending'} · ${item.action}`); option.value = item.id; if (selectedRequestId === item.id) option.selected = true; requestSelect.append(option);
      }
      const selectedRequest = (data.outboundRequests || []).find((item) => item.id === selectedRequestId) || null;
      requestState.textContent = selectedRequest ? JSON.stringify(selectedRequest, null, 2) : 'No outbound request selected.';

      proposalSelect.replaceChildren(el('option', 'Select incoming proposal'));
      proposalSelect.firstChild.value = '';
      for (const item of data.incomingProposals || []) {
        const option = el('option', `${item.id} · ${item.state} · ${item.reasonCode || 'no reason'}`); option.value = item.id; if (selectedProposalId === item.id) option.selected = true; proposalSelect.append(option);
      }
      const selectedProposal = (data.incomingProposals || []).find((item) => item.id === selectedProposalId) || null;
      approve.disabled = pending || selectedProposal?.state !== 'waiting_human';
      reject.disabled = pending || selectedProposal?.state !== 'waiting_human';
      const admission = (data.admissionSnapshots || []).filter((item) => item.proposalId === selectedProposalId).sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt)))[0] || null;
      const acceptance = (data.acceptances || []).find((item) => item.proposalId === selectedProposalId) || null;
      const gate = (data.humanGates || []).find((item) => item.id === selectedProposal?.humanGateId) || null;
      gateState.textContent = JSON.stringify({ proposal: selectedProposal, gate, acceptance, remoteDecisionAuthority: false }, null, 2);
      admissionState.textContent = admission ? JSON.stringify(admission, null, 2) : 'No admission snapshot for selected proposal.';
      const binding = (data.executionBindings || []).find((item) => item.proposalId === selectedProposalId) || null;
      bindingState.textContent = binding ? JSON.stringify(binding, null, 2) : 'No destination-local execution binding for selected proposal.';

      cancellationSelect.replaceChildren(el('option', 'Select incoming cancellation'));
      cancellationSelect.firstChild.value = '';
      for (const item of (data.cancellationProposals || []).filter((entry) => entry.direction === 'inbound')) {
        const option = el('option', `${item.id} · ${item.state}`); option.value = item.id; if (selectedCancellationId === item.id) option.selected = true; cancellationSelect.append(option);
      }
      const selectedCancellation = (data.cancellationProposals || []).find((item) => item.id === selectedCancellationId) || null;
      acceptCancel.disabled = pending || selectedCancellation?.state !== 'pending_local_decision';
      rejectCancel.disabled = pending || selectedCancellation?.state !== 'pending_local_decision';
      proposeCancel.disabled = pending || !selectedRequestId;
      cancellationState.textContent = selectedCancellation ? JSON.stringify(selectedCancellation, null, 2) : 'Post-start remote cancellation is non-authoritative.';

      receiptSelect.replaceChildren(el('option', 'Select receipt'));
      receiptSelect.firstChild.value = '';
      receiptList.replaceChildren();
      for (const item of data.receipts || []) {
        card(receiptList, `${item.delegationRequestId} · ${item.state}`, `${item.receiptDigest || 'digest unavailable'} · ${(item.evidenceDigests || []).length} evidence digest(s)`);
        if (item.direction === 'inbound') { const option = el('option', `${item.id} · ${item.state}`); option.value = item.id; if (selectedReceiptMirrorId === item.id) option.selected = true; receiptSelect.append(option); }
      }
      if (!(data.receipts || []).length) receiptList.append(el('p', 'No delegation receipt/evidence mirrored.'));
      consumeReceipt.disabled = pending || !selectedReceiptMirrorId;

      divergenceList.replaceChildren();
      for (const item of data.divergences || []) card(divergenceList, item.reasonCode || 'delegation issue', `${item.requestId || 'request'} · ${item.state || 'rejected'}`);
      if (!(data.divergences || []).length) divergenceList.append(el('p', 'No delegation gap/divergence/rejection evidence.'));
    }

    async function refresh() {
      snapshot = await bridge.queryState(currentWorkspaceId());
      render();
    }
    async function action(command, target) {
      if (pending) return;
      pending = true; render();
      try { const result = await command(); target.textContent = JSON.stringify(safe(result), null, 2); await refresh(); }
      catch (error) { target.textContent = error.message || String(error); }
      finally { pending = false; render(); }
    }

    requestSelect.addEventListener('change', () => { selectedRequestId = requestSelect.value || null; render(); });
    proposalSelect.addEventListener('change', () => { selectedProposalId = proposalSelect.value || null; render(); });
    cancellationSelect.addEventListener('change', () => { selectedCancellationId = cancellationSelect.value || null; render(); });
    receiptSelect.addEventListener('change', () => { selectedReceiptMirrorId = receiptSelect.value || null; render(); });
    push.addEventListener('click', () => action(() => bridge.pushDelegationRequest({ workspaceId: currentWorkspaceId(), requestId: selectedRequestId }), transportState));
    pullInbox.addEventListener('click', () => action(() => bridge.pullDelegationInbox({ workspaceId: currentWorkspaceId() }), transportState));
    pullReceipts.addEventListener('click', () => action(() => bridge.pullDelegationReceipts({ workspaceId: currentWorkspaceId() }), transportState));
    approve.addEventListener('click', () => action(() => bridge.approveDelegationProposal({ workspaceId: currentWorkspaceId(), proposalId: selectedProposalId }), gateState));
    reject.addEventListener('click', () => action(() => bridge.rejectDelegationProposal({ workspaceId: currentWorkspaceId(), proposalId: selectedProposalId }), gateState));
    proposeCancel.addEventListener('click', () => action(() => bridge.proposeDelegationCancellation({ workspaceId: currentWorkspaceId(), requestId: selectedRequestId, reasonClass: 'source_withdrawal' }), cancellationState));
    acceptCancel.addEventListener('click', () => action(() => bridge.resolveDelegationCancellation({ workspaceId: currentWorkspaceId(), cancellationId: selectedCancellationId, acceptedLocally: true }), cancellationState));
    rejectCancel.addEventListener('click', () => action(() => bridge.resolveDelegationCancellation({ workspaceId: currentWorkspaceId(), cancellationId: selectedCancellationId, acceptedLocally: false }), cancellationState));
    consumeReceipt.addEventListener('click', () => action(() => bridge.consumeDelegationReceipt({ workspaceId: currentWorkspaceId(), receiptMirrorId: selectedReceiptMirrorId }), receiptList));
    document.querySelector('#s1-workspace')?.addEventListener('change', () => { selectedProposalId = null; selectedRequestId = null; refresh().catch((error) => { summary.textContent = error.message; }); });
    document.querySelector('#refresh')?.addEventListener('click', () => refresh().catch((error) => { summary.textContent = error.message; }));
    queueMicrotask(() => refresh().catch((error) => { summary.textContent = error.message; }));
  }

  init();
})();