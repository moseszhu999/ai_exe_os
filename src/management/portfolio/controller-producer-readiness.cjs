'use strict';

const { CONTROLLER_ADOPTION_READINESS_SCHEMA } = require('./controller-adoption-readiness.cjs');
const { CONTROLLER_RECURRING_STRUCTURED_PROOF_SCHEMA } = require('./controller-recurrence-proof.cjs');

const CONTROLLER_PRODUCER_READINESS_SCHEMA = 'aiexe.controller-producer-readiness.v1';

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

function exactBoolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  return value;
}

function optionalInstant(value, label) {
  if (value == null) return null;
  const text = requiredText(value, label, 80);
  if (!Number.isFinite(Date.parse(text))) throw new TypeError(`${label} must be an ISO timestamp`);
  return text;
}

function uniqueRefs(value, label) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const refs = value.map((item) => requiredText(item, label));
  if (new Set(refs).size !== refs.length) throw new Error(`${label} must not contain duplicates`);
  return Object.freeze([...refs].sort());
}

function canonicalRecurrenceProof(value, adoptionProject) {
  if (value == null) return null;
  plainObject(value, 'recurring structured proof');
  if (
    value.schema !== CONTROLLER_RECURRING_STRUCTURED_PROOF_SCHEMA
    || value.evidenceClass !== 'VERIFIED_RECURRING_STRUCTURED_CONTROLLER_SOURCE'
    || value.readOnly !== true
    || value.writeAuthority !== 'none'
    || value.proven !== true
  ) {
    throw new Error('canonical recurring structured proof required');
  }
  if (value.projectId !== adoptionProject.projectId || value.repository !== adoptionProject.repository) {
    throw new Error('recurring structured proof project binding mismatch');
  }
  if (!adoptionProject.structuredControllerAdopted) {
    throw new Error('recurring structured proof requires structured Controller adoption');
  }
  if (!Number.isInteger(value.cycleCount) || value.cycleCount < 2) {
    throw new Error('recurring structured proof requires at least two verified cycles');
  }
  if (
    value.allCyclesAcceptedExactHeadCurrent !== true
    || value.distinctSourceRefs !== true
    || value.distinctSourceDigests !== true
    || value.strictlyIncreasingObservedAt !== true
  ) {
    throw new Error('recurring structured proof invariants are incomplete');
  }
  const sourceRefs = uniqueRefs(value.sourceRefs, 'recurring proof source ref');
  const sourceDigests = uniqueRefs(value.sourceDigests, 'recurring proof source digest');
  if (sourceRefs.length !== value.cycleCount || sourceDigests.length !== value.cycleCount) {
    throw new Error('recurring structured proof cycle evidence is incomplete');
  }
  const first = optionalInstant(value.firstObservedAt, 'recurring proof first observed at');
  const last = optionalInstant(value.lastObservedAt, 'recurring proof last observed at');
  if (!first || !last || Date.parse(last) <= Date.parse(first)) {
    throw new Error('recurring structured proof time range must advance');
  }
  return value;
}

function classifyProducer(raw, adoptionProject) {
  plainObject(raw, 'controller producer observation');
  const allowed = new Set([
    'projectId', 'schedulerRef', 'schedulerObserved', 'schedulerEnabled', 'lastRunAt',
    'structuredProducerContractObserved', 'outOfBandPersistenceChannelObserved',
    'recurringStructuredEvidenceRefs', 'recurringStructuredProof', 'evidenceRefs',
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new Error(`controller producer observation contains unsupported field: ${key}`);
  }

  const projectId = requiredText(raw.projectId, 'producer project id', 120);
  if (!adoptionProject || adoptionProject.projectId !== projectId) throw new Error(`producer project ${projectId} is not bound to adoption readiness`);

  const schedulerObserved = exactBoolean(raw.schedulerObserved, 'schedulerObserved');
  const schedulerEnabled = exactBoolean(raw.schedulerEnabled, 'schedulerEnabled');
  if (schedulerEnabled && !schedulerObserved) throw new Error('scheduler cannot be enabled when scheduler observation is absent');

  const lastRunAt = optionalInstant(raw.lastRunAt, 'producer last run at');
  if (lastRunAt && !schedulerObserved) throw new Error('producer last run requires observed scheduler topology');

  const structuredProducerContractObserved = exactBoolean(raw.structuredProducerContractObserved, 'structuredProducerContractObserved');
  const outOfBandPersistenceChannelObserved = exactBoolean(raw.outOfBandPersistenceChannelObserved, 'outOfBandPersistenceChannelObserved');
  const recurringStructuredEvidenceRefs = uniqueRefs(raw.recurringStructuredEvidenceRefs, 'recurring structured evidence ref');
  const evidenceRefs = uniqueRefs(raw.evidenceRefs, 'producer evidence ref');

  if (recurringStructuredEvidenceRefs.length > 0 && !adoptionProject.structuredControllerAdopted) {
    throw new Error('recurring structured evidence requires structured Controller adoption');
  }

  const recurringStructuredProof = canonicalRecurrenceProof(raw.recurringStructuredProof, adoptionProject);
  if (recurringStructuredProof && !structuredProducerContractObserved) {
    throw new Error('recurring structured proof requires the structured producer contract to be observed');
  }

  const recurringStructuredProven = Boolean(
    recurringStructuredProof
    && schedulerObserved
    && schedulerEnabled
    && structuredProducerContractObserved
    && adoptionProject.structuredControllerAdopted
  );

  let state;
  if (!schedulerObserved) state = 'PRODUCER_TOPOLOGY_UNOBSERVED';
  else if (!schedulerEnabled) state = 'PRODUCER_DISABLED';
  else if (recurringStructuredProven) state = 'RECURRING_STRUCTURED_PRODUCER_PROVEN';
  else if (adoptionProject.structuredControllerAdopted) state = 'STRUCTURED_SOURCE_PRESENT_RECURRENCE_UNPROVEN';
  else if (!structuredProducerContractObserved && !outOfBandPersistenceChannelObserved) state = 'ACTIVE_CONTRACT_AND_PERSISTENCE_MISSING';
  else if (!structuredProducerContractObserved) state = 'ACTIVE_STRUCTURED_CONTRACT_MISSING';
  else if (!outOfBandPersistenceChannelObserved) state = 'ACTIVE_OUT_OF_BAND_PERSISTENCE_MISSING';
  else state = 'ACTIVE_STRUCTURED_SOURCE_NOT_YET_OBSERVED';

  return freezeDeep({
    projectId,
    repository: adoptionProject.repository,
    exactHeadSha: adoptionProject.exactHeadSha,
    adoptionState: adoptionProject.state,
    state,
    schedulerRef: requiredText(raw.schedulerRef, 'scheduler ref', 240),
    schedulerObserved,
    schedulerEnabled,
    lastRunAt,
    structuredProducerContractObserved,
    outOfBandPersistenceChannelObserved,
    recurringStructuredProven,
    recurringStructuredEvidenceRefs,
    recurringStructuredProof,
    evidenceRefs,
    domainTruthInferred: false,
    authorityGranted: false,
  });
}

function buildControllerProducerReadiness(input) {
  plainObject(input, 'controller producer readiness input');
  const allowed = new Set(['observedAt', 'adoptionReadiness', 'producers']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`controller producer readiness input contains unsupported field: ${key}`);
  }

  const adoptionReadiness = input.adoptionReadiness;
  if (adoptionReadiness?.schema !== CONTROLLER_ADOPTION_READINESS_SCHEMA || adoptionReadiness?.readOnly !== true) {
    throw new Error('canonical controller adoption readiness required');
  }
  if (!Array.isArray(input.producers)) throw new TypeError('controller producer readiness requires producers');
  if (input.producers.length !== adoptionReadiness.projects.length) throw new Error('producer observations must cover the same project set as adoption readiness');

  const adoptionByProject = new Map(adoptionReadiness.projects.map((project) => [project.projectId, project]));
  const producers = input.producers
    .map((producer) => classifyProducer(producer, adoptionByProject.get(producer.projectId)))
    .sort((a, b) => a.projectId.localeCompare(b.projectId));
  const ids = producers.map((producer) => producer.projectId);
  if (new Set(ids).size !== ids.length) throw new Error('producer project ids must be unique');
  if (ids.some((id) => !adoptionByProject.has(id))) throw new Error('producer project set mismatch');

  const recurringStructuredProducerCount = producers.filter((producer) => producer.recurringStructuredProven).length;
  const enabledProducerCount = producers.filter((producer) => producer.schedulerObserved && producer.schedulerEnabled).length;
  const disabledProducerCount = producers.filter((producer) => producer.schedulerObserved && !producer.schedulerEnabled).length;
  const contractMissingCount = producers.filter((producer) => !producer.structuredProducerContractObserved).length;
  const persistenceMissingCount = producers.filter((producer) => !producer.outOfBandPersistenceChannelObserved).length;

  return freezeDeep({
    schema: CONTROLLER_PRODUCER_READINESS_SCHEMA,
    evidenceClass: 'READ_ONLY_CONTROLLER_PRODUCER_TOPOLOGY',
    observedAt: requiredText(input.observedAt, 'observed at', 80),
    externalProjectCount: producers.length,
    enabledProducerCount,
    disabledProducerCount,
    contractMissingCount,
    persistenceMissingCount,
    recurringStructuredProducerCount,
    recurringStructuredProducerComplete: recurringStructuredProducerCount === producers.length,
    schedulerStateIsNotDomainTruth: true,
    promptPresenceIsNotDomainTruth: true,
    arbitraryEvidenceRefsCannotProveRecurrence: true,
    readOnly: true,
    writeAuthority: 'none',
    llmFactGenerationAllowed: false,
    crossRepositoryCredentialRequiredByThisModule: false,
    externalRepositoryMutationRequiredByThisModule: false,
    producers,
  });
}

module.exports = {
  CONTROLLER_PRODUCER_READINESS_SCHEMA,
  buildControllerProducerReadiness,
};
