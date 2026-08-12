'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/trade.verify_supplier.selection-eval.v1.json');
const { collectAgentSelectionHostObservations } = require('../src/discovery/agent-selection-host-collector.cjs');
const { createAgentSelectionHostProvenanceEnvelope } = require('../src/discovery/agent-selection-host-provenance-envelope.cjs');
const {
  VERIFICATION_REQUEST_SCHEMA,
  REQUEST_STATUS,
  DECISION_VOCABULARY,
  createAgentSelectionHostProvenanceVerificationRequest,
} = require('../src/discovery/agent-selection-host-provenance-verification-request.cjs');

async function sampleEnvelope({ withAttestation = true } = {}) {
  const collection = await collectAgentSelectionHostObservations({
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

  return createAgentSelectionHostProvenanceEnvelope({
    collection,
    surface: 'chatgpt_app',
    hostName: 'Test Agent Host',
    hostVersion: 'build-2026-08-12.1',
    modelName: 'test-model-v1',
    observedAt: '2026-08-12T02:00:00.000Z',
    captureSetRef: 'capture-set:test-host:run-001',
    externalAttestation: withAttestation ? {
      attestation_ref: 'host-attestation:test:001',
      verifier_ref: 'host-verifier:test',
      key_ref: 'host-key:test:1',
      signature_algorithm: 'Ed25519',
      signature: 'ZmFrZS1zaWduYXR1cmU',
      issued_at: '2026-08-12T01:59:00.000Z',
      valid_until: '2026-08-12T02:10:00.000Z',
    } : null,
  });
}

function baseInput(envelope) {
  return {
    envelope,
    verifierPolicyRef: 'policy:agent-host-provenance:external-v1',
    maxAttestationAgeSeconds: 3600,
    requestedAt: '2026-08-12T02:01:00.000Z',
  };
}

test('creates a deterministic pending external-verification request from an unverified envelope', async () => {
  const envelope = await sampleEnvelope();
  const request = createAgentSelectionHostProvenanceVerificationRequest(baseInput(envelope));

  assert.equal(request.schema, VERIFICATION_REQUEST_SCHEMA);
  assert.equal(request.requestStatus, REQUEST_STATUS);
  assert.equal(request.requestStatus, 'pending_external_verification');
  assert.equal(request.envelopeRef.envelopeDigest, envelope.envelopeDigest);
  assert.equal(request.envelopeRef.provenanceStatus, 'unverified');
  assert.deepEqual(request.expectedHost, envelope.host);
  assert.deepEqual(request.verifierPolicy.decisionVocabulary, DECISION_VOCABULARY);
  assert.equal(request.verifierPolicy.requireExternalAttestation, true);
  assert.equal(request.verifierPolicy.externalAttestationPresent, true);
  assert.deepEqual(request.requestBoundary, {
    externalVerificationPerformedByThisModule: false,
    verificationDecisionCreatedByThisModule: false,
    externalTrustRootConfiguredByThisModule: false,
    publicKeyEmbeddedByThisModule: false,
    transportCredentialsOwnedByThisModule: false,
    networkPerformedByThisModule: false,
    externalHostProvenanceVerified: false,
    rankingClaimCreated: false,
    registryPublicationPerformed: false,
    paymentPerformed: false,
    domainWritePerformed: false,
    executionAuthorized: false,
  });
  assert.match(request.requestDigest, /^sha256:[0-9a-f]{64}$/);
});

test('host and envelope identity are derived from the envelope rather than caller-provided expectations', async () => {
  const envelope = await sampleEnvelope();
  const base = baseInput(envelope);

  assert.throws(
    () => createAgentSelectionHostProvenanceVerificationRequest({ ...base, expectedHost: { hostName: 'spoof' } }),
    /unsupported field: expectedHost/,
  );
  assert.throws(
    () => createAgentSelectionHostProvenanceVerificationRequest({ ...base, envelopeDigest: `sha256:${'0'.repeat(64)}` }),
    /unsupported field: envelopeDigest/,
  );
});

test('rejects caller-supplied decisions, trust roots, public keys, credentials and transport configuration', async () => {
  const envelope = await sampleEnvelope();
  const base = baseInput(envelope);
  const forbidden = [
    ['decision', 'verified'],
    ['trusted', true],
    ['trustRoot', 'root:test'],
    ['publicKey', 'fake-key'],
    ['authorization', 'Bearer no'],
    ['url', 'https://verifier.example'],
  ];

  for (const [key, value] of forbidden) {
    assert.throws(
      () => createAgentSelectionHostProvenanceVerificationRequest({ ...base, [key]: value }),
      new RegExp(`unsupported field: ${key}`),
    );
  }
});

test('missing external attestation remains visible and never becomes an implicit verification success', async () => {
  const envelope = await sampleEnvelope({ withAttestation: false });
  const request = createAgentSelectionHostProvenanceVerificationRequest(baseInput(envelope));

  assert.equal(request.verifierPolicy.requireExternalAttestation, true);
  assert.equal(request.verifierPolicy.externalAttestationPresent, false);
  assert.equal(request.requestBoundary.externalVerificationPerformedByThisModule, false);
  assert.equal(request.requestBoundary.externalHostProvenanceVerified, false);
});

test('rejects tampered envelopes, invalid max age and request time before observation', async () => {
  const envelope = await sampleEnvelope();
  const base = baseInput(envelope);
  const tampered = JSON.parse(JSON.stringify(envelope));
  tampered.host.hostVersion = 'tampered-build';

  assert.throws(
    () => createAgentSelectionHostProvenanceVerificationRequest({ ...base, envelope: tampered }),
    /envelope integrity mismatch/,
  );
  assert.throws(
    () => createAgentSelectionHostProvenanceVerificationRequest({ ...base, maxAttestationAgeSeconds: 30 }),
    /maxAttestationAgeSeconds must be an integer between/,
  );
  assert.throws(
    () => createAgentSelectionHostProvenanceVerificationRequest({ ...base, requestedAt: '2026-08-12T01:59:59.000Z' }),
    /requestedAt must not be earlier than envelope observedAt/,
  );
});
