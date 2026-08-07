'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createExecutionPlan, createPlanStep, createStepBinding } = require('../src/domain/plan-model.cjs');
const { createStepOutput } = require('../src/domain/step-output-model.cjs');

function binding(agentId = 'agent-a') {
  return createStepBinding({ id: 'binding-a', workspaceId: 'workspace-a', agentId, installationId: 'install-a', capabilityVersionId: 'cap.a@1.0.0', action: 'submit_payload', target: 'http://127.0.0.1:43119/task-form.html', providerSnapshotId: 'provider-local-form' });
}
function step() {
  return createPlanStep({ id: 'step-a', planId: 'plan-a', workspaceId: 'workspace-a', name: 'Step A', bindingId: 'binding-a', dependsOn: [], declaredInputs: [], declaredOutputs: ['result'], evidenceRequirements: [], humanGatePolicy: 'action', resourceRequirements: [] });
}

test('duplicate StepBinding identities are rejected instead of silently overwritten', () => {
  assert.throws(() => createExecutionPlan({ id: 'plan-a', missionRevisionId: 'revision-a', workspaceId: 'workspace-a', steps: [step()], bindings: [binding('agent-a'), binding('agent-b')], terminalStepIds: ['step-a'] }), /Duplicate step binding id/);
});

test('StepOutput accepts only JSON-safe privacy-bounded values', () => {
  const base = { id: 'output-a', workspaceId: 'workspace-a', missionRunId: 'run-a', stepAttemptId: 'attempt-a', outputName: 'result', schemaDigest: 'sha256:schema', evidenceIds: [] };
  assert.doesNotThrow(() => createStepOutput({ ...base, value: { answer: [1, true, null, 'ok'] } }));
  assert.throws(() => createStepOutput({ ...base, value: new Map([['answer', 1]]) }), /JSON-safe/);
  assert.throws(() => createStepOutput({ ...base, value: { profilePath: '/tmp/private' } }), /Forbidden StepOutput field/);
  assert.throws(() => createStepOutput({ ...base, value: { nested: { accessToken: 'secret' } } }), /Forbidden StepOutput field/);
});
