'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  createGroupAutonomyPolicy,
  createGroupWorkEntry,
} = require('../src/group-fabric/group-operating-system.cjs');
const {
  consumeTradeOSBuyerResearchLoop,
} = require('../src/group-fabric/tradeos-buyer-research-consumer.cjs');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function workEntry(overrides = {}) {
  return createGroupWorkEntry({
    entryRef: 'group:work-entry:buyer-001',
    actorRef: 'group:subject:owner-001',
    organizationRef: 'group:organization:company-001',
    objective: 'Research a qualified buyer candidate and preserve reviewed evidence.',
    requestedActionCode: 'buyer_research',
    targetRef: 'tradeos:presales:BUYER-001',
    requestedDomain: 'tradeos',
    sourceKind: 'human',
    createdAt: '2026-08-12T00:00:00Z',
    evidenceRefs: ['evidence:request:buyer-001'],
    ...overrides,
  });
}

function policy(overrides = {}) {
  return createGroupAutonomyPolicy({
    policyRef: 'group:autonomy-policy:buyer-research',
    actionCode: 'buyer_research',
    ownerDomain: 'tradeos',
    autonomyLevel: 'L0',
    reversibility: 'read_only',
    humanGateRequired: false,
    retryClass: 'safe_idempotent',
    maxAttempts: 3,
    maxCostUsd: 5,
    maxActions: 10,
    evidenceKinds: ['source', 'route', 'outcome'],
    policyEvidenceRefs: ['evidence:policy:buyer-research'],
    validFrom: '2026-08-01T00:00:00Z',
    validUntil: '2026-09-01T00:00:00Z',
    ...overrides,
  });
}

function receipt(input = {}) {
  const entry = input.entry || workEntry();
  const pol = input.policy || policy();
  const state = input.state || 'candidate_review_ready';
  const draftKind = input.draftKind || (
    state === 'candidate_review_ready'
      ? 'initial_outreach_draft'
      : state === 'draft_review_ready'
        ? 'follow_up_draft'
        : null
  );
  const draftIntent = draftKind
    ? {
        kind: draftKind,
        leadKey: 'BUYER-001',
        buyerOrPublisher: 'Example Buyer Organization',
        objective: 'Prepare a bounded buyer communication draft from reviewed evidence references.',
        evidenceFactRefs: ['tradeos:presales-fact:BUYER-001:1'],
        draftOnly: true,
        recipientResolved: false,
        contactDataImported: false,
        sendAuthorized: false,
        externalActionPerformed: false,
      }
    : null;
  const boundaries = {
    sourceReadOnly: true,
    canonicalBusinessObjectCreated: false,
    domainTruthMutated: false,
    crmRecordCreated: false,
    contactDataImported: false,
    sourceFreeTextCopiedToDraft: false,
    messageBodyPersisted: false,
    recipientResolved: false,
    externalSendPerformed: false,
    supplierCreated: false,
    opportunityCreated: false,
    financingPerformed: false,
    paymentPerformed: false,
    chainActionPerformed: false,
  };
  const body = {
    schemaVersion: 'tradeos.group-buyer-research-loop.v1',
    loopReceiptRef: 'tradeos:group-buyer-research-loop:fixture001',
    groupBinding: {
      workEntryRef: entry.entryRef,
      workEntryDigest: entry.entryDigest,
      autonomyPolicyRef: pol.policyRef,
      autonomyPolicyDigest: pol.policyDigest,
      actionCode: 'buyer_research',
      autonomyLevel: pol.autonomyLevel,
    },
    source: {
      snapshotGeneratedAt: '2026-08-12T00:05:00Z',
      leadKey: 'BUYER-001',
      leadStatus: state === 'draft_review_ready' ? 'contacted' : state === 'needs_more_research' ? 'researching' : state === 'blocked' ? 'human_review' : 'ready_to_contact',
      sourcePackageIds: ['sp-001'],
      evidenceSources: ['supabase'],
    },
    evidenceSummary: {
      researchBatchCount: 1,
      evidenceResultCount: 2,
      supplyLeadCount: 0,
      openTaskCount: state === 'needs_more_research' ? 1 : 0,
      findingCount: 2,
      gapOrConflictCount: state === 'blocked' ? 1 : 0,
      reviewCount: 1,
      sourceFactCount: 1,
      latestReviewStatus: 'accepted',
    },
    route: {
      state,
      reasonCode: state === 'candidate_review_ready'
        ? 'evidence_ready_for_buyer_candidate_review'
        : state === 'draft_review_ready'
          ? 'existing_contact_ready_for_follow_up_draft'
          : state === 'needs_more_research'
            ? 'open_research_tasks_remain'
            : 'evidence_gap_or_conflict_present',
      nextAction: 'Continue through bounded Group workflow.',
      ownerReviewRequired: state !== 'needs_more_research',
    },
    draftIntent,
    businessEvalHandoff: {
      groupBusinessEvalCreated: false,
      measuredOutcomeRequired: true,
      requiredMetrics: [
        'outcome',
        'human_minutes',
        'cycle_time_ms',
        'cost_usd',
        'error_count',
        'reversal_count',
        'human_takeover',
      ],
      technicalEvidenceRefs: ['tradeos:source-package:sp-001'],
    },
    boundaries,
  };
  if (input.mutate) input.mutate(body);
  return Object.freeze({ ...body, loopDigest: digest(body) });
}

function consume(overrides = {}) {
  const entry = overrides.workEntry || workEntry();
  const pol = overrides.policy || policy();
  const tradeosReceipt = overrides.tradeosReceipt || receipt({ entry, policy: pol });
  return consumeTradeOSBuyerResearchLoop({
    intakeRef: 'group:domain-loop-intake:tradeos-buyer-001',
    workEntry: entry,
    policy: pol,
    tradeosReceipt,
    intakeEvidenceRefs: ['evidence:tradeos-receipt-observed:001'],
    observedAt: '2026-08-12T00:10:00Z',
    ...overrides,
  });
}

test('evidence-ready buyer research produces only an L1 next-work proposal, not a draft execution', () => {
  const result = consume();
  assert.equal(result.sourceDomain, 'tradeos');
  assert.equal(result.sourceState, 'candidate_review_ready');
  assert.equal(result.ownerAttentionRequired, true);
  assert.equal(result.nextWorkProposal.requestedActionCode, 'buyer_outreach_draft');
  assert.equal(result.nextWorkProposal.requiredAutonomyLevel, 'L1');
  assert.equal(result.nextWorkProposal.workKind, 'draft_text');
  assert.equal(result.nextWorkProposal.requiresNewWorkEntry, true);
  assert.equal(result.nextWorkProposal.requiresPolicyMatch, true);
  assert.equal(result.nextWorkProposal.providerRouteResolved, false);
  assert.equal(result.nextWorkProposal.capabilityResolved, false);
  assert.equal(result.nextWorkProposal.executionEligibilityGranted, false);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.domainWritePerformed, false);
  assert.equal(result.externalActionPerformed, false);
});

test('researching buyer state produces an L0 continuation proposal without owner attention', () => {
  const entry = workEntry();
  const pol = policy();
  const result = consume({
    workEntry: entry,
    policy: pol,
    tradeosReceipt: receipt({ entry, policy: pol, state: 'needs_more_research' }),
  });
  assert.equal(result.sourceState, 'needs_more_research');
  assert.equal(result.ownerAttentionRequired, false);
  assert.equal(result.nextWorkProposal.requestedActionCode, 'buyer_research');
  assert.equal(result.nextWorkProposal.requiredAutonomyLevel, 'L0');
  assert.equal(result.nextWorkProposal.workKind, 'research_evidence');
  assert.equal(result.nextWorkProposal.ownerApprovalBeforeExternalEffect, false);
});

test('contacted and replied paths map only to their distinct L1 draft action proposals', () => {
  const entry = workEntry();
  const pol = policy();
  const followup = consume({
    workEntry: entry,
    policy: pol,
    tradeosReceipt: receipt({ entry, policy: pol, state: 'draft_review_ready', draftKind: 'follow_up_draft' }),
  });
  assert.equal(followup.nextWorkProposal.requestedActionCode, 'buyer_follow_up_draft');
  assert.equal(followup.nextWorkProposal.intentCode, 'follow_up_draft');

  const responseReceipt = receipt({
    entry,
    policy: pol,
    state: 'draft_review_ready',
    draftKind: 'response_draft',
    mutate(body) {
      body.source.leadStatus = 'replied';
      body.route.reasonCode = 'buyer_reply_ready_for_response_draft';
    },
  });
  const response = consume({ workEntry: entry, policy: pol, tradeosReceipt: responseReceipt });
  assert.equal(response.nextWorkProposal.requestedActionCode, 'buyer_response_draft');
  assert.equal(response.nextWorkProposal.intentCode, 'response_draft');
});

test('blocked TradeOS state creates no next-work proposal and remains owner attention', () => {
  const entry = workEntry();
  const pol = policy();
  const result = consume({
    workEntry: entry,
    policy: pol,
    tradeosReceipt: receipt({ entry, policy: pol, state: 'blocked' }),
  });
  assert.equal(result.sourceState, 'blocked');
  assert.equal(result.ownerAttentionRequired, true);
  assert.equal(result.nextWorkProposal, null);
  assert.equal(result.nextWorkProposalRef, null);
  assert.equal(result.executionEligibilityGranted, false);
});

test('consumer binds exact W0 Work Entry and policy identities from the TradeOS receipt', () => {
  const entry = workEntry();
  const pol = policy();
  const wrongEntry = workEntry({ entryRef: 'group:work-entry:buyer-999' });
  assert.throws(() => consume({
    workEntry: wrongEntry,
    policy: pol,
    tradeosReceipt: receipt({ entry, policy: pol }),
  }), /Work Entry binding mismatch/);

  const wrongPolicy = policy({ policyRef: 'group:autonomy-policy:buyer-research-other' });
  assert.throws(() => consume({
    workEntry: entry,
    policy: wrongPolicy,
    tradeosReceipt: receipt({ entry, policy: pol }),
  }), /autonomy policy binding mismatch/);
});

test('consumer rejects a tampered TradeOS receipt digest', () => {
  const entry = workEntry();
  const pol = policy();
  const original = receipt({ entry, policy: pol });
  const tampered = { ...original, route: { ...original.route, state: 'blocked' } };
  assert.throws(() => consume({ workEntry: entry, policy: pol, tradeosReceipt: tampered }), /loopDigest mismatch/);
});

test('consumer rejects widened TradeOS send, CRM, source-free-text or Domain-truth boundaries', () => {
  const entry = workEntry();
  const pol = policy();
  for (const key of ['externalSendPerformed', 'crmRecordCreated', 'sourceFreeTextCopiedToDraft', 'domainTruthMutated']) {
    const widened = receipt({
      entry,
      policy: pol,
      mutate(body) { body.boundaries[key] = true; },
    });
    assert.throws(() => consume({ workEntry: entry, policy: pol, tradeosReceipt: widened }), /must be false/);
  }
});

test('consumer rejects draft payloads that resolve recipient, import contact data or authorize send', () => {
  const entry = workEntry();
  const pol = policy();
  for (const key of ['recipientResolved', 'contactDataImported', 'sendAuthorized', 'externalActionPerformed']) {
    const widened = receipt({
      entry,
      policy: pol,
      mutate(body) { body.draftIntent[key] = true; },
    });
    assert.throws(() => consume({ workEntry: entry, policy: pol, tradeosReceipt: widened }), /must be false/);
  }
});

test('consumer rejects hidden free text or transport fields added to the TradeOS draft intent', () => {
  const entry = workEntry();
  const pol = policy();
  for (const [key, value] of [['evidenceNote', 'free text'], ['recipientEmail', 'buyer@example.com'], ['messageBody', 'hello'], ['sendMessage', true]]) {
    const widened = receipt({
      entry,
      policy: pol,
      mutate(body) { body.draftIntent[key] = value; },
    });
    assert.throws(() => consume({ workEntry: entry, policy: pol, tradeosReceipt: widened }), /unsupported field/);
  }
});

test('consumer accepts uppercase opaque TradeOS lead identifiers without treating them as Group codes', () => {
  const result = consume();
  assert.equal(result.sourceReceiptRef, 'tradeos:group-buyer-research-loop:fixture001');
  assert.equal(result.sourceFreeTextImported, false);
});

test('consumer never imports source free text or creates Group business eval from presales counters', () => {
  const result = consume();
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('Example Buyer Organization'), false);
  assert.equal(serialized.includes('Continue through bounded Group workflow.'), false);
  assert.equal(result.businessEvalMeasurementRequired, true);
  assert.equal(result.businessEvalCreated, false);
  assert.equal(result.sourceFreeTextImported, false);
});

test('consumer source has no network, filesystem, provider runtime, management write or external-effect invocation primitive', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/group-fabric/tradeos-buyer-research-consumer.cjs'), 'utf8');
  assert.equal(/require\(['"](?:node:)?fs['"]\)/.test(source), false);
  assert.equal(/require\(['"](?:node:)?child_process['"]\)/.test(source), false);
  assert.equal(/\bfetch\s*\(/.test(source), false);
  assert.equal(/src\/management|\.\.\/management|provider-runtime|transport\.invoke/.test(source), false);
  assert.equal(/sendMail\s*\(|sendMessage\s*\(|payment\s*\(|settlement\s*\(|wallet\s*\(|deploy\s*\(/i.test(source), false);
});
