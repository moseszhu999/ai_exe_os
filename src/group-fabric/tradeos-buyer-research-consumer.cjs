'use strict';

const { createHash } = require('node:crypto');
const {
  GROUP_AUTONOMY_POLICY_SCHEMA,
  GROUP_WORK_ENTRY_SCHEMA,
} = require('./group-operating-system.cjs');

const TRADEOS_BUYER_RESEARCH_LOOP_SCHEMA = 'tradeos.group-buyer-research-loop.v1';
const GROUP_DOMAIN_LOOP_INTAKE_SCHEMA = 'group.domain-loop-intake.v1';
const GROUP_NEXT_WORK_PROPOSAL_SCHEMA = 'group.next-work-proposal.v1';

const SOURCE_STATES = Object.freeze([
  'needs_more_research',
  'candidate_review_ready',
  'draft_review_ready',
  'blocked',
]);

const DRAFT_KINDS = Object.freeze([
  'initial_outreach_draft',
  'follow_up_draft',
  'response_draft',
]);

const NEXT_ACTION_BY_DRAFT_KIND = Object.freeze({
  initial_outreach_draft: 'buyer_outreach_draft',
  follow_up_draft: 'buyer_follow_up_draft',
  response_draft: 'buyer_response_draft',
});

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) freezeDeep(nested);
  return value;
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function assertAllowedKeys(input, allowed, label) {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TypeError(`${label} contains unsupported field: ${key}`);
  }
}

function text(value, label, max = 240) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new TypeError(`${label} must be a bounded non-empty string`);
  return normalized;
}

function safeCode(value, label) {
  const normalized = text(value, label, 96);
  if (!/^[a-z][a-z0-9._-]{0,95}$/.test(normalized)) throw new TypeError(`${label} must be a bounded code`);
  return normalized;
}

function safeRef(value, label, prefix = null) {
  const normalized = text(value, label, 280);
  if (prefix && !normalized.startsWith(prefix)) throw new TypeError(`${label} must start with ${prefix}`);
  if (/@[^/\s]+\.[A-Za-z]{2,}/.test(normalized)) throw new TypeError(`${label} must not contain email-like PII`);
  if (/bearer|password|secret|token=|api[_-]?key|cookie|session=/i.test(normalized)) {
    throw new TypeError(`${label} must not contain secret/session-like material`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9:._@/-]*$/.test(normalized)) throw new TypeError(`${label} contains invalid characters`);
  return normalized;
}

function digestHex(value, label) {
  const normalized = text(value, label, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new TypeError(`${label} must be a SHA-256 hex digest`);
  return normalized;
}

function timestamp(value, label) {
  const normalized = text(value, label, 40);
  const time = Date.parse(normalized);
  if (!Number.isFinite(time) || !normalized.endsWith('Z')) {
    throw new TypeError(`${label} must be an ISO-8601 UTC timestamp`);
  }
  return { text: normalized, time };
}

function boundedInteger(value, label, min = 0, max = 1000000) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function uniqueStrings(value, label, min = 0, max = 256) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const items = value.map((item) => text(item, label, 500));
  if (new Set(items).size !== items.length) throw new TypeError(`${label} must not contain duplicates`);
  return Object.freeze([...items].sort());
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function noAuthorityFlags() {
  return {
    authorizationDecisionCreated: false,
    authorityGrantCreated: false,
    humanGateDecisionCreated: false,
    delegationCreated: false,
    executionAuthorized: false,
    domainTruthCreated: false,
    domainWritePerformed: false,
    externalActionPerformed: false,
  };
}

function assertNoAuthorityFlags(value, label) {
  for (const [key, expected] of Object.entries(noAuthorityFlags())) {
    if (value[key] !== expected) throw new TypeError(`${label} truth boundary widened: ${key}`);
  }
}

function assertDigestObject(value, schema, digestField, label) {
  plainObject(value, label);
  if (value.schema !== schema) throw new TypeError(`${label} schema mismatch`);
  const actual = value[digestField];
  const unsigned = { ...value };
  delete unsigned[digestField];
  if (typeof actual !== 'string' || actual !== digest(unsigned)) throw new TypeError(`${label} digest mismatch`);
  assertNoAuthorityFlags(value, label);
  return value;
}

function assertWorkEntry(value) {
  assertDigestObject(value, GROUP_WORK_ENTRY_SCHEMA, 'entryDigest', 'work entry');
  if (value.routingProposalOnly !== true || value.managerMayMintDomainTruth !== false) {
    throw new TypeError('work entry routing boundary drift');
  }
  return value;
}

function assertPolicy(value) {
  assertDigestObject(value, GROUP_AUTONOMY_POLICY_SCHEMA, 'policyDigest', 'autonomy policy');
  if (value.policyOnly !== true || value.autonomyPromotionPerformed !== false) {
    throw new TypeError('autonomy policy control boundary drift');
  }
  return value;
}

function assertFalse(value, label) {
  if (value !== false) throw new TypeError(`${label} must be false`);
}

function normalizeGroupBinding(value) {
  plainObject(value, 'TradeOS group binding');
  assertAllowedKeys(value, new Set([
    'workEntryRef', 'workEntryDigest', 'autonomyPolicyRef', 'autonomyPolicyDigest',
    'actionCode', 'autonomyLevel',
  ]), 'TradeOS group binding');
  if (value.actionCode !== 'buyer_research') throw new TypeError('TradeOS group binding actionCode mismatch');
  if (!['L0', 'L1'].includes(value.autonomyLevel)) throw new TypeError('TradeOS group binding autonomyLevel must be L0 or L1');
  return freezeDeep({
    workEntryRef: safeRef(value.workEntryRef, 'workEntryRef', 'group:work-entry:'),
    workEntryDigest: digestHex(value.workEntryDigest, 'workEntryDigest'),
    autonomyPolicyRef: safeRef(value.autonomyPolicyRef, 'autonomyPolicyRef', 'group:autonomy-policy:'),
    autonomyPolicyDigest: digestHex(value.autonomyPolicyDigest, 'autonomyPolicyDigest'),
    actionCode: 'buyer_research',
    autonomyLevel: value.autonomyLevel,
  });
}

function normalizeSource(value) {
  plainObject(value, 'TradeOS source');
  assertAllowedKeys(value, new Set([
    'snapshotGeneratedAt', 'leadKey', 'leadStatus', 'sourcePackageIds', 'evidenceSources',
  ]), 'TradeOS source');
  const leadStatus = safeCode(value.leadStatus, 'leadStatus');
  if (!['replied', 'contacted', 'ready_to_contact', 'researching', 'verification_required', 'human_review', 'evidence_ready'].includes(leadStatus)) {
    throw new TypeError('TradeOS leadStatus is unsupported');
  }
  const sourcePackageIds = uniqueStrings(value.sourcePackageIds, 'sourcePackageIds');
  for (const item of sourcePackageIds) {
    if (/@|bearer|password|secret|token=|api[_-]?key|cookie|session=/i.test(item)) {
      throw new TypeError('TradeOS sourcePackageIds contain sensitive-looking material');
    }
  }
  return freezeDeep({
    snapshotGeneratedAt: timestamp(value.snapshotGeneratedAt, 'snapshotGeneratedAt').text,
    leadKey: safeCode(value.leadKey, 'leadKey'),
    leadStatus,
    sourcePackageIds,
    evidenceSources: uniqueStrings(value.evidenceSources, 'evidenceSources'),
  });
}

function normalizeEvidenceSummary(value) {
  plainObject(value, 'TradeOS evidenceSummary');
  assertAllowedKeys(value, new Set([
    'researchBatchCount', 'evidenceResultCount', 'supplyLeadCount', 'openTaskCount',
    'findingCount', 'gapOrConflictCount', 'reviewCount', 'sourceFactCount', 'latestReviewStatus',
  ]), 'TradeOS evidenceSummary');
  return freezeDeep({
    researchBatchCount: boundedInteger(value.researchBatchCount, 'researchBatchCount'),
    evidenceResultCount: boundedInteger(value.evidenceResultCount, 'evidenceResultCount'),
    supplyLeadCount: boundedInteger(value.supplyLeadCount, 'supplyLeadCount'),
    openTaskCount: boundedInteger(value.openTaskCount, 'openTaskCount'),
    findingCount: boundedInteger(value.findingCount, 'findingCount'),
    gapOrConflictCount: boundedInteger(value.gapOrConflictCount, 'gapOrConflictCount'),
    reviewCount: boundedInteger(value.reviewCount, 'reviewCount'),
    sourceFactCount: boundedInteger(value.sourceFactCount, 'sourceFactCount'),
    latestReviewStatus: value.latestReviewStatus === null ? null : safeCode(value.latestReviewStatus, 'latestReviewStatus'),
  });
}

function normalizeRoute(value) {
  plainObject(value, 'TradeOS route');
  assertAllowedKeys(value, new Set(['state', 'reasonCode', 'nextAction', 'ownerReviewRequired']), 'TradeOS route');
  const state = safeCode(value.state, 'TradeOS route state');
  if (!SOURCE_STATES.includes(state)) throw new TypeError('TradeOS route state is unsupported');
  if (typeof value.ownerReviewRequired !== 'boolean') throw new TypeError('TradeOS ownerReviewRequired must be boolean');
  if (state === 'blocked' && value.ownerReviewRequired !== true) throw new TypeError('blocked TradeOS route must require owner review');
  if (['candidate_review_ready', 'draft_review_ready'].includes(state) && value.ownerReviewRequired !== true) {
    throw new TypeError('draft-capable TradeOS route must require owner review');
  }
  return freezeDeep({
    state,
    reasonCode: safeCode(value.reasonCode, 'TradeOS reasonCode'),
    nextAction: text(value.nextAction, 'TradeOS nextAction', 500),
    ownerReviewRequired: value.ownerReviewRequired,
  });
}

function normalizeDraftIntent(value, routeState) {
  if (value === null) {
    if (['candidate_review_ready', 'draft_review_ready'].includes(routeState)) {
      throw new TypeError('draft-capable TradeOS route requires draftIntent');
    }
    return null;
  }
  plainObject(value, 'TradeOS draftIntent');
  assertAllowedKeys(value, new Set([
    'kind', 'leadKey', 'buyerOrPublisher', 'objective', 'evidenceFactRefs',
    'draftOnly', 'recipientResolved', 'contactDataImported', 'sendAuthorized', 'externalActionPerformed',
  ]), 'TradeOS draftIntent');
  if (!['candidate_review_ready', 'draft_review_ready'].includes(routeState)) {
    throw new TypeError('TradeOS draftIntent is forbidden for non-draft route state');
  }
  const kind = safeCode(value.kind, 'draftIntent.kind');
  if (!DRAFT_KINDS.includes(kind)) throw new TypeError('TradeOS draftIntent kind is unsupported');
  if (routeState === 'candidate_review_ready' && kind !== 'initial_outreach_draft') {
    throw new TypeError('candidate_review_ready requires initial_outreach_draft');
  }
  if (routeState === 'draft_review_ready' && kind === 'initial_outreach_draft') {
    throw new TypeError('draft_review_ready cannot use initial_outreach_draft');
  }
  if (value.draftOnly !== true) throw new TypeError('TradeOS draftIntent must remain draftOnly');
  assertFalse(value.recipientResolved, 'TradeOS recipientResolved');
  assertFalse(value.contactDataImported, 'TradeOS contactDataImported');
  assertFalse(value.sendAuthorized, 'TradeOS sendAuthorized');
  assertFalse(value.externalActionPerformed, 'TradeOS externalActionPerformed');
  const buyerOrPublisher = text(value.buyerOrPublisher, 'buyerOrPublisher', 240);
  if (/@[^/\s]+\.[A-Za-z]{2,}/.test(buyerOrPublisher)) throw new TypeError('buyerOrPublisher must not contain email-like PII');
  return freezeDeep({
    kind,
    leadKey: safeCode(value.leadKey, 'draftIntent.leadKey'),
    buyerOrPublisher,
    objective: text(value.objective, 'draftIntent.objective', 500),
    evidenceFactRefs: uniqueStrings(value.evidenceFactRefs, 'evidenceFactRefs', 1, 256),
    draftOnly: true,
    recipientResolved: false,
    contactDataImported: false,
    sendAuthorized: false,
    externalActionPerformed: false,
  });
}

function normalizeBusinessEvalHandoff(value) {
  plainObject(value, 'TradeOS businessEvalHandoff');
  assertAllowedKeys(value, new Set([
    'groupBusinessEvalCreated', 'measuredOutcomeRequired', 'requiredMetrics', 'technicalEvidenceRefs',
  ]), 'TradeOS businessEvalHandoff');
  assertFalse(value.groupBusinessEvalCreated, 'TradeOS groupBusinessEvalCreated');
  if (value.measuredOutcomeRequired !== true) throw new TypeError('TradeOS measuredOutcomeRequired must be true');
  const metrics = uniqueStrings(value.requiredMetrics, 'requiredMetrics', 7, 7);
  const expected = [
    'cost_usd', 'cycle_time_ms', 'error_count', 'human_minutes',
    'human_takeover', 'outcome', 'reversal_count',
  ];
  if (JSON.stringify(metrics) !== JSON.stringify(expected)) throw new TypeError('TradeOS requiredMetrics drift');
  return freezeDeep({
    groupBusinessEvalCreated: false,
    measuredOutcomeRequired: true,
    requiredMetrics: metrics,
    technicalEvidenceRefs: uniqueStrings(value.technicalEvidenceRefs, 'technicalEvidenceRefs'),
  });
}

function normalizeBoundaries(value) {
  plainObject(value, 'TradeOS boundaries');
  const keys = [
    'sourceReadOnly', 'canonicalBusinessObjectCreated', 'domainTruthMutated', 'crmRecordCreated',
    'contactDataImported', 'sourceFreeTextCopiedToDraft', 'messageBodyPersisted', 'recipientResolved',
    'externalSendPerformed', 'supplierCreated', 'opportunityCreated', 'financingPerformed',
    'paymentPerformed', 'chainActionPerformed',
  ];
  assertAllowedKeys(value, new Set(keys), 'TradeOS boundaries');
  if (value.sourceReadOnly !== true) throw new TypeError('TradeOS sourceReadOnly must be true');
  for (const key of keys.filter((item) => item !== 'sourceReadOnly')) assertFalse(value[key], `TradeOS ${key}`);
  return freezeDeep(Object.fromEntries(keys.map((key) => [key, value[key]])));
}

function normalizeTradeOSReceipt(receipt) {
  plainObject(receipt, 'TradeOS buyer research receipt');
  assertAllowedKeys(receipt, new Set([
    'schemaVersion', 'loopReceiptRef', 'loopDigest', 'groupBinding', 'source', 'evidenceSummary',
    'route', 'draftIntent', 'businessEvalHandoff', 'boundaries',
  ]), 'TradeOS buyer research receipt');
  if (receipt.schemaVersion !== TRADEOS_BUYER_RESEARCH_LOOP_SCHEMA) throw new TypeError('TradeOS buyer research schema mismatch');
  const loopDigest = digestHex(receipt.loopDigest, 'loopDigest');
  const unsigned = { ...receipt };
  delete unsigned.loopDigest;
  if (digest(unsigned) !== loopDigest) throw new TypeError('TradeOS buyer research loopDigest mismatch');

  const route = normalizeRoute(receipt.route);
  const normalized = freezeDeep({
    schemaVersion: TRADEOS_BUYER_RESEARCH_LOOP_SCHEMA,
    loopReceiptRef: safeRef(receipt.loopReceiptRef, 'loopReceiptRef', 'tradeos:group-buyer-research-loop:'),
    loopDigest,
    groupBinding: normalizeGroupBinding(receipt.groupBinding),
    source: normalizeSource(receipt.source),
    evidenceSummary: normalizeEvidenceSummary(receipt.evidenceSummary),
    route,
    draftIntent: normalizeDraftIntent(receipt.draftIntent, route.state),
    businessEvalHandoff: normalizeBusinessEvalHandoff(receipt.businessEvalHandoff),
    boundaries: normalizeBoundaries(receipt.boundaries),
  });

  return normalized;
}

function assertExactGroupBinding(receipt, workEntry, policy) {
  const binding = receipt.groupBinding;
  if (binding.workEntryRef !== workEntry.entryRef || binding.workEntryDigest !== workEntry.entryDigest) {
    throw new TypeError('TradeOS receipt Work Entry binding mismatch');
  }
  if (binding.autonomyPolicyRef !== policy.policyRef || binding.autonomyPolicyDigest !== policy.policyDigest) {
    throw new TypeError('TradeOS receipt autonomy policy binding mismatch');
  }
  if (workEntry.requestedActionCode !== 'buyer_research' || policy.actionCode !== 'buyer_research') {
    throw new TypeError('buyer research consumer requires buyer_research Work Entry and policy');
  }
  if (policy.ownerDomain !== 'tradeos') throw new TypeError('buyer research policy ownerDomain must be tradeos');
  if (binding.autonomyLevel !== policy.autonomyLevel) throw new TypeError('TradeOS receipt autonomy level mismatch');
  if (!['L0', 'L1'].includes(policy.autonomyLevel)) throw new TypeError('W3A buyer research policy must be L0 or L1');
}

function deriveNextWork(receipt) {
  const state = receipt.route.state;
  if (state === 'blocked') return null;
  if (state === 'needs_more_research') {
    return freezeDeep({
      requestedActionCode: 'buyer_research',
      requestedDomain: 'tradeos',
      requiredAutonomyLevel: 'L0',
      workKind: 'research_evidence',
      intentCode: 'continue_buyer_research',
      requiresNewWorkEntry: true,
      requiresPolicyMatch: true,
      ownerApprovalBeforeExternalEffect: false,
    });
  }
  const draftIntent = receipt.draftIntent;
  if (!draftIntent) throw new TypeError('draft route is missing draft intent');
  return freezeDeep({
    requestedActionCode: NEXT_ACTION_BY_DRAFT_KIND[draftIntent.kind],
    requestedDomain: 'tradeos',
    requiredAutonomyLevel: 'L1',
    workKind: 'draft_text',
    intentCode: draftIntent.kind,
    requiresNewWorkEntry: true,
    requiresPolicyMatch: true,
    ownerApprovalBeforeExternalEffect: true,
  });
}

function createNextWorkProposal(input) {
  plainObject(input, 'next work proposal input');
  assertAllowedKeys(input, new Set(['proposalRef', 'receipt', 'observedAt', 'evidenceRefs']), 'next work proposal input');
  const next = deriveNextWork(input.receipt);
  if (!next) return null;
  const unsigned = {
    schema: GROUP_NEXT_WORK_PROPOSAL_SCHEMA,
    proposalRef: safeRef(input.proposalRef, 'proposalRef', 'group:next-work-proposal:'),
    sourceDomain: 'tradeos',
    sourceReceiptRef: input.receipt.loopReceiptRef,
    sourceReceiptDigest: input.receipt.loopDigest,
    sourceState: input.receipt.route.state,
    requestedActionCode: next.requestedActionCode,
    requestedDomain: next.requestedDomain,
    requiredAutonomyLevel: next.requiredAutonomyLevel,
    workKind: next.workKind,
    intentCode: next.intentCode,
    requiresNewWorkEntry: true,
    requiresPolicyMatch: true,
    ownerApprovalBeforeExternalEffect: next.ownerApprovalBeforeExternalEffect,
    providerRouteResolved: false,
    capabilityResolved: false,
    executionEligibilityGranted: false,
    evidenceRefs: uniqueStrings(input.evidenceRefs, 'next work proposal evidenceRefs', 1, 64),
    observedAt: timestamp(input.observedAt, 'observedAt').text,
    proposalOnly: true,
    ...noAuthorityFlags(),
  };
  return freezeDeep({ ...unsigned, proposalDigest: digest(unsigned) });
}

function consumeTradeOSBuyerResearchLoop(input) {
  plainObject(input, 'TradeOS buyer research consumer input');
  assertAllowedKeys(input, new Set([
    'intakeRef', 'workEntry', 'policy', 'tradeosReceipt', 'intakeEvidenceRefs', 'observedAt',
  ]), 'TradeOS buyer research consumer input');

  const workEntry = assertWorkEntry(input.workEntry);
  const policy = assertPolicy(input.policy);
  const receipt = normalizeTradeOSReceipt(input.tradeosReceipt);
  assertExactGroupBinding(receipt, workEntry, policy);
  const observedAt = timestamp(input.observedAt, 'observedAt');
  const snapshotTime = Date.parse(receipt.source.snapshotGeneratedAt);
  if (snapshotTime > observedAt.time) throw new TypeError('TradeOS snapshot cannot be newer than intake observation');

  const nextWorkProposal = createNextWorkProposal({
    proposalRef: `group:next-work-proposal:${safeRef(input.intakeRef, 'intakeRef', 'group:domain-loop-intake:').slice('group:domain-loop-intake:'.length)}`,
    receipt,
    observedAt: observedAt.text,
    evidenceRefs: input.intakeEvidenceRefs,
  });

  const ownerAttentionRequired = receipt.route.ownerReviewRequired || receipt.route.state === 'blocked';
  const unsigned = {
    schema: GROUP_DOMAIN_LOOP_INTAKE_SCHEMA,
    intakeRef: safeRef(input.intakeRef, 'intakeRef', 'group:domain-loop-intake:'),
    sourceDomain: 'tradeos',
    sourceSchema: TRADEOS_BUYER_RESEARCH_LOOP_SCHEMA,
    sourceReceiptRef: receipt.loopReceiptRef,
    sourceReceiptDigest: receipt.loopDigest,
    workEntryRef: workEntry.entryRef,
    workEntryDigest: workEntry.entryDigest,
    policyRef: policy.policyRef,
    policyDigest: policy.policyDigest,
    actionCode: 'buyer_research',
    currentAutonomyLevel: policy.autonomyLevel,
    sourceState: receipt.route.state,
    sourceReasonCode: receipt.route.reasonCode,
    ownerAttentionRequired,
    nextWorkProposalRef: nextWorkProposal ? nextWorkProposal.proposalRef : null,
    nextWorkProposalDigest: nextWorkProposal ? nextWorkProposal.proposalDigest : null,
    nextWorkProposal,
    businessEvalMeasurementRequired: true,
    businessEvalCreated: false,
    technicalEvidenceRefs: receipt.businessEvalHandoff.technicalEvidenceRefs,
    intakeEvidenceRefs: uniqueStrings(input.intakeEvidenceRefs, 'intakeEvidenceRefs', 1, 64),
    observedAt: observedAt.text,
    intakeOnly: true,
    sourceDomainTruthPreserved: true,
    sourceFreeTextImported: false,
    providerRouteResolved: false,
    capabilityResolved: false,
    executionEligibilityGranted: false,
    ...noAuthorityFlags(),
  };

  return freezeDeep({ ...unsigned, intakeDigest: digest(unsigned) });
}

module.exports = {
  DRAFT_KINDS,
  GROUP_DOMAIN_LOOP_INTAKE_SCHEMA,
  GROUP_NEXT_WORK_PROPOSAL_SCHEMA,
  SOURCE_STATES,
  TRADEOS_BUYER_RESEARCH_LOOP_SCHEMA,
  consumeTradeOSBuyerResearchLoop,
};
