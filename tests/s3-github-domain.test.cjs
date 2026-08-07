'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  archiveRepositoryRegistration,
  assertRepositoryRegistrationSemanticMatch,
  assertRepositoryWorkspace,
  createRepositoryBinding,
  createRepositoryRegistration,
} = require('../src/domain/github-repository-model.cjs');
const {
  assertSafeBranchName,
  branchReservationsConflict,
  createBranchReservation,
  createPathOwnershipClaim,
  findOwnershipConflicts,
  normalizePathPrefix,
  pathClaimsConflict,
  releaseBranchReservation,
} = require('../src/domain/github-ownership-model.cjs');
const {
  assertMergeOrderAcyclic,
  assertPullRequestBindingSemanticMatch,
  createDeliveryEvidence,
  createMergeOrderConstraint,
  createPullRequestBinding,
  createRepairProposal,
} = require('../src/domain/github-delivery-model.cjs');

const H1 = '1'.repeat(40);
const H2 = '2'.repeat(40);
const B1 = 'a'.repeat(40);

function registration(overrides = {}) {
  return createRepositoryRegistration({ id: 'repo-a', workspaceId: 'workspace-a', owner: 'moseszhu999', repository: 'ai_exe_os', createdAt: '2026-08-07T06:00:00.000Z', ...overrides });
}

function reservation(id, ownerId, branch = 'agent/feature-a', overrides = {}) {
  return createBranchReservation({ id, workspaceId: 'workspace-a', repositoryRegistrationId: 'repo-a', branch, ownerId, ownerKind: 'mission_step', createdAt: '2026-08-07T06:00:00.000Z', ...overrides });
}

function claim(id, ownerId, pathPattern, overrides = {}) {
  return createPathOwnershipClaim({ id, workspaceId: 'workspace-a', repositoryRegistrationId: 'repo-a', branchReservationId: `branch-${ownerId}`, ownerId, pathPattern, createdAt: '2026-08-07T06:00:00.000Z', ...overrides });
}

test('repository registration is Workspace-scoped and semantic id reuse is fail-closed', () => {
  const a = registration();
  const same = registration();
  assert.equal(assertRepositoryRegistrationSemanticMatch(a, same), a);
  const otherWorkspace = registration({ id: 'repo-b', workspaceId: 'workspace-b' });
  assert.throws(() => assertRepositoryWorkspace('workspace-a', a, otherWorkspace), /Cross-Workspace/);
  const changed = registration({ repository: 'different-repo' });
  assert.throws(() => assertRepositoryRegistrationSemanticMatch(a, changed), /collision/);
  const archived = archiveRepositoryRegistration(a, '2026-08-07T06:01:00.000Z');
  assert.equal(archived.status, 'archived');
  assert.equal(archiveRepositoryRegistration(archived), archived);
});

test('repository binding requires a bounded Mission/Plan owner and preserves Workspace', () => {
  const binding = createRepositoryBinding({ id: 'rb-a', workspaceId: 'workspace-a', repositoryRegistrationId: 'repo-a', missionRunId: 'run-a', planStepId: 'step-a' });
  assert.equal(binding.workspaceId, 'workspace-a');
  assert.throws(() => createRepositoryBinding({ id: 'rb-b', workspaceId: 'workspace-a', repositoryRegistrationId: 'repo-a' }), /requires/);
});

test('branch names allow normal slash refs but reject dangerous Git-ref sequences', () => {
  assert.equal(assertSafeBranchName('agent/s3-feature.v1'), 'agent/s3-feature.v1');
  for (const value of ['../evil', '/root', 'bad//name', 'bad\\name', 'bad@{x', 'bad.lock']) {
    assert.throws(() => assertSafeBranchName(value));
  }
});

test('exclusive branch reservations conflict only for same repo/branch and different owner', () => {
  const a = reservation('br-a', 'step-a');
  const b = reservation('br-b', 'step-b');
  const other = reservation('br-c', 'step-c', 'agent/other');
  const readOnly = reservation('br-d', 'step-d', 'agent/feature-a', { mode: 'read_only' });
  assert.equal(branchReservationsConflict(a, b), true);
  assert.equal(branchReservationsConflict(a, other), false);
  assert.equal(branchReservationsConflict(a, readOnly), false);
  assert.equal(branchReservationsConflict(a, releaseBranchReservation(b)), false);
});

test('path normalization rejects traversal and exclusive conflict is segment-aware', () => {
  assert.equal(normalizePathPrefix('src/application/**'), 'src/application');
  for (const value of ['/src/app', 'src/../secret', 'src//app', 'src\\app']) assert.throws(() => normalizePathPrefix(value));
  const a = claim('claim-a', 'step-a', 'src/app');
  const child = claim('claim-b', 'step-b', 'src/app/components');
  const sibling = claim('claim-c', 'step-c', 'src/application');
  const readOnly = claim('claim-d', 'step-d', 'src/app', { mode: 'read_only' });
  assert.equal(pathClaimsConflict(a, child), true);
  assert.equal(pathClaimsConflict(a, sibling), false);
  assert.equal(pathClaimsConflict(a, readOnly), false);
  assert.deepEqual(findOwnershipConflicts({ claims: [a, child, sibling, readOnly] }).map((x) => x.kind), ['path']);
});

test('PullRequestBinding pins exact head and rejects semantic reuse for a different head', () => {
  const a = createPullRequestBinding({ id: 'prb-a', workspaceId: 'workspace-a', repositoryRegistrationId: 'repo-a', planStepId: 'step-a', number: 44, expectedHeadSha: H1, expectedBaseRef: 'main' });
  const same = createPullRequestBinding({ id: 'prb-a', workspaceId: 'workspace-a', repositoryRegistrationId: 'repo-a', planStepId: 'step-a', number: 44, expectedHeadSha: H1, expectedBaseRef: 'main' });
  assert.equal(assertPullRequestBindingSemanticMatch(a, same), a);
  const moved = createPullRequestBinding({ id: 'prb-a', workspaceId: 'workspace-a', repositoryRegistrationId: 'repo-a', planStepId: 'step-a', number: 44, expectedHeadSha: H2, expectedBaseRef: 'main' });
  assert.throws(() => assertPullRequestBindingSemanticMatch(a, moved), /collision/);
});

test('merge-order constraints reject self-dependency and graph cycles', () => {
  const ab = createMergeOrderConstraint({ id: 'mo-ab', workspaceId: 'workspace-a', repositoryRegistrationId: 'repo-a', predecessorPullRequestBindingId: 'pr-a', successorPullRequestBindingId: 'pr-b' });
  const bc = createMergeOrderConstraint({ id: 'mo-bc', workspaceId: 'workspace-a', repositoryRegistrationId: 'repo-a', predecessorPullRequestBindingId: 'pr-b', successorPullRequestBindingId: 'pr-c' });
  assert.equal(assertMergeOrderAcyclic([ab, bc]), true);
  const ca = createMergeOrderConstraint({ id: 'mo-ca', workspaceId: 'workspace-a', repositoryRegistrationId: 'repo-a', predecessorPullRequestBindingId: 'pr-c', successorPullRequestBindingId: 'pr-a' });
  assert.throws(() => assertMergeOrderAcyclic([ab, bc, ca]), /cycle/);
  assert.throws(() => createMergeOrderConstraint({ id: 'self', workspaceId: 'workspace-a', repositoryRegistrationId: 'repo-a', predecessorPullRequestBindingId: 'pr-a', successorPullRequestBindingId: 'pr-a' }), /self/);
});

test('delivery evidence is immutable, SHA-bound and privacy-bounded; repair is proposal-only data', () => {
  const evidence = createDeliveryEvidence({
    id: 'evidence-a', workspaceId: 'workspace-a', pullRequestBindingId: 'prb-a', kind: 'merge_observed',
    headSha: H1, baseSha: B1, mergeCommitSha: H2, checkDigest: 'sha256:checks', reviewDigest: 'sha256:reviews', payload: { checkCount: 2 },
  });
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(evidence.headSha, H1);
  assert.throws(() => createDeliveryEvidence({ id: 'bad', workspaceId: 'workspace-a', pullRequestBindingId: 'prb-a', kind: 'exact_head_ready', headSha: H1, baseSha: B1, checkDigest: 'x', reviewDigest: 'y', payload: { token: 'secret' } }), /Forbidden/);
  const proposal = createRepairProposal({ id: 'repair-a', workspaceId: 'workspace-a', pullRequestBindingId: 'prb-a', reasonCode: 'base_stale', description: 'Base is stale', suggestedAction: 'Review and prepare a new local repair task' });
  assert.deepEqual(Object.keys(proposal).includes('providerWrite'), false);
  assert.equal(proposal.state, 'proposed');
});
