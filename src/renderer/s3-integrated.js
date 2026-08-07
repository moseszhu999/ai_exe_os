const s3GithubApi = window.aiExecutionOS?.s3?.github;
let s3State = null;
let s3SelectedBindingId = null;
let s3RegistrationId = null;
let s3BranchReservationId = null;

const S3_SENSITIVE_KEY = /(authorization|cookie|password|secret|access[_-]?token|refresh[_-]?token|github[_-]?token|private[_ -]?key|profilePath|profileDir|userData|processId|^pid$|^ppid$)/i;
const S3_SECRET_STRING = /(\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|-----BEGIN .*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9_]{10,})/i;

function s3Sanitize(value, key = '') {
  if (S3_SENSITIVE_KEY.test(key)) return '[redacted]';
  if (typeof value === 'string') return S3_SECRET_STRING.test(value) ? '[redacted]' : value;
  if (Array.isArray(value)) return value.map((item) => s3Sanitize(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([nestedKey, nested]) => [nestedKey, s3Sanitize(nested, nestedKey)]));
  }
  return value;
}

function s3Element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function s3RenderCards(targetId, records, summary) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const cards = (records || []).map((record) => {
    const safe = s3Sanitize(record);
    const card = s3Element('div');
    if (summary) {
      const lines = summary(safe);
      if (lines[0]) card.append(s3Element('strong', lines[0]));
      if (lines[1]) card.append(s3Element('p', lines[1]));
      if (lines[2]) card.append(s3Element('small', lines[2]));
    } else {
      card.append(s3Element('pre', JSON.stringify(safe, null, 2)));
    }
    return card;
  });
  target.replaceChildren(...cards);
  if (!cards.length) target.append(s3Element('p', 'No records'));
}

function s3ActiveWorkspaceId() {
  const selector = document.getElementById('s1-workspace');
  return selector?.value || 'workspace-a';
}

function s3CurrentBinding() {
  return s3State?.pullRequestBindings?.find((item) => item.id === s3SelectedBindingId)
    || s3State?.pullRequestBindings?.[0]
    || null;
}

function s3CurrentGate() {
  const binding = s3CurrentBinding();
  return s3State?.deliveryGates?.find((item) => item.pullRequestBindingId === binding?.id) || null;
}

function s3Render() {
  if (!s3State) return;
  const binding = s3CurrentBinding();
  if (binding) s3SelectedBindingId = binding.id;
  const snapshot = s3State.pullRequestSnapshots?.find((item) => item.pullRequestBindingId === binding?.id) || null;
  const gate = s3CurrentGate();

  document.getElementById('s3-summary').textContent = binding
    ? `PR #${binding.number} · ${gate?.state || 'waiting'} · expected ${binding.expectedHeadSha}`
    : 'No PullRequestBinding';
  document.getElementById('s3-exact-head').textContent = binding
    ? `Expected: ${binding.expectedHeadSha}\nObserved: ${snapshot?.headSha || 'unobserved'}\nMatch: ${snapshot?.headSha === binding.expectedHeadSha ? 'YES' : 'NO'}`
    : 'Bind a PR to pin an exact head.';

  s3RegistrationId = s3RegistrationId || s3State.repositories?.[0]?.id || null;
  s3BranchReservationId = s3BranchReservationId || s3State.branchReservations?.[0]?.id || null;

  s3RenderCards('s3-repositories', s3State.repositories, (item) => [
    `${item.owner}/${item.repository}`,
    `${item.status} · ${item.visibilityHint || 'unknown visibility'}`,
    item.id,
  ]);
  s3RenderCards('s3-ownership', [
    ...(s3State.branchReservations || []),
    ...(s3State.pathOwnershipClaims || []),
  ], (item) => [
    item.branch || item.pathPrefix || item.id,
    `${item.mode || ''} · ${item.state || 'active'}`,
    item.ownerId || item.id,
  ]);
  s3RenderCards('s3-prs', s3State.pullRequestBindings, (item) => [
    `PR #${item.number}`,
    `${item.state} · expected ${item.expectedHeadSha}`,
    item.planStepId ? `PlanStep ${item.planStepId}` : item.id,
  ]);
  s3RenderCards('s3-checks', s3State.checkObservations, (item) => [
    item.headSha,
    (item.checks || []).map((check) => `${check.name}: ${check.status}/${check.conclusion || 'pending'}`).join(' · '),
    item.digest,
  ]);
  s3RenderCards('s3-reviews', s3State.reviewThreadObservations, (item) => [
    `PR #${item.pullRequestNumber}`,
    `resolution evidence: ${item.resolutionAvailable ? 'available' : 'incomplete'} · threads ${(item.threads || []).length}`,
    item.digest,
  ]);
  s3RenderCards('s3-gates', s3State.deliveryGates, (item) => [
    `${item.id} · ${item.state}`,
    (item.blockers || []).map((blocker) => blocker.code).join(' · ') || 'No blockers',
    item.evaluatedHeadSha || 'not evaluated',
  ]);
  s3RenderCards('s3-merge-order', s3State.mergeOrderConstraints, (item) => [
    `${item.predecessorPullRequestBindingId} → ${item.successorPullRequestBindingId}`,
    item.state,
    item.id,
  ]);
  s3RenderCards('s3-evidence', s3State.deliveryEvidence, (item) => [
    item.kind,
    `${item.headSha}${item.mergeCommitSha ? ` · merge ${item.mergeCommitSha}` : ''}`,
    item.id,
  ]);
  s3RenderCards('s3-repairs', s3State.repairProposals, (item) => [
    item.reasonCode,
    `${item.state} · ${item.suggestedAction}`,
    item.id,
  ]);
  document.getElementById('s3-events').textContent = (s3State.githubEvents || []).map((event) => JSON.stringify(s3Sanitize(event))).join('\n');
}

async function s3Refresh() {
  if (!s3GithubApi?.queryState) return;
  try {
    s3State = await s3GithubApi.queryState(s3ActiveWorkspaceId());
    s3Render();
  } catch (error) {
    showStatus(`S3 refresh failed: ${error.message || error}`, true);
  }
}

async function s3Call(action, message) {
  try {
    const result = await action();
    await s3Refresh();
    if (message) showStatus(message);
    return result;
  } catch (error) {
    showStatus(error.message || String(error), true);
    return null;
  }
}

function s3RepoParts() {
  const raw = document.getElementById('s3-repository').value.trim();
  const parts = raw.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('Repository must be owner/name');
  return { owner: parts[0], repository: parts[1] };
}

document.getElementById('s3-register')?.addEventListener('click', () => s3Call(async () => {
  const repo = s3RepoParts();
  const record = await s3GithubApi.registerRepository({ workspaceId: s3ActiveWorkspaceId(), ...repo, visibilityHint: 'unknown' });
  s3RegistrationId = record.id;
  return record;
}, 'Repository registered locally; no GitHub write occurred'));

document.getElementById('s3-reserve')?.addEventListener('click', () => s3Call(async () => {
  if (!s3RegistrationId) throw new Error('Register the repository first');
  const record = await s3GithubApi.reserveBranch({
    workspaceId: s3ActiveWorkspaceId(), repositoryRegistrationId: s3RegistrationId,
    branch: document.getElementById('s3-branch').value.trim(), mode: 'exclusive_write',
    ownerKind: 'operator', ownerId: 's3-ui-owner',
  });
  s3BranchReservationId = record.id;
  return record;
}, 'Branch reserved in local execution-control state'));

document.getElementById('s3-claim')?.addEventListener('click', () => s3Call(async () => {
  if (!s3BranchReservationId) throw new Error('Reserve the branch first');
  return s3GithubApi.claimPaths({
    workspaceId: s3ActiveWorkspaceId(), branchReservationId: s3BranchReservationId,
    ownerId: 's3-ui-owner', paths: [document.getElementById('s3-path').value.trim()], mode: 'exclusive_write',
  });
}, 'Path ownership claimed locally'));

document.getElementById('s3-load-head')?.addEventListener('click', () => s3Call(async () => {
  const repo = s3RepoParts();
  const number = Number(document.getElementById('s3-pr-number').value);
  const snapshot = await window.aiExecutionOS.observePullRequest({ owner: repo.owner, repo: repo.repository, number });
  document.getElementById('s3-expected-head').value = snapshot.headSha || '';
  document.getElementById('s3-base-ref').value = snapshot.baseRef || 'main';
  return snapshot;
}, 'Loaded PR head with read-only compatibility observation'));

document.getElementById('s3-bind')?.addEventListener('click', () => s3Call(async () => {
  if (!s3RegistrationId) throw new Error('Register the repository first');
  const checks = document.getElementById('s3-required-checks').value.split(',').map((item) => item.trim()).filter(Boolean);
  const result = await s3GithubApi.bindPullRequest({
    workspaceId: s3ActiveWorkspaceId(), repositoryRegistrationId: s3RegistrationId,
    number: Number(document.getElementById('s3-pr-number').value),
    expectedHeadSha: document.getElementById('s3-expected-head').value.trim(),
    expectedBaseRef: document.getElementById('s3-base-ref').value.trim() || 'main',
    requiredCheckNames: checks,
    requireNoUnresolvedThreads: document.getElementById('s3-require-reviews').checked,
    requireCurrentBase: document.getElementById('s3-require-base').checked,
    requireOwnershipClear: true,
  });
  s3SelectedBindingId = result.binding.id;
  return result;
}, 'PR bound to immutable expected head'));

document.getElementById('s3-observe')?.addEventListener('click', () => s3Call(async () => {
  const binding = s3CurrentBinding();
  if (!binding) throw new Error('Bind a PR first');
  return s3GithubApi.observeDelivery({ workspaceId: s3ActiveWorkspaceId(), pullRequestBindingId: binding.id });
}, 'Refreshed GitHub evidence with GET-only provider calls'));

document.getElementById('s3-repair')?.addEventListener('click', () => s3Call(async () => {
  const binding = s3CurrentBinding();
  if (!binding) throw new Error('Bind a PR first');
  return s3GithubApi.createRepairProposal({ workspaceId: s3ActiveWorkspaceId(), pullRequestBindingId: binding.id });
}, 'Created local RepairProposal; no GitHub write occurred'));

document.getElementById('s1-workspace')?.addEventListener('change', () => {
  s3RegistrationId = null;
  s3BranchReservationId = null;
  s3SelectedBindingId = null;
  queueMicrotask(() => s3Refresh());
});
document.getElementById('refresh')?.addEventListener('click', () => queueMicrotask(() => s3Refresh()));

s3Refresh();

if (!document.querySelector('script[data-s4-cockpit]')) {
  const s4Script = document.createElement('script');
  s4Script.src = 's4-integrated.js';
  s4Script.dataset.s4Cockpit = 'true';
  document.body.append(s4Script);
}
