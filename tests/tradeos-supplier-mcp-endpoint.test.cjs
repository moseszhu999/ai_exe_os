'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MCP_PATH,
  RESOURCE_ID,
  RUNTIME_BOUNDARY,
  createTradeosSupplierMcpFetchHandler,
  createTradeosSupplierMcpNodeHandler,
} = require('../src/discovery/tradeos-supplier-mcp-endpoint.cjs');
const { verifySupplierMock } = require('../src/discovery/mock-supplier-verification.cjs');

const PROTOCOL_VERSION = '2026-07-28';

function fixtureProvider(input) {
  return verifySupplierMock(input, { fixtureCatalog: [] });
}

async function callModern(handler, method, params = {}, id = 1) {
  const bodyParams = {
    ...params,
    _meta: {
      'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
      'io.modelcontextprotocol/clientInfo': {
        name: 'aiexe-test-client',
        version: '1.0.0',
      },
      'io.modelcontextprotocol/clientCapabilities': {},
    },
  };
  const headers = {
    'content-type': 'application/json',
    'mcp-protocol-version': PROTOCOL_VERSION,
    'mcp-method': method,
  };
  if (method === 'tools/call') headers['mcp-name'] = params.name;

  const response = await handler.fetch(new Request(`https://mcp.test${MCP_PATH}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params: bodyParams }),
  }));
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON MCP response, got status=${response.status} body=${text.slice(0, 500)}`);
  }
  return { response, json };
}

test('MCP endpoint requires an explicitly injected supplier-verification provider', () => {
  assert.throws(
    () => createTradeosSupplierMcpFetchHandler(),
    /verificationProvider must be a function/,
  );
});

test('runtime boundary never claims listener, deployment, Registry publication, payment or Domain truth ownership', () => {
  assert.equal(RUNTIME_BOUNDARY.verificationProviderRequired, true);
  assert.equal(RUNTIME_BOUNDARY.listenerCreatedByThisModule, false);
  assert.equal(RUNTIME_BOUNDARY.deploymentPerformed, false);
  assert.equal(RUNTIME_BOUNDARY.registryPublicationPerformed, false);
  assert.equal(RUNTIME_BOUNDARY.registryAuthenticationPerformed, false);
  assert.equal(RUNTIME_BOUNDARY.credentialOwnedByThisModule, false);
  assert.equal(RUNTIME_BOUNDARY.paymentPerformedByThisModule, false);
  assert.equal(RUNTIME_BOUNDARY.domainWritePerformedByThisModule, false);
  assert.equal(RUNTIME_BOUNDARY.supplierApprovalPerformedByThisModule, false);
  assert.equal(RUNTIME_BOUNDARY.verificationProviderTruthOwnedByThisModule, false);
});

test('modern server/discover advertises tools without initialize/session state', async () => {
  const handler = createTradeosSupplierMcpFetchHandler({ verificationProvider: fixtureProvider });
  const { response, json } = await callModern(handler, 'server/discover', {});

  assert.equal(response.status, 200);
  assert.equal(json.jsonrpc, '2.0');
  assert.ok(json.result.supportedVersions.includes(PROTOCOL_VERSION));
  assert.ok(json.result.capabilities.tools);
  assert.match(json.result.instructions, /NEEDS_DISAMBIGUATION/);
});

test('tools/list exposes deterministic quote then verify_supplier contracts with closed input schema', async () => {
  const handler = createTradeosSupplierMcpFetchHandler({ verificationProvider: fixtureProvider });
  const { response, json } = await callModern(handler, 'tools/list', {});

  assert.equal(response.status, 200);
  assert.deepEqual(json.result.tools.map((tool) => tool.name), [
    'get_supplier_verification_quote',
    'verify_supplier',
  ]);
  const verifyTool = json.result.tools.find((tool) => tool.name === 'verify_supplier');
  assert.equal(verifyTool.title, 'TradeOS Supplier Verification');
  assert.deepEqual(verifyTool.inputSchema.required, ['company_name']);
  assert.equal(verifyTool.inputSchema.additionalProperties, false);
  assert.equal(verifyTool.annotations.readOnlyHint, true);
  assert.equal(verifyTool.annotations.destructiveHint, false);
});

test('quote tool returns $1 launch metadata but performs no charge and does not claim production execution', async () => {
  const handler = createTradeosSupplierMcpFetchHandler({ verificationProvider: fixtureProvider });
  const { response, json } = await callModern(handler, 'tools/call', {
    name: 'get_supplier_verification_quote',
    arguments: {},
  });

  assert.equal(response.status, 200);
  assert.equal(json.result.isError, undefined);
  assert.equal(json.result.structuredContent.resource_id, RESOURCE_ID);
  assert.equal(json.result.structuredContent.unit_amount, '1.00');
  assert.equal(json.result.structuredContent.quote_tool_amount, '0.00');
  assert.equal(json.result.structuredContent.payment_activation, false);
  assert.equal(json.result.structuredContent.payment_performed, false);
  assert.equal(json.result.structuredContent.production_execution_available, false);
});

test('verify_supplier invokes the injected provider exactly once and returns structured read-only evidence', async () => {
  let calls = 0;
  const handler = createTradeosSupplierMcpFetchHandler({
    verificationProvider: async (input) => {
      calls += 1;
      return fixtureProvider(input);
    },
  });
  const { response, json } = await callModern(handler, 'tools/call', {
    name: 'verify_supplier',
    arguments: {
      company_name: 'Example Manufacturing',
      country: 'CN',
    },
  });

  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.equal(json.result.isError, undefined);
  assert.equal(json.result.structuredContent.status, 'INSUFFICIENT_PUBLIC_EVIDENCE');
  assert.equal(json.result.structuredContent.receipt.resource_id, RESOURCE_ID);
  assert.equal(json.result.structuredContent.receipt.mock, true);
  assert.equal(json.result.structuredContent.receipt.network_performed, false);
  assert.equal(json.result.structuredContent.receipt.payment_performed, false);
  assert.equal(json.result.structuredContent.receipt.domain_write_performed, false);
  assert.equal(json.result.structuredContent.receipt.supplier_approved, false);
  assert.match(json.result.content[0].text, /INSUFFICIENT_PUBLIC_EVIDENCE/);
});

test('endpoint fails closed when an injected provider widens payment, Domain write or supplier approval authority', async () => {
  for (const [field, value] of [
    ['payment_performed', true],
    ['domain_write_performed', true],
    ['supplier_approved', true],
    ['legal_advice_provided', true],
  ]) {
    const handler = createTradeosSupplierMcpFetchHandler({
      verificationProvider: async (input) => {
        const result = structuredClone(fixtureProvider(input));
        result.receipt[field] = value;
        return result;
      },
    });
    const { response, json } = await callModern(handler, 'tools/call', {
      name: 'verify_supplier',
      arguments: { company_name: 'Example Manufacturing' },
    });
    assert.equal(response.status, 200);
    assert.equal(json.result.isError, true);
  }
});

test('Node mount requires explicit Host and Origin allowlists and fixes the path to /mcp', () => {
  assert.throws(
    () => createTradeosSupplierMcpNodeHandler({
      verificationProvider: fixtureProvider,
      allowedHostnames: [],
      allowedOriginHostnames: ['tradeos.ai'],
    }),
    /allowedHostnames must be a non-empty array/,
  );
  assert.throws(
    () => createTradeosSupplierMcpNodeHandler({
      verificationProvider: fixtureProvider,
      allowedHostnames: ['mcp.tradeos.ai'],
      allowedOriginHostnames: [],
    }),
    /allowedOriginHostnames must be a non-empty array/,
  );
  assert.throws(
    () => createTradeosSupplierMcpNodeHandler({
      verificationProvider: fixtureProvider,
      allowedHostnames: ['mcp.tradeos.ai'],
      allowedOriginHostnames: ['tradeos.ai'],
      path: '/anything',
    }),
    /v1 MCP path must be \/mcp/,
  );
  assert.equal(typeof createTradeosSupplierMcpNodeHandler({
    verificationProvider: fixtureProvider,
    allowedHostnames: ['mcp.tradeos.ai'],
    allowedOriginHostnames: ['tradeos.ai'],
  }), 'function');
});

test('modern transport rejects a mismatched MCP-Protocol-Version header before tool execution', async () => {
  let calls = 0;
  const handler = createTradeosSupplierMcpFetchHandler({
    verificationProvider: async (input) => {
      calls += 1;
      return fixtureProvider(input);
    },
  });
  const body = {
    jsonrpc: '2.0',
    id: 9,
    method: 'tools/call',
    params: {
      name: 'verify_supplier',
      arguments: { company_name: 'Example Manufacturing' },
      _meta: {
        'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  };
  const response = await handler.fetch(new Request(`https://mcp.test${MCP_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-11-25',
      'mcp-method': 'tools/call',
      'mcp-name': 'verify_supplier',
    },
    body: JSON.stringify(body),
  }));

  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});
