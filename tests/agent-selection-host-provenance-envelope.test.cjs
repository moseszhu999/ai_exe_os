'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/trade.verify_supplier.selection-eval.v1.json');
const { collectAgentSelectionHostObservations } = require('../src/discovery/agent-selection-host-collector.cjs');
const {
  PROVENANCE_ENVELOPE_SCHEMA,
  PROVENANCE_STATUS,
  createAgentSelectionHostProvenanceEnvelope,
} = require('../src/discovery/agent-selection-host-provenance-envelope.cjs');

async function sampleCollection() {
  return collectAgentSelectionHostObservations({
    fixture: {
      schema: fixture.schema,
      resource_id: fixture.resource_id,
      cases: fixture.cases.slice(0, 2),
    },
    collectorId: 'test.host-collector.v1',
    invokeHost: async (input) => ({
      observation_ref: `trace:test:${input.case_id}`,
      response_text: `host-response:${input.case_id}`,
    }),
    classifyResponse: async () => 'SELECT_VERIFY_SUPPLIER',
  });
}

function baseInput(collection) {
  return {
    collection,
    surface: 'chatgpt_app',
    hostName: 'Test Agent Host',
    hostVersion: 'build-2026-08-12.1',
    modelName: 'test-model-v1',
    observedAt: '2026-08-12T02:00:00.000Z',
    captureSetRef: 'capture-set:test-host:run-001',
    externalAttestation: null,
  };
}

test('binds exact collection and host identity while remaining explicitly unverified', async () => {
  const collection = await sampleCollection();
  const envelope = createAgentSelectionHostProvenanceEnvelope(baseInput(collection));

  assert.equal(envelope.schema, PROVENANCE_ENVELOPE_SCHEMA);
  assert.equal(envelope.provenanceStatus, PROVENANCE_STATUS);
  assert.equal(envelope.provenanceStatus, 'unverified');
  assert.equal(envelope.collectionRef.collectionDigest, collection.collectionDigest);
  assert.equal(envelope.collectionRef.observationCount, 2);
  assert.equal(envelope.host.surface, 'chatgpt_app');
  assert.deepEqual(envelope.provenanceBoundary, {
    collectionIntegrityVerifiedByThisModule: true,
    externalSignatureVerificationPerformedByThisModule: false,
    externalTrustRootConfiguredByThisModule: false,
    externalHostProvenanceVerified: false,
    rankingClaimCreated: false,
    registryPublicationPerformed: false,
    paymentPerformed: false,
    domainWritePerformed: false,
    executionAuthorized: false,
  });
  assert.match(envelope.envelopeDigest, /^sha256:[0-9a-f]{64}$/);
});

test('host, model, capture-set or collection drift changes envelope identity', async () => {
  const collection = await sampleCollection();
  const base = baseInput(collection);
  const original = createAgentSelectionHostProvenanceEnvelope(base);

  const hostDrift = createAgentSelectionHostProvenanceEnvelope({ ...base, hostVersion: 'build-2026-08-12.2' });
  const modelDrift = createAgentSelectionHostProvenanceEnvelope({ ...base, modelName: 'test-model-v2' });
  const captureDrift = createAgentSelectionHostProvenanceEnvelope({ ...base, captureSetRef: 'capture-set:test-host:run-002' });

  assert.notEqual(hostDrift.envelopeDigest, original.envelopeDigest);
  assert.notEqual(modelDrift.envelopeDigest, original.envelopeDigest);
  assert.notEqual(captureDrift.envelopeDigest, original.envelopeDigest);

  const mutatedCollection = JSON.parse(JSON.stringify(collection));
  mutatedCollection.collectionDigest = `sha256:${'0'.repeat(64)}`;
  assert.throws(
    () => createAgentSelectionHostProvenanceEnvelope({ ...base, collection: mutatedCollection }),
    /collection integrity mismatch/,
  );
});

test('optional external attestation is bound but never upgraded into verified provenance', async () => {
  const collection = await sampleCollection();
  const envelope = createAgentSelectionHostProvenanceEnvelope({
    ...baseInput(collection),
    externalAttestation: {
      attestation_ref: 'host-attestation:test:001',
      verifier_ref: 'host-verifier:test',
      key_ref: 'host-key:test:1',
      signature_algorithm: 'Ed25519',
      signature: 'ZmFrZS1zaWduYXR1cmU',
      issued_at: '2026-08-12T01:59:00.000Z',
      valid_until: '2026-08-12T02:10:00.000Z',
    },
  });

  assert.equal(envelope.externalAttestation.signature_algorithm, 'Ed25519');
  assert.equal(envelope.provenanceStatus, 'unverified');
  assert.equal(envelope.provenanceBoundary.externalSignatureVerificationPerformedByThisModule, false);
  assert.equal(envelope.provenanceBoundary.externalTrustRootConfiguredByThisModule, false);
  assert.equal(envelope.provenanceBoundary.externalHostProvenanceVerified, false);
});

test('rejects caller attempts to smuggle verified/trusted state or unknown transport metadata', async () => {
  const collection = await sampleCollection();
  const base = baseInput(collection);

  assert.throws(
    () => createAgentSelectionHostProvenanceEnvelope({ ...base, provenanceStatus: 'verified' }),
    /unsupported field: provenanceStatus/,
  );
  assert.throws(
    () => createAgentSelectionHostProvenanceEnvelope({ ...base, trusted: true }),
    /unsupported field: trusted/,
  );
  assert.throws(
    () => createAgentSelectionHostProvenanceEnvelope({ ...base, authorization: 'Bearer no' }),
    /unsupported field: authorization/,
  );
});

test('rejects non-UTC observation time and malformed external attestation validity', async () => {
  const collection = await sampleCollection();
  const base = baseInput(collection);

  assert.throws(
    () => createAgentSelectionHostProvenanceEnvelope({ ...base, observedAt: '2026-08-12T10:00:00+08:00' }),
    /must be an ISO-8601 UTC timestamp/,
  );

  assert.throws(() => createAgentSelectionHostProvenanceEnvelope({
    ...base,
    externalAttestation: {
      attestation_ref: 'host-attestation:test:001',
      verifier_ref: 'host-verifier:test',
      key_ref: 'host-key:test:1',
      signature_algorithm: 'Ed25519',
      signature: 'ZmFrZQ',
      issued_at: '2026-08-12T02:10:00.000Z',
      valid_until: '2026-08-12T02:00:00.000Z',
    },
  }), /valid_until must be after issued_at/);
});
