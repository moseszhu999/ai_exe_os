'use strict';

const { createLiveGithubProviderObservation } = require('./live-provider-observation.cjs');
const { parseControllerAttestationEnvelope } = require('./controller-attestation-envelope.cjs');
const { buildReadOnlyManagementObservationCycle } = require('./observation-cycle.cjs');

const LIVE_PROVIDER_CYCLE_SCHEMA = 'aiexe.management-live-provider-cycle.v1';
const CAPTURE_SCHEMA = 'aiexe.live-github-observation-capture.v1';

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a plain object`);
  return value;
}

function requiredInstant(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new TypeError(`${label} must be an ISO timestamp`);
  return value;
}

function buildExternalProviderManagementCycle(input) {
  plainObject(input, 'external provider management cycle input');
  const allowed = new Set(['capture', 'attestationSources', 'portfolioId', 'freshnessWindowMinutes', 'evaluatedAt']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`external provider management cycle input contains unsupported field: ${key}`);
  }

  const capture = input.capture;
  if (capture?.schema !== CAPTURE_SCHEMA || capture?.evidenceClass !== 'REAL_PROVIDER_OBSERVATION') {
    throw new Error('real live GitHub provider capture required');
  }
  if (!Array.isArray(capture.observations) || capture.observations.length < 1) {
    throw new TypeError('live provider capture requires observations');
  }
  if (!Array.isArray(input.attestationSources)) throw new TypeError('attestationSources must be an array');
  const evaluatedAt = requiredInstant(input.evaluatedAt, 'cycle evaluated at');
  if (Date.parse(evaluatedAt) < Date.parse(capture.capturedAt)) throw new Error('cycle evaluatedAt cannot predate provider capture');

  const observations = capture.observations.map((row) => createLiveGithubProviderObservation(row));
  const envelopes = input.attestationSources.map((source) => parseControllerAttestationEnvelope(source));
  const attestations = envelopes.map((envelope) => envelope.attestation);
  const cycle = buildReadOnlyManagementObservationCycle({
    portfolioId: input.portfolioId || 'group-portfolio',
    observedAt: evaluatedAt,
    githubObservations: observations,
    controllerAttestations: attestations,
    freshnessWindowMinutes: input.freshnessWindowMinutes,
  });

  return freezeDeep({
    schema: LIVE_PROVIDER_CYCLE_SCHEMA,
    evidenceClass: 'REAL_PROVIDER_OBSERVATION_PLUS_CONTROLLER_ATTESTATION',
    providerCapturedAt: capture.capturedAt,
    evaluatedAt,
    providerTransport: 'external-read-only-connector',
    providerObservationSupplied: true,
    providerFetchPerformedInProcess: false,
    crossRepositoryCredentialRequiredByThisModule: false,
    scheduledRuntimeStarted: false,
    recurringIngestionProven: false,
    writeAuthority: 'none',
    llmFactGenerationAllowed: false,
    parsedAttestationCount: attestations.length,
    sourceDigestVerifiedCount: envelopes.filter((envelope) => envelope.sourceDigestVerified).length,
    cycle,
  });
}

module.exports = {
  CAPTURE_SCHEMA,
  LIVE_PROVIDER_CYCLE_SCHEMA,
  buildExternalProviderManagementCycle,
};
