'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const { S4ApplicationService } = require('../src/application/s4-index.cjs');
const {
  MANAGEMENT_CEO_PORTFOLIO_SURFACE_SCHEMA,
  readManagementCeoPortfolioSurface,
} = require('../src/operator-console/read-model/management-ceo-portfolio.cjs');
const { createS4CockpitViewModel } = require('../src/renderer/s4/view-model.cjs');

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);
const HEX_C = 'c'.repeat(64);

const NO_AUTHORITY = Object.freeze({
  sourceSemanticsVerifiedByThisModule: false,
  llmFactGenerationAllowed: false,
  managementPlaneMutationPerformed: false,
  decisionTruthCreated: false,
  authorizationDecisionCreated: false,
  authorityGrantCreated: false,
  humanGateDecisionCreated: false,
  delegationCreated: false,
  executionAuthorized: false,
  domainTruthCreated: false,
  domainWritePerformed: false,
  externalActionPerformed: false,
  paymentPerformed: false,
  productionDeploymentPerformed: false,
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function brief() {
  const unsigned = {
    schema: 'group.ceo-portfolio-brief.v1',
    briefRef: 'group:ceo-portfolio-brief:m2-29-fixture',
    observedAt: '2026-08-12T12:00:00.000Z',
    portfolioHealth: 'attention',
    cardCount: 1,
    attentionCardCount: 1,
    staleCardCount: 0,
    goalCount: 0,
    opportunityCount: 0,
    projectCount: 1,
    exceptionCount: 0,
    cards: [{
      cardRef: 'group:portfolio-card:m2-29-aiexe',
      ownerDomain: 'aiexe',
      cardKind: 'project',
      title: 'AIEXE management portfolio wiring',
      health: 'attention',
      freshness: 'fresh',
      stateCode: 'active',
      reasonCode: 'owner_attention_required',
      attentionRequired: true,
      nextActionCode: 'review_portfolio',
      decisionRef: 'group:owner-decision:m2-29-review',
    }],
    decisions: {
      targetMin: 3,
      targetMax: 10,
      coverageStatus: 'below_target',
      totalDecisionCount: 1,
      visibleDecisionCount: 1,
      deferredDecisionCount: 0,
      decisions: [{
        decisionRef: 'group:owner-decision:m2-29-review',
        decisionLabel: 'Review portfolio attention',
        urgency: 'high',
        decisionKind: 'review',
        reasonCode: 'owner_attention_required',
        evidenceRefs: ['evidence:m2-29-decision'],
        cardRef: 'group:portfolio-card:m2-29-aiexe',
        proposalOnly: true,
        ownerDecisionRecorded: false,
        humanGateDecisionCreated: false,
        authorizationDecisionCreated: false,
        externalActionPerformed: false,
      }],
      decisionsFabricatedToMeetTarget: false,
    },
    businessPerformance: [],
    detailIndex: [{
      cardRef: 'group:portfolio-card:m2-29-aiexe',
      cardDigest: HEX_A,
      workEntryRef: 'group:work-entry:m2-29-aiexe',
      workEntryDigest: `sha256:${HEX_B}`,
      sourceSchema: 'aiexe.group-management-source.v1',
      sourceRef: 'aiexe:management:m2-29',
      sourceDigest: `sha256:${HEX_C}`,
      sourceObservedAt: '2026-08-12T11:59:00.000Z',
      evidenceRefs: ['evidence:m2-29-source'],
    }],
    detailOnlyFieldsExcludedFromCards: ['cardDigest', 'workEntryDigest', 'sourceDigest', 'evidenceRefs'],
    readModelOnly: true,
    digestTraceHiddenFromPrimaryCards: true,
    ...NO_AUTHORITY,
  };
  return { ...unsigned, briefDigest: digest(unsigned) };
}

test('M2.29 validates the external Group brief through M2.28 before exposing a read-only cockpit surface', () => {
  const surface = readManagementCeoPortfolioSurface({
    workspaceId: 'workspace-a',
    groupManagementWorkspaceId: 'workspace-a',
    groupCeoPortfolioBriefReader: () => brief(),
  });
  assert.equal(surface.schema, MANAGEMENT_CEO_PORTFOLIO_SURFACE_SCHEMA);
  assert.equal(surface.available, true);
  assert.equal(surface.reasonCode, 'source_validated');
  assert.equal(surface.view.schema, 'aiexe.management-ceo-portfolio-view.v1');
  assert.equal(surface.view.portfolioHealth, 'attention');
  assert.equal(surface.view.ownerAttention.length, 1);
  assert.equal(surface.view.decisions.decisions[0].proposalOnly, true);
  assert.equal(surface.readOnly, true);
  assert.equal(surface.writeAuthority, 'none');
  assert.equal(surface.managementProposalCreated, false);
  assert.equal(surface.decisionTruthCreated, false);
  assert.equal(surface.externalActionPerformed, false);
});

test('M2.29 exact Workspace visibility prevents Group portfolio reads from leaking into another Workspace', () => {
  let reads = 0;
  const surface = readManagementCeoPortfolioSurface({
    workspaceId: 'workspace-b',
    groupManagementWorkspaceId: 'workspace-a',
    groupCeoPortfolioBriefReader: () => { reads += 1; return brief(); },
  });
  assert.equal(surface, null);
  assert.equal(reads, 0);
});

test('M2.29 source failure and tampering remain bounded visible read-model states instead of inferred truth', () => {
  const failed = readManagementCeoPortfolioSurface({
    workspaceId: 'workspace-a',
    groupManagementWorkspaceId: 'workspace-a',
    groupCeoPortfolioBriefReader: () => { throw new Error('provider secret details must not escape'); },
  });
  assert.equal(failed.available, false);
  assert.equal(failed.reasonCode, 'source_read_failed');
  assert.doesNotMatch(JSON.stringify(failed), /provider secret details/);

  const tampered = brief();
  tampered.cards[0].title = 'tampered without new digest';
  const invalid = readManagementCeoPortfolioSurface({
    workspaceId: 'workspace-a',
    groupManagementWorkspaceId: 'workspace-a',
    groupCeoPortfolioBriefReader: () => tampered,
  });
  assert.equal(invalid.available, false);
  assert.equal(invalid.reasonCode, 'source_invalid');
  assert.equal(invalid.view, null);
});

test('M2.29 S4 cockpit composition is query-only and does not create Mission execution state', () => {
  const service = new S4ApplicationService({
    groupManagementWorkspaceId: 'workspace-a',
    groupCeoPortfolioBriefReader: () => brief(),
  });
  try {
    const attemptsBefore = service.stepAttempt.list().length;
    const cockpit = service.queryOperatorCockpit('workspace-a');
    assert.equal(cockpit.found, true);
    assert.equal(cockpit.managementPortfolio.available, true);
    assert.equal(cockpit.managementPortfolio.view.cards[0].managementProjectId, 'aiexe');
    assert.equal(service.stepAttempt.list().length, attemptsBefore);
  } finally {
    service.close();
  }
});

test('M2.29 S4 view model preserves the optional portfolio as a frozen display-only read model', () => {
  const managementPortfolio = readManagementCeoPortfolioSurface({
    workspaceId: 'workspace-a',
    groupManagementWorkspaceId: 'workspace-a',
    groupCeoPortfolioBriefReader: () => brief(),
  });
  const vm = createS4CockpitViewModel({
    workspaceId: 'workspace-a',
    found: true,
    workspace: { id: 'workspace-a' },
    missions: [], workers: [], humanGates: [], attention: [],
    github: { repositories: [], pullRequests: [], deliveryGates: [], deliveryEvidence: [] },
    evidence: [], events: [], projects: [], agents: [], installations: [], providerSnapshots: [],
    managementPortfolio,
  }, 'workspace-a');
  assert.equal(vm.managementPortfolio.view.decisions.decisions[0].decisionKind, 'review');
  assert.equal(Object.isFrozen(vm.managementPortfolio), true);
  assert.equal(Object.isFrozen(vm.managementPortfolio.view), true);
  assert.equal(vm.managementPortfolio.humanGateDecisionCreated, false);
});

test('M2.29 renderer adds a CEO portfolio read surface without adding decision or execution controls', () => {
  const source = readFileSync(join(__dirname, '..', 'src/renderer/s4/render.cjs'), 'utf8');
  assert.match(source, /CEO Portfolio \/ Management Read Model/);
  assert.match(source, /CEO decision proposals/);
  assert.match(source, /proposal-only/);
  assert.doesNotMatch(source, /Approve CEO|Reject CEO|Execute CEO|Authorize CEO|Delegate CEO/);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|document\.write/);
});
