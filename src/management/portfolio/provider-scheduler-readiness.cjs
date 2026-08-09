'use strict';

const PROVIDER_SCHEDULER_READINESS_SCHEMA = 'aiexe.provider-scheduler-readiness.v1';

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a plain object`);
  return value;
}

function bool(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  return value;
}

function optionalText(value, label, maxLength = 160) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const text = value.trim();
  if (!text) throw new TypeError(`${label} must not be empty`);
  if (text.length > maxLength) throw new TypeError(`${label} is too long`);
  return text;
}

function buildProviderSchedulerReadiness(input) {
  plainObject(input, 'provider scheduler readiness input');
  const allowed = new Set([
    'schedulerObserved',
    'schedulerEnabled',
    'hourlyCadenceObserved',
    'providerIngestionBindingObserved',
    'immutableReceiptPersistenceObserved',
    'successfulScheduledRunObserved',
    'lastRunObservedAt',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`provider scheduler readiness input contains unsupported field: ${key}`);
  }

  const schedulerObserved = bool(input.schedulerObserved, 'schedulerObserved');
  const schedulerEnabled = bool(input.schedulerEnabled, 'schedulerEnabled');
  const hourlyCadenceObserved = bool(input.hourlyCadenceObserved, 'hourlyCadenceObserved');
  const providerIngestionBindingObserved = bool(input.providerIngestionBindingObserved, 'providerIngestionBindingObserved');
  const immutableReceiptPersistenceObserved = bool(input.immutableReceiptPersistenceObserved, 'immutableReceiptPersistenceObserved');
  const successfulScheduledRunObserved = bool(input.successfulScheduledRunObserved, 'successfulScheduledRunObserved');
  const lastRunObservedAt = optionalText(input.lastRunObservedAt, 'lastRunObservedAt', 80);

  if (!schedulerObserved && (schedulerEnabled || hourlyCadenceObserved || providerIngestionBindingObserved || immutableReceiptPersistenceObserved || successfulScheduledRunObserved || lastRunObservedAt)) {
    throw new Error('unobserved scheduler cannot carry scheduler facts');
  }
  if (successfulScheduledRunObserved && !providerIngestionBindingObserved) {
    throw new Error('scheduled provider run evidence requires provider ingestion binding');
  }
  if (immutableReceiptPersistenceObserved && !providerIngestionBindingObserved) {
    throw new Error('provider ingestion receipts require provider ingestion binding');
  }

  let state = 'NO_SCHEDULER_OBSERVED';
  if (schedulerObserved && !schedulerEnabled) state = providerIngestionBindingObserved
    ? 'SCHEDULER_DISABLED_PROVIDER_INGESTION_BOUND'
    : 'SCHEDULER_SUBSTRATE_PRESENT_DISABLED_INGESTION_UNBOUND';
  else if (schedulerObserved && schedulerEnabled && !providerIngestionBindingObserved) state = 'SCHEDULER_ENABLED_INGESTION_UNBOUND';
  else if (schedulerObserved && schedulerEnabled && providerIngestionBindingObserved && !immutableReceiptPersistenceObserved) state = 'SCHEDULER_BOUND_RECEIPT_PERSISTENCE_UNPROVEN';
  else if (schedulerObserved && schedulerEnabled && providerIngestionBindingObserved && immutableReceiptPersistenceObserved && !successfulScheduledRunObserved) state = 'SCHEDULER_BOUND_AWAITING_SUCCESSFUL_RUN';
  else if (schedulerObserved && schedulerEnabled && providerIngestionBindingObserved && immutableReceiptPersistenceObserved && successfulScheduledRunObserved) state = 'SCHEDULED_PROVIDER_INGESTION_PROVEN';

  const scheduledRuntimeProven = state === 'SCHEDULED_PROVIDER_INGESTION_PROVEN';

  return freezeDeep({
    schema: PROVIDER_SCHEDULER_READINESS_SCHEMA,
    evidenceClass: 'READ_ONLY_SCHEDULER_READINESS',
    state,
    schedulerObserved,
    schedulerEnabled,
    hourlyCadenceObserved,
    providerIngestionBindingObserved,
    immutableReceiptPersistenceObserved,
    successfulScheduledRunObserved,
    lastRunObservedAt,
    schedulerSubstratePresent: schedulerObserved,
    scheduledRuntimeProven,
    recurringIngestionProven: scheduledRuntimeProven,
    readOnly: true,
    writeAuthority: 'none',
    schedulerMutationPerformed: false,
    externalProjectMutationPerformed: false,
  });
}

module.exports = {
  PROVIDER_SCHEDULER_READINESS_SCHEMA,
  buildProviderSchedulerReadiness,
};
