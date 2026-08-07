'use strict';

const { createHash } = require('node:crypto');
const { assertSafeIdentifier } = require('./identifiers.cjs');
const { deepFreeze, requiredText } = require('./workspace-model.cjs');

const SHA = /^[0-9a-f]{40}$/i;
function assertSha(value, label = 'Git SHA') {
  if (typeof value !== 'string' || !SHA.test(value)) throw new TypeError(`${label} must be a 40-character hex SHA`);
  return value.toLowerCase();
}
function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function createPullRequestBinding(input) {
  const number = input?.number;
  if (!Number.isInteger(number) || number < 1) throw new TypeError('pull request number must be a positive integer');
  const record = {
    id: assertSafeIdentifier(input?.id, 'pull request binding id'),
    workspaceId: assertSafeIdentifier(input?.workspaceId, 'workspace id'),
    repositoryRegistrationId: assertSafeIdentifier(input?.repositoryRegistrationId, 'repository registration id'),
    planStepId: input?.planStepId ? assertSafeIdentifier(input.planStepId, 'plan step id') : null,
    number,
    expectedHeadSha: assertSha(input?.expectedHeadSha, 'expected head SHA'),
    expectedBaseRef: input?.expectedBaseRef ? requiredText(input.expectedBaseRef, 'expected base ref', 255) : null,
    state: 'active',
    createdAt: input?.createdAt || new Date().toISOString(),
  };
  return deepFreeze({ ...record, semanticDigest: pullRequestBindingDigest(record) });
}

function pullRequestBindingDigest(binding) {
  return digest({
    workspaceId: binding.workspaceId,
    repositoryRegistrationId: binding.repositoryRegistrationId,
    planStepId: binding.planStepId || null,
    number: binding.number,
    expectedHeadSha: String(binding.expectedHeadSha).toLowerCase(),
    expectedBaseRef: binding.expectedBaseRef || null,
  });
}

function assertPullRequestBindingSemanticMatch(existing, candidate) {
  if (!existing) return candidate;
  if (existing.semanticDigest !== candidate.semanticDigest) throw new Error(`Pull request binding idempotency collision: ${candidate.id}`);
  return existing;
}

function supersedePullRequestBinding(binding, occurredAt = new Date().toISOString(), state = 'superseded') {
  if (!binding || typeof binding !== 'object') throw new TypeError('pull request binding is required');
  if (!['superseded', 'merged', 'closed'].includes(state)) throw new TypeError('unsupported pull request binding terminal state');
  if (binding.state !== 'active') return binding;
  return deepFreeze({ ...binding, state, completedAt: occurredAt });
}

function createMergeOrderConstraint(input) {
  const predecessor = assertSafeIdentifier(input?.predecessorPullRequestBindingId, 'predecessor pull request binding id');
  const successor = assertSafeIdentifier(input?.successorPullRequestBindingId, 'successor pull request binding id');
  if (predecessor === successor) throw new Error('merge-order constraint cannot self-depend');
  return deepFreeze({
    id: assertSafeIdentifier(input?.id, 'merge-order constraint id'),
    workspaceId: assertSafeIdentifier(input?.workspaceId, 'workspace id'),
    repositoryRegistrationId: assertSafeIdentifier(input?.repositoryRegistrationId, 'repository registration id'),
    predecessorPullRequestBindingId: predecessor,
    successorPullRequestBindingId: successor,
    state: 'active',
    createdAt: input?.createdAt || new Date().toISOString(),
  });
}

function assertMergeOrderAcyclic(constraints = []) {
  const graph = new Map();
  for (const constraint of constraints.filter((item) => item.state === 'active')) {
    if (!graph.has(constraint.predecessorPullRequestBindingId)) graph.set(constraint.predecessorPullRequestBindingId, []);
    graph.get(constraint.predecessorPullRequestBindingId).push(constraint.successorPullRequestBindingId);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (node) => {
    if (visiting.has(node)) throw new Error('merge-order constraint cycle detected');
    if (visited.has(node)) return;
    visiting.add(node);
    for (const next of graph.get(node) || []) visit(next);
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of graph.keys()) visit(node);
  return true;
}

function assertJsonSafePrivacyBounded(value, path = 'value') {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonSafePrivacyBounded(item, `${path}[${index}]`));
    return true;
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${path} must be JSON-safe`);
  for (const [key, nested] of Object.entries(value)) {
    if (/authorization|bearer|cookie|password|secret|token|private.?key|profilepath|processid|^pid$|^ppid$/i.test(key)) {
      throw new Error(`Forbidden sensitive field in delivery evidence: ${path}.${key}`);
    }
    assertJsonSafePrivacyBounded(nested, `${path}.${key}`);
  }
  return true;
}

function createDeliveryEvidence(input) {
  const kind = input?.kind;
  if (!['exact_head_ready', 'merge_observed'].includes(kind)) throw new TypeError('unsupported delivery evidence kind');
  const payload = input?.payload || {};
  assertJsonSafePrivacyBounded(payload, 'delivery evidence payload');
  return deepFreeze({
    id: assertSafeIdentifier(input?.id, 'delivery evidence id'),
    workspaceId: assertSafeIdentifier(input?.workspaceId, 'workspace id'),
    pullRequestBindingId: assertSafeIdentifier(input?.pullRequestBindingId, 'pull request binding id'),
    kind,
    headSha: assertSha(input?.headSha, 'delivery head SHA'),
    baseSha: assertSha(input?.baseSha, 'delivery base SHA'),
    mergeCommitSha: input?.mergeCommitSha ? assertSha(input.mergeCommitSha, 'merge commit SHA') : null,
    checkDigest: requiredText(input?.checkDigest, 'check digest', 100),
    reviewDigest: requiredText(input?.reviewDigest, 'review digest', 100),
    payload,
    observedAt: input?.observedAt || new Date().toISOString(),
  });
}

function createRepairProposal(input) {
  return deepFreeze({
    id: assertSafeIdentifier(input?.id, 'repair proposal id'),
    workspaceId: assertSafeIdentifier(input?.workspaceId, 'workspace id'),
    pullRequestBindingId: assertSafeIdentifier(input?.pullRequestBindingId, 'pull request binding id'),
    reasonCode: assertSafeIdentifier(input?.reasonCode, 'repair proposal reason code'),
    description: requiredText(input?.description, 'repair proposal description', 1000),
    suggestedAction: requiredText(input?.suggestedAction, 'repair proposal suggested action', 500),
    state: 'proposed',
    createdAt: input?.createdAt || new Date().toISOString(),
  });
}

module.exports = {
  assertJsonSafePrivacyBounded,
  assertMergeOrderAcyclic,
  assertPullRequestBindingSemanticMatch,
  assertSha,
  createDeliveryEvidence,
  createMergeOrderConstraint,
  createPullRequestBinding,
  createRepairProposal,
  pullRequestBindingDigest,
  supersedePullRequestBinding,
};
