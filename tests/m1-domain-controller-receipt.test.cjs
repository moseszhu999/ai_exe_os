'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildObservedPortfolio,
  createGithubReadOnlyProjectObservation,
} = require('../src/management/portfolio/read-only-adapters.cjs');
const {
  createDomainControllerReceipt,
  enrichGithubObservationWithDomainReceipt,
} = require('../src/management/portfolio/domain-controller-receipt.cjs');

function github(overrides = {}) {
  return createGithubReadOnlyProjectObservation({
    projectId: 'tradeos',
    repository: 'moseszhu999/chaintrace-app',
    headSha: '02985010fbd91277df94d97984401af913a7922a',
    observedAt: '2026-08-09T09:10:00Z',
    now: '2026-08-09T09:10:00Z',
    openPullRequests: [],
    ...overrides,
  });
}

function receipt(overrides = {}) {
  return createDomainControllerReceipt({
    projectId: 'tradeos',
    controllerId: 'tradeos-controller',
    repository: 'moseszhu999/chaintrace-app',
    exactHeadSha: '02985010fbd91277df94d97984401af913a7922a',
    domainStatus: 'active',
    owner: 'tradeos-controller',
    milestone: 'N1/N2 controlled execution',
    blockerCodes: [],
    evidenceRefs: ['github:moseszhu999/chaintrace-app:commit:02985010fbd91277df94d97984401af913a7922a'],
    observedAt: '2026-08-09T09:11:00Z',
    ...overrides,
  });
}

test('M1.1 exact-head current controller receipt supplies authoritative domain status', () => {
  const enriched = enrichGithubObservationWithDomainReceipt({
    observation: github(),
    receipt: receipt(),
    now: '2026-08-09T09:20:00Z',
  });
  assert.equal(enriched.domainReceipt.accepted, true);
  assert.equal(enriched.snapshot.status, 'active');
  assert.equal(enriched.snapshot.owner, 'tradeos-controller');
  assert.equal(enriched.snapshot.milestone, 'N1/N2 controlled execution');
  assert.equal(enriched.writeAuthority, 'none');
});

test('M1.1 head mismatch does not project stale domain truth onto current GitHub state', () => {
  const enriched = enrichGithubObservationWithDomainReceipt({
    observation: github(),
    receipt: receipt({ exactHeadSha: '1111111111111111111111111111111111111111' }),
    now: '2026-08-09T09:20:00Z',
  });
  assert.equal(enriched.domainReceipt.accepted, false);
  assert.equal(enriched.domainReceipt.reason, 'exact_head_mismatch');
  assert.equal(enriched.snapshot.status, 'unknown');
  assert.equal(enriched.snapshot.owner, null);
  assert.ok(enriched.snapshot.attentionSignals.includes('domain_receipt_head_mismatch'));
});

test('M1.1 stale controller receipt fails visible instead of being trusted', () => {
  const enriched = enrichGithubObservationWithDomainReceipt({
    observation: github(),
    receipt: receipt({ observedAt: '2026-08-09T04:00:00Z' }),
    now: '2026-08-09T09:20:00Z',
  });
  assert.equal(enriched.domainReceipt.accepted, false);
  assert.equal(enriched.domainReceipt.reason, 'receipt_stale');
  assert.equal(enriched.snapshot.status, 'unknown');
  assert.ok(enriched.snapshot.attentionSignals.includes('domain_receipt_stale'));
});

test('M1.1 receipt requires evidence and cannot carry write authority fields', () => {
  assert.throws(() => receipt({ evidenceRefs: [] }), /requires evidence refs/);
  assert.throws(() => createDomainControllerReceipt({
    projectId: 'tradeos',
    controllerId: 'tradeos-controller',
    repository: 'moseszhu999/chaintrace-app',
    exactHeadSha: '02985010fbd91277df94d97984401af913a7922a',
    domainStatus: 'active',
    owner: 'tradeos-controller',
    milestone: 'x',
    evidenceRefs: ['e'],
    observedAt: '2026-08-09T09:11:00Z',
    write: true,
  }), /unsupported field/);
});

test('M1.1 controller receipt cannot attest unknown domain status', () => {
  assert.throws(() => receipt({ domainStatus: 'unknown' }), /authoritative and non-unknown/);
});

test('M1.1 enriched observation remains composable in the observed portfolio', () => {
  const enriched = enrichGithubObservationWithDomainReceipt({
    observation: github(),
    receipt: receipt(),
    now: '2026-08-09T09:20:00Z',
  });
  const result = buildObservedPortfolio({
    portfolioId: 'group-portfolio',
    observedAt: '2026-08-09T09:20:00Z',
    observations: [enriched],
  });
  assert.equal(result.portfolio.projectCount, 1);
  assert.equal(result.portfolio.statusCounts.active, 1);
  assert.equal(result.writeAuthority, 'none');
});
