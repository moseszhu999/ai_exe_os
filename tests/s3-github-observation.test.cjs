'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GitHubObservationAdapter } = require('../src/main/github-observation/github-observation-adapter.cjs');

const H1 = '1'.repeat(40);
const B1 = 'a'.repeat(40);
const M1 = 'b'.repeat(40);

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

function makeAdapter(routes, { token = 'process-local-token' } = {}) {
  const calls = [];
  const adapter = new GitHubObservationAdapter({
    token,
    clock: () => '2026-08-07T06:00:00.000Z',
    onRequest: (entry) => calls.push(entry),
    fetchImpl: async (url, options) => {
      calls.push({ url, options: { ...options, headers: { ...options.headers } } });
      const path = new URL(url).pathname + new URL(url).search;
      if (!routes.has(path)) return response({ message: 'missing fixture' }, 404);
      return response(routes.get(path));
    },
  });
  return { adapter, calls };
}

test('PR observation normalizes exact head/base/merge state deterministically without token in result', async () => {
  const routes = new Map([[`/repos/moseszhu999/ai_exe_os/pulls/44`, {
    state: 'open', draft: false, merged_at: null, head: { sha: H1, ref: 'agent/feature' }, base: { sha: B1, ref: 'main' },
    merge_commit_sha: M1, mergeable_state: 'clean', updated_at: '2026-08-07T05:00:00Z',
  }]]);
  const { adapter } = makeAdapter(routes);
  const first = await adapter.observePullRequest({ owner: 'moseszhu999', repo: 'ai_exe_os', number: 44 });
  const second = await adapter.observePullRequest({ owner: 'moseszhu999', repo: 'ai_exe_os', number: 44 });
  assert.equal(first.headSha, H1);
  assert.equal(first.baseSha, B1);
  assert.equal(first.digest, second.digest);
  assert.doesNotMatch(JSON.stringify(first), /process-local-token|Authorization|Bearer/i);
});

test('check observation distinguishes pending, success, failure and stable-sorts normalized identities', async () => {
  const root = `/repos/moseszhu999/ai_exe_os/commits/${H1}`;
  const routes = new Map([
    [`${root}/check-runs`, { check_runs: [
      { name: 'build', status: 'completed', conclusion: 'success' },
      { name: 'lint', status: 'in_progress', conclusion: null },
      { name: 'tests', status: 'completed', conclusion: 'failure' },
    ] }],
    [`${root}/status`, { statuses: [
      { context: 'legacy-ci', state: 'pending' },
      { context: 'security', state: 'success' },
    ] }],
  ]);
  const { adapter } = makeAdapter(routes);
  const observed = await adapter.observeChecks({ owner: 'moseszhu999', repo: 'ai_exe_os', sha: H1 });
  assert.deepEqual(observed.checks.map((x) => [x.name, x.status, x.conclusion]), [
    ['build', 'completed', 'success'],
    ['lint', 'in_progress', null],
    ['tests', 'completed', 'failure'],
    ['legacy-ci', 'pending', null],
    ['security', 'completed', 'success'],
  ]);
});

test('review comments fail closed when REST cannot prove thread resolution', async () => {
  const root = `/repos/moseszhu999/ai_exe_os/pulls/44`;
  const routes = new Map([
    [`${root}/comments?per_page=100`, [
      { id: 10, position: 3 },
      { id: 11, in_reply_to_id: 10, position: null },
    ]],
    [`${root}/reviews?per_page=100`, [{ id: 20, state: 'APPROVED', commit_id: H1, submitted_at: '2026-08-07T05:00:00Z' }]],
  ]);
  const { adapter } = makeAdapter(routes);
  const observed = await adapter.observeReviewThreads({ owner: 'moseszhu999', repo: 'ai_exe_os', number: 44, headSha: H1 });
  assert.equal(observed.resolutionAvailable, false);
  assert.equal(observed.threads.length, 1);
  assert.equal(observed.threads[0].commentsCount, 2);
  assert.equal(observed.threads[0].outdated, true);
  assert.equal(observed.threads[0].resolved, null);
});

test('zero review comments yields complete empty-thread evidence without inferring review approval', async () => {
  const root = `/repos/moseszhu999/ai_exe_os/pulls/44`;
  const routes = new Map([
    [`${root}/comments?per_page=100`, []],
    [`${root}/reviews?per_page=100`, []],
  ]);
  const { adapter } = makeAdapter(routes);
  const observed = await adapter.observeReviewThreads({ owner: 'moseszhu999', repo: 'ai_exe_os', number: 44, headSha: H1 });
  assert.equal(observed.resolutionAvailable, true);
  assert.deepEqual(observed.threads, []);
  assert.deepEqual(observed.reviews, []);
});

test('commit and compare observations preserve merge-base provenance', async () => {
  const routes = new Map([
    [`/repos/moseszhu999/ai_exe_os/commits/${H1}`, { parents: [{ sha: B1 }], commit: { committer: { date: '2026-08-07T05:00:00Z' } } }],
    [`/repos/moseszhu999/ai_exe_os/compare/main...agent%2Ffeature`, { status: 'ahead', ahead_by: 2, behind_by: 0, merge_base_commit: { sha: B1 } }],
  ]);
  const { adapter } = makeAdapter(routes);
  const commit = await adapter.observeCommit({ owner: 'moseszhu999', repo: 'ai_exe_os', sha: H1 });
  const compared = await adapter.compare({ owner: 'moseszhu999', repo: 'ai_exe_os', base: 'main', head: 'agent/feature' });
  assert.deepEqual(commit.parents, [B1]);
  assert.equal(compared.mergeBaseSha, B1);
  assert.equal(compared.behindBy, 0);
});

test('request layer rejects every non-GET method before fetch and provider error is bounded', async () => {
  let fetchCount = 0;
  const adapter = new GitHubObservationAdapter({
    fetchImpl: async () => { fetchCount += 1; return response({ authorization: 'Bearer should-not-leak' }, 403); },
  });
  await assert.rejects(() => adapter.request('/x', { method: 'POST' }), /read-only/);
  assert.equal(fetchCount, 0);
  await assert.rejects(() => adapter.request('/x'), (error) => {
    assert.equal(error.message, 'GitHub read observation failed: 403');
    assert.doesNotMatch(error.message, /Bearer|authorization/i);
    return true;
  });
});

test('method audit records only GET paths even when Authorization header is used process-locally', async () => {
  const routes = new Map([[`/repos/moseszhu999/ai_exe_os/pulls/44`, { state: 'open', head: { sha: H1 }, base: { sha: B1 } }]]);
  const { adapter, calls } = makeAdapter(routes);
  await adapter.observePullRequest({ owner: 'moseszhu999', repo: 'ai_exe_os', number: 44 });
  const methodEntries = calls.filter((x) => x.method);
  assert.deepEqual(methodEntries.map((x) => x.method), ['GET']);
  const fetchEntry = calls.find((x) => x.url);
  assert.match(fetchEntry.options.headers.Authorization, /^Bearer /);
});
