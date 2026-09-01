'use strict';

const { createHash } = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

const fixture = require('./fixtures/trade.verify_supplier.selection-eval.v1.json');
const { createAgentSelectionObservationBatch } = require('../src/discovery/agent-selection-observation-batch.cjs');

function sha(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function idealObservations() {
  return fixture.cases.map((item) => ({
    id: item.id,
    observed_behavior: item.expected_behavior,
    observation_ref: `capture:${item.id.toLowerCase()}:host-trace-v1`,
    response_digest: sha(`host-response:${item.id}:${item.expected_behavior}`),
  }));
}

function input(overrides = {}) {
  return {
    fixture,
    observations: idealObservations(),
    capabilityId: 'trade.verify_supplier.v1',
    capabilityVersion: '1.0.0',
    offerDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    surface: 'chatgpt_app',
    hostName: 'ChatGPT',
    hostVersion: 'observed-build-ref',
    modelName: 'observed-model-ref',
    observedAt: '2026-08-12T01:00:00Z',
    ...overrides,
  };
}

test('builds a deterministic 53-case batch whose receipt binds the exact observation set', () => {
  const a = createAgentSelectionObservationBatch(input());
  const b = createAgentSelectionObservationBatch(input());

  assert.equal(a.batchDigest, b.batchDigest);
  assert.equal(a.fixtureRef.caseCount, 53);
  assert.equal(a.observations.length, 53);
  assert.equal(a.evaluation.acceptance, 'PASS');
  assert.equal(a.evaluation.metrics.positive_selection_rate, 1);
  assert.equal(a.evaluation.metrics.negative_false_selection_rate, 0);
  assert.equal(a.receipt.observationEvidence.observationSetDigest, a.observationSetDigest);
  assert.equal(a.receipt.capabilityRef.evalFixtureDigest, a.fixtureRef.evalFixtureDigest);
  assert.deepEqual(a.collectionBoundary, {
    observationCollectionPerformedByThisModule: false,
    hostInvocationPerformedByThisModule: false,
    networkPerformedByThisModule: false,
    rawHostResponseStored: false,
    responseDigestBound: true,
  });
});

test('one observed-behavior drift changes observation, receipt and batch identity and can fail acceptance', () => {
  const original = createAgentSelectionObservationBatch(input());
  const changed = idealObservations();
  const index = changed.findIndex((item) => item.id === 'N01');
  changed[index] = {
    ...changed[index],
    observed_behavior: 'SELECT_VERIFY_SUPPLIER',
    response_digest: sha('host-response:N01:SELECT_VERIFY_SUPPLIER'),
  };

  const drifted = createAgentSelectionObservationBatch(input({ observations: changed }));
  assert.notEqual(original.observationSetDigest, drifted.observationSetDigest);
  assert.notEqual(original.receipt.receiptDigest, drifted.receipt.receiptDigest);
  assert.notEqual(original.batchDigest, drifted.batchDigest);
  assert.equal(drifted.evaluation.metrics.negative_false_selection_rate, 0.1);
  assert.equal(drifted.evaluation.acceptance, 'FAIL');
});

test('fails closed on missing, duplicate or unknown observations', () => {
  const missing = idealObservations().slice(0, -1);
  assert.throws(() => createAgentSelectionObservationBatch(input({ observations: missing })), /Missing observations/);

  const duplicate = idealObservations();
  duplicate[1] = { ...duplicate[1], id: duplicate[0].id };
  assert.throws(() => createAgentSelectionObservationBatch(input({ observations: duplicate })), /Duplicate observation id/);

  const unknown = idealObservations();
  unknown[0] = { ...unknown[0], id: 'UNKNOWN' };
  assert.throws(() => createAgentSelectionObservationBatch(input({ observations: unknown })), /unknown case id/);
});

test('requires evidence references and response digests but never stores raw host output', () => {
  const malformed = idealObservations();
  malformed[0] = { ...malformed[0], response_digest: 'raw-host-output' };
  assert.throws(() => createAgentSelectionObservationBatch(input({ observations: malformed })), /sha256 digest/);

  const duplicateRef = idealObservations();
  duplicateRef[1] = { ...duplicateRef[1], observation_ref: duplicateRef[0].observation_ref };
  assert.throws(() => createAgentSelectionObservationBatch(input({ observations: duplicateRef })), /Duplicate observation_ref/);
});

test('binds fixture resource identity to the capability under evaluation', () => {
  assert.throws(() => createAgentSelectionObservationBatch(input({ capabilityId: 'trade.other.v1' })), /resource_id must equal capabilityId/);
});
