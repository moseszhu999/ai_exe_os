'use strict';

const { PROJECT_STATUSES, createManagedProjectSnapshot } = require('./index.cjs');
const { OBSERVATION_SCHEMA, classifyFreshness, descriptorFor } = require('./read-only-adapters.cjs');

const DOMAIN_RECEIPT_SCHEMA = 'aiexe.domain-controller-receipt.v1';
const ENRICHED_OBSERVATION_SCHEMA = 'aiexe.project-observation.enriched.v1';

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

function exactSha(value, label = 'exact head sha') {
  const text = requiredText(value, label, 64).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(text)) throw new TypeError(`${label} must be a 40-character git SHA`);
  return text;
}

function isoInstant(value, label) {
  const text = requiredText(value, label, 80);
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new TypeError(`${label} must be an ISO timestamp`);
  return { text, ms };
}

function uniqueTextList(value, label, maxLength = 320) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const rows = value.map((item) => requiredText(item, label, maxLength));
  if (new Set(rows).size !== rows.length) throw new Error(`${label} must not contain duplicates`);
  return Object.freeze([...rows].sort());
}

function exactDomainStatus(value) {
  const text = requiredText(value, 'domain status', 80);
  if (!PROJECT_STATUSES.includes(text) || text === 'unknown') {
    throw new TypeError('domain status receipt must be authoritative and non-unknown');
  }
  return text;
}

function createDomainControllerReceipt(input) {
  plainObject(input, 'domain controller receipt');
  const allowed = new Set([
    'projectId', 'controllerId', 'repository', 'exactHeadSha', 'domainStatus',
    'owner', 'milestone', 'blockerCodes', 'evidenceRefs', 'observedAt',
  ]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`domain controller receipt contains unsupported field: ${key}`);

  const descriptor = descriptorFor(input.projectId);
  const repository = requiredText(input.repository, 'repository', 200);
  if (repository !== descriptor.repository) throw new Error(`repository mismatch for ${descriptor.id}`);
  const blockerCodes = uniqueTextList(input.blockerCodes, 'blocker code', 120);
  const evidenceRefs = uniqueTextList(input.evidenceRefs, 'receipt evidence ref', 320);
  if (evidenceRefs.length < 1) throw new TypeError('domain controller receipt requires evidence refs');

  return freezeDeep({
    schema: DOMAIN_RECEIPT_SCHEMA,
    projectId: descriptor.id,
    controllerId: exactIdentifier(input.controllerId, 'controller id'),
    repository,
    exactHeadSha: exactSha(input.exactHeadSha),
    domainStatus: exactDomainStatus(input.domainStatus),
    owner: requiredText(input.owner, 'domain owner', 200),
    milestone: requiredText(input.milestone, 'domain milestone', 400),
    blockerCodes,
    evidenceRefs,
    observedAt: isoInstant(input.observedAt, 'receipt observed at').text,
    readOnly: true,
    binding: false,
    writeAuthority: 'none',
    authority: 'domain-status-attestation',
  });
}

function enrichGithubObservationWithDomainReceipt(input) {
  plainObject(input, 'domain observation enrichment');
  const allowed = new Set(['observation', 'receipt', 'now', 'freshnessWindowMinutes']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`domain observation enrichment contains unsupported field: ${key}`);

  const observation = input.observation;
  const receipt = input.receipt;
  if (observation?.schema !== OBSERVATION_SCHEMA || observation?.readOnly !== true || observation?.writeAuthority !== 'none') {
    throw new Error('canonical GitHub read-only observation required');
  }
  if (receipt?.schema !== DOMAIN_RECEIPT_SCHEMA || receipt?.readOnly !== true || receipt?.writeAuthority !== 'none') {
    throw new Error('canonical domain controller receipt required');
  }
  if (observation.projectId !== receipt.projectId) throw new Error('project mismatch between observation and receipt');
  if (observation.source.repository !== receipt.repository) throw new Error('repository mismatch between observation and receipt');

  const freshness = classifyFreshness({
    observedAt: receipt.observedAt,
    now: input.now || observation.source.observedAt,
    freshnessWindowMinutes: input.freshnessWindowMinutes,
  });
  const headMatches = observation.source.headSha === receipt.exactHeadSha;
  const accepted = headMatches && freshness.state === 'current';
  const reason = accepted
    ? 'accepted_exact_head_current'
    : !headMatches
      ? 'exact_head_mismatch'
      : freshness.state === 'stale'
        ? 'receipt_stale'
        : 'receipt_freshness_unknown';

  const base = observation.snapshot;
  const attention = [...base.attentionSignals.filter((signal) => !['domain_status_unknown', 'owner_unknown'].includes(signal))];
  if (!accepted) {
    if (!headMatches) attention.push('domain_receipt_head_mismatch');
    if (freshness.state === 'stale') attention.push('domain_receipt_stale');
    if (freshness.state === 'unknown') attention.push('domain_receipt_freshness_unknown');
    attention.push('domain_status_unknown');
  }
  for (const code of accepted ? receipt.blockerCodes : []) attention.push(`blocker:${code}`);

  const snapshot = createManagedProjectSnapshot({
    id: base.id,
    name: base.name,
    kind: base.kind,
    status: accepted ? receipt.domainStatus : 'unknown',
    sourceOfTruth: base.sourceOfTruth,
    owner: accepted ? receipt.owner : null,
    milestone: accepted ? receipt.milestone : null,
    summary: accepted
      ? `GitHub source and domain-controller receipt agree at ${receipt.exactHeadSha.slice(0, 12)}.`
      : base.summary,
    attentionSignals: [...new Set(attention)].sort(),
    evidenceRefs: [...new Set([
      ...base.evidenceRefs,
      ...receipt.evidenceRefs,
      `domain-receipt:${receipt.controllerId}@${receipt.exactHeadSha}`,
    ])].sort(),
    observedAt: observation.source.observedAt,
  });

  return freezeDeep({
    schema: ENRICHED_OBSERVATION_SCHEMA,
    projectId: observation.projectId,
    readOnly: true,
    writeAuthority: 'none',
    source: observation.source,
    openWork: observation.openWork,
    blockers: accepted ? receipt.blockerCodes : observation.blockers,
    domainReceipt: { accepted, reason, freshness, receipt },
    snapshot,
  });
}

module.exports = {
  DOMAIN_RECEIPT_SCHEMA,
  ENRICHED_OBSERVATION_SCHEMA,
  createDomainControllerReceipt,
  enrichGithubObservationWithDomainReceipt,
};
