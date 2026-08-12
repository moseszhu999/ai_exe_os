'use strict';

const { createHash } = require('node:crypto');
const { deepFreeze, requiredText } = require('../domain/workspace-model.cjs');
const { OBSERVED_BEHAVIORS } = require('./agent-selection-evaluator.cjs');

const COLLECTION_SCHEMA = 'ado.selection.host-observation.collection.v1';
const FIXTURE_SCHEMA = 'ado.selection.eval.fixture.v1';
const MAX_RESPONSE_BYTES = 256 * 1024;

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

function digestResponse(responseText) {
  return `sha256:${createHash('sha256').update(responseText, 'utf8').digest('hex')}`;
}

function normalizeFixture(value) {
  const input = assertPlainObject(value, 'fixture');
  if (input.schema !== FIXTURE_SCHEMA) throw new Error(`fixture schema must be ${FIXTURE_SCHEMA}`);
  const resourceId = requiredText(input.resource_id, 'fixture resource_id', 160);
  if (!Array.isArray(input.cases) || input.cases.length === 0) throw new Error('fixture.cases must be a non-empty array');

  const ids = new Set();
  const cases = input.cases.map((entryValue, index) => {
    const entry = assertPlainObject(entryValue, `fixture.cases[${index}]`);
    const id = requiredText(entry.id, 'case id', 32);
    if (ids.has(id)) throw new Error(`Duplicate fixture case id: ${id}`);
    ids.add(id);
    return Object.freeze({
      id,
      category: requiredText(entry.category, 'case category', 80),
      prompt: requiredText(entry.prompt, 'case prompt', 2000),
    });
  });

  return deepFreeze({ schema: FIXTURE_SCHEMA, resource_id: resourceId, cases });
}

function normalizeCapture(value, caseId) {
  const capture = assertPlainObject(value, `capture for ${caseId}`);
  const allowed = new Set(['observation_ref', 'response_text']);
  for (const key of Object.keys(capture)) {
    if (!allowed.has(key)) throw new Error(`Unsupported capture field for ${caseId}: ${key}`);
  }

  const observationRef = requiredText(capture.observation_ref, 'observation_ref', 240);
  if (typeof capture.response_text !== 'string' || capture.response_text.length === 0) {
    throw new Error(`response_text for ${caseId} must be a non-empty string`);
  }
  if (Buffer.byteLength(capture.response_text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new Error(`response_text for ${caseId} exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }

  return { observationRef, responseText: capture.response_text };
}

async function collectAgentSelectionHostObservations({ fixture, collectorId, invokeHost, classifyResponse }) {
  const normalizedFixture = normalizeFixture(fixture);
  const normalizedCollectorId = requiredText(collectorId, 'collectorId', 120);
  if (typeof invokeHost !== 'function') throw new TypeError('invokeHost must be a function');
  if (typeof classifyResponse !== 'function') throw new TypeError('classifyResponse must be a function');

  const observations = [];
  const observationRefs = new Set();

  for (const testCase of normalizedFixture.cases) {
    const invocation = deepFreeze({
      case_id: testCase.id,
      category: testCase.category,
      prompt: testCase.prompt,
      resource_id: normalizedFixture.resource_id,
    });

    const capture = normalizeCapture(await invokeHost(invocation), testCase.id);
    if (observationRefs.has(capture.observationRef)) {
      throw new Error(`Duplicate observation_ref: ${capture.observationRef}`);
    }
    observationRefs.add(capture.observationRef);

    const classificationInput = deepFreeze({
      case_id: testCase.id,
      category: testCase.category,
      prompt: testCase.prompt,
      resource_id: normalizedFixture.resource_id,
      response_text: capture.responseText,
    });
    const observedBehavior = requiredText(await classifyResponse(classificationInput), 'observed_behavior', 80);
    if (!OBSERVED_BEHAVIORS.has(observedBehavior)) {
      throw new Error(`Unsupported observed_behavior: ${observedBehavior}`);
    }

    observations.push(Object.freeze({
      id: testCase.id,
      observed_behavior: observedBehavior,
      observation_ref: capture.observationRef,
      response_digest: digestResponse(capture.responseText),
    }));
  }

  const payload = {
    schema: COLLECTION_SCHEMA,
    collectorId: normalizedCollectorId,
    fixtureRef: {
      schema: FIXTURE_SCHEMA,
      resourceId: normalizedFixture.resource_id,
      caseCount: normalizedFixture.cases.length,
      fixtureDigest: digest(normalizedFixture),
    },
    observations: Object.freeze(observations),
    collectionBoundary: {
      evaluationPolicyOwnedByCollector: false,
      acceptanceThresholdsOwnedByCollector: false,
      rankingClaimCreated: false,
      registryPublicationPerformed: false,
      paymentPerformed: false,
      domainWritePerformed: false,
      rawHostResponseStored: false,
      responseDigestBound: true,
      externalHostProvenanceVerifiedByThisModule: false,
      transportCredentialsOwnedByThisModule: false,
      arbitraryUrlAcceptedByThisModule: false,
    },
  };

  return deepFreeze({ ...payload, collectionDigest: digest(payload) });
}

module.exports = {
  COLLECTION_SCHEMA,
  MAX_RESPONSE_BYTES,
  collectAgentSelectionHostObservations,
};
