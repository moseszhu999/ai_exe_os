'use strict';

const { createHash } = require('node:crypto');
const { CAPTURE_SCHEMA, buildExternalProviderManagementCycle } = require('./live-provider-cycle.cjs');

const REPEATED_PROVIDER_INGESTION_SCHEMA = 'aiexe.management-repeated-provider-ingestion.v1';

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a plain object`);
  return value;
}

function requiredText(value, label, maxLength = 400) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const text = value.trim();
  if (!text) throw new TypeError(`${label} must not be empty`);
  if (text.length > maxLength) throw new TypeError(`${label} is too long`);
  return text;
}

function instant(value, label) {
  const text = requiredText(value, label, 80);
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new TypeError(`${label} must be an ISO timestamp`);
  return { text, ms };
}

function digestBody(body) {
  if (typeof body !== 'string') throw new TypeError('provider capture body must be a string');
  return `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
}

function exactDigest(value) {
  const text = requiredText(value, 'provider capture digest', 80).toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/.test(text)) throw new TypeError('provider capture digest must be sha256:<64 hex chars>');
  return text;
}

function parseCaptureSource(input) {
  plainObject(input, 'provider capture source');
  const allowed = new Set(['body', 'sourceRef', 'sourceDigest']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`provider capture source contains unsupported field: ${key}`);
  }
  const body = typeof input.body === 'string' ? input.body : (() => { throw new TypeError('provider capture body must be a string'); })();
  const sourceRef = requiredText(input.sourceRef, 'provider capture source ref', 320);
  const sourceDigest = exactDigest(input.sourceDigest);
  if (sourceDigest !== digestBody(body)) throw new Error('provider capture digest mismatch');

  let capture;
  try {
    capture = JSON.parse(body);
  } catch (error) {
    throw new Error(`provider capture JSON is invalid: ${error.message}`);
  }
  plainObject(capture, 'provider capture');
  if (capture.schema !== CAPTURE_SCHEMA || capture.evidenceClass !== 'REAL_PROVIDER_OBSERVATION') {
    throw new Error('real live GitHub provider capture required');
  }
  return { body, sourceRef, sourceDigest, capture };
}

function fingerprint(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')}`;
}

function normalizedHeads(capture) {
  return capture.observations
    .map((row) => ({ projectId: row.projectId, headSha: row.headSha }))
    .sort((left, right) => left.projectId.localeCompare(right.projectId));
}

function normalizedOpenWork(capture) {
  return capture.observations
    .map((row) => ({
      projectId: row.projectId,
      pullRequests: [...row.openPullRequests]
        .map((pr) => ({ number: pr.number, headSha: pr.headSha, draft: Boolean(pr.draft), updatedAt: pr.updatedAt }))
        .sort((left, right) => left.number - right.number),
    }))
    .sort((left, right) => left.projectId.localeCompare(right.projectId));
}

function buildRepeatedReadOnlyProviderEvidence(input) {
  plainObject(input, 'repeated provider ingestion input');
  const allowed = new Set(['runs', 'portfolioId', 'freshnessWindowMinutes', 'minimumSpacingSeconds']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`repeated provider ingestion input contains unsupported field: ${key}`);
  }
  if (!Array.isArray(input.runs) || input.runs.length < 2) throw new TypeError('repeated provider ingestion requires at least two real runs');
  const minimumSpacingSeconds = input.minimumSpacingSeconds == null ? 60 : input.minimumSpacingSeconds;
  if (!Number.isFinite(minimumSpacingSeconds) || minimumSpacingSeconds < 1) throw new TypeError('minimumSpacingSeconds must be positive');

  const seenRunIds = new Set();
  const seenSourceRefs = new Set();
  const seenSourceDigests = new Set();
  let priorCapturedMs = null;
  let priorIngestedMs = null;
  let baselineProjectIds = null;
  const records = [];

  for (const rawRun of input.runs) {
    plainObject(rawRun, 'provider ingestion run');
    const runAllowed = new Set(['runId', 'captureSource', 'attestationSources', 'evaluatedAt', 'ingestedAt']);
    for (const key of Object.keys(rawRun)) {
      if (!runAllowed.has(key)) throw new Error(`provider ingestion run contains unsupported field: ${key}`);
    }
    const runId = requiredText(rawRun.runId, 'provider ingestion run id', 160);
    if (seenRunIds.has(runId)) throw new Error('provider ingestion run ids must be unique');
    seenRunIds.add(runId);

    const source = parseCaptureSource(rawRun.captureSource);
    if (seenSourceRefs.has(source.sourceRef)) throw new Error('provider capture source refs must be unique across repeated runs');
    if (seenSourceDigests.has(source.sourceDigest)) throw new Error('provider capture digests must be unique across repeated runs');
    seenSourceRefs.add(source.sourceRef);
    seenSourceDigests.add(source.sourceDigest);

    const captured = instant(source.capture.capturedAt, 'provider captured at');
    const evaluated = instant(rawRun.evaluatedAt, 'provider run evaluated at');
    const ingested = instant(rawRun.ingestedAt, 'provider run ingested at');
    if (evaluated.ms < captured.ms) throw new Error('provider run evaluatedAt cannot predate capture');
    if (ingested.ms < evaluated.ms) throw new Error('provider run ingestedAt cannot predate evaluation');
    if (priorCapturedMs != null && captured.ms - priorCapturedMs < minimumSpacingSeconds * 1000) {
      throw new Error('provider captures do not satisfy minimum repeated-run spacing');
    }
    if (priorIngestedMs != null && ingested.ms <= priorIngestedMs) throw new Error('provider ingestion times must increase strictly');
    priorCapturedMs = captured.ms;
    priorIngestedMs = ingested.ms;

    const cycle = buildExternalProviderManagementCycle({
      capture: source.capture,
      attestationSources: rawRun.attestationSources || [],
      portfolioId: input.portfolioId,
      freshnessWindowMinutes: input.freshnessWindowMinutes,
      evaluatedAt: evaluated.text,
    });
    const projectIds = cycle.cycle.portfolio.projects.map((project) => project.id).sort();
    if (baselineProjectIds == null) baselineProjectIds = projectIds;
    else if (JSON.stringify(projectIds) !== JSON.stringify(baselineProjectIds)) throw new Error('provider project set changed across repeated runs');

    const heads = normalizedHeads(source.capture);
    const openWork = normalizedOpenWork(source.capture);
    records.push(freezeDeep({
      runId,
      captureSourceRef: source.sourceRef,
      captureSourceDigest: source.sourceDigest,
      capturedAt: captured.text,
      evaluatedAt: evaluated.text,
      ingestedAt: ingested.text,
      projectCount: cycle.cycle.projectCount,
      attestedProjectCount: cycle.cycle.attestedProjectCount,
      unresolvedProjectIds: cycle.cycle.unresolvedProjectIds,
      heads,
      headsFingerprint: fingerprint(heads),
      openWorkFingerprint: fingerprint(openWork),
    }));
  }

  const headFingerprints = new Set(records.map((row) => row.headsFingerprint));
  const openWorkFingerprints = new Set(records.map((row) => row.openWorkFingerprint));

  return freezeDeep({
    schema: REPEATED_PROVIDER_INGESTION_SCHEMA,
    evidenceClass: 'REAL_PROVIDER_MULTI_RUN_OBSERVATION',
    providerTransport: 'external-read-only-connector',
    readOnly: true,
    writeAuthority: 'none',
    crossRepositoryCredentialRequiredByThisModule: false,
    llmFactGenerationAllowed: false,
    runCount: records.length,
    multiRunIngestionObserved: true,
    stableDefaultBranchHeadsAcrossRuns: headFingerprints.size === 1,
    openWorkChangedAcrossRuns: openWorkFingerprints.size > 1,
    recurringIngestionProven: false,
    scheduledRuntimeStarted: false,
    scheduledRuntimeProven: false,
    recurringEvidenceState: 'MULTI_RUN_REAL_PROVIDER_OBSERVED_SCHEDULE_UNPROVEN',
    runs: records,
  });
}

module.exports = {
  REPEATED_PROVIDER_INGESTION_SCHEMA,
  buildRepeatedReadOnlyProviderEvidence,
  digestBody,
};
