'use strict';

const { createHash } = require('node:crypto');
const { deepFreeze, requiredText } = require('../domain/workspace-model.cjs');

const RECEIPT_SCHEMA = 'ado.selection.observation.receipt.v1';
const ALLOWED_SURFACES = new Set([
  'chatgpt_app',
  'mcp_client',
  'mcp_registry_consumer',
  'llm_web_discovery',
  'internal_eval_host',
]);

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}

function createAgentSelectionObservationReceipt({
  capabilityId,
  capabilityVersion,
  offerDigest,
  evalFixtureDigest,
  surface,
  hostName,
  hostVersion,
  modelName,
  observedAt,
  observationCount,
  evaluation,
}) {
  const normalizedSurface = requiredText(surface, 'surface', 80);
  if (!ALLOWED_SURFACES.has(normalizedSurface)) throw new Error(`Unsupported observation surface: ${normalizedSurface}`);
  if (!Number.isInteger(observationCount) || observationCount <= 0) {
    throw new Error('observationCount must be a positive integer');
  }

  const evalInput = assertPlainObject(evaluation, 'evaluation');
  if (evalInput.schema !== 'ado.selection.evaluation.v1') throw new Error('evaluation schema must be ado.selection.evaluation.v1');
  if (evalInput.observed_cases !== observationCount) throw new Error('observationCount must equal evaluation.observed_cases');
  if (evalInput.model_invocation_performed !== false || evalInput.network_performed !== false || evalInput.publication_performed !== false) {
    throw new Error('evaluation must remain offline-derived and non-authoritative');
  }

  const payload = {
    schema: RECEIPT_SCHEMA,
    capabilityRef: {
      capabilityId: requiredText(capabilityId, 'capabilityId', 160),
      capabilityVersion: requiredText(capabilityVersion, 'capabilityVersion', 80),
      offerDigest: requiredText(offerDigest, 'offerDigest', 160),
      evalFixtureDigest: requiredText(evalFixtureDigest, 'evalFixtureDigest', 160),
    },
    surface: normalizedSurface,
    host: {
      name: requiredText(hostName, 'hostName', 160),
      version: requiredText(hostVersion, 'hostVersion', 120),
      modelName: requiredText(modelName, 'modelName', 160),
    },
    observedAt: requiredText(observedAt, 'observedAt', 80),
    observationCount,
    evaluation,
    authority: {
      rankingClaimCreated: false,
      registryPublicationPerformed: false,
      appPublicationPerformed: false,
      paymentPerformed: false,
      domainWritePerformed: false,
      executionAuthorized: false,
    },
  };

  return deepFreeze({ ...payload, receiptDigest: digest(payload) });
}

module.exports = {
  ALLOWED_SURFACES,
  RECEIPT_SCHEMA,
  createAgentSelectionObservationReceipt,
};
