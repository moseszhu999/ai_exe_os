'use strict';

const { createHash } = require('node:crypto');
const { deepFreeze, requiredText } = require('../domain/workspace-model.cjs');

const OFFER_SCHEMA = 'agent.resource.offer.v1';
const REGISTRY_SCHEMA = 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';
const RESOURCE_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*\.v\d+$/;
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SERVER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/;
const ALLOWED_KEYS = new Set([
  'schema',
  'resourceId',
  'capabilityRef',
  'publicTitle',
  'toolName',
  'description',
  'locales',
  'pricePolicyRef',
  'evidencePolicyRef',
  'registry',
  'llmDiscovery',
  'annotations',
]);

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function assertExactKeys(value, allowed, label) {
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

function assertHttpsUrl(value, label) {
  const text = requiredText(value, label, 1000);
  const url = new URL(text);
  if (url.protocol !== 'https:') throw new Error(`${label} must use https`);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must not contain credentials, query or fragment`);
  }
  return text;
}

function normalizeCapabilityRef(value) {
  const input = assertPlainObject(value, 'capabilityRef');
  assertExactKeys(input, new Set(['packageId', 'version', 'integrityDigest']), 'capabilityRef');
  const packageId = requiredText(input.packageId, 'capability package id', 160);
  const version = requiredText(input.version, 'capability version', 80);
  if (!SEMVER_PATTERN.test(version)) throw new Error('capabilityRef.version must be semver');
  const integrityDigest = requiredText(input.integrityDigest, 'capability integrity digest', 100);
  if (!/^sha256:[a-f0-9]{64}$/.test(integrityDigest)) throw new Error('capabilityRef.integrityDigest must be sha256');
  return Object.freeze({ packageId, version, integrityDigest });
}

function normalizeLocales(value, publicTitle, description) {
  const input = assertPlainObject(value, 'locales');
  if (!input['en-US']) throw new Error('locales must include en-US canonical copy');
  const output = {};
  for (const [locale, entryValue] of Object.entries(input)) {
    if (!LOCALE_PATTERN.test(locale)) throw new Error(`Invalid locale: ${locale}`);
    const entry = assertPlainObject(entryValue, `locales.${locale}`);
    assertExactKeys(entry, new Set(['title', 'description', 'useWhen', 'limitations']), `locales.${locale}`);
    output[locale] = Object.freeze({
      title: requiredText(entry.title, `locales.${locale}.title`, 160),
      description: requiredText(entry.description, `locales.${locale}.description`, 1200),
      useWhen: requiredText(entry.useWhen, `locales.${locale}.useWhen`, 800),
      limitations: requiredText(entry.limitations, `locales.${locale}.limitations`, 800),
    });
  }
  if (output['en-US'].title !== publicTitle) throw new Error('en-US title must equal publicTitle');
  if (output['en-US'].description !== description) throw new Error('en-US description must equal canonical description');
  return deepFreeze(output);
}

function normalizeRegistry(value) {
  const input = assertPlainObject(value, 'registry');
  assertExactKeys(input, new Set(['serverName', 'serverVersion', 'remoteUrl']), 'registry');
  const serverName = requiredText(input.serverName, 'registry serverName', 200);
  if (!SERVER_NAME_PATTERN.test(serverName)) throw new Error('registry.serverName has invalid format');
  const serverVersion = requiredText(input.serverVersion, 'registry serverVersion', 80);
  if (!SEMVER_PATTERN.test(serverVersion)) throw new Error('registry.serverVersion must be semver');
  const remoteUrl = assertHttpsUrl(input.remoteUrl, 'registry remoteUrl');
  return Object.freeze({ serverName, serverVersion, remoteUrl });
}

function normalizeLlmDiscovery(value, resourceId) {
  const input = assertPlainObject(value, 'llmDiscovery');
  assertExactKeys(input, new Set(['capabilityPath', 'llmsIndexPath', 'llmsApisPath']), 'llmDiscovery');
  const capabilityPath = requiredText(input.capabilityPath, 'llm capabilityPath', 300);
  const llmsIndexPath = requiredText(input.llmsIndexPath, 'llm llmsIndexPath', 100);
  const llmsApisPath = requiredText(input.llmsApisPath, 'llm llmsApisPath', 100);
  if (!capabilityPath.startsWith('/capabilities/') || !capabilityPath.endsWith('.md')) {
    throw new Error('llm capabilityPath must be a /capabilities/*.md path');
  }
  if (!capabilityPath.includes(resourceId)) throw new Error('llm capabilityPath must bind the exact resourceId');
  if (llmsIndexPath !== '/llms.txt') throw new Error('llmsIndexPath must be /llms.txt in v1');
  if (llmsApisPath !== '/llms-apis.txt') throw new Error('llmsApisPath must be /llms-apis.txt in v1');
  return Object.freeze({ capabilityPath, llmsIndexPath, llmsApisPath });
}

function normalizeAnnotations(value) {
  const input = assertPlainObject(value, 'annotations');
  const keys = new Set(['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']);
  assertExactKeys(input, keys, 'annotations');
  const output = {};
  for (const key of keys) {
    if (typeof input[key] !== 'boolean') throw new TypeError(`annotations.${key} must be boolean`);
    output[key] = input[key];
  }
  return Object.freeze(output);
}

function renderCapabilityMarkdown(offer, locale) {
  const copy = offer.locales[locale];
  return [
    `# ${copy.title}`,
    '',
    `Canonical resource: \`${offer.resourceId}\``,
    `MCP tool: \`${offer.toolName}\``,
    `Capability package: \`${offer.capabilityRef.packageId}@${offer.capabilityRef.version}\``,
    `Price policy: \`${offer.pricePolicyRef}\``,
    `Evidence policy: \`${offer.evidencePolicyRef}\``,
    '',
    copy.description,
    '',
    '## Use when',
    '',
    copy.useWhen,
    '',
    '## Limitations',
    '',
    copy.limitations,
    '',
    '## Machine contract',
    '',
    `- Remote MCP: ${offer.registry.remoteUrl}`,
    `- Read-only: ${offer.annotations.readOnlyHint}`,
    `- Destructive: ${offer.annotations.destructiveHint}`,
    `- Open-world evidence lookup: ${offer.annotations.openWorldHint}`,
    '',
  ].join('\n');
}

function compileAgentResourcePublication(value) {
  const input = assertPlainObject(value, 'agent resource offer');
  assertExactKeys(input, ALLOWED_KEYS, 'agent resource offer');
  if (input.schema !== OFFER_SCHEMA) throw new Error(`Unsupported agent resource offer schema: ${input.schema}`);

  const resourceId = requiredText(input.resourceId, 'resourceId', 180);
  if (!RESOURCE_ID_PATTERN.test(resourceId)) throw new Error('resourceId must be a versioned machine identifier');
  const publicTitle = requiredText(input.publicTitle, 'publicTitle', 160);
  const toolName = requiredText(input.toolName, 'toolName', 64);
  if (!TOOL_NAME_PATTERN.test(toolName)) throw new Error('toolName must be lowercase snake_case');
  const description = requiredText(input.description, 'description', 1200);
  const capabilityRef = normalizeCapabilityRef(input.capabilityRef);
  const locales = normalizeLocales(input.locales, publicTitle, description);
  const pricePolicyRef = requiredText(input.pricePolicyRef, 'pricePolicyRef', 180);
  const evidencePolicyRef = requiredText(input.evidencePolicyRef, 'evidencePolicyRef', 180);
  const registry = normalizeRegistry(input.registry);
  const llmDiscovery = normalizeLlmDiscovery(input.llmDiscovery, resourceId);
  const annotations = normalizeAnnotations(input.annotations);

  if (annotations.destructiveHint) throw new Error('agent resource publication v1 is discovery-only and cannot advertise destructive tools');

  const normalizedOffer = deepFreeze({
    schema: OFFER_SCHEMA,
    resourceId,
    capabilityRef,
    publicTitle,
    toolName,
    description,
    locales,
    pricePolicyRef,
    evidencePolicyRef,
    registry,
    llmDiscovery,
    annotations,
  });

  const offerDigest = digest(normalizedOffer);
  const registryServerJson = deepFreeze({
    $schema: REGISTRY_SCHEMA,
    name: registry.serverName,
    title: publicTitle,
    description,
    version: registry.serverVersion,
    remotes: [{ type: 'streamable-http', url: registry.remoteUrl }],
    _meta: {
      'io.modelcontextprotocol.registry/publisher-provided': {
        resourceId,
        capabilityRef,
        offerDigest,
        pricePolicyRef,
        evidencePolicyRef,
      },
    },
  });

  const mcpTool = deepFreeze({
    name: toolName,
    title: publicTitle,
    description,
    annotations,
  });
  const markdownByLocale = deepFreeze(Object.fromEntries(
    Object.keys(locales).sort().map((locale) => [locale, renderCapabilityMarkdown(normalizedOffer, locale)]),
  ));
  const llmsTxtEntry = `- [${publicTitle}](${llmDiscovery.capabilityPath}): ${description}`;
  const llmsApisEntry = `${toolName} | ${resourceId} | MCP ${registry.remoteUrl} | ${description}`;

  return deepFreeze({
    normalizedOffer,
    offerDigest,
    registryServerJson,
    mcpTool,
    markdownByLocale,
    llmsTxtEntry,
    llmsApisEntry,
    publicationPerformed: false,
    networkPerformed: false,
    paymentPerformed: false,
    domainWritePerformed: false,
  });
}

module.exports = {
  OFFER_SCHEMA,
  REGISTRY_SCHEMA,
  canonicalize,
  compileAgentResourcePublication,
  digest,
};
