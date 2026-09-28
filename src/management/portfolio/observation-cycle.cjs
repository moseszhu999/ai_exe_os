'use strict';

const { buildPortfolioSnapshot } = require('./index.cjs');
const { OBSERVATION_SCHEMA } = require('./read-only-adapters.cjs');
const {
  EXTERNAL_ATTESTATION_SCHEMA,
  enrichGithubObservationWithExternalAttestation,
} = require('./external-controller-attestation.cjs');
const { buildAttentionQueue, buildManagementCockpit } = require('./attention-engine.cjs');

const OBSERVATION_CYCLE_SCHEMA = 'aiexe.management-observation-cycle.v1';

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function requiredText(value, label, maxLength = 320) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const text = value.trim();
  if (!text) throw new TypeError(`${label} must not be empty`);
  if (text.length > maxLength) throw new TypeError(`${label} is too long`);
  return text;
}

function isoInstant(value, label) {
  const text = requiredText(value, label, 80);
  if (!Number.isFinite(Date.parse(text))) throw new TypeError(`${label} must be an ISO timestamp`);
  return text;
}

function buildReadOnlyManagementObservationCycle(input) {
  plainObject(input, 'management observation cycle input');
  const allowed = new Set([
    'portfolioId', 'observedAt', 'githubObservations', 'controllerAttestations',
    'freshnessWindowMinutes',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`management observation cycle input contains unsupported field: ${key}`);
  }

  const portfolioId = requiredText(input.portfolioId, 'portfolio id', 120);
  const observedAt = isoInstant(input.observedAt, 'cycle observed at');
  if (!Array.isArray(input.githubObservations) || input.githubObservations.length < 1) {
    throw new TypeError('githubObservations must be a non-empty array');
  }
  const attestations = input.controllerAttestations == null ? [] : input.controllerAttestations;
  if (!Array.isArray(attestations)) throw new TypeError('controllerAttestations must be an array');

  const observationIds = [];
  for (const observation of input.githubObservations) {
    if (observation?.schema !== OBSERVATION_SCHEMA || observation?.readOnly !== true || observation?.writeAuthority !== 'none') {
      throw new Error('cycle accepts only canonical read-only GitHub observations');
    }
    observationIds.push(observation.projectId);
  }
  if (new Set(observationIds).size !== observationIds.length) {
    throw new Error('cycle GitHub observation project ids must be unique');
  }

  const attestationByProject = new Map();
  for (const attestation of attestations) {
    if (attestation?.schema !== EXTERNAL_ATTESTATION_SCHEMA || attestation?.readOnly !== true || attestation?.writeAuthority !== 'none') {
      throw new Error('cycle accepts only canonical external controller attestations');
    }
    if (!observationIds.includes(attestation.projectId)) {
      throw new Error(`controller attestation has no matching GitHub observation: ${attestation.projectId}`);
    }
    if (attestationByProject.has(attestation.projectId)) {
      throw new Error(`duplicate controller attestation for project: ${attestation.projectId}`);
    }
    attestationByProject.set(attestation.projectId, attestation);
  }

  const resolvedObservations = input.githubObservations.map((observation) => {
    const attestation = attestationByProject.get(observation.projectId);
    if (attestation) {
      return enrichGithubObservationWithExternalAttestation({
        observation,
        attestation,
        now: observedAt,
        freshnessWindowMinutes: input.freshnessWindowMinutes,
      });
    }

    if (observation.snapshot.status !== 'unknown' || observation.snapshot.owner != null || observation.snapshot.milestone != null) {
      throw new Error(`live management cycle requires an external controller attestation for non-unknown domain facts: ${observation.projectId}`);
    }
    return observation;
  });

  const portfolio = buildPortfolioSnapshot({
    portfolioId,
    observedAt,
    projects: resolvedObservations.map((observation) => observation.snapshot),
  });
  const packets = buildAttentionQueue({ portfolio, evaluatedAt: observedAt });
  const cockpit = buildManagementCockpit({ portfolio, packets, observedAt });
  const unresolvedProjectIds = portfolio.projects
    .filter((project) => project.status === 'unknown')
    .map((project) => project.id)
    .sort();

  return freezeDeep({
    schema: OBSERVATION_CYCLE_SCHEMA,
    observedAt,
    readOnly: true,
    writeAuthority: 'none',
    domainRepositoryMutationRequired: false,
    providerFetchPerformed: false,
    scheduledRuntimeStarted: false,
    factPolicy: 'explicit-source-and-attestation-only',
    llmFactGenerationAllowed: false,
    projectCount: portfolio.projectCount,
    attestedProjectCount: attestationByProject.size,
    unresolvedProjectIds,
    resolvedObservations,
    portfolio,
    packets,
    cockpit,
  });
}

module.exports = {
  OBSERVATION_CYCLE_SCHEMA,
  buildReadOnlyManagementObservationCycle,
};
