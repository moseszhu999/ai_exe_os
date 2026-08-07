'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { CHANNELS, createS3GitHubBridgeContract } = require('../src/preload/s3-github-bridge-contract.cjs');
const { S3GitHubDeliveryController } = require('../src/renderer/s3/controller.cjs');
const { NAVIGATION, createS3GitHubViewModel, sanitizeS3 } = require('../src/renderer/s3/view-model.cjs');

const root = join(__dirname, '..');
const renderSource = readFileSync(join(root, 'src/renderer/s3/render.cjs'), 'utf8');

function state() {
  return {
    workspaces: [
      { id: 'workspace-a', name: 'A' },
      { id: 'workspace-b', name: 'B' },
    ],
    repositories: [
      { id: 'repo-a', workspaceId: 'workspace-a', repository: 'moseszhu999/ai_exe_os' },
      { id: 'repo-b', workspaceId: 'workspace-b', repository: 'other/private' },
    ],
    repositoryBindings: [],
    branchReservations: [{ id: 'branch-a', workspaceId: 'workspace-a', branch: 'agent/s3-test' }],
    pathOwnershipClaims: [{ id: 'claim-a', workspaceId: 'workspace-a', paths: ['src/domain'] }],
    pullRequestBindings: [{
      id: 'pr-binding-a', workspaceId: 'workspace-a', number: 44,
      expectedHeadSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }],
    pullRequestSnapshots: [{
      id: 'snapshot-a', workspaceId: 'workspace-a', pullRequestBindingId: 'pr-binding-a',
      headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', baseSha: 'cccccccccccccccccccccccccccccccccccccccc',
    }],
    checkObservations: [{ id: 'checks-a', workspaceId: 'workspace-a', pullRequestBindingId: 'pr-binding-a', state: 'pending' }],
    reviewThreadObservations: [{ id: 'reviews-a', workspaceId: 'workspace-a', pullRequestBindingId: 'pr-binding-a', resolutionAvailable: false }],
    deliveryGates: [{
      id: 'gate-a', workspaceId: 'workspace-a', pullRequestBindingId: 'pr-binding-a', state: 'blocked',
      blockers: [{ code: 'head_mismatch', detail: { expected: 'a', observed: 'b', githubToken: 'ghp_should_not_render' } }],
    }],
    mergeOrderConstraints: [],
    deliveryEvidence: [],
    repairProposals: [{ id: 'repair-a', workspaceId: 'workspace-a', pullRequestBindingId: 'pr-binding-a', status: 'proposal_only' }],
  };
}

test('view model is Workspace fail-closed and never falls back for an unknown explicit Workspace', () => {
  const vm = createS3GitHubViewModel(state(), 'workspace-missing');
  assert.equal(vm.activeWorkspace, null);
  assert.deepEqual(vm.repositories, []);
  assert.deepEqual(vm.pullRequestBindings, []);
  assert.deepEqual(vm.deliveryGates, []);
});

test('view model isolates Workspace and exposes exact-head mismatch plus deterministic blockers', () => {
  const vm = createS3GitHubViewModel(state(), 'workspace-a', 'pr-binding-a');
  assert.deepEqual(vm.repositories.map((item) => item.id), ['repo-a']);
  assert.equal(vm.exactHead.expected, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(vm.exactHead.observed, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert.equal(vm.exactHead.matches, false);
  assert.deepEqual(vm.blockers.map((item) => item.code), ['head_mismatch']);
  assert.equal(vm.blockers[0].detail.githubToken, '[redacted]');
  assert.equal(vm.controls.githubWriteAvailable, false);
});

test('nested secret profile and process-local values are redacted before display', () => {
  const safe = sanitizeS3({
    nested: {
      authorization: 'Bearer abcdefghijklmnopqrstuvwxyz',
      cookie: 'session=secret',
      processId: 9988,
      profilePath: '/tmp/profile',
      label: 'visible',
    },
  });
  assert.equal(safe.nested.authorization, '[redacted]');
  assert.equal(safe.nested.cookie, '[redacted]');
  assert.equal(safe.nested.processId, '[redacted]');
  assert.equal(safe.nested.profilePath, '[redacted]');
  assert.equal(safe.nested.label, 'visible');
});

test('controller collapses repeated read-only observation commands into one bridge invocation', async () => {
  let observeCalls = 0;
  let resolveObservation;
  const observation = new Promise((resolve) => { resolveObservation = resolve; });
  const bridge = {
    queryState: async () => state(),
    observeDelivery: async () => { observeCalls += 1; await observation; return { pullRequestBindingId: 'pr-binding-a' }; },
  };
  const controller = new S3GitHubDeliveryController({ bridge });
  const input = { workspaceId: 'workspace-a', pullRequestBindingId: 'pr-binding-a' };
  const one = controller.observeDelivery(input);
  const two = controller.observeDelivery(input);
  await Promise.resolve();
  assert.equal(observeCalls, 1);
  resolveObservation();
  await Promise.all([one, two]);
  assert.equal(observeCalls, 1);
});

test('bridge exposes exactly seven bounded local/read-only channels', async () => {
  const calls = [];
  const bridge = createS3GitHubBridgeContract({ invoke: async (...args) => { calls.push(args); return {}; } });
  assert.deepEqual(Object.keys(bridge).sort(), [
    'bindPullRequest','claimPaths','createRepairProposal','observeDelivery','queryState','registerRepository','reserveBranch',
  ]);
  assert.equal(Object.keys(CHANNELS).length, 7);
  await bridge.queryState('workspace-a');
  await bridge.observeDelivery({ workspaceId: 'workspace-a', pullRequestBindingId: 'pr-binding-a' });
  assert.equal(calls[0][0], 's3:github:query-state');
  assert.equal(calls[1][0], 's3:github:delivery:observe');
  for (const channel of Object.values(CHANNELS)) {
    assert.doesNotMatch(channel, /merge|close|comment|approve|review:submit|update|delete/i);
  }
});

test('renderer includes every S3 evidence surface and only safe DOM construction', () => {
  for (const surface of NAVIGATION) assert.ok(renderSource.includes(`'${surface}'`) || renderSource.includes(surface), surface);
  assert.match(renderSource, /Provider mode: READ-ONLY/);
  assert.match(renderSource, /Refresh Read-Only GitHub Evidence/);
  assert.match(renderSource, /Create Local Repair Proposal/);
  assert.doesNotMatch(renderSource, /innerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(renderSource, /mergePullRequest|closePullRequest|createComment|submitReview|updatePullRequest|deleteBranch/);
  assert.doesNotMatch(renderSource, /require\(['"]node:sqlite|DatabaseSync|state\.sqlite/);
});
