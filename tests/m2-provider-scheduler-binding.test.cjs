'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { buildProviderSchedulerReadiness } = require('../src/management/portfolio/provider-scheduler-readiness.cjs');

const source = JSON.parse(readFileSync(join(
  __dirname,
  '..',
  'fixtures',
  'management',
  'm2-provider-scheduler-binding-2026-08-10.json',
), 'utf8'));

test('M2.10 real AIEXE hourly automation is enabled and provider-bound without inventing a successful scheduled receipt', () => {
  assert.equal(source.evidenceClass, 'REAL_NATIVE_AUTOMATION_BINDING_OBSERVATION');
  assert.equal(source.schedulePolicy.timezone, 'Asia/Shanghai');
  assert.equal(source.schedulePolicy.cadence, 'HOURLY');
  assert.equal(source.schedulePolicy.minute, 48);
  assert.equal(source.schedulePolicy.exactSchedule, true);
  assert.equal(source.bindingPolicy.existingControllerPromptPreserved, true);
  assert.equal(source.bindingPolicy.providerIngestionClauseAppended, true);
  assert.equal(source.bindingPolicy.secondSchedulerCreated, false);
  assert.equal(source.bindingPolicy.externalDomainCommentsAllowed, false);
  assert.equal(source.bindingPolicy.aiexePr125EvidenceCommentOnly, true);
  assert.equal(source.bindingPolicy.domainTruthInferenceAllowed, false);
  assert.equal(source.bindingPolicy.mergeAllowed, false);
  assert.equal(source.bindingPolicy.deployAllowed, false);
  assert.equal(source.bindingPolicy.productionMutationAllowed, false);

  const readiness = buildProviderSchedulerReadiness(source.readinessInput);
  assert.equal(readiness.state, source.expected.state);
  assert.equal(readiness.schedulerEnabled, true);
  assert.equal(readiness.providerIngestionBindingObserved, true);
  assert.equal(readiness.immutableReceiptPersistenceObserved, false);
  assert.equal(readiness.successfulScheduledRunObserved, false);
  assert.equal(readiness.scheduledRuntimeProven, false);
  assert.equal(readiness.recurringIngestionProven, false);
});

test('M2.10 scheduler binding evidence carries no personal automation id or external write authority', () => {
  const serialized = JSON.stringify(source);
  assert.doesNotMatch(serialized, /6a780e4958a881919bb3d5d216c2a205/);
  assert.doesNotMatch(serialized, /writeAuthority/);
  assert.equal(source.bindingPolicy.externalDomainCommentsAllowed, false);
  assert.equal(source.bindingPolicy.productionMutationAllowed, false);
});
