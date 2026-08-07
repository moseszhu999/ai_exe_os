'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { S3ApplicationService } = require('../src/application/s3-application-service.cjs');
const {
  LOCAL_TRANSFORM_PACKAGE_ID,
  LOCAL_TRANSFORM_TARGET,
  LOCAL_TRANSFORM_VERSION,
} = require('../src/application/s2-index.cjs');
const { semanticDigest } = require('../src/main/github-observation/github-observation-adapter.cjs');

const H1 = '1'.repeat(40);
const H2 = '2'.repeat(40);
const B1 = 'a'.repeat(40);
const M1 = 'b'.repeat(40);

class FakeGitHubObservation {
  constructor() {
    this.headSha = H1;
    this.merged = false;
    this.calls = [];
  }
  async observePullRequest({ owner, repo, number }) {
    this.calls.push(['GET_PR', owner, repo, number]);
    const value = {
      repository: `${owner}/${repo}`, number,
      state: this.merged ? 'closed' : 'open', draft: false, merged: this.merged,
      headSha: this.headSha, headRef: 'agent/s3-test', baseSha: B1, baseRef: 'main',
      mergeCommitSha: this.merged ? M1 : null, mergeableState: 'clean', updatedAt: '2026-08-07T06:00:00Z', observedAt: '2026-08-07T06:00:01Z',
    };
    return Object.freeze({ ...value, digest: semanticDigest({ ...value, observedAt: undefined }) });
  }
  async observeChecks({ sha }) {
    this.calls.push(['GET_CHECKS', sha]);
    const checks = [{ name: 'build', status: 'completed', conclusion: 'success', source: 'check_run' }];
    return Object.freeze({ repository: 'moseszhu999/ai_exe_os', headSha: sha, checks, observedAt: '2026-08-07T06:00:02Z', digest: semanticDigest({ headSha: sha, checks }) });
  }
  async observeReviewThreads({ number, headSha }) {
    this.calls.push(['GET_REVIEWS', number, headSha]);
    return Object.freeze({ repository: 'moseszhu999/ai_exe_os', pullRequestNumber: number, headSha, threads: [], reviews: [], resolutionAvailable: true, observedAt: '2026-08-07T06:00:03Z', digest: semanticDigest({ headSha, threads: [], reviews: [], resolutionAvailable: true }) });
  }
  async compare({ base, head }) {
    this.calls.push(['GET_COMPARE', base, head]);
    const value = { repository: 'moseszhu999/ai_exe_os', base, head, status: 'ahead', aheadBy: 3, behindBy: 0, mergeBaseSha: base, observedAt: '2026-08-07T06:00:04Z' };
    return Object.freeze({ ...value, digest: semanticDigest({ ...value, observedAt: undefined }) });
  }
}

function workerManager() {
  return {
    list: () => [],
    async submitAuthorizedLocalTask() { throw new Error('external runtime must not be reached in this test'); },
  };
}

function prepareMission(service) {
  const installation = service.installCapability({ workspaceId: 'workspace-a', packageId: LOCAL_TRANSFORM_PACKAGE_ID, version: LOCAL_TRANSFORM_VERSION });
  service.grantCapability({
    workspaceId: 'workspace-a', agentId: 'agent-a2', installationId: installation.id,
    allowedActions: ['transform_payload'], allowedTargets: [LOCAL_TRANSFORM_TARGET],
  });
  const created = service.createMission({ id: 's3-delivery-mission', workspaceId: 'workspace-a', title: 'S3 delivery continuation', objective: 'Run only after observed merge evidence' });
  const revision = service.createRevision({
    id: 's3-delivery-revision', workspaceId: 'workspace-a', missionId: created.mission.id, revision: 1,
    objective: 'Run only after observed merge evidence', terminalStepIds: ['delivery-local-step'],
    steps: [{
      id: 'delivery-local-step', name: 'Delivery released local continuation', agentId: 'agent-a2',
      installationId: installation.id, capabilityVersionId: `${LOCAL_TRANSFORM_PACKAGE_ID}@${LOCAL_TRANSFORM_VERSION}`,
      action: 'transform_payload', target: LOCAL_TRANSFORM_TARGET, dependsOn: [], declaredInputs: [],
      declaredOutputs: ['delivery_result'], evidenceRequirements: ['local-transform-evidence'], humanGatePolicy: 'never',
      payload: 'released by GitHub merge evidence',
    }],
  });
  return { mission: created.mission, revision: revision.revision };
}

test('exact-head readiness does not start Mission; merge evidence releases it exactly once across restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ai-exe-os-s3-'));
  const databasePath = join(root, 'state.sqlite');
  const github = new FakeGitHubObservation();
  let service;
  try {
    service = new S3ApplicationService({ databasePath, workerManager: workerManager(), localTarget: 'http://127.0.0.1:43119/task-form.html', githubObservationAdapter: github });
    const { mission, revision } = prepareMission(service);
    const registration = service.registerRepository({ id: 'repo-reg-a', workspaceId: 'workspace-a', owner: 'moseszhu999', repository: 'ai_exe_os', visibilityHint: 'private' });
    const reservation = service.reserveBranch({ id: 'branch-res-a', workspaceId: 'workspace-a', repositoryRegistrationId: registration.id, branch: 'agent/s3-test', ownerKind: 'mission_step', ownerId: 'delivery-local-step' });
    service.claimPaths({ workspaceId: 'workspace-a', branchReservationId: reservation.id, ownerId: 'delivery-local-step', paths: ['src/application/**'] });
    const { binding } = service.bindPullRequest({
      id: 'pr-binding-a', workspaceId: 'workspace-a', repositoryRegistrationId: registration.id, planStepId: 'delivery-local-step',
      number: 54, expectedHeadSha: H1, expectedBaseRef: 'main', requiredCheckNames: ['build'], requireNoUnresolvedThreads: true, requireCurrentBase: true,
    });
    service.declareMissionDeliveryDependency({
      id: 'delivery-dependency-a', workspaceId: 'workspace-a', pullRequestBindingId: binding.id,
      missionId: mission.id, revisionId: revision.id, runId: 's3-delivery-run',
    });

    const ready = await service.observeDelivery({ workspaceId: 'workspace-a', pullRequestBindingId: binding.id });
    assert.equal(ready.gate.state, 'ready');
    assert.equal(ready.evidence.kind, 'exact_head_ready');
    assert.equal(service.missionRun.get('s3-delivery-run'), null, 'exact-head ready must not start the delivery-dependent Mission');
    assert.equal(service.deliveryDependency.get('delivery-dependency-a').state, 'waiting');

    github.merged = true;
    const merged = await service.observeDelivery({ workspaceId: 'workspace-a', pullRequestBindingId: binding.id });
    assert.equal(merged.evidence.kind, 'merge_observed');
    assert.equal(merged.gate.state, 'satisfied');
    assert.equal(service.deliveryDependency.get('delivery-dependency-a').state, 'released');
    assert.equal(service.missionRun.get('s3-delivery-run').state, 'completed');
    assert.equal(service.stepAttempt.list().filter((item) => item.missionRunId === 's3-delivery-run').length, 1);
    const githubEventCount = service.store.listEvents({ workspaceId: 'workspace-a' }).filter((event) => event.eventType.startsWith('github.')).length;
    service.close();

    service = new S3ApplicationService({ databasePath, workerManager: workerManager(), localTarget: 'http://127.0.0.1:43119/task-form.html', githubObservationAdapter: github });
    assert.equal(service.missionRun.get('s3-delivery-run').state, 'completed');
    assert.equal(service.deliveryDependency.get('delivery-dependency-a').state, 'released');
    const beforeRepeatAttempts = service.stepAttempt.list().filter((item) => item.missionRunId === 's3-delivery-run').length;
    await service.observeDelivery({ workspaceId: 'workspace-a', pullRequestBindingId: binding.id });
    assert.equal(service.stepAttempt.list().filter((item) => item.missionRunId === 's3-delivery-run').length, beforeRepeatAttempts, 'repeated merged observation must not replay Mission work');
    const afterGithubEventCount = service.store.listEvents({ workspaceId: 'workspace-a' }).filter((event) => event.eventType.startsWith('github.')).length;
    assert.equal(afterGithubEventCount, githubEventCount, 'unchanged observation must not append duplicate canonical GitHub events');
  } finally {
    try { service?.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test('head movement fails stale, proposal is local-only, and Workspace queries isolate repository state', async () => {
  const github = new FakeGitHubObservation();
  const service = new S3ApplicationService({ workerManager: workerManager(), localTarget: 'http://127.0.0.1:43119/task-form.html', githubObservationAdapter: github });
  try {
    const registrationA = service.registerRepository({ id: 'repo-a', workspaceId: 'workspace-a', owner: 'moseszhu999', repository: 'ai_exe_os' });
    service.registerRepository({ id: 'repo-b', workspaceId: 'workspace-b', owner: 'moseszhu999', repository: 'ai_exe_os' });
    const { binding } = service.bindPullRequest({ id: 'binding-a', workspaceId: 'workspace-a', repositoryRegistrationId: registrationA.id, number: 51, expectedHeadSha: H1, requiredCheckNames: ['build'], requireNoUnresolvedThreads: true, requireCurrentBase: true });
    github.headSha = H2;
    const observed = await service.observeDelivery({ workspaceId: 'workspace-a', pullRequestBindingId: binding.id });
    assert.equal(observed.gate.state, 'stale');
    assert.equal(observed.gate.blockers.some((item) => item.code === 'head_mismatch'), true);
    const proposal = service.createRepairProposal({ workspaceId: 'workspace-a', pullRequestBindingId: binding.id });
    assert.equal(proposal.state, 'proposed');
    assert.match(proposal.suggestedAction, /local rebinding/);
    const stateA = service.queryGitHubDeliveryState('workspace-a');
    const stateB = service.queryGitHubDeliveryState('workspace-b');
    assert.deepEqual(stateA.repositories.map((item) => item.id), ['repo-a']);
    assert.deepEqual(stateB.repositories.map((item) => item.id), ['repo-b']);
    assert.equal(github.calls.every((call) => call[0].startsWith('GET_')), true);
  } finally {
    service.close();
  }
});
