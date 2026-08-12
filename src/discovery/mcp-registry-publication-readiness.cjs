'use strict';

const { createHash } = require('node:crypto');
const { deepFreeze, requiredText } = require('../domain/workspace-model.cjs');
const { REGISTRY_SCHEMA } = require('./agent-resource-publication.cjs');

const READINESS_SCHEMA = 'ado.mcp-registry.publication-static-readiness.v1';
const OFFICIAL_REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io';
const OFFICIAL_REGISTRY_API_VERSION = 'v0.1';
const PUBLISHER_META_MAX_BYTES = 4096;
const STATIC_STATUS = Object.freeze({
  BLOCKED: 'blocked',
  EXTERNAL_CHECKS_REQUIRED: 'external_checks_required',
});
const CHECK_STATUS = Object.freeze({
  PASS: 'pass',
  WARN: 'warn',
  BLOCK: 'block',
  UNVERIFIED: 'unverified',
});

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function assertAllowedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field: ${key}`);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}

function check(code, status, message, evidence = null) {
  return Object.freeze({ code, status, message, evidence });
}

function isPlaceholderDigest(value) {
  const match = /^sha256:([0-9a-f])\1{63}$/.exec(value || '');
  return Boolean(match);
}

function isPlaceholderHost(hostname) {
  const lower = hostname.toLowerCase();
  return lower === 'example.com' ||
    lower.endsWith('.example.com') ||
    lower === 'example.net' ||
    lower.endsWith('.example.net') ||
    lower === 'example.org' ||
    lower.endsWith('.example.org') ||
    lower.endsWith('.example');
}

function normalizePublication(value) {
  const publication = assertPlainObject(value, 'publication');
  const allowed = new Set([
    'normalizedOffer',
    'offerDigest',
    'registryServerJson',
    'mcpTool',
    'markdownByLocale',
    'llmsTxtEntry',
    'llmsApisEntry',
    'publicationPerformed',
    'networkPerformed',
    'paymentPerformed',
    'domainWritePerformed',
  ]);
  assertAllowedKeys(publication, allowed, 'publication');
  for (const key of ['normalizedOffer', 'offerDigest', 'registryServerJson', 'publicationPerformed', 'networkPerformed']) {
    if (!Object.hasOwn(publication, key)) throw new Error(`publication is missing required field: ${key}`);
  }
  if (publication.publicationPerformed !== false || publication.networkPerformed !== false) {
    throw new Error('static readiness requires a non-publishing, non-network publication artifact');
  }
  return publication;
}

function evaluateMcpRegistryPublicationStaticReadiness(inputValue) {
  const input = assertPlainObject(inputValue, 'registry readiness input');
  const allowed = new Set(['publication', 'githubOwner']);
  assertAllowedKeys(input, allowed, 'registry readiness input');
  for (const key of allowed) {
    if (!Object.hasOwn(input, key)) throw new Error(`registry readiness input is missing required field: ${key}`);
  }

  const publication = normalizePublication(input.publication);
  const githubOwner = requiredText(input.githubOwner, 'githubOwner', 100);
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(githubOwner)) {
    throw new Error('githubOwner has invalid format');
  }

  const offer = assertPlainObject(publication.normalizedOffer, 'publication normalizedOffer');
  const server = assertPlainObject(publication.registryServerJson, 'publication registryServerJson');
  const registry = assertPlainObject(offer.registry, 'publication registry');
  const capabilityRef = assertPlainObject(offer.capabilityRef, 'publication capabilityRef');
  const checks = [];

  if (server.$schema === REGISTRY_SCHEMA) {
    checks.push(check('OFFICIAL_SCHEMA_CURRENT', CHECK_STATUS.PASS, 'server.json points at the expected official Registry schema.', server.$schema));
  } else {
    checks.push(check('OFFICIAL_SCHEMA_MISMATCH', CHECK_STATUS.BLOCK, 'server.json does not point at the expected official Registry schema.', server.$schema || null));
  }

  if (server.name === registry.serverName && server.version === registry.serverVersion) {
    checks.push(check('SERVER_IDENTITY_BOUND', CHECK_STATUS.PASS, 'Compiled server name/version match the canonical registry offer.', `${server.name}@${server.version}`));
  } else {
    checks.push(check('SERVER_IDENTITY_DRIFT', CHECK_STATUS.BLOCK, 'Compiled server name/version drift from the canonical registry offer.'));
  }

  const expectedPrefix = `io.github.${githubOwner}/`;
  if (typeof server.name === 'string' && server.name.startsWith(expectedPrefix)) {
    checks.push(check(
      'GITHUB_NAMESPACE_STRUCTURALLY_COMPATIBLE',
      CHECK_STATUS.PASS,
      'The server name is structurally compatible with Official Registry GitHub OAuth/OIDC namespace authentication.',
      expectedPrefix,
    ));
  } else {
    checks.push(check(
      'GITHUB_NAMESPACE_MISMATCH',
      CHECK_STATUS.BLOCK,
      'The server name does not match the io.github.<owner>/ namespace required for this GitHub owner.',
      expectedPrefix,
    ));
  }

  checks.push(check(
    'REGISTRY_NAMESPACE_AUTH_UNVERIFIED',
    CHECK_STATUS.UNVERIFIED,
    'This module does not authenticate with the MCP Registry; GitHub OAuth/OIDC proof is still required at publish time.',
    'github_oauth_or_oidc',
  ));

  let remoteUrl = null;
  try {
    remoteUrl = new URL(registry.remoteUrl);
  } catch {
    checks.push(check('REMOTE_URL_INVALID', CHECK_STATUS.BLOCK, 'Remote MCP URL is not a valid URL.'));
  }

  if (remoteUrl) {
    const remoteShapeMatches = Array.isArray(server.remotes) &&
      server.remotes.length === 1 &&
      server.remotes[0] &&
      server.remotes[0].type === 'streamable-http' &&
      server.remotes[0].url === registry.remoteUrl;
    if (remoteShapeMatches) {
      checks.push(check('REMOTE_STREAMABLE_HTTP_BOUND', CHECK_STATUS.PASS, 'server.json exposes the canonical remote URL as Streamable HTTP.', registry.remoteUrl));
    } else {
      checks.push(check('REMOTE_TRANSPORT_DRIFT', CHECK_STATUS.BLOCK, 'server.json remote transport does not exactly match the canonical offer.'));
    }

    if (isPlaceholderHost(remoteUrl.hostname)) {
      checks.push(check('REMOTE_ENDPOINT_PLACEHOLDER', CHECK_STATUS.BLOCK, 'Remote MCP endpoint uses a reserved example hostname and is not publishable as a real public server.', remoteUrl.hostname));
    } else {
      checks.push(check('REMOTE_ENDPOINT_NON_PLACEHOLDER', CHECK_STATUS.PASS, 'Remote MCP endpoint does not use a reserved example hostname.', remoteUrl.hostname));
    }
  }

  checks.push(check(
    'REMOTE_PUBLIC_REACHABILITY_UNVERIFIED',
    CHECK_STATUS.UNVERIFIED,
    'Official Registry remote servers must be publicly accessible; this static module performs no network reachability check.',
    registry.remoteUrl,
  ));

  if (isPlaceholderDigest(capabilityRef.integrityDigest)) {
    checks.push(check('CAPABILITY_INTEGRITY_PLACEHOLDER', CHECK_STATUS.BLOCK, 'Capability integrity digest is an obvious placeholder and must be replaced before publication.', capabilityRef.integrityDigest));
  } else {
    checks.push(check('CAPABILITY_INTEGRITY_NON_PLACEHOLDER', CHECK_STATUS.PASS, 'Capability integrity digest is structurally non-placeholder.', capabilityRef.integrityDigest));
  }

  const publisherMeta = server._meta && server._meta['io.modelcontextprotocol.registry/publisher-provided'];
  if (publisherMeta && typeof publisherMeta === 'object' && !Array.isArray(publisherMeta)) {
    const publisherMetaBytes = Buffer.byteLength(JSON.stringify(publisherMeta), 'utf8');
    if (publisherMetaBytes <= PUBLISHER_META_MAX_BYTES) {
      checks.push(check('PUBLISHER_META_WITHIN_LIMIT', CHECK_STATUS.PASS, 'Publisher-provided Registry metadata is within the official 4 KiB limit.', publisherMetaBytes));
    } else {
      checks.push(check('PUBLISHER_META_TOO_LARGE', CHECK_STATUS.BLOCK, 'Publisher-provided Registry metadata exceeds the official 4 KiB limit.', publisherMetaBytes));
    }
  } else {
    checks.push(check('PUBLISHER_META_ABSENT', CHECK_STATUS.WARN, 'No publisher-provided Registry metadata was found.'));
  }

  if (server.repository && typeof server.repository === 'object' && !Array.isArray(server.repository)) {
    checks.push(check('REPOSITORY_METADATA_PRESENT', CHECK_STATUS.PASS, 'server.json includes repository metadata.', server.repository.url || null));
  } else {
    checks.push(check('REPOSITORY_METADATA_ABSENT', CHECK_STATUS.WARN, 'Official Registry quickstart examples include repository metadata; current compiled remote server does not.'));
  }

  const blockingCodes = Object.freeze(checks.filter((item) => item.status === CHECK_STATUS.BLOCK).map((item) => item.code));
  const warningCodes = Object.freeze(checks.filter((item) => item.status === CHECK_STATUS.WARN).map((item) => item.code));
  const unverifiedCodes = Object.freeze(checks.filter((item) => item.status === CHECK_STATUS.UNVERIFIED).map((item) => item.code));
  const staticStatus = blockingCodes.length > 0 ? STATIC_STATUS.BLOCKED : STATIC_STATUS.EXTERNAL_CHECKS_REQUIRED;

  const payload = {
    schema: READINESS_SCHEMA,
    staticStatus,
    targetRegistry: {
      baseUrl: OFFICIAL_REGISTRY_BASE_URL,
      apiVersion: OFFICIAL_REGISTRY_API_VERSION,
      namespaceAuthCandidate: 'github_oauth_or_oidc',
    },
    serverRef: {
      name: server.name,
      version: server.version,
      remoteUrl: registry.remoteUrl,
      offerDigest: publication.offerDigest,
      capabilityIntegrityDigest: capabilityRef.integrityDigest,
    },
    checks: Object.freeze(checks),
    blockingCodes,
    warningCodes,
    unverifiedCodes,
    readinessBoundary: {
      registrySchemaValidatedByOfficialPublisher: false,
      registryAuthenticationPerformed: false,
      registryNamespaceOwnershipVerified: false,
      remoteReachabilityChecked: false,
      remotePublicAccessibilityVerified: false,
      registrySearchPerformed: false,
      publicationPerformed: false,
      networkPerformed: false,
      paymentPerformed: false,
      domainWritePerformed: false,
      executionAuthorized: false,
    },
  };

  return deepFreeze({ ...payload, readinessDigest: digest(payload) });
}

module.exports = {
  READINESS_SCHEMA,
  OFFICIAL_REGISTRY_BASE_URL,
  OFFICIAL_REGISTRY_API_VERSION,
  PUBLISHER_META_MAX_BYTES,
  STATIC_STATUS,
  CHECK_STATUS,
  evaluateMcpRegistryPublicationStaticReadiness,
};
