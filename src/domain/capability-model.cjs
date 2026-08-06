const { createHash } = require('node:crypto');
const { assertSafeIdentifier } = require('./identifiers.cjs');
const { assertWorkspaceActive, deepFreeze, requiredText } = require('./workspace-model.cjs');

const PUBLISHERS = new Set(['project-owned', 'approved-local', 'approved-provider']);
const GATE_POLICIES = new Set(['never', 'task', 'action']);
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

function uniqueStrings(values, label, { identifiers = false } = {}) {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  const normalized = values.map((value) => identifiers
    ? assertSafeIdentifier(value, label)
    : requiredText(value, label, 300));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must not contain duplicates`);
  return normalized;
}

function createCapabilityPackage(input) {
  const publisher = requiredText(input?.publisher, 'publisher', 40);
  if (!PUBLISHERS.has(publisher)) throw new Error(`Unsupported capability publisher: ${publisher}`);
  return deepFreeze({
    id: assertSafeIdentifier(input?.id, 'capability package id'),
    name: requiredText(input?.name, 'capability package name'),
    publisher,
    description: requiredText(input?.description, 'capability package description', 1000),
  });
}

function publishCapabilityVersion(input) {
  const packageId = assertSafeIdentifier(input?.packageId, 'capability package id');
  const version = requiredText(input?.version, 'capability version', 80);
  if (!VERSION_PATTERN.test(version)) throw new Error('Capability version must be semver');
  const integrityDigest = requiredText(input?.integrityDigest, 'integrity digest', 80);
  if (!DIGEST_PATTERN.test(integrityDigest)) throw new Error('Capability integrity digest must be sha256:<64 lowercase hex>');
  const humanGatePolicy = requiredText(input?.humanGatePolicy, 'human gate policy', 20);
  if (!GATE_POLICIES.has(humanGatePolicy)) throw new Error('Unsupported Human Gate policy');
  if (!input.inputSchema || typeof input.inputSchema !== 'object' || Array.isArray(input.inputSchema)) {
    throw new TypeError('inputSchema must be an object');
  }
  if (!input.outputSchema || typeof input.outputSchema !== 'object' || Array.isArray(input.outputSchema)) {
    throw new TypeError('outputSchema must be an object');
  }
  return deepFreeze({
    packageId,
    version,
    integrityDigest,
    inputSchema: structuredClone(input.inputSchema),
    outputSchema: structuredClone(input.outputSchema),
    evidenceRequirements: uniqueStrings(input.evidenceRequirements || [], 'evidence requirement'),
    resourceRequirements: uniqueStrings(input.resourceRequirements || [], 'resource requirement'),
    providerContractIds: uniqueStrings(input.providerContractIds || [], 'provider contract id', { identifiers: true }),
    humanGatePolicy,
    status: input.status || 'available',
  });
}

function createCapabilityInstallation({ workspace, version, id, installedAt = new Date().toISOString() }) {
  assertWorkspaceActive(workspace);
  if (!version || version.status !== 'available') throw new Error('Capability version is not available');
  return deepFreeze({
    id: assertSafeIdentifier(id, 'capability installation id'),
    workspaceId: workspace.id,
    packageId: assertSafeIdentifier(version.packageId, 'capability package id'),
    version: version.version,
    integrityDigest: version.integrityDigest,
    status: 'installed',
    installedAt,
  });
}

function transitionInstallation(installation, nextStatus) {
  if (!installation || typeof installation !== 'object') throw new TypeError('installation is required');
  if (!['installed', 'disabled', 'removed'].includes(nextStatus)) throw new Error('Unsupported installation status');
  if (installation.status === nextStatus) return installation;
  if (installation.status === 'removed') throw new Error('Removed installation cannot be reactivated');
  if (installation.status === 'disabled' && nextStatus === 'installed') throw new Error('Disabled installation requires a new explicit installation command');
  return deepFreeze({ ...installation, status: nextStatus });
}

function assertInstallationUsable(installation, version = null) {
  if (!installation || installation.status !== 'installed') throw new Error('Capability installation is missing or disabled');
  if (version) {
    if (installation.packageId !== version.packageId
      || installation.version !== version.version
      || installation.integrityDigest !== version.integrityDigest) {
      throw new Error('Capability installation digest/version mismatch');
    }
    if (version.status !== 'available') throw new Error('Capability version is not available');
  }
  return installation;
}

function capabilityVersionDigest(version) {
  return `sha256:${createHash('sha256').update(JSON.stringify(version)).digest('hex')}`;
}

module.exports = {
  assertInstallationUsable,
  capabilityVersionDigest,
  createCapabilityInstallation,
  createCapabilityPackage,
  publishCapabilityVersion,
  transitionInstallation,
};
