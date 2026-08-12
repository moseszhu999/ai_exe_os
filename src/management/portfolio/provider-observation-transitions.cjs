'use strict';

const PROVIDER_OBSERVATION_TRANSITIONS_SCHEMA = 'aiexe.provider-observation-head-transitions.v1';
const REPEATED_PROVIDER_SCHEMA = 'aiexe.management-repeated-provider-ingestion.v1';

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

function requiredText(value, label, maxLength = 400) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const text = value.trim();
  if (!text) throw new TypeError(`${label} must not be empty`);
  if (text.length > maxLength) throw new TypeError(`${label} is too long`);
  return text;
}

function exactSha(value, label) {
  const text = requiredText(value, label, 80).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(text)) throw new TypeError(`${label} must be a 40-character git SHA`);
  return text;
}

function normalizeHeads(run) {
  if (!Array.isArray(run.heads) || run.heads.length < 1) throw new TypeError('provider run heads must be a non-empty array');
  const rows = run.heads.map((row) => ({
    projectId: requiredText(row.projectId, 'provider head project id', 120),
    headSha: exactSha(row.headSha, 'provider head sha'),
  })).sort((a, b) => a.projectId.localeCompare(b.projectId));
  const ids = rows.map((row) => row.projectId);
  if (new Set(ids).size !== ids.length) throw new Error('provider run head project ids must be unique');
  return rows;
}

function buildProviderObservationTransitions(repeatedEvidence) {
  if (!repeatedEvidence || typeof repeatedEvidence !== 'object' || Array.isArray(repeatedEvidence)) {
    throw new TypeError('repeated provider evidence must be a plain object');
  }
  if (repeatedEvidence.schema !== REPEATED_PROVIDER_SCHEMA || repeatedEvidence.evidenceClass !== 'REAL_PROVIDER_MULTI_RUN_OBSERVATION') {
    throw new Error('trusted repeated provider evidence required');
  }
  if (!Array.isArray(repeatedEvidence.runs) || repeatedEvidence.runs.length < 2) {
    throw new TypeError('at least two provider runs are required for transition evidence');
  }

  const normalized = repeatedEvidence.runs.map((run) => ({
    runId: requiredText(run.runId, 'provider run id', 160),
    capturedAt: requiredText(run.capturedAt, 'provider captured at', 80),
    heads: normalizeHeads(run),
  }));
  const baselineIds = normalized[0].heads.map((row) => row.projectId);
  const transitions = [];
  const changedProjectIds = new Set();

  for (let index = 1; index < normalized.length; index += 1) {
    const prior = normalized[index - 1];
    const current = normalized[index];
    const currentIds = current.heads.map((row) => row.projectId);
    if (JSON.stringify(currentIds) !== JSON.stringify(baselineIds)) throw new Error('provider project head set changed across runs');
    const priorMap = new Map(prior.heads.map((row) => [row.projectId, row.headSha]));
    const changes = current.heads
      .filter((row) => priorMap.get(row.projectId) !== row.headSha)
      .map((row) => {
        changedProjectIds.add(row.projectId);
        return freezeDeep({
          projectId: row.projectId,
          fromHeadSha: priorMap.get(row.projectId),
          toHeadSha: row.headSha,
        });
      });
    transitions.push(freezeDeep({
      fromRunId: prior.runId,
      toRunId: current.runId,
      fromCapturedAt: prior.capturedAt,
      toCapturedAt: current.capturedAt,
      headChanged: changes.length > 0,
      changedProjectCount: changes.length,
      changes,
    }));
  }

  return freezeDeep({
    schema: PROVIDER_OBSERVATION_TRANSITIONS_SCHEMA,
    evidenceClass: 'REAL_PROVIDER_HEAD_TRANSITION_EVIDENCE',
    runCount: normalized.length,
    transitionCount: transitions.length,
    changedTransitionCount: transitions.filter((transition) => transition.headChanged).length,
    headChangedAcrossRuns: changedProjectIds.size > 0,
    changedProjectIds: [...changedProjectIds].sort(),
    readOnly: true,
    writeAuthority: 'none',
    domainTruthInferred: false,
    transitions,
  });
}

module.exports = {
  PROVIDER_OBSERVATION_TRANSITIONS_SCHEMA,
  buildProviderObservationTransitions,
};
