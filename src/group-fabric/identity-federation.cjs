'use strict';

const { createHash } = require('node:crypto');

const GROUP_SUBJECT_LINK_SCHEMA = 'group.subject-link.v1';
const GROUP_ORGANIZATION_LINK_SCHEMA = 'group.organization-link.v1';
const GROUP_ROLE_CONTEXT_LINK_SCHEMA = 'group.role-context-link.v1';
const GROUP_FEDERATION_LINK_STATUS_SCHEMA = 'group.federation-link.status.v1';

const DOMAIN_CODES = Object.freeze(['tradeos', 'trainingos', 'aiexe', 'shared-media']);
const STATUS_CODES = Object.freeze(['valid', 'expired', 'revoked', 'unknown']);
const LINK_KINDS = Object.freeze(['subject', 'organization']);

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

function text(value, label, max = 240) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw new TypeError(`${label} must be a bounded non-empty string`);
  return trimmed;
}

function timestamp(value, label) {
  const normalized = text(value, label, 40);
  const time = Date.parse(normalized);
  if (!Number.isFinite(time) || !normalized.endsWith('Z')) {
    throw new TypeError(`${label} must be an ISO-8601 UTC timestamp`);
  }
  return { text: normalized, time };
}

function safeRef(value, label, prefix) {
  const normalized = text(value, label, 240);
  if (!normalized.startsWith(prefix)) throw new TypeError(`${label} must start with ${prefix}`);
  if (/@[^/\s]+\.[A-Za-z]{2,}/.test(normalized)) throw new TypeError(`${label} must not contain email-like PII`);
  if (/bearer|password|secret|token=|api[_-]?key|cookie|session=/i.test(normalized)) {
    throw new TypeError(`${label} must not contain secret/session-like material`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9:._@/-]*$/.test(normalized)) throw new TypeError(`${label} contains invalid characters`);
  return normalized;
}

function safeDomainRef(value, label, domain, kind) {
  const prefix = `${domain}:`;
  const normalized = safeRef(value, label, prefix);
  if (kind === 'subject' && !/(human|actor|subject|user)-?ref:|:(human|actor|subject|user):/i.test(normalized)) {
    throw new TypeError(`${label} must be an explicit subject/actor reference`);
  }
  if (kind === 'organization' && !/organization|org/i.test(normalized)) {
    throw new TypeError(`${label} must be an explicit organization reference`);
  }
  return normalized;
}

function safeCode(value, label) {
  const normalized = text(value, label, 80);
  if (!/^[a-z][a-z0-9._-]{0,79}$/.test(normalized)) throw new TypeError(`${label} must be a bounded code`);
  return normalized;
}

function uniqueCodes(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
    throw new TypeError(`${label} must be a non-empty bounded array`);
  }
  const codes = value.map((item) => safeCode(item, label));
  if (new Set(codes).size !== codes.length) throw new TypeError(`${label} must not contain duplicates`);
  return Object.freeze([...codes].sort());
}

function evidenceRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    throw new TypeError('evidenceRefs must be a non-empty bounded array');
  }
  const refs = value.map((item) => safeRef(item, 'evidenceRef', 'evidence:'));
  if (new Set(refs).size !== refs.length) throw new TypeError('evidenceRefs must not contain duplicates');
  return Object.freeze([...refs].sort());
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function normalizeEndpoint(input, kind) {
  plainObject(input, `${kind} endpoint`);
  assertAllowedKeys(input, new Set(['domain', 'ref']), `${kind} endpoint`);
  const domain = safeCode(input.domain, `${kind} endpoint domain`);
  if (!DOMAIN_CODES.includes(domain)) throw new TypeError(`unsupported federation domain: ${domain}`);
  return freezeDeep({
    domain,
    ref: safeDomainRef(input.ref, `${kind} endpoint ref`, domain, kind),
  });
}

function normalizeEndpoints(value, kind) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new TypeError(`${kind} link requires exactly two domain endpoints in v1`);
  }
  const endpoints = value.map((item) => normalizeEndpoint(item, kind)).sort((a, b) => a.domain.localeCompare(b.domain));
  if (endpoints[0].domain === endpoints[1].domain) throw new TypeError(`${kind} link endpoints must come from distinct domains`);
  if (endpoints[0].ref === endpoints[1].ref) throw new TypeError(`${kind} link endpoints must be distinct references`);
  return Object.freeze(endpoints);
}

function normalizeValidity(input) {
  const verifiedAt = timestamp(input.verifiedAt, 'verifiedAt');
  const validFrom = timestamp(input.validFrom, 'validFrom');
  const validUntil = timestamp(input.validUntil, 'validUntil');
  if (validUntil.time <= validFrom.time) throw new TypeError('validUntil must be after validFrom');
  if (verifiedAt.time > validFrom.time) throw new TypeError('verifiedAt must not be after validFrom');
  return { verifiedAt: verifiedAt.text, validFrom: validFrom.text, validUntil: validUntil.text };
}

function baseFlags() {
  return {
    mappingReceipt: true,
    loginCredential: false,
    sessionCreated: false,
    membershipCreated: false,
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
}

function createLink(input, kind) {
  plainObject(input, `${kind} link`);
  assertAllowedKeys(input, new Set([
    'linkRef', 'groupRef', 'endpoints', 'purposeCodes', 'evidenceRefs',
    'verificationReceiptRef', 'verificationPolicyRef', 'verifiedAt', 'validFrom', 'validUntil',
  ]), `${kind} link`);

  const schema = kind === 'subject' ? GROUP_SUBJECT_LINK_SCHEMA : GROUP_ORGANIZATION_LINK_SCHEMA;
  const groupPrefix = kind === 'subject' ? 'group:subject:' : 'group:organization:';
  const linkPrefix = kind === 'subject' ? 'group:subject-link:' : 'group:organization-link:';
  const validity = normalizeValidity(input);

  const unsigned = {
    schema,
    kind,
    linkRef: safeRef(input.linkRef, 'linkRef', linkPrefix),
    groupRef: safeRef(input.groupRef, 'groupRef', groupPrefix),
    endpoints: normalizeEndpoints(input.endpoints, kind),
    purposeCodes: uniqueCodes(input.purposeCodes, 'purposeCodes'),
    evidenceRefs: evidenceRefs(input.evidenceRefs),
    verificationReceiptRef: safeRef(input.verificationReceiptRef, 'verificationReceiptRef', 'evidence:verification:'),
    verificationPolicyRef: safeRef(input.verificationPolicyRef, 'verificationPolicyRef', 'group:identity-policy:'),
    ...validity,
    ...baseFlags(),
  };

  return freezeDeep({ ...unsigned, linkDigest: digest(unsigned) });
}

function createGroupSubjectLink(input) {
  return createLink(input, 'subject');
}

function createGroupOrganizationLink(input) {
  return createLink(input, 'organization');
}

function assertLink(link, kind) {
  plainObject(link, `${kind} link`);
  if (link.kind !== kind) throw new TypeError(`expected ${kind} link`);
  const expectedSchema = kind === 'subject' ? GROUP_SUBJECT_LINK_SCHEMA : GROUP_ORGANIZATION_LINK_SCHEMA;
  if (link.schema !== expectedSchema) throw new TypeError(`${kind} link schema mismatch`);
  const { linkDigest, ...unsigned } = link;
  if (typeof linkDigest !== 'string' || linkDigest !== digest(unsigned)) throw new TypeError(`${kind} link digest mismatch`);
  for (const [key, expected] of Object.entries(baseFlags())) {
    if (link[key] !== expected) throw new TypeError(`${kind} link truth boundary widened: ${key}`);
  }
  return link;
}

function projectFederationLinkStatus(link, observedAtInput, lifecycleEvents = []) {
  const kind = LINK_KINDS.includes(link?.kind) ? link.kind : null;
  if (!kind) throw new TypeError('federation link kind is invalid');
  assertLink(link, kind);
  const observedAt = timestamp(observedAtInput, 'observedAt');
  const validFrom = timestamp(link.validFrom, 'link.validFrom');
  const validUntil = timestamp(link.validUntil, 'link.validUntil');
  if (!Array.isArray(lifecycleEvents)) throw new TypeError('lifecycleEvents must be an array');

  let revokedAt = null;
  for (const event of lifecycleEvents) {
    plainObject(event, 'lifecycle event');
    assertAllowedKeys(event, new Set(['status', 'effectiveAt', 'evidenceRef']), 'lifecycle event');
    if (event.status !== 'revoked') throw new TypeError('only revoked lifecycle events are supported in v1');
    const effectiveAt = timestamp(event.effectiveAt, 'lifecycle event effectiveAt');
    if (effectiveAt.time > observedAt.time) continue;
    safeRef(event.evidenceRef, 'lifecycle event evidenceRef', 'evidence:');
    if (!revokedAt || effectiveAt.time < revokedAt.time) revokedAt = effectiveAt;
  }

  let status = 'unknown';
  let reasonCode = 'before_validity_window';
  if (revokedAt) {
    status = 'revoked';
    reasonCode = 'link_revoked';
  } else if (observedAt.time >= validUntil.time) {
    status = 'expired';
    reasonCode = 'validity_window_ended';
  } else if (observedAt.time >= validFrom.time) {
    status = 'valid';
    reasonCode = 'verified_link_within_validity_window';
  }

  const unsigned = {
    schema: GROUP_FEDERATION_LINK_STATUS_SCHEMA,
    linkRef: link.linkRef,
    linkDigest: link.linkDigest,
    kind,
    status,
    reasonCode,
    observedAt: observedAt.text,
    loginCredential: false,
    membershipCreated: false,
    authorityGrantCreated: false,
    crossDomainAccessGranted: false,
    domainWritePerformed: false,
    externalActionPerformed: false,
  };
  return freezeDeep({ ...unsigned, statusDigest: digest(unsigned) });
}

function normalizeDomainRole(input) {
  plainObject(input, 'domainRole');
  assertAllowedKeys(input, new Set(['domain', 'roleRef', 'roleCode', 'observedAt', 'evidenceRef']), 'domainRole');
  const domain = safeCode(input.domain, 'domainRole.domain');
  if (!DOMAIN_CODES.includes(domain)) throw new TypeError(`unsupported federation domain: ${domain}`);
  return freezeDeep({
    domain,
    roleRef: safeRef(input.roleRef, 'domainRole.roleRef', `${domain}:role-ref:`),
    roleCode: safeCode(input.roleCode, 'domainRole.roleCode'),
    observedAt: timestamp(input.observedAt, 'domainRole.observedAt').text,
    evidenceRef: safeRef(input.evidenceRef, 'domainRole.evidenceRef', 'evidence:'),
  });
}

function createGroupRoleContextLink(input) {
  plainObject(input, 'role context link');
  assertAllowedKeys(input, new Set([
    'linkRef', 'groupSubjectRef', 'groupOrganizationRef', 'subjectLink', 'organizationLink',
    'domainRoles', 'purposeCodes', 'evidenceRefs', 'observedAt',
  ]), 'role context link');

  const subjectLink = assertLink(input.subjectLink, 'subject');
  const organizationLink = assertLink(input.organizationLink, 'organization');
  const groupSubjectRef = safeRef(input.groupSubjectRef, 'groupSubjectRef', 'group:subject:');
  const groupOrganizationRef = safeRef(input.groupOrganizationRef, 'groupOrganizationRef', 'group:organization:');
  if (subjectLink.groupRef !== groupSubjectRef) throw new TypeError('role context group subject does not match subject link');
  if (organizationLink.groupRef !== groupOrganizationRef) throw new TypeError('role context group organization does not match organization link');

  if (!Array.isArray(input.domainRoles) || input.domainRoles.length < 1 || input.domainRoles.length > 4) {
    throw new TypeError('domainRoles must be a non-empty bounded array');
  }
  const domainRoles = input.domainRoles.map(normalizeDomainRole).sort((a, b) => a.domain.localeCompare(b.domain));
  if (new Set(domainRoles.map((role) => role.domain)).size !== domainRoles.length) {
    throw new TypeError('domainRoles may contain at most one observed role per domain in v1');
  }
  const subjectDomains = new Set(subjectLink.endpoints.map((endpoint) => endpoint.domain));
  const organizationDomains = new Set(organizationLink.endpoints.map((endpoint) => endpoint.domain));
  for (const role of domainRoles) {
    if (!subjectDomains.has(role.domain) || !organizationDomains.has(role.domain)) {
      throw new TypeError(`domain role ${role.domain} is not covered by both subject and organization links`);
    }
  }

  const observedAt = timestamp(input.observedAt, 'observedAt');
  for (const role of domainRoles) {
    if (Date.parse(role.observedAt) > observedAt.time) throw new TypeError('domain role observation must not be in the future');
  }

  const unsigned = {
    schema: GROUP_ROLE_CONTEXT_LINK_SCHEMA,
    linkRef: safeRef(input.linkRef, 'linkRef', 'group:role-context-link:'),
    groupSubjectRef,
    groupOrganizationRef,
    subjectLinkRef: subjectLink.linkRef,
    subjectLinkDigest: subjectLink.linkDigest,
    organizationLinkRef: organizationLink.linkRef,
    organizationLinkDigest: organizationLink.linkDigest,
    domainRoles: Object.freeze(domainRoles),
    purposeCodes: uniqueCodes(input.purposeCodes, 'purposeCodes'),
    evidenceRefs: evidenceRefs(input.evidenceRefs),
    observedAt: observedAt.text,
    roleContextOnly: true,
    roleEquivalenceAsserted: false,
    organizationMembershipInferred: false,
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

  return freezeDeep({ ...unsigned, linkDigest: digest(unsigned) });
}

module.exports = {
  DOMAIN_CODES,
  GROUP_FEDERATION_LINK_STATUS_SCHEMA,
  GROUP_ORGANIZATION_LINK_SCHEMA,
  GROUP_ROLE_CONTEXT_LINK_SCHEMA,
  GROUP_SUBJECT_LINK_SCHEMA,
  STATUS_CODES,
  createGroupOrganizationLink,
  createGroupRoleContextLink,
  createGroupSubjectLink,
  projectFederationLinkStatus,
};
