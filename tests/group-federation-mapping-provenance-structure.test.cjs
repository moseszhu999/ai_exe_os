'use strict';

const assert = require('node:assert/strict');
const { createHash, generateKeyPairSync } = require('node:crypto');
const test = require('node:test');
const {
  createFederationMappingProvenanceAttestation,
} = require('../src/group-fabric/federation-mapping-provenance.cjs');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function verifiedReceipt() {
  const unsigned = {
    schema: 'group.federation-mapping-verification.receipt.v1',
    verificationReceiptRef: 'group:federation-verification-receipt:00000000000000000000000000000001',
    requestRef: 'group:federation-verification-request:001',
    requestDigest: '1'.repeat(64),
    decision: 'verified',
    reasonCodes: ['exact_domain_pair_verified'],
    mappingVerified: true,
    subjectLinkRef: 'group:subject-link:001',
    subjectLinkDigest: '2'.repeat(64),
    subjectStatus: 'valid',
    subjectStatusDigest: '3'.repeat(64),
    subjectLifecycleDigest: '4'.repeat(64),
    organizationLinkRef: 'group:organization-link:001',
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
  return { ...unsigned, receiptDigest: digest(unsigned) };
}

function signingInput(receipt) {
  const { privateKey } = generateKeyPairSync('ed25519');
  return {
    receipt,
    verifierRef: 'group:verifier:aiexe-federation-v1',
    keyRef: 'group:verifier-key:aiexe-federation-ed25519-v1',
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    issuedAt: '2026-08-11T03:01:00Z',
    validUntil: '2026-08-11T03:06:00Z',
  };
}

test('provenance signer rejects hidden, missing, and malformed #140 receipt structure', () => {
  const base = verifiedReceipt();

  const hiddenUnsigned = { ...base, authorizationDecision: 'allow' };
  delete hiddenUnsigned.receiptDigest;
  const hidden = { ...hiddenUnsigned, receiptDigest: digest(hiddenUnsigned) };
  assert.throws(
    () => createFederationMappingProvenanceAttestation(signingInput(hidden)),
    /unsupported field: authorizationDecision/,
  );

  const missingUnsigned = { ...base };
  delete missingUnsigned.receiptDigest;
  delete missingUnsigned.organizationLinkDigest;
  const missing = { ...missingUnsigned, receiptDigest: digest(missingUnsigned) };
  assert.throws(
    () => createFederationMappingProvenanceAttestation(signingInput(missing)),
    /missing required field: organizationLinkDigest/,
  );

  const malformedUnsigned = {
    ...base,
    domainBindings: [{
      domain: 'trainingos',
      subjectRef: 'trainingos:human-ref:person-001',
      organizationRef: 'trainingos:organization:org-001',
    }],
  };
  delete malformedUnsigned.receiptDigest;
  const malformed = { ...malformedUnsigned, receiptDigest: digest(malformedUnsigned) };
  assert.throws(
    () => createFederationMappingProvenanceAttestation(signingInput(malformed)),
    /domainBindings must contain exactly two entries/,
  );
});
