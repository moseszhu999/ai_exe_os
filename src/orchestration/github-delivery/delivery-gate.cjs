'use strict';

const { createHash } = require('node:crypto');

const BLOCKERS = Object.freeze([
  'repository_inactive',
  'cross_workspace_binding',
  'ownership_conflict',
  'head_mismatch',
  'base_stale',
  'required_check_missing',
  'required_check_pending',
  'required_check_failed',
  'review_thread_unresolved',
  'merge_order_unsatisfied',
  'pull_request_closed_unmerged',
  'observation_incomplete',
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')}`;
}
function blocker(code, detail = {}) {
  if (!BLOCKERS.includes(code)) throw new Error(`Unsupported S3 blocker: ${code}`);
  return Object.freeze({ code, detail: Object.freeze({ ...detail }) });
}

function evaluateDeliveryGate(input) {
  const blockers = [];
  const registration = input?.registration;
  const binding = input?.binding;
  const snapshot = input?.pullRequestSnapshot;
  const gate = input?.gate || {};
  const workspaceId = gate.workspaceId || binding?.workspaceId || registration?.workspaceId || null;

  if (!registration || registration.status !== 'active') blockers.push(blocker('repository_inactive'));
  if (!binding || !registration || binding.workspaceId !== workspaceId || registration.workspaceId !== workspaceId) {
    blockers.push(blocker('cross_workspace_binding'));
  }

  if (!snapshot) {
    blockers.push(blocker('observation_incomplete', { observation: 'pull_request' }));
  } else if (binding) {
    if (snapshot.headSha !== binding.expectedHeadSha) {
      blockers.push(blocker('head_mismatch', { expectedHeadSha: binding.expectedHeadSha, observedHeadSha: snapshot.headSha || null }));
    }
    if (snapshot.state === 'closed' && !snapshot.merged) blockers.push(blocker('pull_request_closed_unmerged'));
  }

  for (const conflict of input?.ownershipConflicts || []) {
    blockers.push(blocker('ownership_conflict', { kind: conflict.kind || 'unknown', leftId: conflict.leftId || null, rightId: conflict.rightId || null }));
  }

  evaluateRequiredChecks(gate.requiredCheckNames || [], input?.checksObservation, binding, blockers);
  evaluateReviews(Boolean(gate.requireNoUnresolvedThreads), input?.reviewObservation, binding, blockers);
  evaluateBase(Boolean(gate.requireCurrentBase), input?.baseObservation, blockers);
  evaluateMergeOrder(binding, input?.mergeOrderConstraints || [], input?.deliveryEvidence || [], blockers);

  const unique = dedupeBlockers(blockers);
  const stale = unique.some((item) => item.code === 'head_mismatch' || item.code === 'base_stale');
  return Object.freeze({
    state: stale ? 'stale' : unique.length ? 'blocked' : 'ready',
    blockers: Object.freeze(unique),
    evaluatedHeadSha: snapshot?.headSha || null,
    evaluatedBaseSha: snapshot?.baseSha || null,
  });
}

function evaluateRequiredChecks(requiredNames, observation, binding, blockers) {
  if (!requiredNames.length) return;
  if (!observation || (binding && observation.headSha !== binding.expectedHeadSha)) {
    blockers.push(blocker('observation_incomplete', { observation: 'checks' }));
    return;
  }
  const byName = new Map();
  for (const check of observation.checks || []) {
    if (!byName.has(check.name)) byName.set(check.name, []);
    byName.get(check.name).push(check);
  }
  for (const name of [...new Set(requiredNames)].sort()) {
    const checks = byName.get(name) || [];
    if (!checks.length) {
      blockers.push(blocker('required_check_missing', { name }));
      continue;
    }
    const state = collapseCheckState(checks);
    if (state === 'failed') blockers.push(blocker('required_check_failed', { name }));
    if (state === 'pending') blockers.push(blocker('required_check_pending', { name }));
  }
}

function collapseCheckState(checks) {
  if (checks.some((check) => ['failure', 'cancelled', 'timed_out', 'action_required', 'stale', 'unknown'].includes(check.conclusion))) return 'failed';
  if (checks.some((check) => check.status !== 'completed' || check.conclusion === null)) return 'pending';
  if (checks.every((check) => ['success', 'neutral', 'skipped'].includes(check.conclusion))) return 'success';
  return 'failed';
}

function evaluateReviews(required, observation, binding, blockers) {
  if (!required) return;
  if (!observation || (binding && observation.headSha !== binding.expectedHeadSha)) {
    blockers.push(blocker('observation_incomplete', { observation: 'review_threads' }));
    return;
  }
  if (observation.resolutionAvailable !== true) {
    blockers.push(blocker('observation_incomplete', { observation: 'review_thread_resolution' }));
    return;
  }
  for (const thread of observation.threads || []) {
    if (thread.resolved !== true) blockers.push(blocker('review_thread_unresolved', { threadId: thread.id }));
  }
}

function evaluateBase(required, observation, blockers) {
  if (!required) return;
  if (!observation || !Number.isInteger(observation.behindBy)) {
    blockers.push(blocker('observation_incomplete', { observation: 'base_freshness' }));
    return;
  }
  if (observation.behindBy > 0) blockers.push(blocker('base_stale', { behindBy: observation.behindBy, mergeBaseSha: observation.mergeBaseSha || null }));
}

function evaluateMergeOrder(binding, constraints, evidence, blockers) {
  if (!binding) return;
  const active = constraints.filter((constraint) => constraint.state === 'active' && constraint.successorPullRequestBindingId === binding.id);
  for (const constraint of active) {
    const satisfied = evidence.some((item) => item.kind === 'merge_observed' && item.pullRequestBindingId === constraint.predecessorPullRequestBindingId);
    if (!satisfied) blockers.push(blocker('merge_order_unsatisfied', { constraintId: constraint.id, predecessorPullRequestBindingId: constraint.predecessorPullRequestBindingId }));
  }
}

function createExactHeadReadyEvidence({ id, workspaceId, binding, snapshot, checksObservation, reviewObservation, observedAt = new Date().toISOString() }) {
  if (!binding || !snapshot || binding.expectedHeadSha !== snapshot.headSha) throw new Error('exact-head ready evidence requires matching bound head');
  return Object.freeze({
    id,
    workspaceId,
    pullRequestBindingId: binding.id,
    kind: 'exact_head_ready',
    headSha: snapshot.headSha,
    baseSha: snapshot.baseSha,
    mergeCommitSha: null,
    checkDigest: checksObservation?.digest || digest(checksObservation || {}),
    reviewDigest: reviewObservation?.digest || digest(reviewObservation || {}),
    observedAt,
  });
}

function createMergeObservedEvidence({ id, workspaceId, binding, snapshot, checksObservation, reviewObservation, observedAt = new Date().toISOString() }) {
  if (!binding || !snapshot || binding.expectedHeadSha !== snapshot.headSha || !snapshot.merged || !snapshot.mergeCommitSha) {
    throw new Error('merge evidence requires explicit merged snapshot for the bound exact head');
  }
  return Object.freeze({
    id,
    workspaceId,
    pullRequestBindingId: binding.id,
    kind: 'merge_observed',
    headSha: snapshot.headSha,
    baseSha: snapshot.baseSha,
    mergeCommitSha: snapshot.mergeCommitSha,
    checkDigest: checksObservation?.digest || digest(checksObservation || {}),
    reviewDigest: reviewObservation?.digest || digest(reviewObservation || {}),
    observedAt,
  });
}

function proposeRepair({ id, workspaceId, binding, gateResult }) {
  if (!gateResult?.blockers?.length) throw new Error('repair proposal requires a blocked or stale gate');
  const primary = gateResult.blockers[0];
  return Object.freeze({
    id,
    workspaceId,
    pullRequestBindingId: binding.id,
    reasonCode: primary.code,
    description: `Delivery gate requires review: ${primary.code}`,
    suggestedAction: repairSuggestion(primary.code),
    state: 'proposed',
  });
}

function repairSuggestion(code) {
  const suggestions = {
    head_mismatch: 'Review the new head and create an explicit local rebinding if appropriate.',
    base_stale: 'Review base freshness and prepare a bounded repair task; do not mutate GitHub automatically.',
    ownership_conflict: 'Resolve the local ownership conflict before continuing.',
    required_check_failed: 'Inspect failing exact-head checks and prepare a bounded repair task.',
    required_check_pending: 'Wait for the required exact-head check observation to become terminal.',
    review_thread_unresolved: 'Review unresolved provider evidence before continuing.',
    merge_order_unsatisfied: 'Wait for predecessor merge evidence.',
  };
  return suggestions[code] || 'Review the blocker and prepare a bounded local repair proposal.';
}

function dedupeBlockers(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = `${item.code}:${JSON.stringify(item.detail)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

module.exports = {
  BLOCKERS,
  collapseCheckState,
  createExactHeadReadyEvidence,
  createMergeObservedEvidence,
  evaluateDeliveryGate,
  proposeRepair,
};
