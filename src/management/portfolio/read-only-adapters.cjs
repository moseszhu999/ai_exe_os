'use strict';

const { buildPortfolioSnapshot, createManagedProjectSnapshot } = require('./index.cjs');

const OBSERVATION_SCHEMA = 'aiexe.project-observation.github.v1';
const OBSERVED_PORTFOLIO_SCHEMA = 'aiexe.observed-portfolio.v1';
const FRESHNESS_STATES = Object.freeze(['current', 'stale', 'unknown']);
const DEFAULT_FRESHNESS_WINDOW_MINUTES = 120;

const CORE_PORTFOLIO_PROJECTS = Object.freeze([
  Object.freeze({ id: 'aiexe', name: 'AIEXE', kind: 'platform', repository: 'moseszhu999/ai_exe_os', defaultBranch: 'main' }),
  Object.freeze({ id: 'trainingos', name: 'TrainingOS', kind: 'domain-os', repository: 'moseszhu999/training-learning-rails', defaultBranch: 'main' }),
  Object.freeze({ id: 'tradeos', name: 'TradeOS', kind: 'domain-os', repository: 'moseszhu999/chaintrace-app', defaultBranch: 'main' }),
  Object.freeze({ id: 'video-operation-shared-media', name: 'Video Operation / Shared Media', kind: 'shared-service', repository: 'moseszhu999/global-tool-radar', defaultBranch: 'main' }),
]);

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a plain object`);
  return value;
}

function requiredText(value, label, maxLength = 320) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const text = value.trim();
  if (!text) throw new TypeError(`${label} must not be empty`);
  if (text.length > maxLength) throw new TypeError(`${label} is too long`);
  return text;
}

function optionalText(value, label, maxLength = 1000) {
  if (value == null) return null;
  return requiredText(value, label, maxLength);
}

function exactIdentifier(value, label) {
  const text = requiredText(value, label, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(text)) throw new TypeError(`${label} must be a bounded identifier`);
  return text;
}

function isoInstant(value, label) {
  const text = requiredText(value, label, 80);
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new TypeError(`${label} must be an ISO timestamp`);
  return { text, ms };
}

function exactSha(value, label = 'commit sha') {
  const text = requiredText(value, label, 64).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(text)) throw new TypeError(`${label} must be a 40-character git SHA`);
  return text;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer`);
  return value;
}

function uniqueTextList(value, label, maxLength = 320) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const rows = value.map((item) => requiredText(item, label, maxLength));
  if (new Set(rows).size !== rows.length) throw new Error(`${label} must not contain duplicates`);
  return Object.freeze([...rows].sort());
}

function descriptorFor(projectId) {
  const id = exactIdentifier(projectId, 'project id');
  const descriptor = CORE_PORTFOLIO_PROJECTS.find((project) => project.id === id);
  if (!descriptor) throw new Error(`unregistered core portfolio project: ${id}`);
  return descriptor;
}

function classifyFreshness({ observedAt, now, freshnessWindowMinutes = DEFAULT_FRESHNESS_WINDOW_MINUTES }) {
  const observed = isoInstant(observedAt, 'source observed at');
  const clock = isoInstant(now, 'current time');
  if (!Number.isFinite(freshnessWindowMinutes) || freshnessWindowMinutes <= 0) throw new TypeError('freshness window minutes must be positive');
  const ageMs = clock.ms - observed.ms;
  if (ageMs < 0) return freezeDeep({ state: 'unknown', ageMinutes: null, reason: 'observation_from_future' });
  const ageMinutes = Math.floor(ageMs / 60000);
  return freezeDeep({
    state: ageMinutes <= freshnessWindowMinutes ? 'current' : 'stale',
    ageMinutes,
    reason: ageMinutes <= freshnessWindowMinutes ? 'within_window' : 'outside_window',
  });
}

function normalizePullRequest(input, repository) {
  plainObject(input, 'pull request observation');
  const allowed = new Set(['number', 'title', 'headSha', 'draft', 'updatedAt', 'ownerScope']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`pull request observation contains unsupported field: ${key}`);
  const headSha = exactSha(input.headSha, 'pull request head sha');
  return freezeDeep({
    number: positiveInteger(input.number, 'pull request number'),
    title: requiredText(input.title, 'pull request title', 300),
    headSha,
    draft: Boolean(input.draft),
    updatedAt: isoInstant(input.updatedAt, 'pull request updated at').text,
    ownerScope: optionalText(input.ownerScope, 'pull request owner scope', 200),
    evidenceRef: `github:${repository}:pr:${input.number}@${headSha}`,
  });
}

function createGithubReadOnlyProjectObservation(input) {
  plainObject(input, 'GitHub project observation');
  const allowed = new Set([
    'projectId', 'repository', 'defaultBranch', 'headSha', 'observedAt', 'now',
    'freshnessWindowMinutes', 'openPullRequests', 'domainStatus', 'owner', 'milestone',
    'summary', 'blockerCodes', 'evidenceRefs',
  ]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`GitHub project observation contains unsupported field: ${key}`);

  const descriptor = descriptorFor(input.projectId);
  const repository = requiredText(input.repository, 'repository', 200);
  if (repository !== descriptor.repository) throw new Error(`repository mismatch for ${descriptor.id}`);
  const defaultBranch = requiredText(input.defaultBranch || descriptor.defaultBranch, 'default branch', 100);
  if (defaultBranch !== descriptor.defaultBranch) throw new Error(`default branch mismatch for ${descriptor.id}`);
  const headSha = exactSha(input.headSha);
  const observedAt = isoInstant(input.observedAt, 'source observed at').text;
  const freshness = classifyFreshness({
    observedAt,
    now: input.now || input.observedAt,
    freshnessWindowMinutes: input.freshnessWindowMinutes || DEFAULT_FRESHNESS_WINDOW_MINUTES,
  });

  const pullRequests = Array.isArray(input.openPullRequests)
    ? input.openPullRequests.map((pr) => normalizePullRequest(pr, repository))
    : [];
  const prNumbers = pullRequests.map((pr) => pr.number);
  if (new Set(prNumbers).size !== prNumbers.length) throw new Error('open pull request numbers must be unique');

  const blockerCodes = uniqueTextList(input.blockerCodes, 'blocker code', 120);
  const attention = [];
  if (freshness.state === 'stale') attention.push('source_stale');
  if (freshness.state === 'unknown') attention.push('source_freshness_unknown');
  if (input.domainStatus == null) attention.push('domain_status_unknown');
  if (input.owner == null) attention.push('owner_unknown');
  for (const code of blockerCodes) attention.push(`blocker:${code}`);

  const evidenceRefs = [
    `github:${repository}:commit:${headSha}`,
    ...pullRequests.map((pr) => pr.evidenceRef),
    ...uniqueTextList(input.evidenceRefs, 'evidence ref', 320),
  ];

  const snapshot = createManagedProjectSnapshot({
    id: descriptor.id,
    name: descriptor.name,
    kind: descriptor.kind,
    status: input.domainStatus || 'unknown',
    sourceOfTruth: `github:${repository}@${defaultBranch}`,
    owner: input.owner || null,
    milestone: input.milestone || null,
    summary: input.summary || `Read-only GitHub observation: ${repository}@${headSha.slice(0, 12)}; open PRs=${pullRequests.length}.`,
    attentionSignals: [...new Set(attention)].sort(),
    evidenceRefs: [...new Set(evidenceRefs)].sort(),
    observedAt,
  });

  return freezeDeep({
    schema: OBSERVATION_SCHEMA,
    projectId: descriptor.id,
    readOnly: true,
    writeAuthority: 'none',
    source: {
      provider: 'github',
      repository,
      defaultBranch,
      headSha,
      observedAt,
      freshness,
    },
    openWork: { pullRequests },
    blockers: blockerCodes,
    snapshot,
  });
}

function buildObservedPortfolio(input) {
  plainObject(input, 'observed portfolio input');
  const allowed = new Set(['portfolioId', 'observedAt', 'observations']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`observed portfolio input contains unsupported field: ${key}`);
  if (!Array.isArray(input.observations) || input.observations.length < 1) throw new TypeError('observations must be a non-empty array');
  for (const observation of input.observations) {
    if (observation?.schema !== OBSERVATION_SCHEMA || observation?.readOnly !== true || observation?.writeAuthority !== 'none') {
      throw new Error('portfolio accepts only canonical read-only project observations');
    }
  }
  const ids = input.observations.map((observation) => observation.projectId);
  if (new Set(ids).size !== ids.length) throw new Error('observed portfolio projects must be unique');

  const portfolio = buildPortfolioSnapshot({
    portfolioId: input.portfolioId,
    observedAt: input.observedAt,
    projects: input.observations.map((observation) => observation.snapshot),
  });
  const freshnessCounts = Object.fromEntries(FRESHNESS_STATES.map((state) => [
    state,
    input.observations.filter((observation) => observation.source.freshness.state === state).length,
  ]));

  return freezeDeep({
    schema: OBSERVED_PORTFOLIO_SCHEMA,
    observedAt: isoInstant(input.observedAt, 'portfolio observed at').text,
    readOnly: true,
    writeAuthority: 'none',
    sourceTruthAuthority: 'external',
    freshnessCounts,
    portfolio,
    sources: input.observations.map((observation) => observation.source).sort((left, right) => left.repository.localeCompare(right.repository)),
  });
}

module.exports = {
  CORE_PORTFOLIO_PROJECTS,
  DEFAULT_FRESHNESS_WINDOW_MINUTES,
  FRESHNESS_STATES,
  OBSERVATION_SCHEMA,
  OBSERVED_PORTFOLIO_SCHEMA,
  buildObservedPortfolio,
  classifyFreshness,
  createGithubReadOnlyProjectObservation,
  descriptorFor,
};
