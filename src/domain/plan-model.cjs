'use strict';

const { createHash } = require('node:crypto');
const { assertSafeIdentifier } = require('./identifiers.cjs');
const { deepFreeze, requiredText } = require('./workspace-model.cjs');

function cloneArray(value) {
  if (!Array.isArray(value)) throw new TypeError('expected an array');
  return structuredClone(value);
}

function createStepBinding(input) {
  return deepFreeze({
    id: assertSafeIdentifier(input?.id, 'step binding id'),
    workspaceId: assertSafeIdentifier(input?.workspaceId, 'workspace id'),
    agentId: assertSafeIdentifier(input?.agentId, 'agent id'),
    installationId: assertSafeIdentifier(input?.installationId, 'installation id'),
    capabilityVersionId: requiredText(input?.capabilityVersionId, 'capability version id', 200),
    action: assertSafeIdentifier(input?.action, 'capability action'),
    target: requiredText(input?.target, 'step target', 500),
    providerSnapshotId: assertSafeIdentifier(input?.providerSnapshotId, 'provider snapshot id'),
  });
}

function createPlanStep(input) {
  const policy = input?.humanGatePolicy || 'action';
  if (!['never', 'action', 'always'].includes(policy)) throw new Error(`Unsupported Human Gate policy: ${policy}`);
  return deepFreeze({
    id: assertSafeIdentifier(input?.id, 'plan step id'),
    planId: assertSafeIdentifier(input?.planId, 'execution plan id'),
    workspaceId: assertSafeIdentifier(input?.workspaceId, 'workspace id'),
    name: requiredText(input?.name, 'plan step name'),
    bindingId: assertSafeIdentifier(input?.bindingId, 'step binding id'),
    dependsOn: cloneArray(input?.dependsOn || []).map((id) => assertSafeIdentifier(id, 'dependency step id')),
    declaredInputs: cloneArray(input?.declaredInputs || []),
    declaredOutputs: cloneArray(input?.declaredOutputs || []),
    evidenceRequirements: cloneArray(input?.evidenceRequirements || []),
    humanGatePolicy: policy,
    resourceRequirements: cloneArray(input?.resourceRequirements || []),
  });
}

function planDigest({ id, missionRevisionId, workspaceId, steps, terminalStepIds }) {
  const semantic = {
    id,
    missionRevisionId,
    workspaceId,
    steps: steps.map((step) => ({
      id: step.id,
      bindingId: step.bindingId,
      dependsOn: [...step.dependsOn].sort(),
      declaredInputs: step.declaredInputs,
      declaredOutputs: step.declaredOutputs,
      evidenceRequirements: step.evidenceRequirements,
      humanGatePolicy: step.humanGatePolicy,
      resourceRequirements: step.resourceRequirements,
    })).sort((a, b) => a.id.localeCompare(b.id)),
    terminalStepIds: [...terminalStepIds].sort(),
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(semantic)).digest('hex')}`;
}

function createExecutionPlan(input) {
  if (!Array.isArray(input?.steps) || input.steps.length === 0) throw new TypeError('execution plan steps are required');
  const id = assertSafeIdentifier(input.id, 'execution plan id');
  const missionRevisionId = assertSafeIdentifier(input.missionRevisionId, 'mission revision id');
  const workspaceId = assertSafeIdentifier(input.workspaceId, 'workspace id');
  const steps = input.steps.map((step) => step.planId ? step : createPlanStep({ ...step, planId: id, workspaceId }));
  const terminalStepIds = (input.terminalStepIds || []).map((stepId) => assertSafeIdentifier(stepId, 'terminal step id'));
  const plan = { id, missionRevisionId, workspaceId, stepIds: steps.map((step) => step.id), terminalStepIds };
  validateExecutionPlan({ plan, steps, bindings: input.bindings || [] });
  return deepFreeze({ ...plan, contentDigest: planDigest({ ...plan, steps }) });
}

function validateExecutionPlan({ plan, steps, bindings = [] }) {
  if (!plan || !Array.isArray(steps)) throw new TypeError('plan and steps are required');
  const stepById = new Map();
  const bindingById = new Map(bindings.map((binding) => [binding.id, binding]));
  for (const step of steps) {
    if (step.workspaceId !== plan.workspaceId || step.planId !== plan.id) throw new Error('Cross-Workspace or cross-plan step reference denied');
    if (stepById.has(step.id)) throw new Error(`Duplicate semantic step id: ${step.id}`);
    stepById.set(step.id, step);
    if (bindings.length) {
      const binding = bindingById.get(step.bindingId);
      if (!binding || binding.workspaceId !== plan.workspaceId) throw new Error(`Invalid or cross-Workspace step binding: ${step.bindingId}`);
    }
  }
  for (const step of steps) {
    for (const dependencyId of step.dependsOn) {
      if (dependencyId === step.id) throw new Error('Plan step cannot depend on itself');
      if (!stepById.has(dependencyId)) throw new Error(`Plan dependency missing: ${dependencyId}`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(stepId) {
    if (visiting.has(stepId)) throw new Error('Execution plan contains a cycle');
    if (visited.has(stepId)) return;
    visiting.add(stepId);
    for (const dep of stepById.get(stepId).dependsOn) visit(dep);
    visiting.delete(stepId);
    visited.add(stepId);
  }
  for (const stepId of stepById.keys()) visit(stepId);
  if (!Array.isArray(plan.terminalStepIds) || plan.terminalStepIds.length === 0) throw new Error('Execution plan requires at least one terminal step');
  for (const terminalId of plan.terminalStepIds) {
    if (!stepById.has(terminalId)) throw new Error(`Unknown terminal step: ${terminalId}`);
  }
  const dependedUpon = new Set(steps.flatMap((step) => step.dependsOn));
  for (const terminalId of plan.terminalStepIds) {
    if (dependedUpon.has(terminalId)) throw new Error(`Terminal step is not terminal: ${terminalId}`);
  }
  return deepFreeze({ plan, steps: [...steps], bindings: [...bindings] });
}

function assertBindingSemanticMatch(existing, candidate) {
  if (!existing) return candidate;
  const fields = ['workspaceId', 'agentId', 'installationId', 'capabilityVersionId', 'action', 'target', 'providerSnapshotId'];
  if (fields.some((field) => existing[field] !== candidate[field])) throw new Error(`Step binding idempotency collision: ${existing.id}`);
  return existing;
}

module.exports = {
  assertBindingSemanticMatch,
  createExecutionPlan,
  createPlanStep,
  createStepBinding,
  validateExecutionPlan,
};
