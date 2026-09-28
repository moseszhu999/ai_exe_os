'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildControllerAdoptionSource,
} = require('../src/management/portfolio/controller-adoption-kit.cjs');

function payload() {
  return {
    projectId: 'aiexe',
    controllerId: 'group-management-plane-controller',
    repository: 'moseszhu999/ai_exe_os',
    exactHeadSha: '7fdf410e009ea5a1f25bc03dea3b2e54a83c9d48',
    domainStatus: 'active',
    owner: 'AIEXE Group Management Plane Controller',
    milestone: 'S8 GO; management plane M2.8 adoption/ingestion evidence; M3 still blocked',
    blockerCodes: ['m3_g2_partial', 'm3_g3_partial', 'm3_g4_partial', 'm3_g5_partial'],
    evidenceRefs: ['github:moseszhu999/ai_exe_os:pull:125'],
    observedAt: '2026-08-09T22:54:07Z',
  };
}

test('M2.8 adoption kit renders one canonical out-of-band source and round-trips through the existing parser', () => {
  const result = buildControllerAdoptionSource({
    payload: payload(),
    sourceKind: 'automation-receipt',
    sourceRef: 'automation:aiexe:controller:2026-08-10T07:54:07+09:00',
  });

  assert.equal(result.schema, 'aiexe.controller-adoption-source.v1');
  assert.equal(result.adoptionMode, 'out-of-band-structured-envelope');
  assert.equal(result.externalRepositoryFrameworkRequired, false);
  assert.equal(result.externalRepositoryWriteRequiredByThisBuilder, false);
  assert.equal(result.crossRepositoryCredentialRequiredByThisBuilder, false);
  assert.equal(result.factExtraction, 'marked-json-only');
  assert.equal(result.llmFactGenerationAllowed, false);
  assert.equal(result.readOnly, true);
  assert.equal(result.writeAuthority, 'none');
  assert.match(result.sourceDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(result.body, /aiexe\.external-controller-attestation\.v1/);
  assert.equal(result.envelope.sourceDigestVerified, true);
  assert.equal(result.envelope.attestation.projectId, 'aiexe');
  assert.equal(result.envelope.attestation.canonicalReceipt.exactHeadSha, payload().exactHeadSha);
});

test('M2.8 adoption kit cannot smuggle authority fields or duplicate attestation markers', () => {
  assert.throws(() => buildControllerAdoptionSource({
    payload: { ...payload(), writeAuthority: 'merge' },
    sourceKind: 'automation-receipt',
    sourceRef: 'automation:aiexe:bad-authority',
  }), /unsupported field: writeAuthority/);

  assert.throws(() => buildControllerAdoptionSource({
    payload: payload(),
    sourceKind: 'automation-receipt',
    sourceRef: 'automation:aiexe:duplicate-marker',
    prose: '<!-- aiexe.external-controller-attestation.v1 --> duplicate marker',
  }), /exactly one attestation marker pair/);
});
