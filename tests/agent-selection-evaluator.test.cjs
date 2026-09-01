'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const { evaluateAgentSelection } = require('../src/discovery/agent-selection-evaluator.cjs');

function loadFixture() {
  return JSON.parse(readFileSync(join(
    __dirname,
    'fixtures',
    'trade.verify_supplier.selection-eval.v1.json',
  ), 'utf8'));
}

test('selection fixture contains the frozen 53-case ADO set', () => {
  const fixture = loadFixture();
  assert.equal(fixture.schema, 'ado.selection.eval.fixture.v1');
  assert.equal(fixture.resource_id, 'trade.verify_supplier.v1');
  assert.equal(fixture.cases.length, 53);
  assert.equal(new Set(fixture.cases.map((item) => item.id)).size, 53);
});

test('perfect observations pass all discovery acceptance metrics', () => {
  const { cases } = loadFixture();
  const observations = cases.map((item) => ({
    id: item.id,
    observed_behavior: item.expected_behavior,
  }));
  const result = evaluateAgentSelection(cases, observations);
  assert.equal(result.complete, true);
  assert.equal(result.total_cases, 53);
  assert.equal(result.metrics.overall_accuracy, 1);
  assert.equal(result.metrics.positive_selection_rate, 1);
  assert.equal(result.metrics.negative_false_selection_rate, 0);
  assert.equal(result.metrics.ambiguous_disambiguation_rate, 1);
  assert.equal(result.metrics.price_quote_routing_rate, 1);
  assert.equal(result.metrics.safety_boundary_rate, 1);
  assert.equal(result.acceptance, 'PASS');
  assert.equal(result.model_invocation_performed, false);
  assert.equal(result.network_performed, false);
  assert.equal(result.publication_performed, false);
});

test('positive under-selection and negative false selection fail thresholds', () => {
  const { cases } = loadFixture();
  const observations = cases.map((item) => ({
    id: item.id,
    observed_behavior: item.expected_behavior,
  }));
  for (const item of observations.filter((entry) => /^E0[1-4]$/.test(entry.id))) {
    item.observed_behavior = 'DO_NOT_SELECT_VERIFY_SUPPLIER';
  }
  observations.find((item) => item.id === 'N01').observed_behavior = 'SELECT_VERIFY_SUPPLIER';
  const result = evaluateAgentSelection(cases, observations);
  assert.ok(result.metrics.positive_selection_rate < 0.90);
  assert.ok(result.metrics.negative_false_selection_rate > 0.05);
  assert.equal(result.acceptance, 'FAIL');
});

test('missing observations cannot pass acceptance', () => {
  const { cases } = loadFixture();
  const result = evaluateAgentSelection(cases, [{
    id: cases[0].id,
    observed_behavior: cases[0].expected_behavior,
  }]);
  assert.equal(result.complete, false);
  assert.equal(result.acceptance, 'FAIL');
  assert.equal(result.missing_observation_ids.length, 52);
});

test('observations cannot smuggle unknown case ids or behaviors', () => {
  const { cases } = loadFixture();
  assert.throws(
    () => evaluateAgentSelection(cases, [{ id: 'UNKNOWN', observed_behavior: 'SELECT_VERIFY_SUPPLIER' }]),
    /unknown case id/,
  );
  assert.throws(
    () => evaluateAgentSelection(cases, [{ id: cases[0].id, observed_behavior: 'AUTO_PAY_AND_ORDER' }]),
    /Unsupported observed_behavior/,
  );
});
