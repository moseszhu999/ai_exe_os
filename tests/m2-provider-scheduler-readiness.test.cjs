'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildProviderSchedulerReadiness,
} = require('../src/management/portfolio/provider-scheduler-readiness.cjs');

test('M2.9 observed disabled hourly scheduler without ingestion binding stays unproven', () => {
  const result = buildProviderSchedulerReadiness({
    schedulerObserved: true,
    schedulerEnabled: false,
    hourlyCadenceObserved: true,
    providerIngestionBindingObserved: false,
    immutableReceiptPersistenceObserved: false,
    successfulScheduledRunObserved: false,
    lastRunObservedAt: '2026-08-09T05:52:04.858710Z',
  });
  assert.equal(result.schema, 'aiexe.provider-scheduler-readiness.v1');
  assert.equal(result.state, 'SCHEDULER_SUBSTRATE_PRESENT_DISABLED_INGESTION_UNBOUND');
  assert.equal(result.schedulerSubstratePresent, true);
  assert.equal(result.scheduledRuntimeProven, false);
  assert.equal(result.recurringIngestionProven, false);
  assert.equal(result.recurringProofAuthority, 'aiexe.recurring-scheduled-provider-evidence.v1');
  assert.equal(result.readOnly, true);
  assert.equal(result.writeAuthority, 'none');
  assert.equal(result.schedulerMutationPerformed, false);
  assert.equal(result.externalProjectMutationPerformed, false);
});

test('M2.9 enabled scheduler alone cannot be promoted when provider ingestion is unbound', () => {
  const result = buildProviderSchedulerReadiness({
    schedulerObserved: true,
    schedulerEnabled: true,
    hourlyCadenceObserved: true,
    providerIngestionBindingObserved: false,
    immutableReceiptPersistenceObserved: false,
    successfulScheduledRunObserved: false,
    lastRunObservedAt: null,
  });
  assert.equal(result.state, 'SCHEDULER_ENABLED_INGESTION_UNBOUND');
  assert.equal(result.scheduledRuntimeProven, false);
  assert.equal(result.recurringIngestionProven, false);
});

test('M2.10 one successful scheduled provider run proves scheduled runtime but not recurrence', () => {
  const partial = buildProviderSchedulerReadiness({
    schedulerObserved: true,
    schedulerEnabled: true,
    hourlyCadenceObserved: true,
    providerIngestionBindingObserved: true,
    immutableReceiptPersistenceObserved: true,
    successfulScheduledRunObserved: false,
    lastRunObservedAt: null,
  });
  assert.equal(partial.state, 'SCHEDULER_BOUND_AWAITING_SUCCESSFUL_RUN');
  assert.equal(partial.scheduledRuntimeProven, false);
  assert.equal(partial.recurringIngestionProven, false);

  const oneRun = buildProviderSchedulerReadiness({
    schedulerObserved: true,
    schedulerEnabled: true,
    hourlyCadenceObserved: true,
    providerIngestionBindingObserved: true,
    immutableReceiptPersistenceObserved: true,
    successfulScheduledRunObserved: true,
    lastRunObservedAt: '2026-08-10T00:48:00Z',
  });
  assert.equal(oneRun.state, 'SUCCESSFUL_SCHEDULED_PROVIDER_RUN_OBSERVED');
  assert.equal(oneRun.scheduledRuntimeProven, true);
  assert.equal(oneRun.recurringIngestionProven, false);
  assert.equal(oneRun.recurringProofAuthority, 'aiexe.recurring-scheduled-provider-evidence.v1');
});

test('M2.10 readiness rejects spoofed proof fields and inconsistent scheduler evidence', () => {
  assert.throws(() => buildProviderSchedulerReadiness({
    schedulerObserved: true,
    schedulerEnabled: false,
    hourlyCadenceObserved: true,
    providerIngestionBindingObserved: false,
    immutableReceiptPersistenceObserved: false,
    successfulScheduledRunObserved: false,
    lastRunObservedAt: null,
    scheduledRuntimeProven: true,
  }), /unsupported field: scheduledRuntimeProven/);

  assert.throws(() => buildProviderSchedulerReadiness({
    schedulerObserved: true,
    schedulerEnabled: true,
    hourlyCadenceObserved: true,
    providerIngestionBindingObserved: false,
    immutableReceiptPersistenceObserved: false,
    successfulScheduledRunObserved: true,
    lastRunObservedAt: null,
  }), /requires provider ingestion binding/);

  assert.throws(() => buildProviderSchedulerReadiness({
    schedulerObserved: true,
    schedulerEnabled: true,
    hourlyCadenceObserved: true,
    providerIngestionBindingObserved: true,
    immutableReceiptPersistenceObserved: false,
    successfulScheduledRunObserved: true,
    lastRunObservedAt: null,
  }), /requires immutable receipt persistence/);
});
