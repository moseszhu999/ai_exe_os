'use strict';

const {
  createMcpHandler,
  fromJsonSchema,
  McpServer,
} = require('@modelcontextprotocol/server');
const {
  hostHeaderValidation,
  originValidation,
  toNodeHandler,
} = require('@modelcontextprotocol/node');
const { deepFreeze } = require('../domain/workspace-model.cjs');

const RESOURCE_ID = 'trade.verify_supplier.v1';
const SERVER_NAME = 'tradeos-supplier-verification';
const SERVER_VERSION = '1.0.0';
const PRICE_POLICY_REF = 'price.trade.verify_supplier.v1';
const EVIDENCE_POLICY_REF = 'evidence.trade.verify_supplier.public-v1';
const MCP_PATH = '/mcp';
const MAX_PROVIDER_RESULT_BYTES = 256 * 1024;

const RUNTIME_BOUNDARY = deepFreeze({
  schema: 'tradeos.supplier-verification.mcp-runtime-boundary.v1',
  verificationProviderRequired: true,
  listenerCreatedByThisModule: false,
  deploymentPerformed: false,
  registryPublicationPerformed: false,
  registryAuthenticationPerformed: false,
  credentialOwnedByThisModule: false,
  paymentPerformedByThisModule: false,
  domainWritePerformedByThisModule: false,
  supplierApprovalPerformedByThisModule: false,
  verificationProviderTruthOwnedByThisModule: false,
});

const VERIFY_INPUT_SCHEMA = deepFreeze({
  type: 'object',
  properties: {
    company_name: {
      type: 'string',
      minLength: 1,
      maxLength: 240,
      description: 'Supplier or company name to verify.',
    },
    country: {
      type: 'string',
      maxLength: 120,
      description: 'Country or jurisdiction, if known.',
    },
    website: {
      type: 'string',
      maxLength: 1000,
      format: 'uri',
      description: 'Official or claimed website, if known.',
    },
    registration_id: {
      type: 'string',
      maxLength: 180,
      description: 'Business registration or tax identifier, if known.',
    },
    product_requirement: {
      type: 'string',
      maxLength: 800,
      description: 'Product, manufacturing capability, or buyer requirement to verify.',
    },
    buyer_country: {
      type: 'string',
      maxLength: 120,
      description: 'Destination market when market-specific evidence matters.',
    },
    required_certifications: {
      type: 'array',
      maxItems: 32,
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 120 },
      description: 'Specific certifications or standards that must be checked.',
    },
  },
  required: ['company_name'],
  additionalProperties: false,
});

const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    check: { type: 'string' },
    status: { enum: ['VERIFIED', 'PARTIALLY_VERIFIED', 'NOT_VERIFIED'] },
    evidence_refs: { type: 'array', items: { type: 'string' } },
    gap: { type: ['string', 'null'] },
  },
  required: ['check', 'status', 'evidence_refs', 'gap'],
  additionalProperties: false,
};

const EVIDENCE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    source_type: { type: 'string' },
    source_url: { type: 'string' },
    observed_at: { type: 'string' },
    supports: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'source_type', 'source_url', 'observed_at', 'supports'],
  additionalProperties: false,
};

const VERIFY_OUTPUT_SCHEMA = deepFreeze({
  type: 'object',
  properties: {
    status: {
      enum: [
        'VERIFIED',
        'VERIFIED_WITH_GAPS',
        'PARTIALLY_VERIFIED',
        'NOT_VERIFIED',
        'CONFLICTING_EVIDENCE',
        'NEEDS_DISAMBIGUATION',
        'INSUFFICIENT_PUBLIC_EVIDENCE',
        'ERROR',
      ],
    },
    subject: {
      type: 'object',
      properties: {
        canonical_name: { type: 'string' },
        country: { type: ['string', 'null'] },
        registration_id: { type: ['string', 'null'] },
        official_website: { type: ['string', 'null'] },
      },
      required: ['canonical_name'],
      additionalProperties: false,
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    checks: { type: 'array', items: CHECK_SCHEMA },
    evidence: { type: 'array', items: EVIDENCE_SCHEMA },
    limitations: { type: 'array', items: { type: 'string' } },
    recommended_next_action: { type: 'string' },
    receipt: {
      type: 'object',
      properties: {
        resource_id: { const: RESOURCE_ID },
        execution_mode: { type: 'string' },
        request_digest: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
        result_digest: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
        mock: { type: 'boolean' },
        public_source_verification_performed: { type: 'boolean' },
        network_performed: { type: 'boolean' },
        payment_performed: { const: false },
        supplier_approved: { const: false },
        legal_advice_provided: { const: false },
        domain_write_performed: { const: false },
      },
      required: [
        'resource_id',
        'execution_mode',
        'request_digest',
        'result_digest',
        'mock',
        'public_source_verification_performed',
        'network_performed',
        'payment_performed',
        'supplier_approved',
        'legal_advice_provided',
        'domain_write_performed',
      ],
      additionalProperties: false,
    },
  },
  required: [
    'status',
    'subject',
    'confidence',
    'checks',
    'evidence',
    'limitations',
    'recommended_next_action',
    'receipt',
  ],
  additionalProperties: false,
});

const QUOTE_OUTPUT_SCHEMA = deepFreeze({
  type: 'object',
  properties: {
    resource_id: { const: RESOURCE_ID },
    currency: { const: 'USD' },
    unit_amount: { const: '1.00' },
    billing_unit: { const: 'call' },
    quote_tool_amount: { const: '0.00' },
    price_policy_ref: { const: PRICE_POLICY_REF },
    evidence_policy_ref: { const: EVIDENCE_POLICY_REF },
    payment_activation: { const: false },
    payment_performed: { const: false },
    production_execution_available: { const: false },
  },
  required: [
    'resource_id',
    'currency',
    'unit_amount',
    'billing_unit',
    'quote_tool_amount',
    'price_policy_ref',
    'evidence_policy_ref',
    'payment_activation',
    'payment_performed',
    'production_execution_available',
  ],
  additionalProperties: false,
});

const QUOTE = deepFreeze({
  resource_id: RESOURCE_ID,
  currency: 'USD',
  unit_amount: '1.00',
  billing_unit: 'call',
  quote_tool_amount: '0.00',
  price_policy_ref: PRICE_POLICY_REF,
  evidence_policy_ref: EVIDENCE_POLICY_REF,
  payment_activation: false,
  payment_performed: false,
  production_execution_available: false,
});

function assertFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function`);
  return value;
}

function assertHostnameList(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array`);
  }
  const normalized = value.map((item) => {
    if (typeof item !== 'string' || item.trim() === '') throw new TypeError(`${label} entries must be non-empty strings`);
    const text = item.trim().toLowerCase();
    if (text.includes('://') || text.includes('/') || text.includes('@')) {
      throw new Error(`${label} entries must be hostnames, not URLs`);
    }
    return text;
  });
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must not contain duplicates`);
  return Object.freeze(normalized);
}

function boundedJsonBytes(value, label) {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') > MAX_PROVIDER_RESULT_BYTES) {
    throw new Error(`${label} exceeds ${MAX_PROVIDER_RESULT_BYTES} bytes`);
  }
  return json;
}

function assertReadOnlyVerificationResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('verificationProvider result must be an object');
  }
  if (!value.receipt || typeof value.receipt !== 'object' || Array.isArray(value.receipt)) {
    throw new TypeError('verificationProvider result must include receipt');
  }
  if (value.receipt.resource_id !== RESOURCE_ID) throw new Error('verificationProvider result resource_id mismatch');
  if (value.receipt.payment_performed !== false) throw new Error('verificationProvider may not perform payment in this endpoint');
  if (value.receipt.domain_write_performed !== false) throw new Error('verificationProvider may not perform Domain writes in this endpoint');
  if (value.receipt.supplier_approved !== false) throw new Error('verificationProvider may not approve suppliers in this endpoint');
  if (value.receipt.legal_advice_provided !== false) throw new Error('verificationProvider may not provide legal advice in this endpoint');
  boundedJsonBytes(value, 'verificationProvider result');
  return value;
}

function toolResult(value) {
  const text = boundedJsonBytes(value, 'tool result');
  return {
    content: [{ type: 'text', text }],
    structuredContent: value,
  };
}

function buildTradeosSupplierMcpServer({ verificationProvider } = {}) {
  const verify = assertFunction(verificationProvider, 'verificationProvider');
  const server = new McpServer(
    {
      name: SERVER_NAME,
      title: 'TradeOS Supplier Verification',
      version: SERVER_VERSION,
      description: 'Evidence-first supplier verification capability exposed by AIEXE.',
    },
    {
      instructions: [
        'Use verify_supplier for evidence-based supplier identity or capability verification before sourcing, RFQ preparation, onboarding, or counterparty review.',
        'If entity identity is ambiguous, return NEEDS_DISAMBIGUATION rather than guessing.',
        'Missing evidence is not negative evidence. Never treat this tool as supplier approval, legal advice, certification issuance, or a guarantee of future performance.',
        'Call get_supplier_verification_quote when price or commercial coverage is needed before invoking verification.',
      ].join(' '),
    },
  );

  server.registerTool(
    'get_supplier_verification_quote',
    {
      title: 'Get Supplier Verification Quote',
      description: 'Return the current launch quote metadata for TradeOS Supplier Verification without charging or executing supplier verification.',
      inputSchema: fromJsonSchema({ type: 'object', additionalProperties: false }),
      outputSchema: fromJsonSchema(QUOTE_OUTPUT_SCHEMA),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => toolResult(QUOTE),
  );

  server.registerTool(
    'verify_supplier',
    {
      title: 'TradeOS Supplier Verification',
      description: 'Verify whether a named supplier is the claimed legal or manufacturing entity and whether current evidence supports its capability for a specified product or buyer requirement. Returns structured verification checks, dated evidence references, gaps, confidence, and a machine-readable receipt. Does not approve suppliers, guarantee performance, or provide legal advice.',
      inputSchema: fromJsonSchema(VERIFY_INPUT_SCHEMA),
      outputSchema: fromJsonSchema(VERIFY_OUTPUT_SCHEMA),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      const result = await verify(deepFreeze(structuredClone(args)));
      return toolResult(assertReadOnlyVerificationResult(result));
    },
  );

  return server;
}

function createTradeosSupplierMcpFetchHandler(options = {}) {
  assertFunction(options.verificationProvider, 'verificationProvider');
  return createMcpHandler(() => buildTradeosSupplierMcpServer(options));
}

function createTradeosSupplierMcpNodeHandler({
  verificationProvider,
  allowedHostnames,
  allowedOriginHostnames,
  path = MCP_PATH,
} = {}) {
  assertFunction(verificationProvider, 'verificationProvider');
  const hosts = assertHostnameList(allowedHostnames, 'allowedHostnames');
  const origins = assertHostnameList(allowedOriginHostnames, 'allowedOriginHostnames');
  if (path !== MCP_PATH) throw new Error(`v1 MCP path must be ${MCP_PATH}`);

  const fetchHandler = createTradeosSupplierMcpFetchHandler({ verificationProvider });
  const nodeHandler = toNodeHandler(fetchHandler);
  const validateHost = hostHeaderValidation(hosts);
  const validateOrigin = originValidation(origins);

  return function tradeosSupplierMcpNodeHandler(req, res) {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname !== MCP_PATH) {
      res.statusCode = 404;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('Not Found');
      return;
    }
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    return nodeHandler(req, res);
  };
}

module.exports = {
  EVIDENCE_POLICY_REF,
  MCP_PATH,
  PRICE_POLICY_REF,
  QUOTE,
  QUOTE_OUTPUT_SCHEMA,
  RESOURCE_ID,
  RUNTIME_BOUNDARY,
  SERVER_NAME,
  SERVER_VERSION,
  VERIFY_INPUT_SCHEMA,
  VERIFY_OUTPUT_SCHEMA,
  assertReadOnlyVerificationResult,
  buildTradeosSupplierMcpServer,
  createTradeosSupplierMcpFetchHandler,
  createTradeosSupplierMcpNodeHandler,
};
