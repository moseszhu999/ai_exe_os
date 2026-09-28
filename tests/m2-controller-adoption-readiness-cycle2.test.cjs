'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { buildControllerAdoptionReadiness } = require('../src/management/portfolio/controller-adoption-readiness.cjs');

const source = JSON.parse(readFileSync(join(
  __dirname,
  '..',
  'fixtures',
  'management',
  'm2-external-controller-adoption-readiness-2026-08-10-cycle2.json',
), 'utf8'));

function build() {
  return buildControllerAdoptionReadiness({
    observedAt: source.observedAt,
    projects: source.projects.map((project) => ({
      projectId: project.projectId,
      repository: project.repository,
      exactHeadSha: project.exactHeadSha,
      groupAdapterEvidenceRefs: project.groupAdapterEvidenceRefs,
      verifiedCurrentEnvelopeEvidenceRefs: project.verifiedCurrentEnvelopeEvidenceRefs,
      markerSearchObserved: project.markerSearchObserved,
      markerSearchMatched: project.markerSearchMatched,
    })),
  });
}

test('M2.10 all three external domains now have real group integration substrate while Controller adoption remains zero', () => {
  const readiness = build();
  assert.equal(readiness.externalProjectCount, 3);
  assert.equal(readiness.groupAdapterReadyCount, 3);
  assert.equal(readiness.structuredAdoptedCount, 0);
  assert.equal(readiness.unverifiedMarkerCount, 0);
  assert.equal(readiness.structuredAdoptionComplete, false);
  assert.equal(readiness.groupAdapterIsNotControllerAdoption, true);
  assert.equal(readiness.readOnly, true);
  assert.equal(readiness.writeAuthority, 'none');
  for (const project of readiness.projects) {
    assert.equal(project.state, 'GROUP_ADAPTER_READY_ENVELOPE_MISSING');
    assert.equal(project.groupIntegrationReady, true);
    assert.equal(project.structuredControllerAdopted, false);
    assert.equal(project.markerSearchObserved, true);
    assert.equal(project.markerSearchMatched, false);
    assert.equal(project.authorityGranted, false);
    assert.equal(project.domainTruthInferred, false);
  }
});

test('M2.10 TradeOS group Work Inbox/read transport evidence cannot be promoted by naming alone', () => {
  const readiness = build();
  const trade = readiness.projects.find((project) => project.projectId === 'tradeos');
  assert.equal(trade.exactHeadSha, 'c51b766aefecb5fcc49c27c3c51bd982c13a30e0');
  assert.equal(trade.groupAdapterEvidenceRefs.length, 2);
  assert.equal(trade.verifiedCurrentEnvelopeEvidenceRefs.length, 0);
  assert.equal(trade.state, 'GROUP_ADAPTER_READY_ENVELOPE_MISSING');
});
