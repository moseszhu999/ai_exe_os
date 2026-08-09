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

test('M2.9 scheduled provider ingestion is proven only after binding, immutable receipt persistence and a successful scheduled run', () => {
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

  const proven = buildProviderSchedulerReadiness({
    schedulerObserved: true,
    schedulerEnabled: true,
    hourlyCadenceObserved: true,
    providerIngestionBindingObserved: true,
    immutableReceiptPersistenceObserved: true,
    successfulScheduledRunObserved: true,
    lastRunObservedAt: '2026-08-10T00:00:00Z',
  });
  assert.equal(proven.state, 'SCHEDULED_PROVIDER_INGESTION_PROVEN');
  assert.equal(proven.scheduledRuntimeProven, true);
  assert.equal(proven.recurringIngestionProven, true);
});

test('M2.9 readiness rejects spoofed proof fields and inconsistent scheduler evidence', () => {
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
});
