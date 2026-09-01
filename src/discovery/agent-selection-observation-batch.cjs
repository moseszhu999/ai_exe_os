'use strict';

const { createHash } = require('node:crypto');
const { deepFreeze, requiredText } = require('../domain/workspace-model.cjs');
const { OBSERVED_BEHAVIORS, evaluateAgentSelection } = require('./agent-selection-evaluator.cjs');
const { createAgentSelectionObservationReceipt, SHA256_PATTERN } = require('./agent-selection-observation-receipt.cjs');

const BATCH_SCHEMA = 'ado.selection.observation.batch.v1';
const FIXTURE_SCHEMA = 'ado.selection.eval.fixture.v1';

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}

function normalizeFixture(value, capabilityId) {
  const input = assertPlainObject(value, 'fixture');
  if (input.schema !== FIXTURE_SCHEMA) throw new Error(`fixture schema must be ${FIXTURE_SCHEMA}`);
  const resourceId = requiredText(input.resource_id, 'fixture resource_id', 160);
  if (resourceId !== capabilityId) throw new Error('fixture resource_id must equal capabilityId');
  if (!Array.isArray(input.cases) || input.cases.length === 0) throw new Error('fixture.cases must be a non-empty array');

  const seen = new Set();
  const cases = input.cases.map((entryValue, index) => {
    const entry = assertPlainObject(entryValue, `fixture.cases[${index}]`);
    const id = requiredText(entry.id, 'case id', 32);
    if (seen.has(id)) throw new Error(`Duplicate fixture case id: ${id}`);
    seen.add(id);
    return Object.freeze({
      id,
      category: requiredText(entry.category, 'case category', 80),
      prompt: requiredText(entry.prompt, 'case prompt', 2000),
      expected_behavior: requiredText(entry.expected_behavior, 'expected_behavior', 80),
    });
  });

  return deepFreeze({ schema: FIXTURE_SCHEMA, resource_id: resourceId, cases });
}

function normalizeObservationSet(value, cases) {
  if (!Array.isArray(value)) throw new TypeError('observations must be an array');
  const expectedIds = new Set(cases.map((item) => item.id));
  const byId = new Map();
  const refs = new Set();

  value.forEach((entryValue, index) => {
    const entry = assertPlainObject(entryValue, `observations[${index}]`);
    const id = requiredText(entry.id, 'observation id', 32);
    if (!expectedIds.has(id)) throw new Error(`Observation references unknown case id: ${id}`);
    if (byId.has(id)) throw new Error(`Duplicate observation id: ${id}`);

    const observedBehavior = requiredText(entry.observed_behavior, 'observed_behavior', 80);
    if (!OBSERVED_BEHAVIORS.has(observedBehavior)) throw new Error(`Unsupported observed_behavior: ${observedBehavior}`);

    const observationRef = requiredText(entry.observation_ref, 'observation_ref', 240);
    if (refs.has(observationRef)) throw new Error(`Duplicate observation_ref: ${observationRef}`);
    refs.add(observationRef);

    const responseDigest = requiredText(entry.response_digest, 'response_digest', 160);
    if (!SHA256_PATTERN.test(responseDigest)) throw new Error('response_digest must be a sha256 digest');

    byId.set(id, Object.freeze({
      id,
      observed_behavior: observedBehavior,
      observation_ref: observationRef,
      response_digest: responseDigest,
    }));
  });

  const missing = cases.filter((item) => !byId.has(item.id)).map((item) => item.id);
  if (missing.length > 0) throw new Error(`Missing observations for case ids: ${missing.join(',')}`);
  if (byId.size !== cases.length) throw new Error('observations must cover every fixture case exactly once');

  return Object.freeze(cases.map((item) => byId.get(item.id)));
}

function createAgentSelectionObservationBatch({
  fixture,
  observations,
  capabilityId,
  capabilityVersion,
  offerDigest,
  surface,
  hostName,
  hostVersion,
  modelName,
  observedAt,
  thresholds,
}) {
  const normalizedCapabilityId = requiredText(capabilityId, 'capabilityId', 160);
  const normalizedFixture = normalizeFixture(fixture, normalizedCapabilityId);
  const normalizedObservations = normalizeObservationSet(observations, normalizedFixture.cases);
  const evalFixtureDigest = digest(normalizedFixture);
  const observationSetDigest = digest(normalizedObservations);
  const evaluation = evaluateAgentSelection(normalizedFixture.cases, normalizedObservations, thresholds);
  const receipt = createAgentSelectionObservationReceipt({
    capabilityId: normalizedCapabilityId,
    capabilityVersion,
    offerDigest,
    evalFixtureDigest,
    observationSetDigest,
    surface,
    hostName,
    hostVersion,
    modelName,
    observedAt,
    observationCount: normalizedObservations.length,
    evaluation,
  });

  const payload = {
    schema: BATCH_SCHEMA,
    fixtureRef: {
      schema: FIXTURE_SCHEMA,
      resourceId: normalizedFixture.resource_id,
      caseCount: normalizedFixture.cases.length,
      evalFixtureDigest,
    },
    observationSetDigest,
    observations: normalizedObservations,
    evaluation,
    receipt,
    collectionBoundary: {
      observationCollectionPerformedByThisModule: false,
      hostInvocationPerformedByThisModule: false,
      networkPerformedByThisModule: false,
      rawHostResponseStored: false,
      responseDigestBound: true,
    },
  };

  return deepFreeze({ ...payload, batchDigest: digest(payload) });
}

module.exports = {
  BATCH_SCHEMA,
  FIXTURE_SCHEMA,
  createAgentSelectionObservationBatch,
};
