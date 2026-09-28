'use strict';

const { createManagementProposal } = require('./index.cjs');

const WORKSTREAM_SCHEMA = 'aiexe.managed-workstream.v1';
const WORKSTREAM_ATTENTION_SCHEMA = 'aiexe.workstream-attention.v1';
const PROJECT_WORKSTREAM_ROLLUP_SCHEMA = 'aiexe.project-workstream-rollup.v1';
const WORKSTREAM_STATUSES = Object.freeze(['active', 'blocked', 'paused', 'complete', 'unknown']);

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

function exactStatus(value) {
  const status = requiredText(value, 'workstream status', 40);
  if (!WORKSTREAM_STATUSES.includes(status)) throw new TypeError(`workstream status must be one of: ${WORKSTREAM_STATUSES.join(', ')}`);
  return status;
}

function isoInstant(value, label) {
  const text = requiredText(value, label, 80);
  if (!Number.isFinite(Date.parse(text))) throw new TypeError(`${label} must be an ISO timestamp`);
  return text;
}

function uniqueTextList(value, label, maxLength = 320) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const rows = value.map((item) => requiredText(item, label, maxLength));
  if (new Set(rows).size !== rows.length) throw new Error(`${label} must not contain duplicates`);
  return Object.freeze([...rows].sort());
}

function createManagedWorkstreamSnapshot(input) {
  plainObject(input, 'managed workstream');
  const allowed = new Set([
    'projectId', 'id', 'name', 'status', 'owner', 'milestone', 'critical',
    'blockerCodes', 'evidenceRefs', 'observedAt',
  ]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`managed workstream contains unsupported field: ${key}`);

  const evidenceRefs = uniqueTextList(input.evidenceRefs, 'workstream evidence ref');
  if (evidenceRefs.length < 1) throw new TypeError('managed workstream requires evidence refs');

  return freezeDeep({
    schema: WORKSTREAM_SCHEMA,
    projectId: exactIdentifier(input.projectId, 'project id'),
    id: exactIdentifier(input.id, 'workstream id'),
    name: requiredText(input.name, 'workstream name', 200),
    status: exactStatus(input.status),
    owner: input.owner == null ? null : requiredText(input.owner, 'workstream owner', 200),
    milestone: input.milestone == null ? null : requiredText(input.milestone, 'workstream milestone', 400),
    critical: input.critical !== false,
    blockerCodes: uniqueTextList(input.blockerCodes, 'workstream blocker code', 120),
    evidenceRefs,
    observedAt: isoInstant(input.observedAt, 'workstream observed at'),
    readOnly: true,
    writeAuthority: 'none',
  });
}

function classifyWorkstream(workstream) {
  if (workstream.status === 'unknown') return { bucket: 'needs_attention', type: 'escalate', priority: 'normal', reason: 'workstream_status_unknown' };
  if (workstream.status === 'blocked' || workstream.status === 'paused' || workstream.blockerCodes.length > 0) {
    return { bucket: 'blocked', type: 'pause', priority: workstream.critical ? 'high' : 'normal', reason: workstream.blockerCodes[0] ? `blocker:${workstream.blockerCodes[0]}` : `status:${workstream.status}` };
  }
  return { bucket: 'automatic', type: 'continue', priority: 'low', reason: workstream.status === 'complete' ? 'workstream_complete' : 'workstream_active' };
}

function evaluateWorkstreamAttention(input) {
  plainObject(input, 'workstream attention input');
  const allowed = new Set(['portfolioId', 'workstream', 'evaluatedAt']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`workstream attention input contains unsupported field: ${key}`);
  const workstream = input.workstream;
  if (workstream?.schema !== WORKSTREAM_SCHEMA || workstream?.readOnly !== true) throw new Error('canonical managed workstream required');
  const rule = classifyWorkstream(workstream);
  const proposal = createManagementProposal({
    id: `mgmt-${rule.type}-${workstream.projectId}-${workstream.id}`,
    portfolioId: input.portfolioId,
    projectId: workstream.projectId,
    type: rule.type,
    rationale: rule.type === 'continue'
      ? `${workstream.name} has no explicit blocker requiring management intervention.`
      : `${workstream.name} requires ${rule.type} because ${rule.reason}.`,
    evidenceRefs: workstream.evidenceRefs,
    requestedAt: input.evaluatedAt,
    priority: rule.priority,
  });
  return freezeDeep({
    schema: WORKSTREAM_ATTENTION_SCHEMA,
    projectId: workstream.projectId,
    workstreamId: workstream.id,
    bucket: rule.bucket,
    primaryReason: rule.reason,
    status: workstream.status,
    critical: workstream.critical,
    deterministic: true,
    projectWideAuthority: false,
    llmFactGenerationAllowed: false,
    proposal,
  });
}

function rollupProjectWorkstreamAttention(input) {
  plainObject(input, 'project workstream rollup input');
  const allowed = new Set(['portfolioId', 'project', 'workstreams', 'evaluatedAt', 'decisionScopeComplete']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`project workstream rollup input contains unsupported field: ${key}`);
  if (input.decisionScopeComplete != null && typeof input.decisionScopeComplete !== 'boolean') throw new TypeError('decisionScopeComplete must be boolean when provided');
  const decisionScopeComplete = input.decisionScopeComplete === true;
  const project = input.project;
  if (!project || typeof project !== 'object' || typeof project.id !== 'string') throw new TypeError('managed project snapshot required');
  if (!Array.isArray(input.workstreams) || input.workstreams.length < 1) throw new TypeError('at least one managed workstream is required');

  const packets = input.workstreams.map((workstream) => {
    if (workstream.projectId !== project.id) throw new Error('workstream project mismatch');
    return evaluateWorkstreamAttention({ portfolioId: input.portfolioId, workstream, evaluatedAt: input.evaluatedAt });
  });

  const automatic = packets.filter((packet) => packet.bucket === 'automatic');
  const active = automatic.filter((packet) => packet.status === 'active');
  const complete = automatic.filter((packet) => packet.status === 'complete');
  const unknown = packets.filter((packet) => packet.bucket === 'needs_attention');
  const held = packets.filter((packet) => packet.bucket === 'blocked');
  const heldCritical = held.filter((packet) => packet.critical);

  let bucket;
  let type;
  let priority;
  let reason;
  let projectWidePause = false;

  if (project.status === 'blocked' || project.status === 'paused') {
    bucket = 'blocked'; type = 'pause'; priority = 'high'; reason = `project_status_${project.status}`; projectWidePause = true;
  } else if (unknown.length > 0) {
    bucket = 'needs_attention'; type = 'escalate'; priority = 'normal'; reason = 'workstream_truth_unknown';
  } else if (heldCritical.length > 0 && active.length > 0) {
    bucket = 'needs_attention'; type = 'reprioritize'; priority = 'high'; reason = 'partial_workstream_block';
  } else if (heldCritical.length > 0 && active.length === 0 && decisionScopeComplete) {
    bucket = 'blocked'; type = 'pause'; priority = 'high'; reason = 'all_decision_scope_critical_workstreams_held'; projectWidePause = true;
  } else if (held.length > 0 && active.length > 0) {
    bucket = 'needs_attention'; type = 'reprioritize'; priority = 'normal'; reason = 'noncritical_workstream_block';
  } else if (held.length > 0 && active.length === 0 && decisionScopeComplete) {
    bucket = 'blocked'; type = 'pause'; priority = 'normal'; reason = 'all_remaining_decision_scope_workstreams_held'; projectWidePause = true;
  } else if (held.length > 0) {
    bucket = 'needs_attention'; type = 'escalate'; priority = heldCritical.length > 0 ? 'high' : 'normal'; reason = 'decision_scope_incomplete';
  } else {
    bucket = 'automatic'; type = 'continue'; priority = 'low'; reason = active.length > 0 ? 'all_observed_active_workstreams_clear' : 'observed_workstreams_complete';
  }

  const evidenceRefs = [...new Set([...(project.evidenceRefs || []), ...input.workstreams.flatMap((workstream) => workstream.evidenceRefs)])].sort();
  const proposal = createManagementProposal({
    id: `mgmt-${type}-${project.id}-workstreams`,
    portfolioId: input.portfolioId,
    projectId: project.id,
    type,
    rationale: type === 'reprioritize'
      ? `${project.name} has held workstreams but also active safe work that can continue; contain the blockers instead of pausing the whole project.`
      : type === 'continue'
        ? `${project.name} has no observed workstream blocker requiring management intervention.`
        : type === 'escalate' && reason === 'decision_scope_incomplete'
          ? `${project.name} has held workstreams and no observed active safe work, but the workstream decision scope is incomplete; project-wide pause is not justified.`
          : `${project.name} requires ${type} because ${reason}.`,
    evidenceRefs,
    requestedAt: input.evaluatedAt,
    priority,
  });

  return freezeDeep({
    schema: PROJECT_WORKSTREAM_ROLLUP_SCHEMA,
    projectId: project.id,
    bucket,
    primaryReason: reason,
    projectWidePause,
    decisionScopeComplete,
    deterministic: true,
    llmFactGenerationAllowed: false,
    counts: {
      automatic: automatic.length,
      active: active.length,
      complete: complete.length,
      needsAttention: unknown.length,
      blocked: held.length,
    },
    continueEligibleWorkstreamIds: active.map((packet) => packet.workstreamId).sort(),
    completedWorkstreamIds: complete.map((packet) => packet.workstreamId).sort(),
    heldWorkstreamIds: held.map((packet) => packet.workstreamId).sort(),
    unresolvedWorkstreamIds: unknown.map((packet) => packet.workstreamId).sort(),
    workstreams: packets,
    proposal,
  });
}

module.exports = {
  PROJECT_WORKSTREAM_ROLLUP_SCHEMA,
  WORKSTREAM_ATTENTION_SCHEMA,
  WORKSTREAM_SCHEMA,
  WORKSTREAM_STATUSES,
  createManagedWorkstreamSnapshot,
  evaluateWorkstreamAttention,
  rollupProjectWorkstreamAttention,
};
