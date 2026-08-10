'use strict';

const { createHash } = require('node:crypto');
const {
  DOMAIN_CODES,
  createGroupRoleContextLink,
  projectFederationLinkStatus,
} = require('./identity-federation.cjs');

const GROUP_FEDERATION_MAPPING_VERIFICATION_REQUEST_SCHEMA = 'group.federation-mapping-verification.request.v1';
const GROUP_FEDERATION_MAPPING_VERIFICATION_RECEIPT_SCHEMA = 'group.federation-mapping-verification.receipt.v1';
const VERIFICATION_POLICY_REF = 'group:federation-verification-policy:explicit-domain-pair-v1';
const MAX_STATUS_AGE_SECONDS = 300;
const DECISIONS = Object.freeze(['verified', 'denied', 'unknown']);

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) freezeDeep(nested);
  return value;
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a plain object`);
  return value;
}

function assertAllowedKeys(input, allowed, label) {
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new TypeError(`${label} contains unsupported field: ${key}`);
}

function text(value, label, max = 240) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw new TypeError(`${label} must be a bounded non-empty string`);
  return trimmed;
}

function timestamp(value, label) {
  const normalized = text(value, label, 40);
  const time = Date.parse(normalized);
  if (!Number.isFinite(time) || !normalized.endsWith('Z')) throw new TypeError(`${label} must be an ISO-8601 UTC timestamp`);
  return { text: normalized, time };
}

function safeRef(value, label, prefix) {
  const normalized = text(value, label, 240);
  if (!normalized.startsWith(prefix)) throw new TypeError(`${label} must start with ${prefix}`);
  if (/@[^/\s]+\.[A-Za-z]{2,}/.test(normalized)) throw new TypeError(`${label} must not contain email-like PII`);
  if (/bearer|password|secret|token=|api[_-]?key|cookie|session=|jwt/i.test(normalized)) throw new TypeError(`${label} must not contain secret/session-like material`);
  if (!/^[A-Za-z0-9][A-Za-z0-9:._@/-]*$/.test(normalized)) throw new TypeError(`${label} contains invalid characters`);
  return normalized;
}

function safeCode(value, label) {
  const normalized = text(value, label, 80);
  if (!/^[a-z][a-z0-9._-]{0,79}$/.test(normalized)) throw new TypeError(`${label} must be a bounded code`);
  return normalized;
}

function safeDomainRef(value, label, domain, kind) {
  const normalized = safeRef(value, label, `${domain}:`);
  if (kind === 'subject' && !/(human|actor|subject|user)-?ref:|:(human|actor|subject|user):/i.test(normalized)) throw new TypeError(`${label} must be an explicit subject/actor reference`);
  if (kind === 'organization' && !/organization|org/i.test(normalized)) throw new TypeError(`${label} must be an explicit organization reference`);
  if (kind === 'role' && !/role-ref:/i.test(normalized)) throw new TypeError(`${label} must be an explicit role reference`);
  return normalized;
}

function evidenceRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) throw new TypeError('evidenceRefs must be a non-empty bounded array');
  const refs = value.map((item) => safeRef(item, 'evidenceRef', 'evidence:'));
  if (new Set(refs).size !== refs.length) throw new TypeError('evidenceRefs must not contain duplicates');
  return Object.freeze([...refs].sort());
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function sameCanonical(left, right) { return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)); }

function normalizeBinding(input) {
  plainObject(input, 'domain binding');
  assertAllowedKeys(input, new Set(['domain', 'subjectRef', 'organizationRef', 'roleRef']), 'domain binding');
  const domain = safeCode(input.domain, 'domain binding domain');
  if (!DOMAIN_CODES.includes(domain)) throw new TypeError(`unsupported federation domain: ${domain}`);
  const binding = {
    domain,
    subjectRef: safeDomainRef(input.subjectRef, 'domain binding subjectRef', domain, 'subject'),
    organizationRef: safeDomainRef(input.organizationRef, 'domain binding organizationRef', domain, 'organization'),
  };
  if (input.roleRef !== undefined) binding.roleRef = safeDomainRef(input.roleRef, 'domain binding roleRef', domain, 'role');
  return freezeDeep(binding);
}

function normalizeBindings(value) {
  if (!Array.isArray(value) || value.length !== 2) throw new TypeError('domainBindings must contain exactly two domains in v1');
  const bindings = value.map(normalizeBinding).sort((a, b) => a.domain.localeCompare(b.domain));
  if (bindings[0].domain === bindings[1].domain) throw new TypeError('domainBindings must cover two distinct domains');
  return Object.freeze(bindings);
}

function normalizeLifecycleEvents(value, label) {
  if (!Array.isArray(value) || value.length > 32) throw new TypeError(`${label}LifecycleEvents must be a bounded array`);
  const events = value.map((event) => {
    plainObject(event, `${label} lifecycle event`);
    assertAllowedKeys(event, new Set(['status', 'effectiveAt', 'evidenceRef']), `${label} lifecycle event`);
    if (event.status !== 'revoked') throw new TypeError(`${label} lifecycle event status must be revoked in v1`);
    return freezeDeep({
      status: 'revoked',
      effectiveAt: timestamp(event.effectiveAt, `${label} lifecycle event effectiveAt`).text,
      evidenceRef: safeRef(event.evidenceRef, `${label} lifecycle event evidenceRef`, 'evidence:'),
    });
  }).sort((left, right) => left.effectiveAt.localeCompare(right.effectiveAt) || left.evidenceRef.localeCompare(right.evidenceRef));
  const keys = events.map((event) => `${event.effectiveAt}|${event.evidenceRef}`);
  if (new Set(keys).size !== keys.length) throw new TypeError(`${label}LifecycleEvents must not contain duplicates`);
  return Object.freeze(events);
}

function exactStatus(link, suppliedStatus, lifecycleEvents, label) {
  plainObject(suppliedStatus, `${label} status`);
  const normalizedLifecycleEvents = normalizeLifecycleEvents(lifecycleEvents, label);
  const reconstructed = projectFederationLinkStatus(link, suppliedStatus.observedAt, normalizedLifecycleEvents);
  if (!sameCanonical(reconstructed, suppliedStatus)) throw new TypeError(`${label} status does not match link/lifecycle truth`);
  return { status: reconstructed, lifecycleDigest: digest(normalizedLifecycleEvents) };
}

function exactRoleContext(roleContextLink, subjectLink, organizationLink) {
  if (roleContextLink === null || roleContextLink === undefined) return null;
  plainObject(roleContextLink, 'roleContextLink');
  const reconstructed = createGroupRoleContextLink({
    linkRef: roleContextLink.linkRef,
    groupSubjectRef: roleContextLink.groupSubjectRef,
    groupOrganizationRef: roleContextLink.groupOrganizationRef,
    subjectLink,
    organizationLink,
    domainRoles: roleContextLink.domainRoles,
    purposeCodes: roleContextLink.purposeCodes,
    evidenceRefs: roleContextLink.evidenceRefs,
    observedAt: roleContextLink.observedAt,
  });
  if (!sameCanonical(reconstructed, roleContextLink)) throw new TypeError('roleContextLink does not match canonical federation truth');
  return reconstructed;
}

function endpointMap(link) {
  if (!Array.isArray(link?.endpoints) || link.endpoints.length !== 2) throw new TypeError('federation link endpoints are invalid');
  return new Map(link.endpoints.map((endpoint) => [endpoint.domain, endpoint.ref]));
}

function statusFinding(status, verificationTime, label) {
  const observed = timestamp(status.observedAt, `${label} status observedAt`);
  if (observed.time > verificationTime) throw new TypeError(`${label} status observation must not be in the future`);
  const ageSeconds = Math.floor((verificationTime - observed.time) / 1000);
  if (ageSeconds > MAX_STATUS_AGE_SECONDS) return { severity: 'unknown', code: `${label}_status_stale`, ageSeconds };
  if (status.status === 'valid') return { severity: 'ok', code: `${label}_status_valid`, ageSeconds };
  if (status.status === 'unknown') return { severity: 'unknown', code: `${label}_status_unknown`, ageSeconds };
  if (status.status === 'expired') return { severity: 'denied', code: `${label}_link_expired`, ageSeconds };
  if (status.status === 'revoked') return { severity: 'denied', code: `${label}_link_revoked`, ageSeconds };
  throw new TypeError(`${label} status is unsupported`);
}

function verifyGroupFederationMapping(input) {
  plainObject(input, 'verification request');
  assertAllowedKeys(input, new Set([
    'schema', 'requestRef', 'subjectLink', 'subjectStatus', 'subjectLifecycleEvents',
    'organizationLink', 'organizationStatus', 'organizationLifecycleEvents',
    'roleContextLink', 'domainBindings', 'verificationPolicyRef', 'evidenceRefs', 'observedAt',
  ]), 'verification request');
  if (input.schema !== GROUP_FEDERATION_MAPPING_VERIFICATION_REQUEST_SCHEMA) throw new TypeError('verification request schema mismatch');

  const observedAt = timestamp(input.observedAt, 'observedAt');
  const requestRef = safeRef(input.requestRef, 'requestRef', 'group:federation-verification-request:');
  const verificationPolicyRef = safeRef(input.verificationPolicyRef, 'verificationPolicyRef', 'group:federation-verification-policy:');
  if (verificationPolicyRef !== VERIFICATION_POLICY_REF) throw new TypeError('unsupported federation verification policy');
  const acceptedEvidenceRefs = evidenceRefs(input.evidenceRefs);
  const domainBindings = normalizeBindings(input.domainBindings);

  const subjectTruth = exactStatus(input.subjectLink, input.subjectStatus, input.subjectLifecycleEvents, 'subject');
  const organizationTruth = exactStatus(input.organizationLink, input.organizationStatus, input.organizationLifecycleEvents, 'organization');
  const subjectStatus = subjectTruth.status;
  const organizationStatus = organizationTruth.status;
  const roleContextLink = exactRoleContext(input.roleContextLink, input.subjectLink, input.organizationLink);

  const subjectEndpoints = endpointMap(input.subjectLink);
  const organizationEndpoints = endpointMap(input.organizationLink);
  const bindingDomains = domainBindings.map((binding) => binding.domain);
  const subjectDomains = [...subjectEndpoints.keys()].sort();
  const organizationDomains = [...organizationEndpoints.keys()].sort();
  const deniedReasons = [];
  const unknownReasons = [];

  if (!sameCanonical(bindingDomains, subjectDomains) || !sameCanonical(bindingDomains, organizationDomains)) deniedReasons.push('domain_pair_mismatch');
  for (const binding of domainBindings) {
    if (subjectEndpoints.get(binding.domain) !== binding.subjectRef) deniedReasons.push(`${binding.domain}_subject_ref_mismatch`);
    if (organizationEndpoints.get(binding.domain) !== binding.organizationRef) deniedReasons.push(`${binding.domain}_organization_ref_mismatch`);
  }

  const subjectFinding = statusFinding(subjectStatus, observedAt.time, 'subject');
  const organizationFinding = statusFinding(organizationStatus, observedAt.time, 'organization');
  for (const finding of [subjectFinding, organizationFinding]) {
    if (finding.severity === 'denied') deniedReasons.push(finding.code);
    if (finding.severity === 'unknown') unknownReasons.push(finding.code);
  }

  if (roleContextLink) {
    const roleByDomain = new Map(roleContextLink.domainRoles.map((role) => [role.domain, role.roleRef]));
    for (const binding of domainBindings) {
      const expectedRole = binding.roleRef;
      const actualRole = roleByDomain.get(binding.domain);
      if ((expectedRole || actualRole) && expectedRole !== actualRole) deniedReasons.push(`${binding.domain}_role_context_mismatch`);
    }
    if (roleContextLink.subjectLinkRef !== input.subjectLink.linkRef || roleContextLink.subjectLinkDigest !== input.subjectLink.linkDigest) deniedReasons.push('role_context_subject_link_mismatch');
    if (roleContextLink.organizationLinkRef !== input.organizationLink.linkRef || roleContextLink.organizationLinkDigest !== input.organizationLink.linkDigest) deniedReasons.push('role_context_organization_link_mismatch');
  } else if (domainBindings.some((binding) => binding.roleRef)) {
    deniedReasons.push('role_context_missing');
  }

  const uniqueDenied = [...new Set(deniedReasons)].sort();
  const uniqueUnknown = [...new Set(unknownReasons)].sort();
  const decision = uniqueDenied.length > 0 ? 'denied' : uniqueUnknown.length > 0 ? 'unknown' : 'verified';
  const reasonCodes = Object.freeze(decision === 'verified' ? ['exact_domain_pair_verified'] : [...new Set([...uniqueDenied, ...uniqueUnknown])].sort());

  const normalizedRequest = {
    schema: GROUP_FEDERATION_MAPPING_VERIFICATION_REQUEST_SCHEMA,
    requestRef,
    subjectLinkRef: input.subjectLink.linkRef,
    subjectLinkDigest: input.subjectLink.linkDigest,
    subjectStatusDigest: subjectStatus.statusDigest,
    subjectLifecycleDigest: subjectTruth.lifecycleDigest,
    organizationLinkRef: input.organizationLink.linkRef,
    organizationLinkDigest: input.organizationLink.linkDigest,
    organizationStatusDigest: organizationStatus.statusDigest,
    organizationLifecycleDigest: organizationTruth.lifecycleDigest,
    roleContextLinkRef: roleContextLink?.linkRef ?? null,
    roleContextLinkDigest: roleContextLink?.linkDigest ?? null,
    domainBindings,
    verificationPolicyRef,
    evidenceRefs: acceptedEvidenceRefs,
    observedAt: observedAt.text,
    maxStatusAgeSeconds: MAX_STATUS_AGE_SECONDS,
  };
  const requestDigest = digest(normalizedRequest);

  const unsignedReceipt = {
    schema: GROUP_FEDERATION_MAPPING_VERIFICATION_RECEIPT_SCHEMA,
    verificationReceiptRef: `group:federation-verification-receipt:${requestDigest.slice(0, 32)}`,
    requestRef,
    requestDigest,
    decision,
    reasonCodes,
    mappingVerified: decision === 'verified',
    subjectLinkRef: input.subjectLink.linkRef,
    subjectLinkDigest: input.subjectLink.linkDigest,
    subjectStatus: subjectStatus.status,
    subjectStatusDigest: subjectStatus.statusDigest,
    subjectLifecycleDigest: subjectTruth.lifecycleDigest,
    organizationLinkRef: input.organizationLink.linkRef,
    organizationLinkDigest: input.organizationLink.linkDigest,
    organizationStatus: organizationStatus.status,
    organizationStatusDigest: organizationStatus.statusDigest,
    organizationLifecycleDigest: organizationTruth.lifecycleDigest,
    roleContextLinkRef: roleContextLink?.linkRef ?? null,
    roleContextLinkDigest: roleContextLink?.linkDigest ?? null,
    domainBindings,
    verificationPolicyRef,
    evidenceRefs: acceptedEvidenceRefs,
    observedAt: observedAt.text,
    maxStatusAgeSeconds: MAX_STATUS_AGE_SECONDS,
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
  return freezeDeep({ ...unsignedReceipt, receiptDigest: digest(unsignedReceipt) });
}

module.exports = {
  DECISIONS,
  GROUP_FEDERATION_MAPPING_VERIFICATION_RECEIPT_SCHEMA,
  GROUP_FEDERATION_MAPPING_VERIFICATION_REQUEST_SCHEMA,
  MAX_STATUS_AGE_SECONDS,
  VERIFICATION_POLICY_REF,
  verifyGroupFederationMapping,
};
