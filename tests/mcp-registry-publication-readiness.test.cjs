'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const offerFixture = require('../examples/agent-resource-offers/trade.verify_supplier.v1.json');
const { compileAgentResourcePublication } = require('../src/discovery/agent-resource-publication.cjs');
const {
  READINESS_SCHEMA,
  STATIC_STATUS,
  evaluateMcpRegistryPublicationStaticReadiness,
} = require('../src/discovery/mcp-registry-publication-readiness.cjs');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function compileOffer(mutator = null) {
  const offer = clone(offerFixture);
  if (mutator) mutator(offer);
  return compileAgentResourcePublication(offer);
}

test('current TradeOS fixture is correctly BLOCKED by real publication placeholders without performing Registry/network effects', () => {
  const publication = compileOffer();
  const readiness = evaluateMcpRegistryPublicationStaticReadiness({
    publication,
    githubOwner: 'moseszhu999',
  });

  assert.equal(readiness.schema, READINESS_SCHEMA);
  assert.equal(readiness.staticStatus, STATIC_STATUS.BLOCKED);
  assert.ok(readiness.blockingCodes.includes('REMOTE_ENDPOINT_PLACEHOLDER'));
  assert.ok(readiness.blockingCodes.includes('CAPABILITY_INTEGRITY_PLACEHOLDER'));
  assert.ok(readiness.unverifiedCodes.includes('REGISTRY_NAMESPACE_AUTH_UNVERIFIED'));
  assert.ok(readiness.unverifiedCodes.includes('REMOTE_PUBLIC_REACHABILITY_UNVERIFIED'));
  assert.ok(readiness.warningCodes.includes('REPOSITORY_METADATA_ABSENT'));
  assert.equal(readiness.readinessBoundary.registryAuthenticationPerformed, false);
  assert.equal(readiness.readinessBoundary.remoteReachabilityChecked, false);
  assert.equal(readiness.readinessBoundary.publicationPerformed, false);
  assert.equal(readiness.readinessBoundary.networkPerformed, false);
  assert.match(readiness.readinessDigest, /^sha256:[0-9a-f]{64}$/);
});

test('non-placeholder static metadata can only reach EXTERNAL_CHECKS_REQUIRED, never READY', () => {
  const publication = compileOffer((offer) => {
    offer.capabilityRef.integrityDigest = `sha256:${'a1'.repeat(32)}`;
    offer.registry.remoteUrl = 'https://api.tradeos.example.com/mcp';
  });
  const readiness = evaluateMcpRegistryPublicationStaticReadiness({
    publication,
    githubOwner: 'moseszhu999',
  });

  assert.equal(readiness.staticStatus, STATIC_STATUS.EXTERNAL_CHECKS_REQUIRED);
  assert.deepEqual(readiness.blockingCodes, []);
  assert.ok(readiness.unverifiedCodes.includes('REGISTRY_NAMESPACE_AUTH_UNVERIFIED'));
  assert.ok(readiness.unverifiedCodes.includes('REMOTE_PUBLIC_REACHABILITY_UNVERIFIED'));
  assert.notEqual(readiness.staticStatus, 'ready');
  assert.equal(readiness.readinessBoundary.registryNamespaceOwnershipVerified, false);
  assert.equal(readiness.readinessBoundary.remotePublicAccessibilityVerified, false);
});

test('GitHub namespace mismatch blocks publication readiness', () => {
  const publication = compileOffer((offer) => {
    offer.capabilityRef.integrityDigest = `sha256:${'ab'.repeat(32)}`;
    offer.registry.remoteUrl = 'https://api.tradeos.example.com/mcp';
  });
  const readiness = evaluateMcpRegistryPublicationStaticReadiness({
    publication,
    githubOwner: 'another-owner',
  });

  assert.equal(readiness.staticStatus, STATIC_STATUS.BLOCKED);
  assert.ok(readiness.blockingCodes.includes('GITHUB_NAMESPACE_MISMATCH'));
});

test('server schema/identity drift fails closed instead of trusting caller-compiled metadata', () => {
  const publication = clone(compileOffer((offer) => {
    offer.capabilityRef.integrityDigest = `sha256:${'ab'.repeat(32)}`;
    offer.registry.remoteUrl = 'https://api.tradeos.example.com/mcp';
  }));
  publication.registryServerJson.$schema = 'https://invalid.example/schema.json';
  publication.registryServerJson.version = '9.9.9';

  const readiness = evaluateMcpRegistryPublicationStaticReadiness({
    publication,
    githubOwner: 'moseszhu999',
  });

  assert.ok(readiness.blockingCodes.includes('OFFICIAL_SCHEMA_MISMATCH'));
  assert.ok(readiness.blockingCodes.includes('SERVER_IDENTITY_DRIFT'));
});

test('publisher-provided metadata over 4 KiB blocks static readiness', () => {
  const publication = clone(compileOffer((offer) => {
    offer.capabilityRef.integrityDigest = `sha256:${'ab'.repeat(32)}`;
    offer.registry.remoteUrl = 'https://api.tradeos.example.com/mcp';
  }));
  publication.registryServerJson._meta['io.modelcontextprotocol.registry/publisher-provided'].oversized = 'x'.repeat(5000);

  const readiness = evaluateMcpRegistryPublicationStaticReadiness({
    publication,
    githubOwner: 'moseszhu999',
  });

  assert.equal(readiness.staticStatus, STATIC_STATUS.BLOCKED);
  assert.ok(readiness.blockingCodes.includes('PUBLISHER_META_TOO_LARGE'));
});
