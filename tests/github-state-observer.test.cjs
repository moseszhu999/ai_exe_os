const test = require('node:test');
const assert = require('node:assert/strict');
const { GitHubStateObserver } = require('../src/main/github-state-observer.cjs');

test('GitHub observer emits one event per distinct state', async () => {
  let snapshot = {
    repository: 'owner/repo', number: 1, state: 'open', draft: true, merged: false,
    headSha: 'h1', baseSha: 'b1', updatedAt: '2026-08-06T00:00:00Z',
  };
  const events = [];
  const observer = new GitHubStateObserver({
    adapter: { getPullRequest: async () => snapshot },
    eventStore: { append: (event) => events.push(event) },
  });
  assert.equal((await observer.observePullRequest({ owner: 'owner', repo: 'repo', number: 1 })).changed, true);
  assert.equal((await observer.observePullRequest({ owner: 'owner', repo: 'repo', number: 1 })).changed, false);
  snapshot = { ...snapshot, draft: false, updatedAt: '2026-08-06T00:01:00Z' };
  assert.equal((await observer.observePullRequest({ owner: 'owner', repo: 'repo', number: 1 })).changed, true);
  assert.equal(events.length, 2);
});
