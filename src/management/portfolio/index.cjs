'use strict';

const PROJECT_KINDS = Object.freeze([
  'platform',
  'domain-os',
  'shared-service',
  'vertical-saas',
  'research',
]);

const PROJECT_STATUSES = Object.freeze(['active', 'paused', 'blocked', 'archived']);
const MANAGEMENT_PROPOSAL_TYPES = Object.freeze([
  'continue',
  'pause',
  'reprioritize',
  'escalate',
]);

const FORBIDDEN_MANAGEMENT_ACTIONS = Object.freeze([
  'domain_mutation',
  'merge',
  'deploy',
  'payment',
  'credential_write',
  'production_write',
]);

const MANAGEMENT_AUTHORITY = 'observe-and-propose';
const DOMAIN_TRUTH_AUTHORITY = 'external-source-of-truth';

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function assertAllowedKeys(input, allowed, label) {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field: ${key}`);
  }
}

function requiredText(value, label, maxLength = 240) {
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

function exactEnum(value, allowed, label) {
  const text = requiredText(value, label, 80);
  if (!allowed.includes(text)) throw new TypeError(`${label} must be one of: ${allowed.join(', ')}`);
  return text;
}

function exactIdentifier(value, label) {
  const text = requiredText(value, label, 120);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,119}$/.test(text)) {
    throw new TypeError(`${label} must be a bounded identifier`);
  }
  return text;
}

function uniqueTextList(value, label, maxLength = 240) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const rows = value.map((item) => requiredText(item, label, maxLength));
  if (new Set(rows).size !== rows.length) throw new Error(`${label} must not contain duplicates`);
  return Object.freeze([...rows].sort());
}

function assertCanonicalAuthority(input) {
  if (input.managementAuthority != null && input.managementAuthority !== MANAGEMENT_AUTHORITY) {
    throw new Error(`managed project snapshot cannot widen management authority beyond ${MANAGEMENT_AUTHORITY}`);
  }
  if (input.domainTruthAuthority != null && input.domainTruthAuthority !== DOMAIN_TRUTH_AUTHORITY) {
    throw new Error(`managed project snapshot cannot claim domain truth authority`);
  }
}

function createManagedProjectSnapshot(input) {
  plainObject(input, 'managed project snapshot');
  assertAllowedKeys(input, new Set([
    'id', 'name', 'kind', 'status', 'sourceOfTruth', 'owner', 'milestone',
    'summary', 'attentionSignals', 'evidenceRefs', 'observedAt',
    'managementAuthority', 'domainTruthAuthority',
  ]), 'managed project snapshot');
  assertCanonicalAuthority(input);

  return freezeDeep({
    id: exactIdentifier(input.id, 'project id'),
    name: requiredText(input.name, 'project name', 160),
    kind: exactEnum(input.kind, PROJECT_KINDS, 'project kind'),
    status: exactEnum(input.status, PROJECT_STATUSES, 'project status'),
    sourceOfTruth: requiredText(input.sourceOfTruth, 'source of truth', 320),
    owner: optionalText(input.owner, 'project owner', 160),
    milestone: optionalText(input.milestone, 'project milestone', 320),
    summary: optionalText(input.summary, 'project summary', 1200),
    attentionSignals: uniqueTextList(input.attentionSignals, 'attention signal', 320),
    evidenceRefs: uniqueTextList(input.evidenceRefs, 'evidence ref', 320),
    observedAt: requiredText(input.observedAt, 'observed at', 80),
    managementAuthority: MANAGEMENT_AUTHORITY,
    domainTruthAuthority: DOMAIN_TRUTH_AUTHORITY,
  });
}

function buildPortfolioSnapshot(input) {
  plainObject(input, 'portfolio snapshot input');
  assertAllowedKeys(input, new Set(['portfolioId', 'projects', 'observedAt']), 'portfolio snapshot input');
  if (!Array.isArray(input.projects) || input.projects.length < 1) {
    throw new TypeError('projects must be a non-empty array');
  }
  const projects = input.projects.map(createManagedProjectSnapshot);
  const ids = projects.map((project) => project.id);
  if (new Set(ids).size !== ids.length) throw new Error('portfolio projects must have unique ids');

  const statusCounts = Object.fromEntries(PROJECT_STATUSES.map((status) => [
    status,
    projects.filter((project) => project.status === status).length,
  ]));
  const attention = projects
    .filter((project) => project.attentionSignals.length > 0 || project.status === 'blocked')
    .map((project) => freezeDeep({
      projectId: project.id,
      status: project.status,
      signals: project.attentionSignals,
      evidenceRefs: project.evidenceRefs,
    }))
    .sort((left, right) => left.projectId.localeCompare(right.projectId));

  return freezeDeep({
    portfolioId: exactIdentifier(input.portfolioId, 'portfolio id'),
    observedAt: requiredText(input.observedAt, 'portfolio observed at', 80),
    projectCount: projects.length,
    statusCounts,
    projects: [...projects].sort((left, right) => left.id.localeCompare(right.id)),
    attention,
    managementAuthority: MANAGEMENT_AUTHORITY,
  });
}

function createManagementProposal(input) {
  plainObject(input, 'management proposal');
  assertAllowedKeys(input, new Set([
    'id', 'portfolioId', 'projectId', 'type', 'rationale', 'evidenceRefs',
    'requestedAt', 'priority', 'forbiddenActions',
  ]), 'management proposal');

  const type = exactEnum(input.type, MANAGEMENT_PROPOSAL_TYPES, 'management proposal type');
  const forbiddenActions = uniqueTextList(input.forbiddenActions, 'forbidden action', 80);
  for (const action of forbiddenActions) {
    if (!FORBIDDEN_MANAGEMENT_ACTIONS.includes(action)) {
      throw new TypeError(`unknown forbidden management action: ${action}`);
    }
  }
  const evidenceRefs = uniqueTextList(input.evidenceRefs, 'proposal evidence ref', 320);
  if (evidenceRefs.length < 1) throw new TypeError('management proposal requires evidence refs');

  return freezeDeep({
    id: exactIdentifier(input.id, 'management proposal id'),
    portfolioId: exactIdentifier(input.portfolioId, 'portfolio id'),
    projectId: exactIdentifier(input.projectId, 'project id'),
    type,
    rationale: requiredText(input.rationale, 'management proposal rationale', 1600),
    evidenceRefs,
    requestedAt: requiredText(input.requestedAt, 'management proposal requested at', 80),
    priority: exactEnum(input.priority || 'normal', ['low', 'normal', 'high', 'critical'], 'management proposal priority'),
    state: 'proposed',
    binding: false,
    requiresHumanApproval: type !== 'continue',
    allowedEffect: 'proposal-only',
    forbiddenActions: Object.freeze([...new Set([
      ...FORBIDDEN_MANAGEMENT_ACTIONS,
      ...forbiddenActions,
    ])].sort()),
  });
}

module.exports = {
  DOMAIN_TRUTH_AUTHORITY,
  FORBIDDEN_MANAGEMENT_ACTIONS,
  MANAGEMENT_AUTHORITY,
  MANAGEMENT_PROPOSAL_TYPES,
  PROJECT_KINDS,
  PROJECT_STATUSES,
  buildPortfolioSnapshot,
  createManagedProjectSnapshot,
  createManagementProposal,
};
