'use strict';

const { assertSafeIdentifier } = require('./identifiers.cjs');
const { deepFreeze, requiredText } = require('./workspace-model.cjs');

const FORBIDDEN_OUTPUT_KEY = /^(password|passwd|cookie|authorization|token|accessToken|refreshToken|profilePath|profileDir|profileDirectory|userData|userDataDir|processId|pid|ppid)$/i;

function assertJsonSafe(value, path = 'value') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (Array.isArray(value)) { value.forEach((item, index) => assertJsonSafe(item, `${path}[${index}]`)); return value; }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`StepOutput ${path} must be JSON-safe data`);
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_OUTPUT_KEY.test(key)) throw new Error(`Forbidden StepOutput field: ${path}.${key}`);
    assertJsonSafe(nested, `${path}.${key}`);
  }
  return value;
}

function createStepOutput(input) {
  assertJsonSafe(input?.value);
  return deepFreeze({
    id: assertSafeIdentifier(input?.id, 'step output id'),
    workspaceId: assertSafeIdentifier(input?.workspaceId, 'workspace id'),
    missionRunId: assertSafeIdentifier(input?.missionRunId, 'mission run id'),
    stepAttemptId: assertSafeIdentifier(input?.stepAttemptId, 'step attempt id'),
    outputName: assertSafeIdentifier(input?.outputName, 'output name'),
    schemaDigest: requiredText(input?.schemaDigest, 'output schema digest', 200),
    value: deepFreeze(structuredClone(input.value)),
    evidenceIds: (input?.evidenceIds || []).map((id) => assertSafeIdentifier(id, 'evidence id')),
    createdAt: input?.createdAt || new Date().toISOString(),
  });
}

function assertOutputSemanticMatch(existing, candidate) {
  if (!existing) return candidate;
  const same = existing.workspaceId === candidate.workspaceId && existing.missionRunId === candidate.missionRunId && existing.stepAttemptId === candidate.stepAttemptId && existing.outputName === candidate.outputName && existing.schemaDigest === candidate.schemaDigest && JSON.stringify(existing.value) === JSON.stringify(candidate.value) && JSON.stringify(existing.evidenceIds) === JSON.stringify(candidate.evidenceIds);
  if (!same) throw new Error(`Completed StepOutput is immutable: ${existing.id}`);
  return existing;
}

module.exports = { assertJsonSafe, assertOutputSemanticMatch, createStepOutput };
