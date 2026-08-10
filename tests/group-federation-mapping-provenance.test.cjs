'use strict';

const assert = require('node:assert/strict');
const { createHash, generateKeyPairSync } = require('node:crypto');
const test = require('node:test');
const {
  GROUP_FEDERATION_MAPPING_PROVENANCE_ATTESTATION_SCHEMA,
  GROUP_FEDERATION_MAPPING_PROVENANCE_RESULT_SCHEMA,
  PROVENANCE_POLICY_REF,
  TRUST_RECORD_MAX_AGE_SECONDS,
  createFederationMappingProvenanceAttestation,
  verifyFederationMappingProvenance,
} = require('../src/group-fabric/federation-mapping-provenance.cjs');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
  };
}

function verifiedReceipt(seed = '001') {
  const unsigned = {
    schema: 'group.federation-mapping-verification.receipt.v1',
    verificationReceiptRef: `group:federation-verification-receipt:${seed.padStart(32, '0')}`,
    requestRef: `group:federation-verification-request:${seed}`,
    requestDigest: '1'.repeat(64),
    decision: 'verified',
    reasonCodes: ['exact_domain_pair_verified'],
    mappingVerified: true,
    subjectLinkRef: `group:subject-link:${seed}`,
    subjectLinkDigest: '2'.repeat(64),
    subjectStatus: 'valid',
    subjectStatusDigest: '3'.repeat(64),
    subjectLifecycleDigest: '4'.repeat(64),
    organizationLinkRef: `group:organization-link:${seed}`,
    organizationLinkDigest: '5'.repeat(64),
    organizationStatus: 'valid',
    organizationStatusDigest: '6'.repeat(64),
    organizationLifecycleDigest: '7'.repeat(64),
    roleContextLinkRef: null,
    roleContextLinkDigest: null,
    domainBindings: [
      {
        domain: 'trainingos',
        subjectRef: 'trainingos:human-ref:person-001',
        organizationRef: 'trainingos:organization:org-001',
      },
      {
        domain: 'tradeos',
        subjectRef: 'tradeos:actor-ref:person-001',
        organizationRef: 'tradeos:organization:org-001',
      },
    ],
    verificationPolicyRef: 'group:federation-verification-policy:explicit-domain-pair-v1',
    evidenceRefs: ['evidence:domain-pair-verification:001'],
    observedAt: '2026-08-11T03:00:00Z',
    maxStatusAgeSeconds: 300,
    mappingVerificationReceipt: true,
    correlationOnly: true,
    loginCredential: false,
    sessionCreated: false,
    membershipCreated: false,
    organizationMembershipInferred: false,
    roleEquivalenceAsserted: false,
    capabilityCredentialCreated: false,
    authorityGrantCreated: false,
    authorizationDecisionCreated: false,
    humanGateDecisionCreated: false,
    delegationCreated: false,
    executionAuthorized: false,
    crossDomainAccessGranted: false,
    domainWritePerformed: false,
    externalActionPerformed: false,
  };
  return Object.freeze({ ...unsigned, receiptDigest: digest(unsigned) });
}

function attestation(receipt, kp, overrides = {}) {
  return createFederationMappingProvenanceAttestation({
    receipt,
    verifierRef: 'group:verifier:aiexe-federation-v1',
    keyRef: 'group:verifier-key:aiexe-federation-ed25519-v1',
    privateKeyPem: kp.privateKeyPem,
    issuedAt: '2026-08-11T03:01:00Z',
    validUntil: '2026-08-11T03:06:00Z',
    ...overrides,
  });
}

function trustedRecord(kp, overrides = {}) {
  return {
    verifierRef: 'group:verifier:aiexe-federation-v1',
    keyRef: 'group:verifier-key:aiexe-federation-ed25519-v1',
    publicKeyPem: kp.publicKeyPem,
    status: 'active',
    observedAt: '2026-08-11T03:01:30Z',
    validUntil: '2026-08-11T03:06:30Z',
    ...overrides,
  };
}

test('accepted #140 receipt can receive deterministic provider-verifiable Ed25519 provenance', () => {
  const receipt = verifiedReceipt();
  const kp = keyPair();
  const first = attestation(receipt, kp);
  const second = attestation(receipt, kp);
  assert.equal(first.schema, GROUP_FEDERATION_MAPPING_PROVENANCE_ATTESTATION_SCHEMA);
  assert.equal(first.provenancePolicyRef, PROVENANCE_POLICY_REF);
  assert.equal(first.attestationDigest, second.attestationDigest);
  assert.equal(first.signature, second.signature);
  assert.equal(first.verificationReceiptRef, receipt.verificationReceiptRef);
  assert.equal(first.receiptDigest, receipt.receiptDigest);
  assert.equal(first.providerAccessGranted, false);
  assert.equal(first.authorityGrantCreated, false);
  assert.equal(first.executionAuthorized, false);
  assert.equal(first.externalActionPerformed, false);

  const result = verifyFederationMappingProvenance({
    receipt,
    attestation: first,
    trustedVerifierRecord: trustedRecord(kp),
    observedAt: '2026-08-11T03:02:00Z',
  });
  assert.equal(result.schema, GROUP_FEDERATION_MAPPING_PROVENANCE_RESULT_SCHEMA);
  assert.equal(result.decision, 'verified');
  assert.equal(result.provenanceVerified, true);
  assert.deepEqual(result.reasonCodes, ['provider_verifiable_provenance_verified']);
  assert.equal(result.providerAccessGranted, false);
  assert.equal(result.crossDomainAccessGranted, false);
  assert.equal(result.executionAuthorized, false);
});

test('a caller-self-hashed receipt without a valid trusted signature is denied', () => {
  const receipt = verifiedReceipt();
  const trusted = keyPair();
  const attacker = keyPair();
  const forged = attestation(receipt, attacker);
  const result = verifyFederationMappingProvenance({
    receipt,
    attestation: forged,
    trustedVerifierRecord: trustedRecord(trusted),
    observedAt: '2026-08-11T03:02:00Z',
  });
  assert.equal(result.decision, 'denied');
  assert.equal(result.provenanceVerified, false);
  assert.match(result.reasonCodes.join(','), /verifier_key_fingerprint_mismatch/);
  assert.match(result.reasonCodes.join(','), /attestation_signature_invalid/);
});

test('wrong verifier or key reference is denied even when signature bytes are otherwise valid', () => {
  const receipt = verifiedReceipt();
  const kp = keyPair();
  const signed = attestation(receipt, kp);

  const wrongVerifier = verifyFederationMappingProvenance({
    receipt,
    attestation: signed,
    trustedVerifierRecord: trustedRecord(kp, { verifierRef: 'group:verifier:other' }),
    observedAt: '2026-08-11T03:02:00Z',
  });
  assert.equal(wrongVerifier.decision, 'denied');
  assert.match(wrongVerifier.reasonCodes.join(','), /verifier_ref_mismatch/);

  const wrongKeyRef = verifyFederationMappingProvenance({
    receipt,
    attestation: signed,
    trustedVerifierRecord: trustedRecord(kp, { keyRef: 'group:verifier-key:other' }),
    observedAt: '2026-08-11T03:02:00Z',
  });
  assert.equal(wrongKeyRef.decision, 'denied');
  assert.match(wrongKeyRef.reasonCodes.join(','), /verifier_key_ref_mismatch/);
});

test('stale trusted verifier provenance becomes unknown and never grants access', () => {
  const receipt = verifiedReceipt();
  const kp = keyPair();
  const signed = attestation(receipt, kp, { validUntil: '2026-08-11T03:20:00Z' });
  const result = verifyFederationMappingProvenance({
    receipt,
    attestation: signed,
    trustedVerifierRecord: trustedRecord(kp, {
      observedAt: '2026-08-11T03:01:00Z',
      validUntil: '2026-08-11T03:20:00Z',
    }),
    observedAt: `2026-08-11T03:${String(2 + Math.floor(TRUST_RECORD_MAX_AGE_SECONDS / 60) + 5).padStart(2, '0')}:00Z`,
  });
  assert.equal(result.decision, 'unknown');
  assert.match(result.reasonCodes.join(','), /verifier_record_stale/);
  assert.equal(result.providerAccessGranted, false);
});

test('revoked verifier provenance is denied and unknown verifier provenance remains unknown', () => {
  const receipt = verifiedReceipt();
  const kp = keyPair();
  const signed = attestation(receipt, kp);

  const revoked = verifyFederationMappingProvenance({
    receipt,
    attestation: signed,
    trustedVerifierRecord: trustedRecord(kp, { status: 'revoked' }),
    observedAt: '2026-08-11T03:02:00Z',
  });
  assert.equal(revoked.decision, 'denied');
  assert.match(revoked.reasonCodes.join(','), /verifier_revoked/);

  const unknown = verifyFederationMappingProvenance({
    receipt,
    attestation: signed,
    trustedVerifierRecord: trustedRecord(kp, { status: 'unknown' }),
    observedAt: '2026-08-11T03:02:00Z',
  });
  assert.equal(unknown.decision, 'unknown');
  assert.match(unknown.reasonCodes.join(','), /verifier_status_unknown/);
});

test('cross-receipt substitution is denied even under the same trusted verifier key', () => {
  const receiptA = verifiedReceipt('001');
  const receiptB = verifiedReceipt('002');
  const kp = keyPair();
  const signedForA = attestation(receiptA, kp);
  const result = verifyFederationMappingProvenance({
    receipt: receiptB,
    attestation: signedForA,
    trustedVerifierRecord: trustedRecord(kp),
    observedAt: '2026-08-11T03:02:00Z',
  });
  assert.equal(result.decision, 'denied');
  assert.match(result.reasonCodes.join(','), /verification_receipt_ref_mismatch/);
  assert.match(result.reasonCodes.join(','), /receipt_digest_mismatch/);
});

test('tampered receipt or attestation digest fails closed before provenance can be verified', () => {
  const receipt = verifiedReceipt();
  const kp = keyPair();
  const signed = attestation(receipt, kp);

  assert.throws(() => verifyFederationMappingProvenance({
    receipt: { ...receipt, evidenceRefs: ['evidence:tampered'] },
    attestation: signed,
    trustedVerifierRecord: trustedRecord(kp),
    observedAt: '2026-08-11T03:02:00Z',
  }), /receipt integrity mismatch/);

  assert.throws(() => verifyFederationMappingProvenance({
    receipt,
    attestation: { ...signed, issuedAt: '2026-08-11T03:01:01Z' },
    trustedVerifierRecord: trustedRecord(kp),
    observedAt: '2026-08-11T03:02:00Z',
  }), /attestation digest mismatch/);
});

test('caller-controlled trust booleans are rejected instead of becoming provenance', () => {
  const receipt = verifiedReceipt();
  const kp = keyPair();
  const signed = attestation(receipt, kp);

  assert.throws(() => verifyFederationMappingProvenance({
    receipt,
    attestation: { ...signed, trusted: true },
    trustedVerifierRecord: trustedRecord(kp),
    observedAt: '2026-08-11T03:02:00Z',
  }), /unsupported field: trusted/);

  assert.throws(() => verifyFederationMappingProvenance({
    receipt,
    attestation: signed,
    trustedVerifierRecord: { ...trustedRecord(kp), trusted: true },
    observedAt: '2026-08-11T03:02:00Z',
  }), /unsupported field: trusted/);
});

test('expired attestation is denied and cannot be converted into provider access', () => {
  const receipt = verifiedReceipt();
  const kp = keyPair();
  const signed = attestation(receipt, kp, { validUntil: '2026-08-11T03:02:30Z' });
  const result = verifyFederationMappingProvenance({
    receipt,
    attestation: signed,
    trustedVerifierRecord: trustedRecord(kp, { validUntil: '2026-08-11T03:10:00Z' }),
    observedAt: '2026-08-11T03:03:00Z',
  });
  assert.equal(result.decision, 'denied');
  assert.match(result.reasonCodes.join(','), /attestation_expired/);
  assert.equal(result.providerAccessGranted, false);
  assert.equal(result.authorityGrantCreated, false);
  assert.equal(result.executionAuthorized, false);
});
