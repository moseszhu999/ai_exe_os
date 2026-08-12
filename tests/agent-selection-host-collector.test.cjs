'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fixture = require('./fixtures/trade.verify_supplier.selection-eval.v1.json');
const {
  COLLECTION_SCHEMA,
  MAX_RESPONSE_BYTES,
  collectAgentSelectionHostObservations,
} = require('../src/discovery/agent-selection-host-collector.cjs');

function sha256(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

function expectedByCaseId() {
  return new Map(fixture.cases.map((entry) => [entry.id, entry.expected_behavior]));
}

test('collects the frozen 53-case fixture through injected adapters without exposing expected behavior or raw response', async () => {
  const expected = expectedByCaseId();
  const invokeInputs = [];
  const classifyInputs = [];
  const rawById = new Map();

  const collection = await collectAgentSelectionHostObservations({
    fixture,
    collectorId: 'test.injected-host-collector.v1',
    invokeHost: async (input) => {
      invokeInputs.push(input);
      assert.equal(Object.hasOwn(input, 'expected_behavior'), false);
      const responseText = JSON.stringify({ observed: expected.get(input.case_id), nonce: input.case_id });
      rawById.set(input.case_id, responseText);
      return {
        observation_ref: `trace:test-host:${input.case_id}`,
        response_text: responseText,
      };
    },
    classifyResponse: async (input) => {
      classifyInputs.push(input);
      assert.equal(Object.hasOwn(input, 'expected_behavior'), false);
      return JSON.parse(input.response_text).observed;
    },
  });

  assert.equal(collection.schema, COLLECTION_SCHEMA);
  assert.equal(collection.fixtureRef.caseCount, 53);
  assert.equal(collection.observations.length, 53);
  assert.deepEqual(collection.observations.map((item) => item.id), fixture.cases.map((item) => item.id));
  assert.equal(invokeInputs.length, 53);
  assert.equal(classifyInputs.length, 53);

  const first = collection.observations[0];
  assert.equal(first.response_digest, sha256(rawById.get(first.id)));
  assert.equal(JSON.stringify(collection).includes('response_text'), false);
  assert.equal(JSON.stringify(collection).includes(rawById.get(first.id)), false);

  assert.deepEqual(collection.collectionBoundary, {
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
  });
  assert.match(collection.collectionDigest, /^sha256:[0-9a-f]{64}$/);
});

test('fails closed on duplicate external observation references', async () => {
  await assert.rejects(() => collectAgentSelectionHostObservations({
    fixture: {
      schema: fixture.schema,
      resource_id: fixture.resource_id,
      cases: fixture.cases.slice(0, 2),
    },
    collectorId: 'test.duplicate-ref.v1',
    invokeHost: async () => ({ observation_ref: 'trace:same', response_text: 'response' }),
    classifyResponse: async () => 'SELECT_VERIFY_SUPPLIER',
  }), /Duplicate observation_ref/);
});

test('fails closed on unsupported classifier output and never converts it into evaluation policy', async () => {
  await assert.rejects(() => collectAgentSelectionHostObservations({
    fixture: {
      schema: fixture.schema,
      resource_id: fixture.resource_id,
      cases: fixture.cases.slice(0, 1),
    },
    collectorId: 'test.bad-classifier.v1',
    invokeHost: async () => ({ observation_ref: 'trace:one', response_text: 'response' }),
    classifyResponse: async () => 'PASS',
  }), /Unsupported observed_behavior: PASS/);
});

test('rejects capture fields that could smuggle transport credentials or unbounded provider metadata', async () => {
  await assert.rejects(() => collectAgentSelectionHostObservations({
    fixture: {
      schema: fixture.schema,
      resource_id: fixture.resource_id,
      cases: fixture.cases.slice(0, 1),
    },
    collectorId: 'test.capture-boundary.v1',
    invokeHost: async () => ({
      observation_ref: 'trace:one',
      response_text: 'response',
      authorization: 'Bearer should-not-enter-collector',
    }),
    classifyResponse: async () => 'SELECT_VERIFY_SUPPLIER',
  }), /Unsupported capture field/);
});

test('bounds raw host response bytes before classification', async () => {
  let classifierCalled = false;
  await assert.rejects(() => collectAgentSelectionHostObservations({
    fixture: {
      schema: fixture.schema,
      resource_id: fixture.resource_id,
      cases: fixture.cases.slice(0, 1),
    },
    collectorId: 'test.response-bound.v1',
    invokeHost: async () => ({
      observation_ref: 'trace:large',
      response_text: 'x'.repeat(MAX_RESPONSE_BYTES + 1),
    }),
    classifyResponse: async () => {
      classifierCalled = true;
      return 'SELECT_VERIFY_SUPPLIER';
    },
  }), /exceeds/);
  assert.equal(classifierCalled, false);
});
