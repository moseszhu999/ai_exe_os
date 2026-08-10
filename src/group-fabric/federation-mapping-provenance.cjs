'use strict';

const {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign: cryptoSign,
  verify: cryptoVerify,
} = require('node:crypto');
const {
  GROUP_FEDERATION_MAPPING_VERIFICATION_RECEIPT_SCHEMA,
  MAX_STATUS_AGE_SECONDS,
  VERIFICATION_POLICY_REF,
} = require('./federation-mapping-verifier.cjs');

const GROUP_FEDERATION_MAPPING_PROVENANCE_ATTESTATION_SCHEMA =
  'group.federation-mapping-provenance-attestation.v1';
const GROUP_FEDERATION_MAPPING_PROVENANCE_RESULT_SCHEMA =
  'group.federation-mapping-provenance-result.v1';
const PROVENANCE_POLICY_REF =
  'group:federation-provenance-policy:ed25519-provider-verifiable-v1';
const SIGNATURE_ALGORITHM = 'Ed25519';
const TRUST_RECORD_MAX_AGE_SECONDS = 300;
const PROVENANCE_DECISIONS = Object.freeze(['verified', 'denied', 'unknown']);

const RECEIPT_FIELDS = new Set([
  'schema',
  'verificationReceiptRef',
  'requestRef',
  'requestDigest',
  'decision',
  'reasonCodes',
  'mappingVerified',
  'subjectLinkRef',
  'subjectLinkDigest',
  'subjectStatus',
  'subjectStatusDigest',
  'subjectLifecycleDigest',
  'organizationLinkRef',
  'organizationLinkDigest',
  'organizationStatus',
  'organizationStatusDigest',
  'organizationLifecycleDigest',
  'roleContextLinkRef',
  'roleContextLinkDigest',
  'domainBindings',
  'verificationPolicyRef',
  'evidenceRefs',
  'observedAt',
  'maxStatusAgeSeconds',
  'mappingVerificationReceipt',
  'correlationOnly',
  'loginCredential',
  'sessionCreated',
  'membershipCreated',
  'organizationMembershipInferred',
  'roleEquivalenceAsserted',
  'capabilityCredentialCreated',
  'authorityGrantCreated',
  'authorizationDecisionCreated',
  'humanGateDecisionCreated',
  'delegationCreated',
  'executionAuthorized',
  'crossDomainAccessGranted',
  'domainWritePerformed',
  'externalActionPerformed',
  'receiptDigest',
]);

const RECEIPT_FALSE_FLAGS = Object.freeze([
  'loginCredential',
  'sessionCreated',
  'membershipCreated',
  'organizationMembershipInferred',
  'roleEquivalenceAsserted',
  'capabilityCredentialCreated',
  'authorityGrantCreated',
  'authorizationDecisionCreated',
  'humanGateDecisionCreated',
  'delegationCreated',
  'executionAuthorized',
  'crossDomainAccessGranted',
  'domainWritePerformed',
  'externalActionPerformed',
]);

const RESULT_FALSE_FLAGS = Object.freeze([
  'loginCredentialCreated',
  'sessionCreated',
  'membershipCreated',
  'organizationMembershipInferred',
  'roleEquivalenceAsserted',
  'capabilityCredentialCreated',
  'authorityGrantCreated',
  'authorizationDecisionCreated',
  'providerAccessGranted',
  'humanGateDecisionCreated',
  'delegationCreated',
  'executionAuthorized',
  'crossDomainAccessGranted',
  'domainWritePerformed',
  'externalActionPerformed',
]);

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) freezeDeep(nested);
  return value;
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function assertAllowedKeys(input, allowed, label) {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TypeError(`${label} contains unsupported field: ${key}`);
  }
}

function assertExactKeys(input, fields, label) {
  assertAllowedKeys(input, fields, label);
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) {
      throw new TypeError(`${label} is missing required field: ${field}`);
    }
  }
}

function text(value, label, max = 240) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} must be bounded non-empty text`);
  }
  return normalized;
}

function safeRef(value, label, prefix) {
  const normalized = text(value, label);
  if (!normalized.startsWith(prefix)) throw new TypeError(`${label} must start with ${prefix}`);
  if (/@[^/\s]+\.[A-Za-z]{2,}/.test(normalized)) {
    throw new TypeError(`${label} must not contain email-like PII`);
  }
  if (/bearer|password|secret|token=|api[_-]?key|cookie|session=|jwt/i.test(normalized)) {
    throw new TypeError(`${label} must not contain secret/session-like material`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9:._@/-]*$/.test(normalized)) {
    throw new TypeError(`${label} contains invalid characters`);
  }
  return normalized;
}

function safeOpaqueRef(value, label) {
  const normalized = text(value, label);
  if (/@[^/\s]+\.[A-Za-z]{2,}/.test(normalized)) {
    throw new TypeError(`${label} must not contain email-like PII`);
  }
  if (/bearer|password|secret|token=|api[_-]?key|cookie|session=|jwt/i.test(normalized)) {
    throw new TypeError(`${label} must not contain secret/session-like material`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9:._@/-]*$/.test(normalized)) {
    throw new TypeError(`${label} contains invalid characters`);
  }
  return normalized;
}

function safeCode(value, label) {
  const normalized = text(value, label, 80);
  if (!/^[a-z][a-z0-9._-]{0,79}$/.test(normalized)) {
    throw new TypeError(`${label} must be a bounded code`);
  }
  return normalized;
}

function timestamp(value, label) {
  const normalized = text(value, label, 40);
  const time = Date.parse(normalized);
  if (!Number.isFinite(time) || !normalized.endsWith('Z')) {
    throw new TypeError(`${label} must be an ISO-8601 UTC timestamp`);
  }
  return { text: normalized, time };
}

function sha256(value, label) {
  const normalized = text(value, label, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new TypeError(`${label} must be SHA-256`);
  return normalized;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
  );
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function assertBoolean(value, expected, label) {
  if (value !== expected) throw new TypeError(`${label} must be ${expected}`);
}

function normalizeReceiptBinding(binding, index) {
  plainObject(binding, `mapping verification receipt domainBindings[${index}]`);
  assertAllowedKeys(
    binding,
    new Set(['domain', 'subjectRef', 'organizationRef', 'roleRef']),
    `mapping verification receipt domainBindings[${index}]`,
  );
  for (const field of ['domain', 'subjectRef', 'organizationRef']) {
    if (!Object.prototype.hasOwnProperty.call(binding, field)) {
      throw new TypeError(`mapping verification receipt domainBindings[${index}] is missing required field: ${field}`);
    }
  }
  const normalized = {
    domain: safeCode(binding.domain, `mapping verification receipt domainBindings[${index}].domain`),
    subjectRef: safeOpaqueRef(
      binding.subjectRef,
      `mapping verification receipt domainBindings[${index}].subjectRef`,
    ),
    organizationRef: safeOpaqueRef(
      binding.organizationRef,
      `mapping verification receipt domainBindings[${index}].organizationRef`,
    ),
  };
  if (binding.roleRef !== undefined) {
    normalized.roleRef = safeOpaqueRef(
      binding.roleRef,
      `mapping verification receipt domainBindings[${index}].roleRef`,
    );
  }
  return freezeDeep(normalized);
}

function validateReceiptStructure(receipt) {
  assertExactKeys(receipt, RECEIPT_FIELDS, 'mapping verification receipt');
  safeRef(
    receipt.verificationReceiptRef,
    'mapping verification receipt verificationReceiptRef',
    'group:federation-verification-receipt:',
  );
  safeRef(
    receipt.requestRef,
    'mapping verification receipt requestRef',
    'group:federation-verification-request:',
  );
  sha256(receipt.requestDigest, 'mapping verification receipt requestDigest');
  if (!Array.isArray(receipt.reasonCodes)
      || receipt.reasonCodes.length !== 1
      || receipt.reasonCodes[0] !== 'exact_domain_pair_verified') {
    throw new TypeError('verified mapping verification receipt must contain exact verified reasonCodes');
  }
  safeRef(receipt.subjectLinkRef, 'mapping verification receipt subjectLinkRef', 'group:subject-link:');
  sha256(receipt.subjectLinkDigest, 'mapping verification receipt subjectLinkDigest');
  if (receipt.subjectStatus !== 'valid') {
    throw new TypeError('verified mapping verification receipt subjectStatus must be valid');
  }
  sha256(receipt.subjectStatusDigest, 'mapping verification receipt subjectStatusDigest');
  sha256(receipt.subjectLifecycleDigest, 'mapping verification receipt subjectLifecycleDigest');
  safeRef(
    receipt.organizationLinkRef,
    'mapping verification receipt organizationLinkRef',
    'group:organization-link:',
  );
  sha256(receipt.organizationLinkDigest, 'mapping verification receipt organizationLinkDigest');
  if (receipt.organizationStatus !== 'valid') {
    throw new TypeError('verified mapping verification receipt organizationStatus must be valid');
  }
  sha256(receipt.organizationStatusDigest, 'mapping verification receipt organizationStatusDigest');
  sha256(
    receipt.organizationLifecycleDigest,
    'mapping verification receipt organizationLifecycleDigest',
  );
  const hasRoleRef = receipt.roleContextLinkRef !== null;
  const hasRoleDigest = receipt.roleContextLinkDigest !== null;
  if (hasRoleRef !== hasRoleDigest) {
    throw new TypeError('mapping verification receipt role context ref/digest must be both null or both present');
  }
  if (hasRoleRef) {
    safeRef(
      receipt.roleContextLinkRef,
      'mapping verification receipt roleContextLinkRef',
      'group:role-context-link:',
    );
    sha256(receipt.roleContextLinkDigest, 'mapping verification receipt roleContextLinkDigest');
  }
  if (!Array.isArray(receipt.domainBindings) || receipt.domainBindings.length !== 2) {
    throw new TypeError('mapping verification receipt domainBindings must contain exactly two entries');
  }
  const bindings = receipt.domainBindings.map(normalizeReceiptBinding);
  if (bindings[0].domain === bindings[1].domain) {
    throw new TypeError('mapping verification receipt domainBindings must cover distinct domains');
  }
  if (!Array.isArray(receipt.evidenceRefs)
      || receipt.evidenceRefs.length < 1
      || receipt.evidenceRefs.length > 32) {
    throw new TypeError('mapping verification receipt evidenceRefs must be a non-empty bounded array');
  }
  const evidence = receipt.evidenceRefs.map((ref, index) => safeRef(
    ref,
    `mapping verification receipt evidenceRefs[${index}]`,
    'evidence:',
  ));
  if (new Set(evidence).size !== evidence.length) {
    throw new TypeError('mapping verification receipt evidenceRefs must be unique');
  }
  timestamp(receipt.observedAt, 'mapping verification receipt observedAt');
  if (receipt.maxStatusAgeSeconds !== MAX_STATUS_AGE_SECONDS) {
    throw new TypeError('mapping verification receipt maxStatusAgeSeconds mismatch');
  }
  if (receipt.verificationPolicyRef !== VERIFICATION_POLICY_REF) {
    throw new TypeError('mapping verification receipt verificationPolicyRef mismatch');
  }
}

function assertVerifiedReceipt(receipt) {
  plainObject(receipt, 'mapping verification receipt');
  validateReceiptStructure(receipt);
  if (receipt.schema !== GROUP_FEDERATION_MAPPING_VERIFICATION_RECEIPT_SCHEMA) {
    throw new TypeError('mapping verification receipt schema mismatch');
  }
  const suppliedDigest = sha256(
    receipt.receiptDigest,
    'mapping verification receipt receiptDigest',
  );
  const unsigned = { ...receipt };
  delete unsigned.receiptDigest;
  if (digest(unsigned) !== suppliedDigest) {
    throw new TypeError('mapping verification receipt integrity mismatch');
  }
  if (receipt.decision !== 'verified' || receipt.mappingVerified !== true) {
    throw new TypeError('mapping verification receipt must be an accepted verified receipt');
  }
  assertBoolean(receipt.mappingVerificationReceipt, true, 'mappingVerificationReceipt');
  assertBoolean(receipt.correlationOnly, true, 'correlationOnly');
  for (const field of RECEIPT_FALSE_FLAGS) {
    assertBoolean(receipt[field], false, `mapping verification receipt ${field}`);
  }
  return freezeDeep(receipt);
}

function publicKeyFingerprintSha256(key) {
  const publicKey = key && key.type === 'public' ? key : createPublicKey(key);
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex');
}

function normalizePrivateKey(privateKeyPem) {
  const value = text(privateKeyPem, 'privateKeyPem', 8192);
  const key = createPrivateKey(value);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('privateKeyPem must be an Ed25519 private key');
  }
  return key;
}

function normalizeTrustedVerifierRecord(record) {
  plainObject(record, 'trusted verifier record');
  assertAllowedKeys(
    record,
    new Set([
      'verifierRef',
      'keyRef',
      'publicKeyPem',
      'status',
      'observedAt',
      'validUntil',
    ]),
    'trusted verifier record',
  );
  for (const field of ['verifierRef', 'keyRef', 'publicKeyPem', 'status', 'observedAt', 'validUntil']) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      throw new TypeError(`trusted verifier record is missing required field: ${field}`);
    }
  }
  const verifierRef = safeRef(record.verifierRef, 'trusted verifier verifierRef', 'group:verifier:');
  const keyRef = safeRef(record.keyRef, 'trusted verifier keyRef', 'group:verifier-key:');
  const publicKeyPem = text(record.publicKeyPem, 'trusted verifier publicKeyPem', 8192);
  const publicKey = createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('trusted verifier publicKeyPem must be an Ed25519 public key');
  }
  if (!['active', 'revoked', 'unknown'].includes(record.status)) {
    throw new TypeError('trusted verifier status must be active, revoked, or unknown');
  }
  const observedAt = timestamp(record.observedAt, 'trusted verifier observedAt');
  const validUntil = timestamp(record.validUntil, 'trusted verifier validUntil');
  if (validUntil.time < observedAt.time) {
    throw new TypeError('trusted verifier validUntil must not precede observedAt');
  }
  return freezeDeep({
    verifierRef,
    keyRef,
    publicKeyPem,
    status: record.status,
    observedAt: observedAt.text,
    validUntil: validUntil.text,
    publicKeyFingerprintSha256: publicKeyFingerprintSha256(publicKey),
  });
}

function createFederationMappingProvenanceAttestation(input) {
  plainObject(input, 'provenance attestation input');
  assertAllowedKeys(
    input,
    new Set([
      'receipt',
      'verifierRef',
      'keyRef',
      'privateKeyPem',
      'issuedAt',
      'validUntil',
    ]),
    'provenance attestation input',
  );

  const receipt = assertVerifiedReceipt(input.receipt);
  const verifierRef = safeRef(input.verifierRef, 'verifierRef', 'group:verifier:');
  const keyRef = safeRef(input.keyRef, 'keyRef', 'group:verifier-key:');
  const privateKey = normalizePrivateKey(input.privateKeyPem);
  const issuedAt = timestamp(input.issuedAt, 'issuedAt');
  const validUntil = timestamp(input.validUntil, 'validUntil');
  if (validUntil.time <= issuedAt.time) {
    throw new TypeError('validUntil must be after issuedAt');
  }

  const publicKeyFingerprint = publicKeyFingerprintSha256(privateKey);
  const refSeed = {
    verificationReceiptRef: receipt.verificationReceiptRef,
    receiptDigest: receipt.receiptDigest,
    verifierRef,
    keyRef,
    publicKeyFingerprintSha256: publicKeyFingerprint,
    issuedAt: issuedAt.text,
  };
  const attestationRef =
    `group:federation-provenance-attestation:${digest(refSeed).slice(0, 32)}`;

  const payload = {
    schema: GROUP_FEDERATION_MAPPING_PROVENANCE_ATTESTATION_SCHEMA,
    attestationRef,
    verificationReceiptRef: receipt.verificationReceiptRef,
    receiptDigest: receipt.receiptDigest,
    verifierRef,
    keyRef,
    publicKeyFingerprintSha256: publicKeyFingerprint,
    signatureAlgorithm: SIGNATURE_ALGORITHM,
    provenancePolicyRef: PROVENANCE_POLICY_REF,
    issuedAt: issuedAt.text,
    validUntil: validUntil.text,
    provenanceAttestation: true,
    correlationOnly: true,
    providerAccessGranted: false,
    authorityGrantCreated: false,
    authorizationDecisionCreated: false,
    humanGateDecisionCreated: false,
    delegationCreated: false,
    executionAuthorized: false,
    crossDomainAccessGranted: false,
    domainWritePerformed: false,
    externalActionPerformed: false,
  };

  const signature = cryptoSign(
    null,
    Buffer.from(JSON.stringify(canonical(payload))),
    privateKey,
  ).toString('base64url');

  return freezeDeep({
    ...payload,
    signature,
    attestationDigest: digest({ ...payload, signature }),
  });
}

function normalizeAttestation(attestation) {
  plainObject(attestation, 'provenance attestation');
  assertAllowedKeys(
    attestation,
    new Set([
      'schema',
      'attestationRef',
      'verificationReceiptRef',
      'receiptDigest',
      'verifierRef',
      'keyRef',
      'publicKeyFingerprintSha256',
      'signatureAlgorithm',
      'provenancePolicyRef',
      'issuedAt',
      'validUntil',
      'provenanceAttestation',
      'correlationOnly',
      'providerAccessGranted',
      'authorityGrantCreated',
      'authorizationDecisionCreated',
      'humanGateDecisionCreated',
      'delegationCreated',
      'executionAuthorized',
      'crossDomainAccessGranted',
      'domainWritePerformed',
      'externalActionPerformed',
      'signature',
      'attestationDigest',
    ]),
    'provenance attestation',
  );
  if (attestation.schema !== GROUP_FEDERATION_MAPPING_PROVENANCE_ATTESTATION_SCHEMA) {
    throw new TypeError('provenance attestation schema mismatch');
  }
  safeRef(
    attestation.attestationRef,
    'provenance attestation attestationRef',
    'group:federation-provenance-attestation:',
  );
  safeRef(
    attestation.verificationReceiptRef,
    'provenance attestation verificationReceiptRef',
    'group:federation-verification-receipt:',
  );
  sha256(attestation.receiptDigest, 'provenance attestation receiptDigest');
  safeRef(attestation.verifierRef, 'provenance attestation verifierRef', 'group:verifier:');
  safeRef(attestation.keyRef, 'provenance attestation keyRef', 'group:verifier-key:');
  sha256(
    attestation.publicKeyFingerprintSha256,
    'provenance attestation publicKeyFingerprintSha256',
  );
  if (attestation.signatureAlgorithm !== SIGNATURE_ALGORITHM) {
    throw new TypeError('provenance attestation signature algorithm mismatch');
  }
  if (attestation.provenancePolicyRef !== PROVENANCE_POLICY_REF) {
    throw new TypeError('provenance attestation policy mismatch');
  }
  const issuedAt = timestamp(attestation.issuedAt, 'provenance attestation issuedAt');
  const validUntil = timestamp(attestation.validUntil, 'provenance attestation validUntil');
  if (validUntil.time <= issuedAt.time) {
    throw new TypeError('provenance attestation validUntil must be after issuedAt');
  }
  assertBoolean(attestation.provenanceAttestation, true, 'provenanceAttestation');
  assertBoolean(attestation.correlationOnly, true, 'correlationOnly');
  for (const field of [
    'providerAccessGranted',
    'authorityGrantCreated',
    'authorizationDecisionCreated',
    'humanGateDecisionCreated',
    'delegationCreated',
    'executionAuthorized',
    'crossDomainAccessGranted',
    'domainWritePerformed',
    'externalActionPerformed',
  ]) {
    assertBoolean(attestation[field], false, `provenance attestation ${field}`);
  }
  const signature = text(attestation.signature, 'provenance attestation signature', 512);
  if (!/^[A-Za-z0-9_-]+$/.test(signature)) {
    throw new TypeError('provenance attestation signature must be base64url');
  }
  const suppliedDigest = sha256(
    attestation.attestationDigest,
    'provenance attestation attestationDigest',
  );
  const unsignedDigest = { ...attestation };
  delete unsignedDigest.attestationDigest;
  if (digest(unsignedDigest) !== suppliedDigest) {
    throw new TypeError('provenance attestation digest mismatch');
  }
  return freezeDeep(attestation);
}

function result({
  decision,
  reasonCodes,
  receipt,
  attestation,
  verifierRecord,
  observedAt,
}) {
  const output = {
    schema: GROUP_FEDERATION_MAPPING_PROVENANCE_RESULT_SCHEMA,
    decision,
    reasonCodes: Object.freeze([...new Set(reasonCodes)].sort()),
    provenanceVerified: decision === 'verified',
    verificationReceiptRef: receipt.verificationReceiptRef,
    receiptDigest: receipt.receiptDigest,
    attestationRef: attestation.attestationRef,
    attestationDigest: attestation.attestationDigest,
    verifierRef: attestation.verifierRef,
    keyRef: attestation.keyRef,
    verifierStatus: verifierRecord.status,
    observedAt,
    correlationOnly: true,
  };
  for (const field of RESULT_FALSE_FLAGS) output[field] = false;
  return freezeDeep({ ...output, resultDigest: digest(output) });
}

function verifyFederationMappingProvenance(input) {
  plainObject(input, 'provenance verification input');
  assertAllowedKeys(
    input,
    new Set(['receipt', 'attestation', 'trustedVerifierRecord', 'observedAt']),
    'provenance verification input',
  );

  const receipt = assertVerifiedReceipt(input.receipt);
  const attestation = normalizeAttestation(input.attestation);
  const verifierRecord = normalizeTrustedVerifierRecord(input.trustedVerifierRecord);
  const observedAt = timestamp(input.observedAt, 'observedAt');
  const issuedAt = timestamp(attestation.issuedAt, 'provenance attestation issuedAt');
  const attestationValidUntil = timestamp(
    attestation.validUntil,
    'provenance attestation validUntil',
  );
  const verifierObservedAt = timestamp(
    verifierRecord.observedAt,
    'trusted verifier observedAt',
  );
  const verifierValidUntil = timestamp(
    verifierRecord.validUntil,
    'trusted verifier validUntil',
  );

  const denied = [];
  const unknown = [];

  if (attestation.verificationReceiptRef !== receipt.verificationReceiptRef) {
    denied.push('verification_receipt_ref_mismatch');
  }
  if (attestation.receiptDigest !== receipt.receiptDigest) {
    denied.push('receipt_digest_mismatch');
  }
  if (attestation.verifierRef !== verifierRecord.verifierRef) {
    denied.push('verifier_ref_mismatch');
  }
  if (attestation.keyRef !== verifierRecord.keyRef) {
    denied.push('verifier_key_ref_mismatch');
  }
  if (
    attestation.publicKeyFingerprintSha256
    !== verifierRecord.publicKeyFingerprintSha256
  ) {
    denied.push('verifier_key_fingerprint_mismatch');
  }

  if (observedAt.time < issuedAt.time) unknown.push('attestation_not_yet_valid');
  if (observedAt.time > attestationValidUntil.time) denied.push('attestation_expired');

  if (verifierObservedAt.time > observedAt.time) {
    unknown.push('verifier_record_from_future');
  } else {
    const verifierAgeSeconds = Math.floor(
      (observedAt.time - verifierObservedAt.time) / 1000,
    );
    if (verifierAgeSeconds > TRUST_RECORD_MAX_AGE_SECONDS) {
      unknown.push('verifier_record_stale');
    }
  }
  if (observedAt.time > verifierValidUntil.time) denied.push('verifier_record_expired');
  if (verifierRecord.status === 'revoked') denied.push('verifier_revoked');
  if (verifierRecord.status === 'unknown') unknown.push('verifier_status_unknown');

  let signatureValid = false;
  try {
    const payload = { ...attestation };
    delete payload.signature;
    delete payload.attestationDigest;
    signatureValid = cryptoVerify(
      null,
      Buffer.from(JSON.stringify(canonical(payload))),
      verifierRecord.publicKeyPem,
      Buffer.from(attestation.signature, 'base64url'),
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) denied.push('attestation_signature_invalid');

  const decision = denied.length > 0 ? 'denied' : unknown.length > 0 ? 'unknown' : 'verified';
  const reasonCodes = decision === 'verified'
    ? ['provider_verifiable_provenance_verified']
    : [...denied, ...unknown];

  return result({
    decision,
    reasonCodes,
    receipt,
    attestation,
    verifierRecord,
    observedAt: observedAt.text,
  });
}

module.exports = {
  GROUP_FEDERATION_MAPPING_PROVENANCE_ATTESTATION_SCHEMA,
  GROUP_FEDERATION_MAPPING_PROVENANCE_RESULT_SCHEMA,
  PROVENANCE_DECISIONS,
  PROVENANCE_POLICY_REF,
  SIGNATURE_ALGORITHM,
  TRUST_RECORD_MAX_AGE_SECONDS,
  createFederationMappingProvenanceAttestation,
  verifyFederationMappingProvenance,
};
