'use strict';

const PROVIDER_SCHEDULED_RUN_RECEIPT_SCHEMA = 'aiexe.provider-scheduled-run-receipt.v1';
const RECURRING_SCHEDULED_PROVIDER_EVIDENCE_SCHEMA = 'aiexe.recurring-scheduled-provider-evidence.v1';

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a plain object`);
  return value;
}

function requiredText(value, label, maxLength = 400) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const text = value.trim();
  if (!text) throw new TypeError(`${label} must not be empty`);
  if (text.length > maxLength) throw new TypeError(`${label} is too long`);
  return text;
}

function instant(value, label) {
  const text = requiredText(value, label, 80);
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new TypeError(`${label} must be an ISO timestamp`);
  return { text, ms };
}

function exactBoolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  return value;
}

function exactDigest(value, label) {
  const text = requiredText(value, label, 80).toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/.test(text)) throw new TypeError(`${label} must be sha256:<64 hex chars>`);
  return text;
}

function createProviderScheduledRunReceipt(input) {
  plainObject(input, 'scheduled provider run receipt');
  const allowed = new Set([
    'schedulerRef', 'trigger', 'scheduledFor', 'startedAt', 'completedAt', 'runOutcome',
    'captureRef', 'captureDigest', 'captureSchema', 'failureCode',
    'schedulerEnabled', 'providerIngestionBindingObserved', 'immutableReceiptPersistenceObserved',
    'readOnly', 'writeAuthority',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`scheduled provider run receipt contains unsupported field: ${key}`);
  }

  const schedulerRef = requiredText(input.schedulerRef, 'scheduler ref', 200);
  if (input.trigger !== 'scheduled') throw new Error('provider scheduled run receipt requires trigger=scheduled');
  const scheduledFor = instant(input.scheduledFor, 'scheduled for');
  const startedAt = instant(input.startedAt, 'started at');
  const completedAt = instant(input.completedAt, 'completed at');
  if (startedAt.ms < scheduledFor.ms) throw new Error('scheduled provider run cannot start before scheduledFor');
  if (completedAt.ms < startedAt.ms) throw new Error('scheduled provider run cannot complete before it starts');

  const runOutcome = requiredText(input.runOutcome, 'run outcome', 40);
  if (!['success', 'failed'].includes(runOutcome)) throw new TypeError('run outcome must be success or failed');
  const schedulerEnabled = exactBoolean(input.schedulerEnabled, 'schedulerEnabled');
  const providerIngestionBindingObserved = exactBoolean(input.providerIngestionBindingObserved, 'providerIngestionBindingObserved');
  const immutableReceiptPersistenceObserved = exactBoolean(input.immutableReceiptPersistenceObserved, 'immutableReceiptPersistenceObserved');
  if (input.readOnly !== true) throw new Error('scheduled provider run receipt must be read-only');
  if (input.writeAuthority !== 'none') throw new Error('scheduled provider run receipt cannot carry write authority');

  let captureRef = null;
  let captureDigest = null;
  let captureSchema = null;
  let failureCode = null;
  if (runOutcome === 'success') {
    captureRef = requiredText(input.captureRef, 'capture ref', 500);
    captureDigest = exactDigest(input.captureDigest, 'capture digest');
    captureSchema = requiredText(input.captureSchema, 'capture schema', 160);
    if (captureSchema !== 'aiexe.live-github-observation-capture.v1') {
      throw new Error('successful scheduled provider run requires canonical live GitHub capture schema');
    }
    if (input.failureCode != null) throw new Error('successful scheduled provider run cannot carry a failure code');
  } else {
    failureCode = requiredText(input.failureCode, 'failure code', 160);
    if (input.captureRef != null || input.captureDigest != null || input.captureSchema != null) {
      throw new Error('failed scheduled provider run cannot claim a completed provider capture');
    }
  }

  let state = 'SCHEDULED_RUN_FAILED';
  if (!schedulerEnabled) state = 'SCHEDULER_DISABLED';
  else if (!providerIngestionBindingObserved) state = 'PROVIDER_INGESTION_UNBOUND';
  else if (!immutableReceiptPersistenceObserved) state = 'IMMUTABLE_RECEIPT_PERSISTENCE_UNPROVEN';
  else if (runOutcome === 'success') state = 'SUCCESSFUL_SCHEDULED_PROVIDER_RUN_OBSERVED';

  return freezeDeep({
    schema: PROVIDER_SCHEDULED_RUN_RECEIPT_SCHEMA,
    evidenceClass: 'SCHEDULED_PROVIDER_RUN_EVIDENCE',
    schedulerRef,
    trigger: 'scheduled',
    scheduledFor: scheduledFor.text,
    startedAt: startedAt.text,
    completedAt: completedAt.text,
    runOutcome,
    state,
    captureRef,
    captureDigest,
    captureSchema,
    failureCode,
    schedulerEnabled,
    providerIngestionBindingObserved,
    immutableReceiptPersistenceObserved,
    successfulScheduledRunObserved: state === 'SUCCESSFUL_SCHEDULED_PROVIDER_RUN_OBSERVED',
    scheduledRuntimeProven: state === 'SUCCESSFUL_SCHEDULED_PROVIDER_RUN_OBSERVED',
    readOnly: true,
    writeAuthority: 'none',
    domainTruthInferred: false,
  });
}

function buildRecurringScheduledProviderEvidence(input) {
  plainObject(input, 'recurring scheduled provider evidence');
  const allowed = new Set(['receipts', 'minimumSuccessfulRuns', 'minimumSpacingSeconds']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`recurring scheduled provider evidence contains unsupported field: ${key}`);
  }
  if (!Array.isArray(input.receipts) || input.receipts.length < 1) throw new TypeError('scheduled provider receipts must be a non-empty array');
  const minimumSuccessfulRuns = input.minimumSuccessfulRuns == null ? 2 : input.minimumSuccessfulRuns;
  const minimumSpacingSeconds = input.minimumSpacingSeconds == null ? 60 : input.minimumSpacingSeconds;
  if (!Number.isInteger(minimumSuccessfulRuns) || minimumSuccessfulRuns < 2) throw new TypeError('minimumSuccessfulRuns must be an integer >= 2');
  if (!Number.isFinite(minimumSpacingSeconds) || minimumSpacingSeconds < 1) throw new TypeError('minimumSpacingSeconds must be positive');

  const receipts = input.receipts.map((receipt) => {
    if (receipt?.schema !== PROVIDER_SCHEDULED_RUN_RECEIPT_SCHEMA) throw new Error('canonical scheduled provider run receipt required');
    return receipt;
  }).sort((left, right) => Date.parse(left.scheduledFor) - Date.parse(right.scheduledFor));

  const successful = receipts.filter((receipt) => receipt.successfulScheduledRunObserved === true);
  const captureDigests = successful.map((receipt) => receipt.captureDigest);
  if (new Set(captureDigests).size !== captureDigests.length) throw new Error('successful scheduled provider runs must have unique capture digests');
  for (let index = 1; index < successful.length; index += 1) {
    if (Date.parse(successful[index].scheduledFor) - Date.parse(successful[index - 1].scheduledFor) < minimumSpacingSeconds * 1000) {
      throw new Error('successful scheduled provider runs do not satisfy minimum spacing');
    }
  }

  const recurringIngestionProven = successful.length >= minimumSuccessfulRuns;
  return freezeDeep({
    schema: RECURRING_SCHEDULED_PROVIDER_EVIDENCE_SCHEMA,
    evidenceClass: 'RECURRING_SCHEDULED_PROVIDER_EVIDENCE',
    receiptCount: receipts.length,
    successfulScheduledRunCount: successful.length,
    minimumSuccessfulRuns,
    recurringIngestionProven,
    state: recurringIngestionProven
      ? 'RECURRING_SCHEDULED_PROVIDER_INGESTION_PROVEN'
      : 'AWAITING_ADDITIONAL_SUCCESSFUL_SCHEDULED_RUNS',
    readOnly: true,
    writeAuthority: 'none',
    domainTruthInferred: false,
  });
}

module.exports = {
  PROVIDER_SCHEDULED_RUN_RECEIPT_SCHEMA,
  RECURRING_SCHEDULED_PROVIDER_EVIDENCE_SCHEMA,
  buildRecurringScheduledProviderEvidence,
  createProviderScheduledRunReceipt,
};
