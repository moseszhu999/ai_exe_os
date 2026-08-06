class GitHubReadOnlyAdapter {
  constructor({ fetchImpl = globalThis.fetch, token = null } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');
    this.fetchImpl = fetchImpl;
    this.token = token;
  }

  headers() {
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ai-execution-os-s0',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  }

  async getPullRequest({ owner, repo, number }) {
    const response = await this.fetchImpl(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, {
      method: 'GET',
      headers: this.headers(),
    });
    if (!response.ok) throw new Error(`GitHub PR request failed: ${response.status}`);
    const data = await response.json();
    return Object.freeze({
      repository: `${owner}/${repo}`,
      number,
      state: data.state,
      draft: Boolean(data.draft),
      merged: Boolean(data.merged_at),
      headSha: data.head?.sha || null,
      baseSha: data.base?.sha || null,
      updatedAt: data.updated_at || null,
    });
  }

  async getCombinedStatus({ owner, repo, sha }) {
    const response = await this.fetchImpl(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/status`, {
      method: 'GET',
      headers: this.headers(),
    });
    if (!response.ok) throw new Error(`GitHub status request failed: ${response.status}`);
    const data = await response.json();
    return Object.freeze({
      repository: `${owner}/${repo}`,
      sha,
      state: data.state,
      totalCount: data.total_count,
      observedAt: new Date().toISOString(),
    });
  }
}

module.exports = { GitHubReadOnlyAdapter };
