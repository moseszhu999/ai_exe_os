'use strict';

const { createHash } = require('node:crypto');
const { assertSafeGitHubName } = require('../../domain/identifiers.cjs');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function semanticDigest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')}`;
}
function assertSha(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/i.test(value)) throw new TypeError('Git SHA must be 40 hex characters');
  return value.toLowerCase();
}
function assertNumber(value) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError('PR number must be a positive integer');
  return value;
}

class GitHubObservationAdapter {
  constructor({ fetchImpl = globalThis.fetch, token = null, apiBase = 'https://api.github.com', onRequest = null, clock = () => new Date().toISOString() } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');
    this.fetchImpl = fetchImpl;
    this.token = token;
    this.apiBase = String(apiBase).replace(/\/$/, '');
    this.onRequest = onRequest;
    this.clock = clock;
  }

  headers() {
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ai-execution-os-s3',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  }

  async request(path, { method = 'GET' } = {}) {
    if (method !== 'GET') throw new Error(`S3 GitHub adapter is read-only; unsupported method: ${method}`);
    if (this.onRequest) this.onRequest(Object.freeze({ method, path }));
    const response = await this.fetchImpl(`${this.apiBase}${path}`, { method, headers: this.headers() });
    if (!response.ok) throw new Error(`GitHub read observation failed: ${response.status}`);
    return response.json();
  }

  repoPath(owner, repo) {
    assertSafeGitHubName(owner, 'GitHub owner');
    assertSafeGitHubName(repo, 'GitHub repository');
    return `/repos/${owner}/${repo}`;
  }

  async observePullRequest({ owner, repo, number }) {
    const data = await this.request(`${this.repoPath(owner, repo)}/pulls/${assertNumber(number)}`);
    const snapshot = Object.freeze({
      repository: `${owner}/${repo}`,
      number,
      state: data.state || 'unknown',
      draft: Boolean(data.draft),
      merged: Boolean(data.merged_at || data.merged),
      headSha: data.head?.sha ? assertSha(data.head.sha) : null,
      headRef: data.head?.ref || null,
      baseSha: data.base?.sha ? assertSha(data.base.sha) : null,
      baseRef: data.base?.ref || null,
      mergeCommitSha: data.merge_commit_sha && /^[0-9a-f]{40}$/i.test(data.merge_commit_sha) ? data.merge_commit_sha.toLowerCase() : null,
      mergeableState: data.mergeable_state || null,
      updatedAt: data.updated_at || null,
      observedAt: this.clock(),
    });
    return Object.freeze({ ...snapshot, digest: semanticDigest(snapshotForDigest(snapshot)) });
  }

  async observeChecks({ owner, repo, sha }) {
    const headSha = assertSha(sha);
    const root = this.repoPath(owner, repo);
    const [checkRuns, combined] = await Promise.all([
      this.request(`${root}/commits/${headSha}/check-runs`),
      this.request(`${root}/commits/${headSha}/status`),
    ]);
    const normalized = [];
    for (const run of checkRuns.check_runs || []) {
      normalized.push(Object.freeze({
        name: String(run.name || 'unnamed-check'),
        status: normalizeStatus(run.status),
        conclusion: normalizeConclusion(run.conclusion),
        source: 'check_run',
      }));
    }
    for (const status of combined.statuses || []) {
      normalized.push(Object.freeze({
        name: String(status.context || 'unnamed-status'),
        status: status.state === 'pending' ? 'pending' : 'completed',
        conclusion: normalizeLegacyStatus(status.state),
        source: 'commit_status',
      }));
    }
    normalized.sort((a, b) => `${a.source}:${a.name}`.localeCompare(`${b.source}:${b.name}`));
    const observation = Object.freeze({
      repository: `${owner}/${repo}`,
      headSha,
      checks: Object.freeze(normalized),
      observedAt: this.clock(),
    });
    return Object.freeze({ ...observation, digest: semanticDigest({ headSha, checks: normalized }) });
  }

  async observeReviewThreads({ owner, repo, number, headSha }) {
    const expectedHead = assertSha(headSha);
    const root = this.repoPath(owner, repo);
    const [comments, reviews] = await Promise.all([
      this.request(`${root}/pulls/${assertNumber(number)}/comments?per_page=100`),
      this.request(`${root}/pulls/${number}/reviews?per_page=100`),
    ]);
    const byRoot = new Map();
    for (const comment of comments || []) {
      const rootId = comment.in_reply_to_id || comment.id;
      const thread = byRoot.get(rootId) || { id: String(rootId), commentsCount: 0, outdated: false, resolved: null };
      thread.commentsCount += 1;
      thread.outdated = thread.outdated || comment.position === null;
      byRoot.set(rootId, thread);
    }
    const threads = [...byRoot.values()].sort((a, b) => a.id.localeCompare(b.id)).map((item) => Object.freeze(item));
    const normalizedReviews = (reviews || []).map((review) => Object.freeze({
      id: String(review.id),
      state: String(review.state || 'UNKNOWN').toUpperCase(),
      commitSha: review.commit_id && /^[0-9a-f]{40}$/i.test(review.commit_id) ? review.commit_id.toLowerCase() : null,
      submittedAt: review.submitted_at || null,
    })).sort((a, b) => a.id.localeCompare(b.id));
    const resolutionAvailable = threads.length === 0;
    const observation = Object.freeze({
      repository: `${owner}/${repo}`,
      pullRequestNumber: number,
      headSha: expectedHead,
      threads: Object.freeze(threads),
      reviews: Object.freeze(normalizedReviews),
      resolutionAvailable,
      observedAt: this.clock(),
    });
    return Object.freeze({
      ...observation,
      digest: semanticDigest({ headSha: expectedHead, threads, reviews: normalizedReviews, resolutionAvailable }),
    });
  }

  async observeCommit({ owner, repo, sha }) {
    const commitSha = assertSha(sha);
    const data = await this.request(`${this.repoPath(owner, repo)}/commits/${commitSha}`);
    const observation = Object.freeze({
      repository: `${owner}/${repo}`,
      sha: commitSha,
      parents: Object.freeze((data.parents || []).map((parent) => assertSha(parent.sha))),
      committedAt: data.commit?.committer?.date || null,
      observedAt: this.clock(),
    });
    return Object.freeze({ ...observation, digest: semanticDigest({ sha: commitSha, parents: observation.parents, committedAt: observation.committedAt }) });
  }

  async compare({ owner, repo, base, head }) {
    const baseRef = encodeURIComponent(String(base));
    const headRef = encodeURIComponent(String(head));
    const data = await this.request(`${this.repoPath(owner, repo)}/compare/${baseRef}...${headRef}`);
    const observation = Object.freeze({
      repository: `${owner}/${repo}`,
      base: String(base),
      head: String(head),
      status: data.status || 'unknown',
      aheadBy: Number.isInteger(data.ahead_by) ? data.ahead_by : null,
      behindBy: Number.isInteger(data.behind_by) ? data.behind_by : null,
      mergeBaseSha: data.merge_base_commit?.sha ? assertSha(data.merge_base_commit.sha) : null,
      observedAt: this.clock(),
    });
    return Object.freeze({ ...observation, digest: semanticDigest({ ...observation, observedAt: undefined }) });
  }
}

function snapshotForDigest(snapshot) {
  return {
    repository: snapshot.repository,
    number: snapshot.number,
    state: snapshot.state,
    draft: snapshot.draft,
    merged: snapshot.merged,
    headSha: snapshot.headSha,
    headRef: snapshot.headRef,
    baseSha: snapshot.baseSha,
    baseRef: snapshot.baseRef,
    mergeCommitSha: snapshot.mergeCommitSha,
    mergeableState: snapshot.mergeableState,
    updatedAt: snapshot.updatedAt,
  };
}
function normalizeStatus(status) {
  if (['queued', 'in_progress', 'completed'].includes(status)) return status;
  if (status === 'pending') return 'pending';
  return 'unknown';
}
function normalizeConclusion(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).toLowerCase();
  return ['success', 'failure', 'cancelled', 'timed_out', 'skipped', 'neutral', 'action_required', 'stale'].includes(normalized) ? normalized : 'unknown';
}
function normalizeLegacyStatus(value) {
  if (value === 'success') return 'success';
  if (['failure', 'error'].includes(value)) return 'failure';
  if (value === 'pending') return null;
  return 'unknown';
}

module.exports = {
  GitHubObservationAdapter,
  semanticDigest,
  stable,
};
