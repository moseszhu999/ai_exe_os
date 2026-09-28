'use strict';

const { createManagementProposal } = require('./index.cjs');

const ATTENTION_ENGINE_SCHEMA = 'aiexe.management-attention.v1';
const COCKPIT_SCHEMA = 'aiexe.management-cockpit.v1';
const ESCALATING_ACTIONS = new Set(['pause', 'escalate']);

const SIGNAL_POLICY = Object.freeze({
  domain_receipt_head_mismatch: Object.freeze({ type: 'escalate', priority: 'high', bucket: 'needs_attention' }),
  domain_receipt_stale: Object.freeze({ type: 'escalate', priority: 'high', bucket: 'needs_attention' }),
  domain_receipt_freshness_unknown: Object.freeze({ type: 'escalate', priority: 'high', bucket: 'needs_attention' }),
  domain_status_unknown: Object.freeze({ type: 'escalate', priority: 'normal', bucket: 'needs_attention' }),
  owner_unknown: Object.freeze({ type: 'escalate', priority: 'normal', bucket: 'needs_attention' }),
  source_stale: Object.freeze({ type: 'escalate', priority: 'normal', bucket: 'needs_attention' }),
  source_freshness_unknown: Object.freeze({ type: 'escalate', priority: 'normal', bucket: 'needs_attention' }),
  'blocker:owner_conflict': Object.freeze({ type: 'pause', priority: 'critical', bucket: 'blocked' }),
  'blocker:validation_failed': Object.freeze({ type: 'pause', priority: 'high', bucket: 'blocked' }),
  'blocker:duplicate_shared_capability': Object.freeze({ type: 'pause', priority: 'high', bucket: 'blocked' }),
  'blocker:policy_blocked': Object.freeze({ type: 'pause', priority: 'critical', bucket: 'blocked' }),
});

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

function exactIdentifier(value, label) {
  const text = requiredText(value, label, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(text)) throw new TypeError(`${label} must be a bounded identifier`);
  return text;
}

function chooseRule(signals, status) {
  const rules = [];
  for (const signal of signals) {
    if (SIGNAL_POLICY[signal]) rules.push({ signal, ...SIGNAL_POLICY[signal] });
    else if (signal.startsWith('blocker:')) rules.push({ signal, type: 'pause', priority: 'high', bucket: 'blocked' });
  }
  if (status === 'blocked') rules.push({ signal: 'status:blocked', type: 'pause', priority: 'high', bucket: 'blocked' });
  if (rules.length === 0) return { signal: 'no_attention_signal', type: 'continue', priority: 'low', bucket: 'automatic' };

  const priorityRank = { low: 0, normal: 1, high: 2, critical: 3 };
  const bucketRank = { automatic: 0, needs_attention: 1, blocked: 2 };
  return [...rules].sort((left, right) => (
    bucketRank[right.bucket] - bucketRank[left.bucket]
    || priorityRank[right.priority] - priorityRank[left.priority]
    || left.signal.localeCompare(right.signal)
  ))[0];
}

function rationaleFor(project, rule, signals) {
  if (rule.type === 'continue') {
    return `No explicit blocking or escalation signal is present for ${project.name}; continue remains advisory and non-binding.`;
  }
  return `${project.name} requires ${rule.type} because deterministic management signals include: ${signals.join(', ') || rule.signal}.`;
}

function evaluateProjectAttention(input) {
  plainObject(input, 'project attention input');
  const allowed = new Set(['portfolioId', 'project', 'evaluatedAt']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`project attention input contains unsupported field: ${key}`);

  const project = input.project;
  plainObject(project, 'managed project snapshot');
  const signals = [...new Set([...(Array.isArray(project.attentionSignals) ? project.attentionSignals : [])])].sort();
  const rule = chooseRule(signals, project.status);
  const evidenceRefs = Array.isArray(project.evidenceRefs) ? project.evidenceRefs : [];
  if (evidenceRefs.length < 1) throw new Error('attention evaluation requires project evidence refs');

  const proposal = createManagementProposal({
    id: `mgmt-${rule.type}-${exactIdentifier(project.id, 'project id')}`,
    portfolioId: input.portfolioId,
    projectId: project.id,
    type: rule.type,
    rationale: rationaleFor(project, rule, signals),
    evidenceRefs,
    requestedAt: input.evaluatedAt,
    priority: rule.priority,
  });

  return freezeDeep({
    schema: ATTENTION_ENGINE_SCHEMA,
    projectId: project.id,
    bucket: rule.bucket,
    primaryReason: rule.signal,
    sourceSignals: signals,
    status: project.status,
    deterministic: true,
    llmFactGenerationAllowed: false,
    proposal,
  });
}

function buildAttentionQueue(input) {
  plainObject(input, 'attention queue input');
  const allowed = new Set(['portfolio', 'evaluatedAt']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`attention queue input contains unsupported field: ${key}`);
  const portfolio = input.portfolio;
  if (!portfolio || !Array.isArray(portfolio.projects)) throw new TypeError('portfolio snapshot required');
  return Object.freeze(portfolio.projects
    .map((project) => evaluateProjectAttention({ portfolioId: portfolio.portfolioId, project, evaluatedAt: input.evaluatedAt }))
    .sort((left, right) => left.projectId.localeCompare(right.projectId)));
}

function buildManagementCockpit(input) {
  plainObject(input, 'management cockpit input');
  const allowed = new Set(['portfolio', 'packets', 'observedAt']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`management cockpit input contains unsupported field: ${key}`);
  const packets = input.packets;
  if (!Array.isArray(packets)) throw new TypeError('management attention packets must be an array');

  const automatic = packets.filter((packet) => packet.bucket === 'automatic');
  const needsAttention = packets.filter((packet) => packet.bucket === 'needs_attention');
  const blocked = packets.filter((packet) => packet.bucket === 'blocked');
  return freezeDeep({
    schema: COCKPIT_SCHEMA,
    observedAt: requiredText(input.observedAt, 'cockpit observed at', 80),
    readOnly: true,
    writeAuthority: 'none',
    counts: {
      automatic: automatic.length,
      needsAttention: needsAttention.length,
      blocked: blocked.length,
    },
    automatic,
    needsAttention,
    blocked,
    ownerMessage: `${needsAttention.length + blocked.length} project(s) need owner attention; ${automatic.length} can continue under current advisory policy.`,
  });
}

function scoreDecisionReplay(rows) {
  if (!Array.isArray(rows) || rows.length < 1) throw new TypeError('replay rows must be a non-empty array');
  let exactMatches = 0;
  let falseEscalations = 0;
  let missedEscalations = 0;
  for (const row of rows) {
    plainObject(row, 'replay row');
    const expected = requiredText(row.expectedType, 'expected type', 40);
    const actual = requiredText(row.actualType, 'actual type', 40);
    if (expected === actual) exactMatches += 1;
    const expectedEscalating = ESCALATING_ACTIONS.has(expected);
    const actualEscalating = ESCALATING_ACTIONS.has(actual);
    if (!expectedEscalating && actualEscalating) falseEscalations += 1;
    if (expectedEscalating && !actualEscalating) missedEscalations += 1;
  }
  return freezeDeep({
    total: rows.length,
    exactMatches,
    exactRate: exactMatches / rows.length,
    falseEscalations,
    missedEscalations,
  });
}

module.exports = {
  ATTENTION_ENGINE_SCHEMA,
  COCKPIT_SCHEMA,
  SIGNAL_POLICY,
  buildAttentionQueue,
  buildManagementCockpit,
  evaluateProjectAttention,
  scoreDecisionReplay,
};
