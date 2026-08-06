const test = require('node:test');
const assert = require('node:assert/strict');
const { GitHubReadOnlyAdapter } = require('../src/main/github-readonly-adapter.cjs');

test('GitHub adapter normalizes a PR without writes', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        state: 'open', draft: true, merged_at: null, updated_at: '2026-08-06T00:00:00Z',
        head: { sha: 'head' }, base: { sha: 'base' },
      }),
    };
  };
  const adapter = new GitHubReadOnlyAdapter({ fetchImpl });
  const result = await adapter.getPullRequest({ owner: 'owner', repo: 'repo', number: 1 });
  assert.deepEqual(result, {
    repository: 'owner/repo', number: 1, state: 'open', draft: true, merged: false,
    headSha: 'head', baseSha: 'base', updatedAt: '2026-08-06T00:00:00Z',
  });
  assert.equal(calls[0].options.method, 'GET');
});
