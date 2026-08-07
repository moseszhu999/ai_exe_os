'use strict';

const { assertSafeIdentifier } = require('./identifiers.cjs');
const { deepFreeze, requiredText } = require('./workspace-model.cjs');

function createStepOutput(input) {
  return deepFreeze({
    id: assertSafeIdentifier(input?.id, 'step output id'),
    workspaceId: assertSafeIdentifier(input?.workspaceId, 'workspace id'),
    missionRunId: assertSafeIdentifier(input?.missionRunId, 'mission run id'),
    stepAttemptId: assertSafeIdentifier(input?.stepAttemptId, 'step attempt id'),
    outputName: assertSafeIdentifier(input?.outputName, 'output name'),
    schemaDigest: requiredText(input?.schemaDigest, 'output schema digest', 200),
    value: deepFreeze(structuredClone(input?.value)),
    evidenceIds: (input?.evidenceIds || []).map((id) => assertSafeIdentifier(id, 'evidence id')),
    createdAt: input?.createdAt || new Date().toISOString(),
  });
}

function assertOutputSemanticMatch(existing, candidate) {
  if (!existing) return candidate;
  const same = existing.workspaceId === candidate.workspaceId
    && existing.missionRunId === candidate.missionRunId
    && existing.stepAttemptId === candidate.stepAttemptId
    && existing.outputName === candidate.outputName
    && existing.schemaDigest === candidate.schemaDigest
    && JSON.stringify(existing.value) === JSON.stringify(candidate.value)
    && JSON.stringify(existing.evidenceIds) === JSON.stringify(candidate.evidenceIds);
  if (!same) throw new Error(`Completed StepOutput is immutable: ${existing.id}`);
  return existing;
}

module.exports = { assertOutputSemanticMatch, createStepOutput };
