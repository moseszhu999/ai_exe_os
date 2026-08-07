'use strict';

const { assertSafeIdentifier } = require('./identifiers.cjs');
const { deepFreeze } = require('./workspace-model.cjs');

function declaredName(entry) {
  return typeof entry === 'string' ? entry : entry?.name;
}

function createAgentHandoff(input) {
  const sourceStep = input?.sourceStep;
  const targetStep = input?.targetStep;
  const output = input?.output;
  if (!sourceStep || !targetStep || !output) throw new TypeError('sourceStep, targetStep, and output are required');
  const workspaceId = assertSafeIdentifier(input?.workspaceId, 'workspace id');
  if ([sourceStep.workspaceId, targetStep.workspaceId, output.workspaceId].some((candidate) => candidate !== workspaceId)) {
    throw new Error('Cross-Workspace Agent handoff denied');
  }
  if (!targetStep.dependsOn.includes(sourceStep.id)) throw new Error('Handoff source is not a declared dependency');
  const inputName = assertSafeIdentifier(input?.inputName, 'handoff input name');
  const declaredInputs = new Set(targetStep.declaredInputs.map(declaredName));
  const declaredOutputs = new Set(sourceStep.declaredOutputs.map(declaredName));
  if (!declaredInputs.has(inputName)) throw new Error(`Step input undeclared: ${inputName}`);
  if (!declaredOutputs.has(output.outputName)) throw new Error(`Step output undeclared: ${output.outputName}`);
  if (input?.outputName && input.outputName !== output.outputName) throw new Error('Handoff output name mismatch');
  return deepFreeze({
    id: assertSafeIdentifier(input?.id, 'agent handoff id'),
    workspaceId,
    missionRunId: assertSafeIdentifier(input?.missionRunId, 'mission run id'),
    fromStepAttemptId: assertSafeIdentifier(input?.fromStepAttemptId || output.stepAttemptId, 'source step attempt id'),
    toStepId: assertSafeIdentifier(targetStep.id, 'target step id'),
    inputName,
    outputId: assertSafeIdentifier(output.id, 'step output id'),
    createdAt: input?.createdAt || new Date().toISOString(),
  });
}

function assertHandoffSemanticMatch(existing, candidate) {
  if (!existing) return candidate;
  const fields = ['workspaceId', 'missionRunId', 'fromStepAttemptId', 'toStepId', 'inputName', 'outputId'];
  if (fields.some((field) => existing[field] !== candidate[field])) throw new Error(`AgentHandoff idempotency collision: ${existing.id}`);
  return existing;
}

module.exports = { assertHandoffSemanticMatch, createAgentHandoff };
