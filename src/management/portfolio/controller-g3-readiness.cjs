'use strict';

const { CONTROLLER_PRODUCER_READINESS_SCHEMA } = require('./controller-producer-readiness.cjs');
const { CONTROLLER_RECURRING_STRUCTURED_PROOF_SCHEMA } = require('./controller-recurrence-proof.cjs');

const CONTROLLER_G3_READINESS_SCHEMA = 'aiexe.controller-g3-readiness.v1';
const REQUIRED_EXTERNAL_DOMAINS = Object.freeze([
  Object.freeze({ projectId: 'tradeos', repository: 'moseszhu999/chaintrace-app' }),
  Object.freeze({ projectId: 'trainingos', repository: 'moseszhu999/training-learning-rails' }),
  Object.freeze({ projectId: 'video-operation-shared-media', repository: 'moseszhu999/global-tool-radar' }),
]);

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a plain object`);
  return value;
}

function requiredText(value, label, maxLength = 500) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const text = value.trim();
  if (!text) throw new TypeError(`${label} must not be empty`);
  if (text.length > maxLength) throw new TypeError(`${label} is too long`);
  return text;
}

function uniqueSortedRefs(value, label) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const refs = value.map((item) => requiredText(item, label));
  if (new Set(refs).size !== refs.length) throw new Error(`${label} must not contain duplicates`);
  return Object.freeze([...refs].sort());
}

function validateCanonicalProducerReadiness(value) {
  plainObject(value, 'controller producer readiness');
  if (
    value.schema !== CONTROLLER_PRODUCER_READINESS_SCHEMA
    || value.evidenceClass !== 'READ_ONLY_CONTROLLER_PRODUCER_TOPOLOGY'
    || value.readOnly !== true
    || value.writeAuthority !== 'none'
    || value.arbitraryEvidenceRefsCannotProveRecurrence !== true
    || value.recurrenceProofRecomputedFromEmbeddedCycles !== true
  ) {
    throw new Error('M2.16 canonical controller producer readiness required');
  }
  if (!Array.isArray(value.producers)) throw new TypeError('controller producer readiness requires producers');
  if (value.externalProjectCount !== REQUIRED_EXTERNAL_DOMAINS.length || value.producers.length !== REQUIRED_EXTERNAL_DOMAINS.length) {
    throw new Error('G3 requires the fixed three-Domain external project set');
  }

  const expected = [...REQUIRED_EXTERNAL_DOMAINS].sort((a, b) => a.projectId.localeCompare(b.projectId));
  const actual = [...value.producers].sort((a, b) => a.projectId.localeCompare(b.projectId));
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index]?.projectId !== expected[index].projectId || actual[index]?.repository !== expected[index].repository) {
      throw new Error('G3 external project set or repository binding mismatch');
    }
  }
  return actual;
}

function classifyRequiredDomain(producer) {
  const blockers = [];
  if (producer.adoptionState !== 'STRUCTURED_CONTROLLER_ADOPTED') blockers.push('structured_controller_not_current');
  if (producer.schedulerObserved !== true) blockers.push('producer_topology_unobserved');
  else if (producer.schedulerEnabled !== true) blockers.push('producer_disabled');
  if (producer.structuredProducerContractObserved !== true) blockers.push('structured_producer_contract_unobserved');
  if (producer.outOfBandPersistenceChannelObserved !== true) blockers.push('out_of_band_persistence_unobserved');
  if (producer.recurringStructuredProven !== true) blockers.push('recurring_structured_proof_missing');

  const proof = producer.recurringStructuredProof;
  if (producer.recurringStructuredProven === true) {
    if (
      proof?.schema !== CONTROLLER_RECURRING_STRUCTURED_PROOF_SCHEMA
      || proof?.evidenceClass !== 'VERIFIED_RECURRING_STRUCTURED_CONTROLLER_SOURCE'
      || proof?.projectId !== producer.projectId
      || proof?.repository !== producer.repository
      || proof?.proven !== true
      || proof?.readOnly !== true
      || proof?.writeAuthority !== 'none'
      || !Array.isArray(proof?.cycles)
      || proof.cycles.length < 2
    ) {
      throw new Error(`producer ${producer.projectId} claims recurrence without canonical proof`);
    }
  }

  const pass = blockers.length === 0;
  return freezeDeep({
    projectId: producer.projectId,
    repository: producer.repository,
    exactHeadSha: producer.exactHeadSha,
    producerState: producer.state,
    pass,
    blockers: Object.freeze(blockers.sort()),
    recurrenceCycleCount: proof?.cycleCount || 0,
    recurrenceSourceRefs: proof ? Object.freeze([...proof.sourceRefs]) : Object.freeze([]),
    recurrenceSourceDigests: proof ? Object.freeze([...proof.sourceDigests]) : Object.freeze([]),
    producerEvidenceRefs: uniqueSortedRefs(producer.evidenceRefs, 'producer evidence ref'),
    readOnly: true,
    writeAuthority: 'none',
    authorityGranted: false,
  });
}

function buildControllerG3Readiness(input) {
  plainObject(input, 'controller G3 readiness input');
  const allowed = new Set(['producerReadiness']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`controller G3 readiness input contains unsupported field: ${key}`);
  }

  const producerReadiness = input.producerReadiness;
  const producers = validateCanonicalProducerReadiness(producerReadiness);
  const projects = producers.map(classifyRequiredDomain);
  const passingProjectCount = projects.filter((project) => project.pass).length;
  const pass = passingProjectCount === REQUIRED_EXTERNAL_DOMAINS.length;

  return freezeDeep({
    schema: CONTROLLER_G3_READINESS_SCHEMA,
    evidenceClass: 'READ_ONLY_G3_CONTROLLER_READINESS_GATE',
    observedAt: requiredText(producerReadiness.observedAt, 'G3 observed at', 80),
    requiredProjectCount: REQUIRED_EXTERNAL_DOMAINS.length,
    passingProjectCount,
    failingProjectCount: REQUIRED_EXTERNAL_DOMAINS.length - passingProjectCount,
    requiredProjectSetFixed: true,
    callerCanReduceRequiredProjectSet: false,
    verdict: pass ? 'PASS' : 'PARTIAL',
    g3Pass: pass,
    m3EntryAuthorized: false,
    a2ExecutionAuthorized: false,
    readOnly: true,
    writeAuthority: 'none',
    domainTruthInferred: false,
    authorityGranted: false,
    projects,
  });
}

module.exports = {
  CONTROLLER_G3_READINESS_SCHEMA,
  REQUIRED_EXTERNAL_DOMAINS,
  buildControllerG3Readiness,
};
