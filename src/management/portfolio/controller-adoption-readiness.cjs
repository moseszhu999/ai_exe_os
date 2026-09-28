'use strict';

const CONTROLLER_ADOPTION_READINESS_SCHEMA = 'aiexe.controller-adoption-readiness.v1';

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

function exactSha(value, label) {
  const text = requiredText(value, label, 80).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(text)) throw new TypeError(`${label} must be a 40-character git SHA`);
  return text;
}

function uniqueRefs(value, label) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const rows = value.map((item) => requiredText(item, label, 500));
  if (new Set(rows).size !== rows.length) throw new Error(`${label} must not contain duplicates`);
  return Object.freeze([...rows].sort());
}

function exactBoolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  return value;
}

function classifyProject(raw) {
  plainObject(raw, 'controller adoption project');
  const allowed = new Set([
    'projectId', 'repository', 'exactHeadSha', 'groupAdapterEvidenceRefs',
    'verifiedCurrentEnvelopeEvidenceRefs', 'markerSearchObserved', 'markerSearchMatched',
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new Error(`controller adoption project contains unsupported field: ${key}`);
  }

  const projectId = requiredText(raw.projectId, 'project id', 120);
  const repository = requiredText(raw.repository, 'repository', 240);
  const exactHeadSha = exactSha(raw.exactHeadSha, 'exact head sha');
  const groupAdapterEvidenceRefs = uniqueRefs(raw.groupAdapterEvidenceRefs, 'group adapter evidence ref');
  const verifiedCurrentEnvelopeEvidenceRefs = uniqueRefs(raw.verifiedCurrentEnvelopeEvidenceRefs, 'verified current envelope evidence ref');
  const markerSearchObserved = exactBoolean(raw.markerSearchObserved, 'markerSearchObserved');
  const markerSearchMatched = exactBoolean(raw.markerSearchMatched, 'markerSearchMatched');

  if (markerSearchMatched && !markerSearchObserved) throw new Error('marker search cannot match when it was not observed');
  if (verifiedCurrentEnvelopeEvidenceRefs.length > 0 && !markerSearchMatched) {
    throw new Error('verified current envelope evidence requires an observed marker match');
  }

  let state = 'NO_STRUCTURED_ADOPTION_EVIDENCE';
  if (verifiedCurrentEnvelopeEvidenceRefs.length > 0) state = 'STRUCTURED_CONTROLLER_ADOPTED';
  else if (markerSearchMatched) state = 'UNVERIFIED_CONTROLLER_MARKER_PRESENT';
  else if (groupAdapterEvidenceRefs.length > 0) state = 'GROUP_ADAPTER_READY_ENVELOPE_MISSING';

  return freezeDeep({
    projectId,
    repository,
    exactHeadSha,
    state,
    groupIntegrationReady: groupAdapterEvidenceRefs.length > 0,
    structuredControllerAdopted: state === 'STRUCTURED_CONTROLLER_ADOPTED',
    markerSearchObserved,
    markerSearchMatched,
    groupAdapterEvidenceRefs,
    verifiedCurrentEnvelopeEvidenceRefs,
    authorityGranted: false,
    domainTruthInferred: false,
  });
}

function readinessResult({ observedAt, projects, evidenceClass, extra = {} }) {
  const structuredAdoptedCount = projects.filter((project) => project.structuredControllerAdopted).length;
  const groupAdapterReadyCount = projects.filter((project) => project.groupIntegrationReady).length;
  const unverifiedMarkerCount = projects.filter((project) => project.state === 'UNVERIFIED_CONTROLLER_MARKER_PRESENT').length;

  return freezeDeep({
    schema: CONTROLLER_ADOPTION_READINESS_SCHEMA,
    evidenceClass,
    observedAt: requiredText(observedAt, 'observed at', 80),
    externalProjectCount: projects.length,
    structuredAdoptedCount,
    groupAdapterReadyCount,
    unverifiedMarkerCount,
    structuredAdoptionComplete: structuredAdoptedCount === projects.length,
    groupAdapterIsNotControllerAdoption: true,
    readOnly: true,
    writeAuthority: 'none',
    crossRepositoryCredentialRequiredByThisModule: false,
    llmFactGenerationAllowed: false,
    ...extra,
    projects,
  });
}

function buildControllerAdoptionReadiness(input) {
  plainObject(input, 'controller adoption readiness input');
  const allowed = new Set(['observedAt', 'projects']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`controller adoption readiness input contains unsupported field: ${key}`);
  }
  if (!Array.isArray(input.projects) || input.projects.length < 1) throw new TypeError('controller adoption readiness requires projects');
  const projects = input.projects.map(classifyProject).sort((a, b) => a.projectId.localeCompare(b.projectId));
  const ids = projects.map((project) => project.projectId);
  if (new Set(ids).size !== ids.length) throw new Error('controller adoption readiness project ids must be unique');

  return readinessResult({
    observedAt: input.observedAt,
    projects,
    evidenceClass: 'READ_ONLY_EXTERNAL_ADOPTION_READINESS',
  });
}

function revalidateControllerAdoptionReadiness(input) {
  plainObject(input, 'controller adoption revalidation input');
  const allowed = new Set(['observedAt', 'adoptionReadiness', 'providerHeads']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`controller adoption revalidation input contains unsupported field: ${key}`);
  }

  const adoptionReadiness = input.adoptionReadiness;
  if (adoptionReadiness?.schema !== CONTROLLER_ADOPTION_READINESS_SCHEMA || adoptionReadiness?.readOnly !== true) {
    throw new Error('canonical controller adoption readiness required');
  }
  if (!Array.isArray(adoptionReadiness.projects) || adoptionReadiness.projects.length < 1) {
    throw new TypeError('controller adoption readiness requires projects');
  }
  if (!Array.isArray(input.providerHeads) || input.providerHeads.length !== adoptionReadiness.projects.length) {
    throw new Error('independent provider heads must cover the same project set as adoption readiness');
  }

  const providerByProject = new Map();
  for (const raw of input.providerHeads) {
    plainObject(raw, 'independent provider head');
    const rowAllowed = new Set(['projectId', 'repository', 'providerHeadSha', 'evidenceRefs']);
    for (const key of Object.keys(raw)) {
      if (!rowAllowed.has(key)) throw new Error(`independent provider head contains unsupported field: ${key}`);
    }
    const projectId = requiredText(raw.projectId, 'provider project id', 120);
    if (providerByProject.has(projectId)) throw new Error('independent provider head project ids must be unique');
    providerByProject.set(projectId, freezeDeep({
      projectId,
      repository: requiredText(raw.repository, 'provider repository', 240),
      providerHeadSha: exactSha(raw.providerHeadSha, 'provider head sha'),
      evidenceRefs: uniqueRefs(raw.evidenceRefs, 'provider head evidence ref'),
    }));
  }

  const projects = adoptionReadiness.projects.map((project) => {
    const provider = providerByProject.get(project.projectId);
    if (!provider) throw new Error(`independent provider head missing for project: ${project.projectId}`);
    if (provider.repository !== project.repository) throw new Error(`independent provider repository mismatch for project: ${project.projectId}`);

    const attestationCurrent = project.exactHeadSha === provider.providerHeadSha;
    const staleStructuredAttestation = project.structuredControllerAdopted && !attestationCurrent;
    const state = staleStructuredAttestation ? 'STRUCTURED_CONTROLLER_ATTESTATION_STALE' : project.state;

    return freezeDeep({
      projectId: project.projectId,
      repository: project.repository,
      exactHeadSha: provider.providerHeadSha,
      attestedHeadSha: project.exactHeadSha,
      providerHeadSha: provider.providerHeadSha,
      providerHeadEvidenceRefs: provider.evidenceRefs,
      independentProviderHeadVerified: true,
      attestationCurrent,
      state,
      groupIntegrationReady: project.groupIntegrationReady,
      structuredControllerAdopted: project.structuredControllerAdopted && attestationCurrent,
      markerSearchObserved: project.markerSearchObserved,
      markerSearchMatched: project.markerSearchMatched,
      groupAdapterEvidenceRefs: project.groupAdapterEvidenceRefs,
      verifiedCurrentEnvelopeEvidenceRefs: attestationCurrent ? project.verifiedCurrentEnvelopeEvidenceRefs : Object.freeze([]),
      authorityGranted: false,
      domainTruthInferred: false,
    });
  }).sort((a, b) => a.projectId.localeCompare(b.projectId));

  if (providerByProject.size !== projects.length) throw new Error('independent provider head project set mismatch');

  const staleAttestationCount = projects.filter((project) => project.state === 'STRUCTURED_CONTROLLER_ATTESTATION_STALE').length;
  return readinessResult({
    observedAt: input.observedAt,
    projects,
    evidenceClass: 'READ_ONLY_EXTERNAL_ADOPTION_REVALIDATION',
    extra: {
      sourceAdoptionObservedAt: adoptionReadiness.observedAt,
      revalidatedAgainstIndependentProviderHeads: true,
      providerFetchPerformedByThisModule: false,
      staleAttestationCount,
    },
  });
}

module.exports = {
  CONTROLLER_ADOPTION_READINESS_SCHEMA,
  buildControllerAdoptionReadiness,
  revalidateControllerAdoptionReadiness,
};
