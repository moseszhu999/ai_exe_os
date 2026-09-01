'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const {
  REGISTRY_SCHEMA,
  compileAgentResourcePublication,
} = require('../src/discovery/agent-resource-publication.cjs');

function loadOffer() {
  return JSON.parse(readFileSync(join(
    __dirname,
    '..',
    'examples',
    'agent-resource-offers',
    'trade.verify_supplier.v1.json',
  ), 'utf8'));
}

test('compiles one canonical offer into registry, MCP and LLM discovery surfaces without publishing', () => {
  const result = compileAgentResourcePublication(loadOffer());
  assert.equal(result.normalizedOffer.resourceId, 'trade.verify_supplier.v1');
  assert.match(result.offerDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.registryServerJson.$schema, REGISTRY_SCHEMA);
  assert.equal(result.registryServerJson.name, 'io.github.moseszhu999/tradeos-supplier-verification');
  assert.deepEqual(result.registryServerJson.remotes, [{ type: 'streamable-http', url: 'https://tradeos.example/mcp' }]);
  assert.equal(
    result.registryServerJson._meta['io.modelcontextprotocol.registry/publisher-provided'].resourceId,
    'trade.verify_supplier.v1',
  );
  assert.equal(result.mcpTool.name, 'verify_supplier');
  assert.equal(result.mcpTool.annotations.readOnlyHint, true);
  assert.equal(result.mcpTool.annotations.destructiveHint, false);
  assert.match(result.markdownByLocale['en-US'], /TradeOS Supplier Verification/);
  assert.match(result.markdownByLocale['ja-JP'], /サプライヤー検証/);
  assert.match(result.markdownByLocale['zh-CN'], /供应商核验/);
  assert.match(result.llmsTxtEntry, /trade\.verify_supplier\.v1\.md/);
  assert.match(result.llmsApisEntry, /verify_supplier/);
  assert.equal(result.publicationPerformed, false);
  assert.equal(result.networkPerformed, false);
  assert.equal(result.paymentPerformed, false);
  assert.equal(result.domainWritePerformed, false);
});

test('publication digest is deterministic across object key order', () => {
  const offer = loadOffer();
  const reordered = Object.fromEntries(Object.entries(offer).reverse());
  assert.equal(
    compileAgentResourcePublication(offer).offerDigest,
    compileAgentResourcePublication(reordered).offerDigest,
  );
});

test('rejects destructive discovery surfaces and unsafe registry endpoints', () => {
  const destructive = loadOffer();
  destructive.annotations.destructiveHint = true;
  assert.throws(() => compileAgentResourcePublication(destructive), /cannot advertise destructive tools/);

  const http = loadOffer();
  http.registry.remoteUrl = 'http://example.com/mcp';
  assert.throws(() => compileAgentResourcePublication(http), /must use https/);

  const mismatch = loadOffer();
  mismatch.llmDiscovery.capabilityPath = '/capabilities/trade.other.v1.md';
  assert.throws(() => compileAgentResourcePublication(mismatch), /bind the exact resourceId/);
});

test('rejects canonical copy drift and unknown metadata fields', () => {
  const localeDrift = loadOffer();
  localeDrift.locales['en-US'].title = 'Different Title';
  assert.throws(() => compileAgentResourcePublication(localeDrift), /en-US title must equal publicTitle/);

  const extra = loadOffer();
  extra.bestInMarket = true;
  assert.throws(() => compileAgentResourcePublication(extra), /unsupported field: bestInMarket/);
});
