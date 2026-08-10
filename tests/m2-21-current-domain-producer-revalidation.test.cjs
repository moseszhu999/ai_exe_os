'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../fixtures/management/m2-21-current-domain-producer-revalidation-2026-08-10.json'),
  'utf8',
));

test('M2.21 current Domain audit keeps G3 fail-closed at one current structured adoption and zero recurring producers', () => {
  assert.equal(fixture.readOnly, true);
  assert.equal(fixture.writeAuthority, 'none');
  assert.equal(fixture.requiredDomainCount, 3);
  assert.equal(fixture.currentStructuredAdoptionCount, 1);
  assert.equal(fixture.staleStructuredAttestationCount, 2);
  assert.equal(fixture.enabledProducerCount, 2);
  assert.equal(fixture.disabledProducerCount, 1);
  assert.equal(fixture.structuredProducerContractCount, 0);
  assert.equal(fixture.recurringStructuredProducerCount, 0);
  assert.equal(fixture.g3State, 'PARTIAL');

  const byId = Object.fromEntries(fixture.domains.map((domain) => [domain.projectId, domain]));

  assert.equal(byId.trainingos.providerAheadBy, 1);
  assert.equal(byId.trainingos.structuredControllerAdoptedCurrent, false);
  assert.equal(byId.trainingos.nativeProducerEnabled, true);
  assert.equal(byId.trainingos.nativeProducerSchedule, 'HOURLY_BYMINUTE_0');

  assert.equal(byId.tradeos.providerAheadBy, 21);
  assert.equal(byId.tradeos.structuredControllerAdoptedCurrent, false);
  assert.equal(byId.tradeos.nativeProducerEnabled, false);

  assert.equal(byId['video-operation-shared-media'].providerComparison, 'identical');
  assert.equal(byId['video-operation-shared-media'].structuredControllerAdoptedCurrent, true);
  assert.equal(byId['video-operation-shared-media'].canonicalIndependentCycleCount, 2);
  assert.equal(byId['video-operation-shared-media'].nativeProducerEnabled, true);

  for (const domain of fixture.domains) {
    assert.equal(domain.structuredProducerContractObserved, false);
    assert.equal(domain.outOfBandPersistenceObserved, true);
    assert.equal(domain.domainTruthInferred, false);
    assert.equal(domain.authorityGranted, false);
  }

  assert.deepEqual(fixture.boundary, {
    externalDomainRepositoryMutation: false,
    externalSchedulerMutation: false,
    controllerAttestationFabricated: false,
    humanGateDecision: false,
    executionAuthorityGranted: false,
  });
});
