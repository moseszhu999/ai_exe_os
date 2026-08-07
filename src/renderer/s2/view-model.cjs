'use strict';

const { sanitizeForDisplay } = require('../s1/view-model.cjs');

const NAVIGATION = Object.freeze([
  'Missions', 'Mission Builder', 'Execution Plan', 'Step Details',
  'Agent Handoffs', 'Human Gates', 'Checkpoints', 'Run Timeline', 'Evidence / Recovery',
]);

const BLOCKER_LABELS = Object.freeze({
  workspace_inactive: 'Workspace is inactive',
  mission_not_found: 'Mission was not found',
  mission_revision_immutable: 'Mission revision is frozen and immutable',
  plan_cycle: 'Execution plan contains a cycle',
  plan_dependency_missing: 'Execution plan dependency is missing',
  plan_cross_workspace_reference: 'Execution plan crosses a Workspace boundary',
  step_binding_invalid: 'Step Agent/capability binding is invalid',
  step_input_undeclared: 'Step input is not declared by the plan',
  step_output_missing: 'Required upstream step output is missing',
  dependency_unsatisfied: 'Step dependency is not satisfied',
  resource_conflict: 'Required exclusive resource is unavailable',
  worker_unavailable: 'Bound Worker is unavailable',
  human_gate_required: 'Human approval is required',
  mission_paused: 'Mission is paused',
  mission_cancelled: 'Mission is cancelled',
  recovery_requires_review: 'Step recovery requires human review',
  terminal_evidence_unsatisfied: 'Terminal evidence requirement is unsatisfied',
});

function inWorkspace(items, workspaceId) {
  return (Array.isArray(items) ? items : []).filter((item) => item.workspaceId === workspaceId);
}

function buildGraph(plan) {
  if (!plan) return Object.freeze({ nodes: [], edges: [] });
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  return Object.freeze({
    nodes: Object.freeze(steps.map((step) => Object.freeze({ id: step.id, name: step.name || step.id, state: step.state || 'pending', bindingId: step.bindingId }))),
    edges: Object.freeze(steps.flatMap((step) => (step.dependsOn || []).map((fromStepId) => Object.freeze({ fromStepId, toStepId: step.id })))),
  });
}

function createS2ViewModel(state, activeWorkspaceId, selectedMissionId = null) {
  if (!state || typeof state !== 'object') throw new TypeError('S2 state is required');
  const workspaces = Array.isArray(state.workspaces) ? state.workspaces : [];
  const activeWorkspace = workspaces.find((item) => item.id === activeWorkspaceId) || workspaces[0] || null;
  const workspaceId = activeWorkspace?.id || null;
  const missions = workspaceId ? inWorkspace(state.missions, workspaceId) : [];
  const selectedMission = missions.find((item) => item.id === selectedMissionId) || missions[0] || null;
  const revisions = workspaceId ? inWorkspace(state.revisions, workspaceId).filter((item) => !selectedMission || item.missionId === selectedMission.id) : [];
  const runs = workspaceId ? inWorkspace(state.missionRuns, workspaceId).filter((item) => !selectedMission || item.missionId === selectedMission.id) : [];
  const selectedRun = runs[0] || null;
  const plans = workspaceId ? inWorkspace(state.plans, workspaceId) : [];
  const selectedPlan = plans.find((item) => selectedRun?.planId === item.id) || plans.find((item) => revisions.some((revision) => revision.planId === item.id)) || null;
  const attempts = workspaceId ? inWorkspace(state.stepAttempts, workspaceId).filter((item) => !selectedRun || item.missionRunId === selectedRun.id) : [];
  const outputs = workspaceId ? inWorkspace(state.stepOutputs, workspaceId).filter((item) => !selectedRun || item.missionRunId === selectedRun.id) : [];
  const handoffs = workspaceId ? inWorkspace(state.agentHandoffs, workspaceId).filter((item) => !selectedRun || item.missionRunId === selectedRun.id) : [];
  const checkpoints = workspaceId ? inWorkspace(state.checkpoints, workspaceId).filter((item) => !selectedRun || item.missionRunId === selectedRun.id) : [];
  const blockers = attempts.flatMap((attempt) => (attempt.blockers || []).map((blocker) => Object.freeze({
    stepAttemptId: attempt.id,
    stepId: attempt.stepId,
    code: blocker.code,
    label: BLOCKER_LABELS[blocker.code] || blocker.code,
    detail: sanitizeForDisplay(blocker.detail),
  })));
  const outputById = new Map(outputs.map((output) => [output.id, output]));
  const lineage = handoffs.map((handoff) => Object.freeze({
    id: handoff.id,
    fromStepAttemptId: handoff.fromStepAttemptId,
    toStepId: handoff.toStepId,
    inputName: handoff.inputName,
    output: sanitizeForDisplay(outputById.get(handoff.outputId) || { id: handoff.outputId }),
  }));
  return Object.freeze({
    navigation: NAVIGATION,
    activeWorkspace,
    workspaces,
    missions: missions.map((item) => sanitizeForDisplay(item)),
    selectedMission: sanitizeForDisplay(selectedMission),
    revisions: revisions.map((item) => sanitizeForDisplay(item)),
    missionRuns: runs.map((item) => sanitizeForDisplay(item)),
    selectedRun: sanitizeForDisplay(selectedRun),
    plan: sanitizeForDisplay(selectedPlan),
    graph: buildGraph(selectedPlan),
    stepAttempts: attempts.map((item) => sanitizeForDisplay(item)),
    stepOutputs: outputs.map((item) => sanitizeForDisplay(item)),
    handoffs: Object.freeze(lineage),
    humanGates: workspaceId ? inWorkspace(state.humanGates, workspaceId).map((item) => sanitizeForDisplay(item)) : [],
    checkpoints: checkpoints.map((item) => sanitizeForDisplay(item)),
    timeline: workspaceId ? inWorkspace(state.missionEvents, workspaceId).filter((item) => !selectedRun || item.missionRunId === selectedRun.id).map((item) => sanitizeForDisplay(item)) : [],
    evidence: workspaceId ? inWorkspace(state.evidence, workspaceId).filter((item) => !selectedRun || item.missionRunId === selectedRun.id).map((item) => sanitizeForDisplay(item)) : [],
    blockers: Object.freeze(blockers),
    controls: Object.freeze({
      canPause: selectedRun?.state === 'running',
      canResume: selectedRun?.state === 'paused',
      canCancel: !!selectedRun && !['completed', 'cancelled', 'failed'].includes(selectedRun.state),
    }),
  });
}

module.exports = { BLOCKER_LABELS, NAVIGATION, buildGraph, createS2ViewModel };
