'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertRevisionSemanticMatch,
  createMission,
  createMissionRevision,
  createMissionRun,
  freezeMissionRevision,
  transitionMissionRun,
} = require('../src/domain/mission-model.cjs');
const {
  assertBindingSemanticMatch,
  createExecutionPlan,
  createPlanStep,
  createStepBinding,
  validateExecutionPlan,
} = require('../src/domain/plan-model.cjs');
const { assertOutputSemanticMatch, createStepOutput } = require('../src/domain/step-output-model.cjs');
const { assertHandoffSemanticMatch, createAgentHandoff } = require('../src/domain/agent-handoff-model.cjs');

const ws = 'workspace-a';
const planId = 'mission-plan-a';

function binding(id, agentId = `agent-${id}`) {
  return createStepBinding({
    id: `binding-${id}`,
    workspaceId: ws,
    agentId,
    installationId: `install-${id}`,
    capabilityVersionId: `capability.${id}@1.0.0`,
    action: 'submit_payload',
    target: 'http://127.0.0.1:43119/task-form.html',
    providerSnapshotId: 'provider-local-form',
  });
}

function step(id, dependsOn = [], declaredInputs = [], declaredOutputs = []) {
  return createPlanStep({
    id,
    planId,
    workspaceId: ws,
    name: id,
    bindingId: `binding-${id}`,
    dependsOn,
    declaredInputs,
    declaredOutputs,
    evidenceRequirements: ['local-result'],
    humanGatePolicy: 'action',
    resourceRequirements: [],
  });
}

function forkJoin() {
  const steps = [
    step('step-a', [], [], ['result_a']),
    step('step-b', [], [], ['result_b']),
    step('step-c', ['step-a', 'step-b'], ['input_a', 'input_b'], ['final_result']),
  ];
  const bindings = [binding('step-a'), binding('step-b'), binding('step-c')];
  const plan = createExecutionPlan({ id: planId, missionRevisionId: 'mission-rev-1', workspaceId: ws, steps, bindings, terminalStepIds: ['step-c'] });
  return { plan, steps, bindings };
}

test('creates an immutable Mission revision and freezes it for execution', () => {
  const mission = createMission({ id: 'mission-a', workspaceId: ws, title: 'Three-step mission' });
  const revision = createMissionRevision({ id: 'mission-rev-1', missionId: mission.id, workspaceId: ws, revision: 1, objective: 'Produce a joined result', planId });
  const frozen = freezeMissionRevision(revision, '2026-08-07T00:00:00.000Z');
  assert.equal(frozen.frozenAt, '2026-08-07T00:00:00.000Z');
  assert.ok(frozen.contentDigest.startsWith('sha256:'));
  assert.equal(freezeMissionRevision(frozen), frozen);
  assert.equal(Object.isFrozen(frozen), true);
});

test('same MissionRevision id rejects changed semantic intent', () => {
  const a = createMissionRevision({ id: 'mission-rev-1', missionId: 'mission-a', workspaceId: ws, revision: 1, objective: 'Objective A', planId });
  const same = createMissionRevision({ id: 'mission-rev-1', missionId: 'mission-a', workspaceId: ws, revision: 1, objective: 'Objective A', planId });
  const changed = createMissionRevision({ id: 'mission-rev-1', missionId: 'mission-a', workspaceId: ws, revision: 1, objective: 'Objective B', planId });
  assert.equal(assertRevisionSemanticMatch(a, same), a);
  assert.throws(() => assertRevisionSemanticMatch(a, changed), /idempotency collision/);
});

test('accepts a three-step fork/join DAG with two independent roots', () => {
  const { plan, steps, bindings } = forkJoin();
  assert.deepEqual(plan.stepIds, ['step-a', 'step-b', 'step-c']);
  assert.deepEqual(plan.terminalStepIds, ['step-c']);
  assert.ok(plan.contentDigest.startsWith('sha256:'));
  assert.doesNotThrow(() => validateExecutionPlan({ plan, steps, bindings }));
});

test('rejects plan cycles, unknown dependencies, and cross-Workspace binding', () => {
  const bindings = [binding('step-a'), binding('step-b')];
  const cycA = step('step-a', ['step-b']);
  const cycB = step('step-b', ['step-a']);
  assert.throws(() => createExecutionPlan({ id: planId, missionRevisionId: 'mission-rev-1', workspaceId: ws, steps: [cycA, cycB], bindings, terminalStepIds: ['step-b'] }), /cycle/);
  assert.throws(() => createExecutionPlan({ id: planId, missionRevisionId: 'mission-rev-1', workspaceId: ws, steps: [step('step-a', ['missing'])], bindings: [binding('step-a')], terminalStepIds: ['step-a'] }), /dependency missing/);
  const foreign = createStepBinding({ ...binding('step-a'), id: 'binding-step-a', workspaceId: 'workspace-b' });
  assert.throws(() => createExecutionPlan({ id: planId, missionRevisionId: 'mission-rev-1', workspaceId: ws, steps: [step('step-a')], bindings: [foreign], terminalStepIds: ['step-a'] }), /cross-Workspace step binding/);
});

test('binding semantic keys reject changed Agent or target', () => {
  const a = binding('step-a');
  const same = binding('step-a');
  const changed = createStepBinding({ ...a, agentId: 'agent-other' });
  assert.equal(assertBindingSemanticMatch(a, same), a);
  assert.throws(() => assertBindingSemanticMatch(a, changed), /idempotency collision/);
});

test('completed StepOutput is immutable under the same semantic id', () => {
  const output = createStepOutput({ id: 'output-a', workspaceId: ws, missionRunId: 'mission-run-1', stepAttemptId: 'attempt-a-1', outputName: 'result_a', schemaDigest: 'sha256:schema-a', value: { ok: true }, evidenceIds: ['evidence-a'] });
  const same = createStepOutput({ ...output });
  const changed = createStepOutput({ ...output, value: { ok: false } });
  assert.equal(assertOutputSemanticMatch(output, same), output);
  assert.throws(() => assertOutputSemanticMatch(output, changed), /immutable/);
});

test('AgentHandoff permits only declared dependency outputs and same Workspace', () => {
  const { steps } = forkJoin();
  const source = steps.find((candidate) => candidate.id === 'step-a');
  const target = steps.find((candidate) => candidate.id === 'step-c');
  const output = createStepOutput({ id: 'output-a', workspaceId: ws, missionRunId: 'mission-run-1', stepAttemptId: 'attempt-a-1', outputName: 'result_a', schemaDigest: 'sha256:schema-a', value: { ok: true }, evidenceIds: ['evidence-a'] });
  const handoff = createAgentHandoff({ id: 'handoff-a-c', workspaceId: ws, missionRunId: 'mission-run-1', sourceStep: source, targetStep: target, inputName: 'input_a', output });
  assert.equal(handoff.outputId, output.id);
  assert.equal(assertHandoffSemanticMatch(handoff, { ...handoff }), handoff);
  assert.throws(() => createAgentHandoff({ id: 'handoff-bad-input', workspaceId: ws, missionRunId: 'mission-run-1', sourceStep: source, targetStep: target, inputName: 'undeclared', output }), /input undeclared/);
  assert.throws(() => createAgentHandoff({ id: 'handoff-foreign', workspaceId: 'workspace-b', missionRunId: 'mission-run-1', sourceStep: source, targetStep: target, inputName: 'input_a', output }), /Cross-Workspace/);
});

test('MissionRun transitions preserve pause/cancel semantics and terminality', () => {
  const run = createMissionRun({ id: 'mission-run-1', workspaceId: ws, missionId: 'mission-a', missionRevisionId: 'mission-rev-1', planId });
  const running = transitionMissionRun(run, 'running', 'start');
  const paused = transitionMissionRun(running, 'paused', 'operator pause');
  const resumed = transitionMissionRun(paused, 'running', 'operator resume');
  const cancelled = transitionMissionRun(resumed, 'cancelled', 'operator cancel');
  assert.equal(cancelled.state, 'cancelled');
  assert.throws(() => transitionMissionRun(cancelled, 'running', 'illegal replay'), /Invalid S2 mission transition/);
});
