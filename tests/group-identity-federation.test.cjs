'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createGroupOrganizationLink,
  createGroupRoleContextLink,
  createGroupSubjectLink,
  projectFederationLinkStatus,
} = require('../src/group-fabric/identity-federation.cjs');

function subjectLinkInput(overrides = {}) {
  return {
    linkRef: 'group:subject-link:person-001',
    groupRef: 'group:subject:person-001',
    endpoints: [
      { domain: 'trainingos', ref: 'trainingos:human-ref:person-001' },
      { domain: 'tradeos', ref: 'tradeos:actor-ref:person-001' },
    ],
    purposeCodes: ['work-entry', 'capability-check'],
    evidenceRefs: ['evidence:identity-match:001'],
    verificationReceiptRef: 'evidence:verification:subject-001',
    verificationPolicyRef: 'group:identity-policy:explicit-domain-link-v1',
    verifiedAt: '2026-08-10T00:00:00Z',
    validFrom: '2026-08-10T00:00:00Z',
    validUntil: '2027-08-10T00:00:00Z',
    ...overrides,
  };
}

function organizationLinkInput(overrides = {}) {
  return {
    linkRef: 'group:organization-link:org-001',
    groupRef: 'group:organization:org-001',
    endpoints: [
      { domain: 'trainingos', ref: 'trainingos:organization:org-001' },
      { domain: 'tradeos', ref: 'tradeos:organization:org-001' },
    ],
    purposeCodes: ['work-entry', 'service-routing'],
    evidenceRefs: ['evidence:organization-match:001'],
    verificationReceiptRef: 'evidence:verification:organization-001',
    verificationPolicyRef: 'group:identity-policy:explicit-domain-link-v1',
    verifiedAt: '2026-08-10T00:00:00Z',
    validFrom: '2026-08-10T00:00:00Z',
    validUntil: '2027-08-10T00:00:00Z',
    ...overrides,
  };
}

test('subject link is a deterministic mapping receipt and never a login or authority object', () => {
  const link = createGroupSubjectLink(subjectLinkInput());
  const second = createGroupSubjectLink({ ...subjectLinkInput(), endpoints: [...subjectLinkInput().endpoints].reverse() });
  assert.equal(link.linkDigest, second.linkDigest);
  assert.equal(link.mappingReceipt, true);
  assert.equal(link.loginCredential, false);
  assert.equal(link.sessionCreated, false);
  assert.equal(link.membershipCreated, false);
  assert.equal(link.authorityGrantCreated, false);
  assert.equal(link.crossDomainAccessGranted, false);
  assert.equal(link.domainWritePerformed, false);
  assert.equal(Object.isFrozen(link), true);
});

test('organization link does not create organization membership or access', () => {
  const link = createGroupOrganizationLink(organizationLinkInput());
  assert.equal(link.kind, 'organization');
  assert.equal(link.membershipCreated, false);
  assert.equal(link.roleEquivalenceAsserted, false);
  assert.equal(link.crossDomainAccessGranted, false);
});

test('federation link status is valid only inside its verified validity window', () => {
  const link = createGroupSubjectLink(subjectLinkInput());
  const before = projectFederationLinkStatus(link, '2026-08-09T23:59:59Z');
  const valid = projectFederationLinkStatus(link, '2026-08-10T01:00:00Z');
  const expired = projectFederationLinkStatus(link, '2027-08-10T00:00:00Z');
  assert.equal(before.status, 'unknown');
  assert.equal(valid.status, 'valid');
  assert.equal(expired.status, 'expired');
  for (const projection of [before, valid, expired]) {
    assert.equal(projection.authorityGrantCreated, false);
    assert.equal(projection.crossDomainAccessGranted, false);
  }
});

test('revocation fails closed and remains independent of domain access', () => {
  const link = createGroupOrganizationLink(organizationLinkInput());
  const status = projectFederationLinkStatus(link, '2026-08-12T00:00:00Z', [
    { status: 'revoked', effectiveAt: '2026-08-11T00:00:00Z', evidenceRef: 'evidence:revocation:001' },
  ]);
  assert.equal(status.status, 'revoked');
  assert.equal(status.reasonCode, 'link_revoked');
  assert.equal(status.crossDomainAccessGranted, false);
});

test('same-domain endpoints are rejected because federation must not alias one domain to itself', () => {
  assert.throws(() => createGroupSubjectLink(subjectLinkInput({
    endpoints: [
      { domain: 'trainingos', ref: 'trainingos:human-ref:person-001' },
      { domain: 'trainingos', ref: 'trainingos:human-ref:person-002' },
    ],
  })), /distinct domains/);
});

test('email-like PII and secret/session-shaped references are rejected', () => {
  assert.throws(() => createGroupSubjectLink(subjectLinkInput({
    groupRef: 'group:subject:user@example.com',
  })), /email-like PII/);
  assert.throws(() => createGroupOrganizationLink(organizationLinkInput({
    evidenceRefs: ['evidence:token=secret'],
  })), /secret\/session-like/);
});

test('unknown input fields fail closed rather than becoming hidden identity metadata', () => {
  assert.throws(() => createGroupSubjectLink({
    ...subjectLinkInput(),
    email: 'user@example.com',
  }), /unsupported field: email/);
});

test('role context binds observed domain roles without asserting equivalence or authority', () => {
  const subjectLink = createGroupSubjectLink(subjectLinkInput());
  const organizationLink = createGroupOrganizationLink(organizationLinkInput());
  const context = createGroupRoleContextLink({
    linkRef: 'group:role-context-link:person-001-org-001',
    groupSubjectRef: 'group:subject:person-001',
    groupOrganizationRef: 'group:organization:org-001',
    subjectLink,
    organizationLink,
    domainRoles: [
      {
        domain: 'trainingos',
        roleRef: 'trainingos:role-ref:teacher',
        roleCode: 'teacher',
        observedAt: '2026-08-10T00:05:00Z',
        evidenceRef: 'evidence:training-role:001',
      },
      {
        domain: 'tradeos',
        roleRef: 'tradeos:role-ref:reviewer',
        roleCode: 'reviewer',
        observedAt: '2026-08-10T00:05:00Z',
        evidenceRef: 'evidence:trade-role:001',
      },
    ],
    purposeCodes: ['work-entry'],
    evidenceRefs: ['evidence:role-context:001'],
    observedAt: '2026-08-10T00:10:00Z',
  });
  assert.equal(context.roleContextOnly, true);
  assert.equal(context.roleEquivalenceAsserted, false);
  assert.equal(context.organizationMembershipInferred, false);
  assert.equal(context.capabilityCredentialCreated, false);
  assert.equal(context.authorityGrantCreated, false);
  assert.equal(context.executionAuthorized, false);
  assert.equal(context.crossDomainAccessGranted, false);
});

test('role context rejects group subject or organization mismatch', () => {
  const subjectLink = createGroupSubjectLink(subjectLinkInput());
  const organizationLink = createGroupOrganizationLink(organizationLinkInput());
  const base = {
    linkRef: 'group:role-context-link:person-001-org-001',
    groupSubjectRef: 'group:subject:person-001',
    groupOrganizationRef: 'group:organization:org-001',
    subjectLink,
    organizationLink,
    domainRoles: [{
      domain: 'trainingos',
      roleRef: 'trainingos:role-ref:teacher',
      roleCode: 'teacher',
      observedAt: '2026-08-10T00:05:00Z',
      evidenceRef: 'evidence:training-role:001',
    }],
    purposeCodes: ['work-entry'],
    evidenceRefs: ['evidence:role-context:001'],
    observedAt: '2026-08-10T00:10:00Z',
  };
  assert.throws(() => createGroupRoleContextLink({ ...base, groupSubjectRef: 'group:subject:person-999' }), /group subject/);
  assert.throws(() => createGroupRoleContextLink({ ...base, groupOrganizationRef: 'group:organization:org-999' }), /group organization/);
});

test('role context rejects a role from a domain not covered by both identity links', () => {
  const subjectLink = createGroupSubjectLink(subjectLinkInput());
  const organizationLink = createGroupOrganizationLink(organizationLinkInput());
  assert.throws(() => createGroupRoleContextLink({
    linkRef: 'group:role-context-link:person-001-org-001',
    groupSubjectRef: 'group:subject:person-001',
    groupOrganizationRef: 'group:organization:org-001',
    subjectLink,
    organizationLink,
    domainRoles: [{
      domain: 'aiexe',
      roleRef: 'aiexe:role-ref:operator',
      roleCode: 'operator',
      observedAt: '2026-08-10T00:05:00Z',
      evidenceRef: 'evidence:aiexe-role:001',
    }],
    purposeCodes: ['work-entry'],
    evidenceRefs: ['evidence:role-context:001'],
    observedAt: '2026-08-10T00:10:00Z',
  }), /not covered by both subject and organization links/);
});
