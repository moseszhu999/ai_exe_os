'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collapseCheckState,
  createExactHeadReadyEvidence,
  createMergeObservedEvidence,
  evaluateDeliveryGate,
  proposeRepair,
} = require('../src/orchestration/github-delivery/delivery-gate.cjs');

const H1 = '1'.repeat(40);
const H2 = '2'.repeat(40);
const B1 = 'a'.repeat(40);
const M1 = 'b'.repeat(40);
const registration = { id: 'repo-a', workspaceId: 'workspace-a', status: 'active' };
const binding = { id: 'prb-a', workspaceId: 'workspace-a', repositoryRegistrationId: 'repo-a', expectedHeadSha: H1 };
const snapshot = { state: 'open', merged: false, headSha: H1, baseSha: B1, mergeCommitSha: null };
const gate = { workspaceId: 'workspace-a', requiredCheckNames: ['build'], requireNoUnresolvedThreads: true, requireCurrentBase: true };
const checks = { headSha: H1, digest: 'sha256:checks', checks: [{ name: 'build', status: 'completed', conclusion: 'success' }] };
const reviews = { headSha: H1, digest: 'sha256:reviews', resolutionAvailable: true, threads: [] };
const base = { behindBy: 0, mergeBaseSha: B1 };

function evaluate(overrides = {}) {
  return evaluateDeliveryGate({ registration, binding, pullRequestSnapshot: snapshot, gate, checksObservation: checks, reviewObservation: reviews, baseObservation: base, ownershipConflicts: [], mergeOrderConstraints: [], deliveryEvidence: [], ...overrides });
}

test('clean exact-head evidence produces ready DeliveryGate', () => {
  const result = evaluate();
  assert.equal(result.state, 'ready');
  assert.deepEqual(result.blockers, []);
});

test('head movement immediately makes prior exact-head gate stale', () => {
  const result = evaluate({ pullRequestSnapshot: { ...snapshot, headSha: H2 } });
  assert.equal(result.state, 'stale');
  assert.equal(result.blockers.some((x) => x.code === 'head_mismatch'), true);
  assert.throws(() => createExactHeadReadyEvidence({ id: 'e', workspaceId: 'workspace-a', binding, snapshot: { ...snapshot, headSha: H2 }, checksObservation: checks, reviewObservation: reviews }), /matching bound head/);
});

test('missing, pending and failed required checks are distinguished fail-closed', () => {
  const missing = evaluate({ checksObservation: { headSha: H1, checks: [] } });
  assert.equal(missing.blockers.some((x) => x.code === 'required_check_missing'), true);
  const pending = evaluate({ checksObservation: { headSha: H1, checks: [{ name: 'build', status: 'in_progress', conclusion: null }] } });
  assert.equal(pending.blockers.some((x) => x.code === 'required_check_pending'), true);
  const failed = evaluate({ checksObservation: { headSha: H1, checks: [{ name: 'build', status: 'completed', conclusion: 'failure' }] } });
  assert.equal(failed.blockers.some((x) => x.code === 'required_check_failed'), true);
  assert.equal(collapseCheckState([{ status: 'completed', conclusion: 'success' }]), 'success');
});

test('review resolution unavailable blocks instead of assuming approval', () => {
  const incomplete = evaluate({ reviewObservation: { headSha: H1, resolutionAvailable: false, threads: [{ id: '10', resolved: null }] } });
  assert.equal(incomplete.blockers.some((x) => x.code === 'observation_incomplete'), true);
  const unresolved = evaluate({ reviewObservation: { headSha: H1, resolutionAvailable: true, threads: [{ id: '10', resolved: false }] } });
  assert.equal(unresolved.blockers.some((x) => x.code === 'review_thread_unresolved'), true);
});

test('stale or incomplete base evidence is fail-closed and stale affects only its gate', () => {
  const stale = evaluate({ baseObservation: { behindBy: 3, mergeBaseSha: B1 } });
  assert.equal(stale.state, 'stale');
  assert.equal(stale.blockers.some((x) => x.code === 'base_stale'), true);
  const incomplete = evaluate({ baseObservation: null });
  assert.equal(incomplete.state, 'blocked');
  assert.equal(incomplete.blockers.some((x) => x.code === 'observation_incomplete'), true);
});

test('ownership conflict blocks only the evaluated delivery path', () => {
  const conflict = evaluate({ ownershipConflicts: [{ kind: 'path', leftId: 'a', rightId: 'b' }] });
  assert.equal(conflict.state, 'blocked');
  assert.equal(conflict.blockers.some((x) => x.code === 'ownership_conflict'), true);
  assert.equal(evaluate().state, 'ready');
});

test('merge-order requires explicit predecessor merge evidence, not closed state', () => {
  const constraint = { id: 'order-a-b', state: 'active', predecessorPullRequestBindingId: 'prb-pre', successorPullRequestBindingId: 'prb-a' };
  const blocked = evaluate({ mergeOrderConstraints: [constraint] });
  assert.equal(blocked.blockers.some((x) => x.code === 'merge_order_unsatisfied'), true);
  const satisfied = evaluate({ mergeOrderConstraints: [constraint], deliveryEvidence: [{ kind: 'merge_observed', pullRequestBindingId: 'prb-pre' }] });
  assert.equal(satisfied.state, 'ready');
});

test('exact-head and merge evidence are immutable and explicit about merge provenance', () => {
  const ready = createExactHeadReadyEvidence({ id: 'ready-a', workspaceId: 'workspace-a', binding, snapshot, checksObservation: checks, reviewObservation: reviews, observedAt: '2026-08-07T06:00:00Z' });
  assert.equal(ready.kind, 'exact_head_ready');
  assert.equal(Object.isFrozen(ready), true);
  const merged = createMergeObservedEvidence({ id: 'merge-a', workspaceId: 'workspace-a', binding, snapshot: { ...snapshot, state: 'closed', merged: true, mergeCommitSha: M1 }, checksObservation: checks, reviewObservation: reviews });
  assert.equal(merged.mergeCommitSha, M1);
  assert.throws(() => createMergeObservedEvidence({ id: 'bad', workspaceId: 'workspace-a', binding, snapshot, checksObservation: checks, reviewObservation: reviews }), /explicit merged snapshot/);
});

test('RepairProposal is local proposal data and never performs provider action', () => {
  const gateResult = evaluate({ pullRequestSnapshot: { ...snapshot, headSha: H2 } });
  const proposal = proposeRepair({ id: 'repair-a', workspaceId: 'workspace-a', binding, gateResult });
  assert.equal(proposal.reasonCode, 'head_mismatch');
  assert.match(proposal.suggestedAction, /local rebinding/);
  assert.equal(Object.keys(proposal).some((key) => /write|push|merge/i.test(key)), false);
});

test('closed-unmerged and cross-Workspace states cannot be ready', () => {
  const closed = evaluate({ pullRequestSnapshot: { ...snapshot, state: 'closed', merged: false } });
  assert.equal(closed.blockers.some((x) => x.code === 'pull_request_closed_unmerged'), true);
  const cross = evaluate({ binding: { ...binding, workspaceId: 'workspace-b' } });
  assert.equal(cross.blockers.some((x) => x.code === 'cross_workspace_binding'), true);
});
