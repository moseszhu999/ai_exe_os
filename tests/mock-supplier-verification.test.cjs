'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { verifySupplierMock } = require('../src/discovery/mock-supplier-verification.cjs');

function fixture(country = 'CN', registrationId = 'REG-001') {
  return {
    canonical_name: 'Acme Manufacturing Co., Ltd.',
    country,
    registration_id: registrationId,
    official_website: 'https://acme.example/',
    confidence: 0.87,
    checks: [
      {
        check: 'legal_entity_identity',
        status: 'VERIFIED',
        evidence_refs: ['ev-001'],
      },
      {
        check: 'claimed_manufacturing_capability',
        status: 'PARTIALLY_VERIFIED',
        evidence_refs: ['ev-002'],
        gap: 'No fixture evidence for an in-house coating line.',
      },
    ],
    evidence: [
      {
        id: 'ev-001',
        source_type: 'official_registry',
        source_url: 'https://registry.example/acme',
        observed_at: '2026-08-12T00:00:00Z',
        supports: ['legal_entity_identity'],
      },
      {
        id: 'ev-002',
        source_type: 'official_company_page',
        source_url: 'https://acme.example/manufacturing',
        observed_at: '2026-08-12T00:00:00Z',
        supports: ['claimed_manufacturing_capability'],
      },
    ],
    limitations: ['No physical factory audit performed.'],
    recommended_next_action: 'Request current production-line evidence.',
  };
}

test('unique fixture returns structured evidence with explicit mock boundary', () => {
  const result = verifySupplierMock({
    company_name: 'Acme Manufacturing Co., Ltd.',
    country: 'CN',
    product_requirement: 'coated aluminum housings',
  }, { fixtureCatalog: [fixture()] });

  assert.equal(result.status, 'VERIFIED_WITH_GAPS');
  assert.equal(result.subject.registration_id, 'REG-001');
  assert.equal(result.checks[0].status, 'VERIFIED');
  assert.deepEqual(result.checks[0].evidence_refs, ['ev-001']);
  assert.equal(result.receipt.resource_id, 'trade.verify_supplier.v1');
  assert.equal(result.receipt.mock, true);
  assert.equal(result.receipt.public_source_verification_performed, false);
  assert.equal(result.receipt.network_performed, false);
  assert.equal(result.receipt.payment_performed, false);
  assert.equal(result.receipt.supplier_approved, false);
  assert.equal(result.receipt.legal_advice_provided, false);
  assert.equal(result.receipt.domain_write_performed, false);
});

test('missing fixture evidence is unknown, never a negative supplier claim', () => {
  const result = verifySupplierMock({ company_name: 'Unknown Supplier' });
  assert.equal(result.status, 'INSUFFICIENT_PUBLIC_EVIDENCE');
  assert.equal(result.confidence, 0);
  assert.equal(result.checks.length, 0);
  assert.match(result.limitations.join(' '), /must not be interpreted as negative evidence/i);
});

test('ambiguous exact-name fixtures refuse to guess', () => {
  const result = verifySupplierMock({ company_name: 'Acme Manufacturing Co Ltd' }, {
    fixtureCatalog: [fixture('CN', 'REG-001'), fixture('US', 'REG-002')],
  });
  assert.equal(result.status, 'NEEDS_DISAMBIGUATION');
  assert.match(result.recommended_next_action, /country|registration_id/i);
});

test('country can disambiguate the same normalized company name', () => {
  const result = verifySupplierMock({ company_name: 'Acme Manufacturing Co Ltd', country: 'US' }, {
    fixtureCatalog: [fixture('CN', 'REG-001'), fixture('US', 'REG-002')],
  });
  assert.equal(result.status, 'VERIFIED_WITH_GAPS');
  assert.equal(result.subject.registration_id, 'REG-002');
});

test('verified fixture checks require real fixture evidence refs', () => {
  const broken = fixture();
  broken.checks[0].evidence_refs = [];
  assert.throws(
    () => verifySupplierMock({ company_name: 'Acme Manufacturing Co., Ltd.' }, { fixtureCatalog: [broken] }),
    /require evidence_refs/,
  );
});

test('closed input surface rejects unsupported fields and embedded URL credentials', () => {
  assert.throws(
    () => verifySupplierMock({ company_name: 'Acme', approve_supplier: true }),
    /unsupported field: approve_supplier/,
  );
  assert.throws(
    () => verifySupplierMock({ company_name: 'Acme', website: 'https://user:pass@example.com/' }),
    /without embedded credentials/,
  );
});
