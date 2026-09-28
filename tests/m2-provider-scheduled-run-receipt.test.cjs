'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRecurringScheduledProviderEvidence,
  createProviderScheduledRunReceipt,
} = require('../src/management/portfolio/provider-scheduled-run-receipt.cjs');

function success(overrides = {}) {
  return createProviderScheduledRunReceipt({
    schedulerRef: 'automation:AIEXE-hourly-controlled-progress',
    trigger: 'scheduled',
    scheduledFor: '2026-08-10T00:48:00Z',
    startedAt: '2026-08-10T00:48:05Z',
    completedAt: '2026-08-10T00:49:00Z',
    runOutcome: 'success',
    captureRef: 'github:moseszhu999/ai_exe_os:pr:125:comment:scheduled-receipt-1',
    captureDigest: `sha256:${'a'.repeat(64)}`,
    captureSchema: 'aiexe.live-github-observation-capture.v1',
    schedulerEnabled: true,
    providerIngestionBindingObserved: true,
    immutableReceiptPersistenceObserved: true,
    readOnly: true,
    writeAuthority: 'none',
    ...overrides,
  });
}

test('M2.10 a canonical successful scheduled provider receipt proves one scheduled run but not recurrence by itself', () => {
  const receipt = success();
  assert.equal(receipt.schema, 'aiexe.provider-scheduled-run-receipt.v1');
  assert.equal(receipt.state, 'SUCCESSFUL_SCHEDULED_PROVIDER_RUN_OBSERVED');
  assert.equal(receipt.successfulScheduledRunObserved, true);
  assert.equal(receipt.scheduledRuntimeProven, true);
  assert.equal(receipt.readOnly, true);
  assert.equal(receipt.writeAuthority, 'none');
  assert.equal(receipt.domainTruthInferred, false);

  const recurring = buildRecurringScheduledProviderEvidence({ receipts: [receipt] });
  assert.equal(recurring.successfulScheduledRunCount, 1);
  assert.equal(recurring.recurringIngestionProven, false);
  assert.equal(recurring.state, 'AWAITING_ADDITIONAL_SUCCESSFUL_SCHEDULED_RUNS');
});

test('M2.10 manual trigger and caller-supplied proof booleans fail closed', () => {
  assert.throws(() => success({ trigger: 'manual' }), /trigger=scheduled/);
  assert.throws(() => success({ scheduledRuntimeProven: true }), /unsupported field/);
  assert.throws(() => success({ recurringIngestionProven: true }), /unsupported field/);
});

test('M2.10 enabled scheduler alone cannot prove a scheduled run without binding and immutable persistence', () => {
  const unbound = success({ providerIngestionBindingObserved: false });
  assert.equal(unbound.state, 'PROVIDER_INGESTION_UNBOUND');
  assert.equal(unbound.successfulScheduledRunObserved, false);
  assert.equal(unbound.scheduledRuntimeProven, false);

  const unpersisted = success({ immutableReceiptPersistenceObserved: false });
  assert.equal(unpersisted.state, 'IMMUTABLE_RECEIPT_PERSISTENCE_UNPROVEN');
  assert.equal(unpersisted.successfulScheduledRunObserved, false);
});

test('M2.10 failed scheduled run is evidence but cannot claim a completed capture', () => {
  const failed = createProviderScheduledRunReceipt({
    schedulerRef: 'automation:AIEXE-hourly-controlled-progress',
    trigger: 'scheduled',
    scheduledFor: '2026-08-10T00:48:00Z',
    startedAt: '2026-08-10T00:48:05Z',
    completedAt: '2026-08-10T00:48:30Z',
    runOutcome: 'failed',
    failureCode: 'provider_read_incomplete',
    schedulerEnabled: true,
    providerIngestionBindingObserved: true,
    immutableReceiptPersistenceObserved: true,
    readOnly: true,
    writeAuthority: 'none',
  });
  assert.equal(failed.state, 'SCHEDULED_RUN_FAILED');
  assert.equal(failed.successfulScheduledRunObserved, false);
  assert.equal(failed.captureDigest, null);
  assert.throws(() => createProviderScheduledRunReceipt({
    ...failed,
    schema: undefined,
  }), /unsupported field/);
});

test('M2.10 two distinct spaced successful scheduled receipts prove recurrence deterministically', () => {
  const first = success();
  const second = success({
    scheduledFor: '2026-08-10T01:48:00Z',
    startedAt: '2026-08-10T01:48:04Z',
    completedAt: '2026-08-10T01:49:02Z',
    captureRef: 'github:moseszhu999/ai_exe_os:pr:125:comment:scheduled-receipt-2',
    captureDigest: `sha256:${'b'.repeat(64)}`,
  });
  const recurring = buildRecurringScheduledProviderEvidence({ receipts: [second, first], minimumSpacingSeconds: 60 });
  assert.equal(recurring.successfulScheduledRunCount, 2);
  assert.equal(recurring.recurringIngestionProven, true);
  assert.equal(recurring.state, 'RECURRING_SCHEDULED_PROVIDER_INGESTION_PROVEN');
});

test('M2.10 replayed capture digest and too-close scheduled successes are rejected', () => {
  const first = success();
  const duplicateDigest = success({
    scheduledFor: '2026-08-10T01:48:00Z',
    startedAt: '2026-08-10T01:48:05Z',
    completedAt: '2026-08-10T01:49:00Z',
    captureRef: 'github:moseszhu999/ai_exe_os:pr:125:comment:scheduled-receipt-2',
  });
  assert.throws(() => buildRecurringScheduledProviderEvidence({ receipts: [first, duplicateDigest] }), /unique capture digests/);

  const tooClose = success({
    scheduledFor: '2026-08-10T00:48:30Z',
    startedAt: '2026-08-10T00:48:31Z',
    completedAt: '2026-08-10T00:48:45Z',
    captureRef: 'github:moseszhu999/ai_exe_os:pr:125:comment:scheduled-receipt-3',
    captureDigest: `sha256:${'c'.repeat(64)}`,
  });
  assert.throws(() => buildRecurringScheduledProviderEvidence({ receipts: [first, tooClose], minimumSpacingSeconds: 60 }), /minimum spacing/);
});
