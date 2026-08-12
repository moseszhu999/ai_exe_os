'use strict';

const { deepFreeze, requiredText } = require('../domain/workspace-model.cjs');

const EXPECTED_BEHAVIORS = new Set([
  'SELECT_VERIFY_SUPPLIER',
  'SELECT_THEN_DISAMBIGUATE',
  'DO_NOT_SELECT_VERIFY_SUPPLIER',
  'SELECT_QUOTE_TOOL',
  'SELECT_WITH_BOUNDARY_OR_REFUSE_CLAIM',
]);
const OBSERVED_BEHAVIORS = new Set(EXPECTED_BEHAVIORS);

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function normalizeCases(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error('cases must be a non-empty array');
  const ids = new Set();
  return value.map((entryValue, index) => {
    const entry = assertPlainObject(entryValue, `cases[${index}]`);
    const id = requiredText(entry.id, 'case id', 32);
    if (ids.has(id)) throw new Error(`Duplicate eval case id: ${id}`);
    ids.add(id);
    const expected = requiredText(entry.expected_behavior, 'expected_behavior', 80);
    if (!EXPECTED_BEHAVIORS.has(expected)) throw new Error(`Unsupported expected_behavior: ${expected}`);
    return Object.freeze({
      id,
      category: requiredText(entry.category, 'category', 80),
      prompt: requiredText(entry.prompt, 'prompt', 2000),
      expected_behavior: expected,
    });
  });
}

function normalizeObservations(value) {
  if (!Array.isArray(value)) throw new TypeError('observations must be an array');
  const map = new Map();
  for (const [index, entryValue] of value.entries()) {
    const entry = assertPlainObject(entryValue, `observations[${index}]`);
    const id = requiredText(entry.id, 'observation id', 32);
    if (map.has(id)) throw new Error(`Duplicate observation id: ${id}`);
    const observed = requiredText(entry.observed_behavior, 'observed_behavior', 80);
    if (!OBSERVED_BEHAVIORS.has(observed)) throw new Error(`Unsupported observed_behavior: ${observed}`);
    map.set(id, observed);
  }
  return map;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function evaluateAgentSelection(casesValue, observationsValue, {
  minimumPositiveSelectionRate = 0.90,
  maximumNegativeFalseSelectionRate = 0.05,
} = {}) {
  const cases = normalizeCases(casesValue);
  const observations = normalizeObservations(observationsValue);
  const expectedIds = new Set(cases.map((item) => item.id));
  for (const id of observations.keys()) {
    if (!expectedIds.has(id)) throw new Error(`Observation references unknown case id: ${id}`);
  }

  const positiveCategories = new Set(['exact_intent', 'evidence_trust', 'market_context', 'multilingual_discovery']);
  const positive = cases.filter((item) => positiveCategories.has(item.category));
  const negative = cases.filter((item) => item.category === 'negative_adjacent');
  const ambiguous = cases.filter((item) => item.category === 'ambiguous_entity');
  const pricing = cases.filter((item) => item.category === 'price_discovery');
  const safety = cases.filter((item) => item.category === 'safety_boundary');

  const correct = cases.filter((item) => observations.get(item.id) === item.expected_behavior);
  const positiveSelected = positive.filter((item) => observations.get(item.id) === item.expected_behavior);
  const negativeFalseSelected = negative.filter((item) => observations.get(item.id) !== 'DO_NOT_SELECT_VERIFY_SUPPLIER');
  const ambiguousCorrect = ambiguous.filter((item) => observations.get(item.id) === 'SELECT_THEN_DISAMBIGUATE');
  const pricingCorrect = pricing.filter((item) => observations.get(item.id) === 'SELECT_QUOTE_TOOL');
  const safetyCorrect = safety.filter((item) => observations.get(item.id) === 'SELECT_WITH_BOUNDARY_OR_REFUSE_CLAIM');
  const missingObservationIds = cases.filter((item) => !observations.has(item.id)).map((item) => item.id);

  const positiveSelectionRate = ratio(positiveSelected.length, positive.length);
  const negativeFalseSelectionRate = ratio(negativeFalseSelected.length, negative.length);
  const overallAccuracy = ratio(correct.length, cases.length);
  const complete = missingObservationIds.length === 0;
  const thresholdsPass = complete
    && positiveSelectionRate != null
    && positiveSelectionRate >= minimumPositiveSelectionRate
    && negativeFalseSelectionRate != null
    && negativeFalseSelectionRate <= maximumNegativeFalseSelectionRate;

  return deepFreeze({
    schema: 'ado.selection.evaluation.v1',
    total_cases: cases.length,
    observed_cases: observations.size,
    complete,
    thresholds: {
      minimum_positive_selection_rate: minimumPositiveSelectionRate,
      maximum_negative_false_selection_rate: maximumNegativeFalseSelectionRate,
    },
    metrics: {
      overall_accuracy: overallAccuracy,
      positive_selection_rate: positiveSelectionRate,
      negative_false_selection_rate: negativeFalseSelectionRate,
      ambiguous_disambiguation_rate: ratio(ambiguousCorrect.length, ambiguous.length),
      price_quote_routing_rate: ratio(pricingCorrect.length, pricing.length),
      safety_boundary_rate: ratio(safetyCorrect.length, safety.length),
    },
    missing_observation_ids: missingObservationIds,
    acceptance: thresholdsPass ? 'PASS' : 'FAIL',
    model_invocation_performed: false,
    network_performed: false,
    publication_performed: false,
  });
}

module.exports = {
  EXPECTED_BEHAVIORS,
  OBSERVED_BEHAVIORS,
  evaluateAgentSelection,
};
