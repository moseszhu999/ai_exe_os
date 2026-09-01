'use strict';

const { createHash } = require('node:crypto');
const { deepFreeze, requiredText } = require('../domain/workspace-model.cjs');

const RESOURCE_ID = 'trade.verify_supplier.v1';
const INPUT_KEYS = new Set([
  'company_name',
  'country',
  'website',
  'registration_id',
  'product_requirement',
  'buyer_country',
  'required_certifications',
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

function normalizeCompanyName(value) {
  return requiredText(value, 'company_name', 240)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\s.,，。()（）\-_]+/g, ' ')
    .trim();
}

function normalizeOptionalText(value, label, maxLength = 500) {
  if (value == null || value === '') return null;
  return requiredText(value, label, maxLength);
}

function normalizeInput(value) {
  const input = assertPlainObject(value, 'supplier verification input');
  assertExactKeys(input, INPUT_KEYS, 'supplier verification input');
  const companyName = requiredText(input.company_name, 'company_name', 240);
  const requiredCertifications = input.required_certifications == null
    ? []
    : input.required_certifications;
  if (!Array.isArray(requiredCertifications)) throw new TypeError('required_certifications must be an array');
  const certifications = requiredCertifications.map((item) => requiredText(item, 'required certification', 120));
  if (new Set(certifications).size !== certifications.length) {
    throw new Error('required_certifications must not contain duplicates');
  }
  if (input.website != null && input.website !== '') {
    const url = new URL(requiredText(input.website, 'website', 1000));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('website must be a public http(s) URL without embedded credentials');
    }
  }
  return deepFreeze({
    company_name: companyName,
    normalized_company_name: normalizeCompanyName(companyName),
    country: normalizeOptionalText(input.country, 'country', 120),
    website: normalizeOptionalText(input.website, 'website', 1000),
    registration_id: normalizeOptionalText(input.registration_id, 'registration_id', 180),
    product_requirement: normalizeOptionalText(input.product_requirement, 'product_requirement', 800),
    buyer_country: normalizeOptionalText(input.buyer_country, 'buyer_country', 120),
    required_certifications: certifications,
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}

function normalizeFixtureCatalog(value) {
  if (!Array.isArray(value)) throw new TypeError('fixtureCatalog must be an array');
  return value.map((fixtureValue, index) => {
    const fixture = assertPlainObject(fixtureValue, `fixtureCatalog[${index}]`);
    assertExactKeys(fixture, new Set([
      'canonical_name', 'country', 'registration_id', 'official_website', 'confidence',
      'checks', 'evidence', 'limitations', 'recommended_next_action',
    ]), `fixtureCatalog[${index}]`);
    const canonicalName = requiredText(fixture.canonical_name, 'fixture canonical_name', 240);
    const confidence = Number(fixture.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error('fixture confidence must be between 0 and 1');
    }
    if (!Array.isArray(fixture.checks) || !Array.isArray(fixture.evidence)) {
      throw new TypeError('fixture checks and evidence must be arrays');
    }
    const evidence = fixture.evidence.map((entryValue, evidenceIndex) => {
      const entry = assertPlainObject(entryValue, `fixture evidence[${evidenceIndex}]`);
      assertExactKeys(entry, new Set(['id', 'source_type', 'source_url', 'observed_at', 'supports']), 'fixture evidence');
      const sourceUrl = requiredText(entry.source_url, 'fixture evidence source_url', 1000);
      const url = new URL(sourceUrl);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('fixture evidence source_url must be http(s)');
      const observedAt = requiredText(entry.observed_at, 'fixture evidence observed_at', 80);
      if (Number.isNaN(Date.parse(observedAt))) throw new Error('fixture evidence observed_at must be an ISO-like timestamp');
      if (!Array.isArray(entry.supports) || entry.supports.length === 0) throw new Error('fixture evidence supports must be non-empty');
      return Object.freeze({
        id: requiredText(entry.id, 'fixture evidence id', 120),
        source_type: requiredText(entry.source_type, 'fixture evidence source_type', 120),
        source_url: sourceUrl,
        observed_at: observedAt,
        supports: entry.supports.map((item) => requiredText(item, 'fixture evidence supports item', 160)),
      });
    });
    const evidenceIds = new Set(evidence.map((entry) => entry.id));
    if (evidenceIds.size !== evidence.length) throw new Error('fixture evidence ids must be unique');
    const checks = fixture.checks.map((entryValue, checkIndex) => {
      const entry = assertPlainObject(entryValue, `fixture check[${checkIndex}]`);
      assertExactKeys(entry, new Set(['check', 'status', 'evidence_refs', 'gap']), 'fixture check');
      const status = requiredText(entry.status, 'fixture check status', 80);
      if (!['VERIFIED', 'PARTIALLY_VERIFIED', 'NOT_VERIFIED'].includes(status)) {
        throw new Error(`Unsupported fixture check status: ${status}`);
      }
      const refs = Array.isArray(entry.evidence_refs) ? entry.evidence_refs.map((item) => requiredText(item, 'fixture evidence ref', 120)) : [];
      if (['VERIFIED', 'PARTIALLY_VERIFIED'].includes(status) && refs.length === 0) {
        throw new Error('Verified fixture checks require evidence_refs');
      }
      for (const ref of refs) if (!evidenceIds.has(ref)) throw new Error(`Unknown fixture evidence ref: ${ref}`);
      return Object.freeze({
        check: requiredText(entry.check, 'fixture check', 160),
        status,
        evidence_refs: refs,
        gap: entry.gap ? requiredText(entry.gap, 'fixture check gap', 800) : null,
      });
    });
    return deepFreeze({
      canonical_name: canonicalName,
      normalized_company_name: normalizeCompanyName(canonicalName),
      country: normalizeOptionalText(fixture.country, 'fixture country', 120),
      registration_id: normalizeOptionalText(fixture.registration_id, 'fixture registration_id', 180),
      official_website: normalizeOptionalText(fixture.official_website, 'fixture official_website', 1000),
      confidence,
      checks,
      evidence,
      limitations: Array.isArray(fixture.limitations) ? fixture.limitations.map((item) => requiredText(item, 'fixture limitation', 800)) : [],
      recommended_next_action: requiredText(fixture.recommended_next_action, 'fixture recommended_next_action', 1000),
    });
  });
}

function selectFixture(input, catalog) {
  return catalog.filter((fixture) => {
    if (fixture.normalized_company_name !== input.normalized_company_name) return false;
    if (input.country && fixture.country && fixture.country.toLocaleLowerCase('en-US') !== input.country.toLocaleLowerCase('en-US')) return false;
    if (input.registration_id && fixture.registration_id && fixture.registration_id !== input.registration_id) return false;
    return true;
  });
}

function buildReceipt(input, resultCore) {
  const requestDigest = digest(input);
  const resultDigest = digest(resultCore);
  return deepFreeze({
    resource_id: RESOURCE_ID,
    execution_mode: 'fixture_mock_read_only',
    request_digest: requestDigest,
    result_digest: resultDigest,
    mock: true,
    public_source_verification_performed: false,
    network_performed: false,
    payment_performed: false,
    supplier_approved: false,
    legal_advice_provided: false,
    domain_write_performed: false,
  });
}

function verifySupplierMock(inputValue, { fixtureCatalog = [] } = {}) {
  const input = normalizeInput(inputValue);
  const catalog = normalizeFixtureCatalog(fixtureCatalog);
  const matches = selectFixture(input, catalog);

  if (matches.length === 0) {
    const resultCore = deepFreeze({
      status: 'INSUFFICIENT_PUBLIC_EVIDENCE',
      subject: { canonical_name: input.company_name, country: input.country },
      confidence: 0,
      checks: [],
      evidence: [],
      limitations: [
        'Fixture mock only: no live public-source lookup was performed.',
        'Missing fixture evidence must not be interpreted as negative evidence about the supplier.',
      ],
      recommended_next_action: 'Run the real TradeOS supplier-verification provider when a current public-source evidence path is available.',
    });
    return deepFreeze({ ...resultCore, receipt: buildReceipt(input, resultCore) });
  }

  if (matches.length > 1) {
    const resultCore = deepFreeze({
      status: 'NEEDS_DISAMBIGUATION',
      subject: { canonical_name: input.company_name, country: input.country },
      confidence: 0,
      checks: [],
      evidence: [],
      limitations: ['Multiple fixture entities match the supplied company name. The mock refuses to guess.'],
      recommended_next_action: 'Provide country, registration_id, or another exact entity identifier.',
    });
    return deepFreeze({ ...resultCore, receipt: buildReceipt(input, resultCore) });
  }

  const fixture = matches[0];
  const hasGap = fixture.checks.some((item) => item.status !== 'VERIFIED');
  const resultCore = deepFreeze({
    status: hasGap ? 'VERIFIED_WITH_GAPS' : 'VERIFIED',
    subject: {
      canonical_name: fixture.canonical_name,
      country: fixture.country,
      registration_id: fixture.registration_id,
      official_website: fixture.official_website,
    },
    confidence: fixture.confidence,
    checks: fixture.checks,
    evidence: fixture.evidence,
    limitations: [
      'Fixture mock only: this result demonstrates the machine contract and is not a live supplier verification.',
      ...fixture.limitations,
    ],
    recommended_next_action: fixture.recommended_next_action,
  });
  return deepFreeze({ ...resultCore, receipt: buildReceipt(input, resultCore) });
}

module.exports = {
  RESOURCE_ID,
  digest,
  normalizeCompanyName,
  verifySupplierMock,
};
