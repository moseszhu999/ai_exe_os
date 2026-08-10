'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createGroupOrganizationLink,
  createGroupRoleContextLink,
  createGroupSubjectLink,
  projectFederationLinkStatus,
} = require('../src/group-fabric/identity-federation.cjs');
const {
  GROUP_FEDERATION_MAPPING_VERIFICATION_REQUEST_SCHEMA,
  verifyGroupFederationMapping,
} = require('../src/group-fabric/federation-mapping-verifier.cjs');

function links() {
  const subjectLink = createGroupSubjectLink({
    linkRef: 'group:subject-link:person-001',
    groupRef: 'group:subject:person-001',
    endpoints: [
      { domain: 'trainingos', ref: 'trainingos:human-ref:person-001' },
      { domain: 'tradeos', ref: 'tradeos:actor-ref:person-001' },
    ],
    purposeCodes: ['work-entry'],
    evidenceRefs: ['evidence:subject:001'],
    verificationReceiptRef: 'evidence:verification:subject-001',
    verificationPolicyRef: 'group:identity-policy:explicit-domain-link-v1',
    verifiedAt: '2026-08-10T10:00:00Z',
    validFrom: '2026-08-10T10:00:00Z',
    validUntil: '2026-09-10T10:00:00Z',
  });
  const organizationLink = createGroupOrganizationLink({
    linkRef: 'group:organization-link:org-001',
    groupRef: 'group:organization:org-001',
    endpoints: [
      { domain: 'trainingos', ref: 'trainingos:organization:org-001' },
      { domain: 'tradeos', ref: 'tradeos:organization:org-001' },
    ],
    purposeCodes: ['work-entry'],
    evidenceRefs: ['evidence:organization:001'],
    verificationReceiptRef: 'evidence:verification:organization-001',
    verificationPolicyRef: 'group:identity-policy:explicit-domain-link-v1',
    verifiedAt: '2026-08-10T10:00:00Z',
    validFrom: '2026-08-10T10:00:00Z',
    validUntil: '2026-09-10T10:00:00Z',
  });
  const roleContextLink = createGroupRoleContextLink({
    linkRef: 'group:role-context-link:person-001-org-001',
    groupSubjectRef: subjectLink.groupRef,
    groupOrganizationRef: organizationLink.groupRef,
    subjectLink,
    organizationLink,
    domainRoles: [
      {
        domain: 'trainingos',
        roleRef: 'trainingos:role-ref:teacher',
        roleCode: 'teacher',
        observedAt: '2026-08-10T10:00:10Z',
        evidenceRef: 'evidence:role:trainingos',
      },
      {
        domain: 'tradeos',
        roleRef: 'tradeos:role-ref:reviewer',
        roleCode: 'reviewer',
        observedAt: '2026-08-10T10:00:10Z',
        evidenceRef: 'evidence:role:tradeos',
      },
    ],
    purposeCodes: ['work-entry'],
    evidenceRefs: ['evidence:role-context:001'],
    observedAt: '2026-08-10T10:00:20Z',
  });
  return { subjectLink, organizationLink, roleContextLink };
}

function request(overrides = {}) {
  const { subjectLink, organizationLink, roleContextLink } = links();
  const statusAt = '2026-08-10T10:01:00Z';
  return {
    schema: GROUP_FEDERATION_MAPPING_VERIFICATION_REQUEST_SCHEMA,
    requestRef: 'group:federation-verification-request:001',
    subjectLink,
    subjectStatus: projectFederationLinkStatus(subjectLink, statusAt),
    subjectLifecycleEvents: [],
    organizationLink,
    organizationStatus: projectFederationLinkStatus(organizationLink, statusAt),
    organizationLifecycleEvents: [],
    roleContextLink,
    domainBindings: [
      {
        domain: 'trainingos',
        subjectRef: 'trainingos:human-ref:person-001',
        organizationRef: 'trainingos:organization:org-001',
        roleRef: 'trainingos:role-ref:teacher',
      },
      {
        domain: 'tradeos',
        subjectRef: 'tradeos:actor-ref:person-001',
        organizationRef: 'tradeos:organization:org-001',
        roleRef: 'tradeos:role-ref:reviewer',
      },
    ],
    verificationPolicyRef: 'group:federation-verification-policy:explicit-domain-pair-v1',
    evidenceRefs: ['evidence:domain-pair-verification:001'],
    observedAt: '2026-08-10T10:02:00Z',
    ...overrides,
  };
}

test('fresh exact TrainingOS↔TradeOS mapping returns deterministic correlation-only verified receipt', () => {
  const firstInput = request();
  const secondInput = request();
  secondInput.domainBindings = [...secondInput.domainBindings].reverse();
  const first = verifyGroupFederationMapping(firstInput);
  const second = verifyGroupFederationMapping(secondInput);
  assert.equal(first.decision, 'verified');
  assert.equal(first.mappingVerified, true);
  assert.equal(first.receiptDigest, second.receiptDigest);
  assert.equal(first.correlationOnly, true);
  assert.equal(first.membershipCreated, false);
  assert.equal(first.roleEquivalenceAsserted, false);
  assert.equal(first.capabilityCredentialCreated, false);
  assert.equal(first.authorityGrantCreated, false);
  assert.equal(first.authorizationDecisionCreated, false);
  assert.equal(first.executionAuthorized, false);
  assert.equal(first.crossDomainAccessGranted, false);
  assert.equal(first.externalActionPerformed, false);
});

test('cross-subject mapping is denied without widening access', () => {
  const input = request();
  input.domainBindings = input.domainBindings.map((binding) => binding.domain === 'trainingos'
    ? { ...binding, subjectRef: 'trainingos:human-ref:person-999' }
    : binding);
  const receipt = verifyGroupFederationMapping(input);
  assert.equal(receipt.decision, 'denied');
  assert.match(receipt.reasonCodes.join(','), /trainingos_subject_ref_mismatch/);
  assert.equal(receipt.crossDomainAccessGranted, false);
});

test('cross-organization mapping is denied', () => {
  const input = request();
  input.domainBindings = input.domainBindings.map((binding) => binding.domain === 'tradeos'
    ? { ...binding, organizationRef: 'tradeos:organization:org-999' }
    : binding);
  const receipt = verifyGroupFederationMapping(input);
  assert.equal(receipt.decision, 'denied');
  assert.match(receipt.reasonCodes.join(','), /tradeos_organization_ref_mismatch/);
});

test('stale valid status becomes unknown rather than verified', () => {
  const receipt = verifyGroupFederationMapping(request({ observedAt: '2026-08-10T10:07:00Z' }));
  assert.equal(receipt.decision, 'unknown');
  assert.equal(receipt.mappingVerified, false);
  assert.deepEqual(receipt.reasonCodes, ['organization_status_stale', 'subject_status_stale']);
});

test('expired, revoked, and before-window links fail visibly closed', () => {
  const base = request();
  const expiredStatus = projectFederationLinkStatus(base.subjectLink, '2026-09-10T10:00:00Z');
  const expired = verifyGroupFederationMapping({
    ...base,
    subjectStatus: expiredStatus,
    observedAt: '2026-09-10T10:01:00Z',
  });
  assert.equal(expired.decision, 'denied');
  assert.match(expired.reasonCodes.join(','), /subject_link_expired/);

  const revokedEvents = [{
    status: 'revoked',
    effectiveAt: '2026-08-10T10:01:00Z',
    evidenceRef: 'evidence:revocation:subject-001',
  }];
  const revokedStatus = projectFederationLinkStatus(base.subjectLink, '2026-08-10T10:01:30Z', revokedEvents);
  const revoked = verifyGroupFederationMapping({
    ...base,
    subjectStatus: revokedStatus,
    subjectLifecycleEvents: revokedEvents,
    observedAt: '2026-08-10T10:02:00Z',
  });
  assert.equal(revoked.decision, 'denied');
  assert.match(revoked.reasonCodes.join(','), /subject_link_revoked/);

  const { subjectLink, organizationLink } = links();
  const beforeSubject = projectFederationLinkStatus(subjectLink, '2026-08-10T09:59:30Z');
  const beforeOrganization = projectFederationLinkStatus(organizationLink, '2026-08-10T09:59:30Z');
  const unknown = verifyGroupFederationMapping({
    ...base,
    subjectStatus: beforeSubject,
    organizationStatus: beforeOrganization,
    observedAt: '2026-08-10T10:00:00Z',
  });
  assert.equal(unknown.decision, 'unknown');
  assert.match(unknown.reasonCodes.join(','), /subject_status_unknown/);
});

test('role-context mismatch is denied and never treated as role equivalence', () => {
  const input = request();
  input.domainBindings = input.domainBindings.map((binding) => binding.domain === 'trainingos'
    ? { ...binding, roleRef: 'trainingos:role-ref:student' }
    : binding);
  const receipt = verifyGroupFederationMapping(input);
  assert.equal(receipt.decision, 'denied');
  assert.match(receipt.reasonCodes.join(','), /trainingos_role_context_mismatch/);
  assert.equal(receipt.roleEquivalenceAsserted, false);
});

test('role-bound request without role context is denied', () => {
  const receipt = verifyGroupFederationMapping({ ...request(), roleContextLink: null });
  assert.equal(receipt.decision, 'denied');
  assert.match(receipt.reasonCodes.join(','), /role_context_missing/);
});

test('PII and secret-shaped evidence or domain refs are rejected before receipt creation', () => {
  assert.throws(() => verifyGroupFederationMapping({
    ...request(),
    evidenceRefs: ['evidence:user@example.com'],
  }), /email-like PII/);
  const input = request();
  input.domainBindings = input.domainBindings.map((binding) => binding.domain === 'trainingos'
    ? { ...binding, subjectRef: 'trainingos:human-ref:token=abc' }
    : binding);
  assert.throws(() => verifyGroupFederationMapping(input), /secret\/session-like/);
});

test('tampered status evidence is rejected rather than downgraded into plausible truth', () => {
  const input = request();
  input.subjectStatus = { ...input.subjectStatus, status: 'expired' };
  assert.throws(() => verifyGroupFederationMapping(input), /does not match link\/lifecycle truth/);
});

test('subject and organization links must cover the same exact domain pair', () => {
  const input = request();
  const organizationLink = createGroupOrganizationLink({
    linkRef: 'group:organization-link:org-002',
    groupRef: 'group:organization:org-002',
    endpoints: [
      { domain: 'trainingos', ref: 'trainingos:organization:org-001' },
      { domain: 'aiexe', ref: 'aiexe:organization:org-001' },
    ],
    purposeCodes: ['work-entry'],
    evidenceRefs: ['evidence:organization:002'],
    verificationReceiptRef: 'evidence:verification:organization-002',
    verificationPolicyRef: 'group:identity-policy:explicit-domain-link-v1',
    verifiedAt: '2026-08-10T10:00:00Z',
    validFrom: '2026-08-10T10:00:00Z',
    validUntil: '2026-09-10T10:00:00Z',
  });
  input.organizationLink = organizationLink;
  input.organizationStatus = projectFederationLinkStatus(organizationLink, '2026-08-10T10:01:00Z');
  input.roleContextLink = null;
  input.domainBindings = input.domainBindings.map(({ roleRef, ...binding }) => binding);
  const receipt = verifyGroupFederationMapping(input);
  assert.equal(receipt.decision, 'denied');
  assert.match(receipt.reasonCodes.join(','), /domain_pair_mismatch/);
});

test('receipt digest binds the exact lifecycle evidence set even when projected status is the same', () => {
  const base = request();
  const eventsA = [{ status: 'revoked', effectiveAt: '2026-08-10T10:01:00Z', evidenceRef: 'evidence:revocation:a' }];
  const eventsB = [{ status: 'revoked', effectiveAt: '2026-08-10T10:01:00Z', evidenceRef: 'evidence:revocation:b' }];
  const statusA = projectFederationLinkStatus(base.subjectLink, '2026-08-10T10:01:30Z', eventsA);
  const statusB = projectFederationLinkStatus(base.subjectLink, '2026-08-10T10:01:30Z', eventsB);
  assert.equal(statusA.statusDigest, statusB.statusDigest);
  const receiptA = verifyGroupFederationMapping({
    ...base,
    subjectStatus: statusA,
    subjectLifecycleEvents: eventsA,
    observedAt: '2026-08-10T10:02:00Z',
  });
  const receiptB = verifyGroupFederationMapping({
    ...base,
    subjectStatus: statusB,
    subjectLifecycleEvents: eventsB,
    observedAt: '2026-08-10T10:02:00Z',
  });
  assert.notEqual(receiptA.subjectLifecycleDigest, receiptB.subjectLifecycleDigest);
  assert.notEqual(receiptA.receiptDigest, receiptB.receiptDigest);
});
