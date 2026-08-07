'use strict';

const { sanitizeForDisplay } = require('../s1/view-model.cjs');

const NAVIGATION = Object.freeze([
  'Repositories',
  'Ownership',
  'Pull Requests',
  'Checks',
  'Review Threads',
  'Delivery Gates',
  'Merge Order',
  'Delivery Evidence',
  'Repair Proposals',
]);

const BLOCKER_LABELS = Object.freeze({
  repository_unregistered: 'Repository is not registered',
  branch_unreserved: 'Branch is not reserved',
  ownership_conflict: 'Exclusive path ownership conflicts with another active owner',
  head_mismatch: 'Observed PR head no longer matches the expected exact head',
  base_unknown: 'Base freshness could not be proven',
  base_stale: 'PR base is stale',
  required_check_missing: 'A required check is missing',
  required_check_pending: 'A required check is still pending',
  required_check_failed: 'A required check failed',
  review_evidence_incomplete: 'Review-thread resolution evidence is incomplete',
  review_thread_unresolved: 'A blocking review thread remains unresolved',
  predecessor_unmerged: 'Required predecessor merge has not been observed',
  merge_not_observed: 'Merge evidence has not been observed',
});

const PROCESS_LOCAL_KEY = /^(profilePath|profileDir|profileDirectory|userData|userDataDir|processId|pid|ppid)$/i;
const TOKENISH_KEY = /(authorization|cookie|password|secret|access[_-]?token|refresh[_-]?token|private[_ -]?key|github[_-]?token|token)$/i;

function sanitizeS3(value, key = '') {
  if (PROCESS_LOCAL_KEY.test(key) || TOKENISH_KEY.test(key)) return '[redacted]';
  const base = sanitizeForDisplay(value, key);
  if (base === '[redacted]') return base;
  if (Array.isArray(value)) return value.map((item) => sanitizeS3(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([nestedKey, nested]) => [nestedKey, sanitizeS3(nested, nestedKey)]));
  }
  return base;
}

function inWorkspace(items, workspaceId) {
  return (Array.isArray(items) ? items : []).filter((item) => item.workspaceId === workspaceId);
}

function createS3GitHubViewModel(state, activeWorkspaceId, selectedPullRequestBindingId = null) {
  if (!state || typeof state !== 'object') throw new TypeError('S3 GitHub delivery state is required');
  const workspaces = Array.isArray(state.workspaces) ? state.workspaces : [];
  const activeWorkspace = activeWorkspaceId
    ? (workspaces.find((item) => item.id === activeWorkspaceId) || null)
    : (workspaces[0] || null);
  const workspaceId = activeWorkspace?.id || null;

  const repositories = workspaceId ? inWorkspace(state.repositories, workspaceId) : [];
  const repositoryBindings = workspaceId ? inWorkspace(state.repositoryBindings, workspaceId) : [];
  const branchReservations = workspaceId ? inWorkspace(state.branchReservations, workspaceId) : [];
  const pathClaims = workspaceId ? inWorkspace(state.pathOwnershipClaims, workspaceId) : [];
  const pullRequestBindings = workspaceId ? inWorkspace(state.pullRequestBindings, workspaceId) : [];
  const selectedPullRequestBinding = pullRequestBindings.find((item) => item.id === selectedPullRequestBindingId)
    || pullRequestBindings[0]
    || null;
  const selectedBindingId = selectedPullRequestBinding?.id || null;

  const pullRequestSnapshots = workspaceId ? inWorkspace(state.pullRequestSnapshots, workspaceId)
    .filter((item) => !selectedBindingId || item.pullRequestBindingId === selectedBindingId) : [];
  const checkObservations = workspaceId ? inWorkspace(state.checkObservations, workspaceId)
    .filter((item) => !selectedBindingId || item.pullRequestBindingId === selectedBindingId) : [];
  const reviewObservations = workspaceId ? inWorkspace(state.reviewThreadObservations, workspaceId)
    .filter((item) => !selectedBindingId || item.pullRequestBindingId === selectedBindingId) : [];
  const deliveryGates = workspaceId ? inWorkspace(state.deliveryGates, workspaceId)
    .filter((item) => !selectedBindingId || item.pullRequestBindingId === selectedBindingId) : [];
  const mergeOrderConstraints = workspaceId ? inWorkspace(state.mergeOrderConstraints, workspaceId) : [];
  const deliveryEvidence = workspaceId ? inWorkspace(state.deliveryEvidence, workspaceId)
    .filter((item) => !selectedBindingId || item.pullRequestBindingId === selectedBindingId) : [];
  const repairProposals = workspaceId ? inWorkspace(state.repairProposals, workspaceId)
    .filter((item) => !selectedBindingId || item.pullRequestBindingId === selectedBindingId) : [];

  const blockers = deliveryGates.flatMap((gate) => (gate.blockers || []).map((blocker) => Object.freeze({
    gateId: gate.id,
    code: blocker.code,
    label: BLOCKER_LABELS[blocker.code] || blocker.code,
    detail: sanitizeS3(blocker.detail),
  })));

  const latestSnapshot = pullRequestSnapshots[0] || null;
  const expectedHead = selectedPullRequestBinding?.expectedHeadSha || null;
  const observedHead = latestSnapshot?.headSha || null;

  return Object.freeze({
    navigation: NAVIGATION,
    activeWorkspace: sanitizeS3(activeWorkspace),
    workspaces: workspaces.map(sanitizeS3),
    repositories: repositories.map(sanitizeS3),
    repositoryBindings: repositoryBindings.map(sanitizeS3),
    branchReservations: branchReservations.map(sanitizeS3),
    pathOwnershipClaims: pathClaims.map(sanitizeS3),
    pullRequestBindings: pullRequestBindings.map(sanitizeS3),
    selectedPullRequestBinding: sanitizeS3(selectedPullRequestBinding),
    pullRequestSnapshots: pullRequestSnapshots.map(sanitizeS3),
    checkObservations: checkObservations.map(sanitizeS3),
    reviewThreadObservations: reviewObservations.map(sanitizeS3),
    deliveryGates: deliveryGates.map(sanitizeS3),
    mergeOrderConstraints: mergeOrderConstraints.map(sanitizeS3),
    deliveryEvidence: deliveryEvidence.map(sanitizeS3),
    repairProposals: repairProposals.map(sanitizeS3),
    blockers: Object.freeze(blockers),
    exactHead: Object.freeze({
      expected: expectedHead,
      observed: observedHead,
      matches: Boolean(expectedHead && observedHead && expectedHead === observedHead),
    }),
    controls: Object.freeze({
      canObserve: Boolean(selectedPullRequestBinding),
      canProposeRepair: blockers.length > 0 && Boolean(selectedPullRequestBinding),
      githubWriteAvailable: false,
    }),
  });
}

module.exports = { BLOCKER_LABELS, NAVIGATION, createS3GitHubViewModel, sanitizeS3 };
