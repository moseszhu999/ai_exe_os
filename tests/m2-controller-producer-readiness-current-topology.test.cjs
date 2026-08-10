'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildControllerAdoptionReadiness } = require('../src/management/portfolio/controller-adoption-readiness.cjs');
const { buildControllerProducerReadiness } = require('../src/management/portfolio/controller-producer-readiness.cjs');

const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'management', 'm2-controller-producer-readiness-current-2026-08-10.json'),
  'utf8',
));

function producerInput(row) {
  const { expectedState: _expectedState, ...input } = row;
  return input;
}

test('M2.18 current topology closes the persistence gap without falsely closing recurring producer readiness', () => {
  assert.equal(fixture.evidenceClass, 'REAL_CONTROLLER_PRODUCER_TOPOLOGY_READ_ONLY_AUDIT_POST_M2_17');
  assert.equal(fixture.readOnly, true);
  assert.equal(fixture.writeAuthority, 'none');

  for (const verification of Object.values(fixture.providerHeadVerification)) {
    assert.equal(verification.comparisonToMain, 'identical');
  }

  const adoptionReadiness = buildControllerAdoptionReadiness({
    observedAt: fixture.observedAt,
    projects: fixture.adoptionProjects,
  });
  const readiness = buildControllerProducerReadiness({
    observedAt: fixture.observedAt,
    adoptionReadiness,
    producers: fixture.producers.map(producerInput),
  });

  assert.equal(adoptionReadiness.structuredAdoptedCount, fixture.expected.structuredAdoptedCount);
  assert.equal(adoptionReadiness.groupAdapterReadyCount, fixture.expected.groupAdapterReadyCount);
  assert.equal(adoptionReadiness.structuredAdoptionComplete, fixture.expected.structuredAdoptionComplete);

  assert.equal(readiness.externalProjectCount, fixture.expected.externalProjectCount);
  assert.equal(readiness.enabledProducerCount, fixture.expected.enabledProducerCount);
  assert.equal(readiness.disabledProducerCount, fixture.expected.disabledProducerCount);
  assert.equal(readiness.contractMissingCount, fixture.expected.contractMissingCount);
  assert.equal(readiness.persistenceMissingCount, fixture.expected.persistenceMissingCount);
  assert.equal(readiness.recurringStructuredProducerCount, fixture.expected.recurringStructuredProducerCount);
  assert.equal(readiness.recurringStructuredProducerComplete, fixture.expected.recurringStructuredProducerComplete);

  const byId = new Map(readiness.producers.map((producer) => [producer.projectId, producer]));
  for (const row of fixture.producers) {
    const producer = byId.get(row.projectId);
    assert.equal(producer.state, row.expectedState);
    assert.equal(producer.outOfBandPersistenceChannelObserved, true);
    assert.equal(producer.structuredProducerContractObserved, false);
    assert.equal(producer.recurringStructuredProven, false);
    assert.equal(producer.domainTruthInferred, false);
    assert.equal(producer.authorityGranted, false);
  }

  assert.equal(byId.get('trainingos').schedulerEnabled, true);
  assert.equal(byId.get('tradeos').schedulerEnabled, false);
  assert.equal(byId.get('video-operation-shared-media').schedulerEnabled, true);

  assert.equal(readiness.readOnly, true);
  assert.equal(readiness.writeAuthority, 'none');
  assert.equal(readiness.externalRepositoryMutationRequiredByThisModule, false);
  assert.equal(readiness.recurringStructuredProducerComplete, false);
});
