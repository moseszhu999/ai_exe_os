const { assertSafeGitHubName } = require('../domain/identifiers.cjs');

class GitHubStateObserver {
  constructor({ adapter, eventStore }) {
    this.adapter = adapter;
    this.eventStore = eventStore;
    this.signatures = new Map();
  }

  async observePullRequest({ owner, repo, number }) {
    assertSafeGitHubName(owner, 'GitHub owner');
    assertSafeGitHubName(repo, 'GitHub repository');
    if (!Number.isInteger(number) || number <= 0) throw new TypeError('PR number must be a positive integer');

    const snapshot = await this.adapter.getPullRequest({ owner, repo, number });
    const key = `${owner}/${repo}#${number}`;
    const signature = JSON.stringify([
      snapshot.state,
      snapshot.draft,
      snapshot.merged,
      snapshot.headSha,
      snapshot.baseSha,
      snapshot.updatedAt,
    ]);
    const changed = this.signatures.get(key) !== signature;
    if (changed) {
      this.signatures.set(key, signature);
      this.eventStore.append({
        type: 'github.pull_request_state_changed',
        key,
        snapshot,
      });
    }
    return Object.freeze({ changed, snapshot });
  }
}

module.exports = { GitHubStateObserver };
