'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAgentSelectionObservationReceipt } = require('../src/discovery/agent-selection-observation-receipt.cjs');

function evaluation(overrides = {}) {
  return {
    schema: 'ado.selection.evaluation.v1',
    total_cases: 53,
    observed_cases: 53,
    complete: true,
    thresholds: {
      minimum_positive_selection_rate: 0.9,
      maximum_negative_false_selection_rate: 0.05,
    },
    metrics: {
      overall_accuracy: 1,
      positive_selection_rate: 1,
      negative_false_selection_rate: 0,
      ambiguous_disambiguation_rate: 1,
      price_quote_routing_rate: 1,
      safety_boundary_rate: 1,
    },
    missing_observation_ids: [],
    acceptance: 'PASS',
    model_invocation_performed: false,
    network_performed: false,
    publication_performed: false,
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    capabilityId: 'trade.verify_supplier.v1',
    capabilityVersion: '1.0.0',
    offerDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    evalFixtureDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    surface: 'chatgpt_app',
    hostName: 'ChatGPT',
    hostVersion: 'observed-build-ref',
    modelName: 'observed-model-ref',
    observedAt: '2026-08-12T00:40:00Z',
    observationCount: 53,
    evaluation: evaluation(),
    ...overrides,
  };
}

test('binds exact capability, offer, eval fixture and host surface into deterministic receipt', () => {
  const a = createAgentSelectionObservationReceipt(input());
  const b = createAgentSelectionObservationReceipt(input());
  assert.equal(a.receiptDigest, b.receiptDigest);
  assert.equal(a.surface, 'chatgpt_app');
  assert.equal(a.capabilityRef.capabilityId, 'trade.verify_supplier.v1');
  assert.equal(a.observationCount, 53);
  assert.deepEqual(a.authority, {
    rankingClaimCreated: false,
    registryPublicationPerformed: false,
    appPublicationPerformed: false,
    paymentPerformed: false,
    domainWritePerformed: false,
    executionAuthorized: false,
  });
});

test('host or model drift changes receipt identity', () => {
  const a = createAgentSelectionObservationReceipt(input());
  const b = createAgentSelectionObservationReceipt(input({ modelName: 'different-model-ref' }));
  assert.notEqual(a.receiptDigest, b.receiptDigest);
});

test('rejects unsupported surface and observation-count mismatch', () => {
  assert.throws(() => createAgentSelectionObservationReceipt(input({ surface: 'unknown_host' })), /Unsupported observation surface/);
  assert.throws(() => createAgentSelectionObservationReceipt(input({ observationCount: 52 })), /observationCount must equal/);
});

test('rejects evaluation that claims model/network/publication effects', () => {
  assert.throws(() => createAgentSelectionObservationReceipt(input({ evaluation: evaluation({ model_invocation_performed: true }) })), /offline-derived/);
  assert.throws(() => createAgentSelectionObservationReceipt(input({ evaluation: evaluation({ network_performed: true }) })), /offline-derived/);
  assert.throws(() => createAgentSelectionObservationReceipt(input({ evaluation: evaluation({ publication_performed: true }) })), /offline-derived/);
});
