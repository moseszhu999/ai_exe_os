'use strict';

function scoped(items, workspaceId) {
  return (Array.isArray(items) ? items : []).filter((item) => item?.workspaceId === workspaceId);
}

function freezeItem(item) {
  return Object.freeze({
    id: item.id,
    workspaceId: item.workspaceId,
    code: item.code,
    state: item.state || 'attention',
    severity: item.severity || 'warning',
    sourceKind: item.sourceKind,
    aggregateId: item.aggregateId || null,
    missionRunId: item.missionRunId || null,
    stepAttemptId: item.stepAttemptId || null,
    executionRunId: item.executionRunId || null,
    taskId: item.taskId || null,
    humanGateId: item.humanGateId || null,
    deliveryGateId: item.deliveryGateId || null,
    detail: item.detail || null,
    evidenceIds: Object.freeze([...(item.evidenceIds || [])]),
    eventIds: Object.freeze([...(item.eventIds || [])]),
    provenanceAvailable: Boolean((item.evidenceIds || []).length || (item.eventIds || []).length || item.humanGateId || item.deliveryGateId),
  });
}

function add(map, item) {
  const frozen = freezeItem(item);
  const key = `${frozen.code}:${frozen.sourceKind}:${frozen.aggregateId || frozen.id}`;
  if (!map.has(key)) map.set(key, frozen);
}

function aggregateAttention({ workspaceId, missionState, githubState = {} } = {}) {
  if (typeof workspaceId !== 'string' || !workspaceId) throw new TypeError('workspaceId is required');
  if (!missionState || typeof missionState !== 'object') throw new TypeError('missionState is required');
  const workspace = (missionState.workspaces || []).find((item) => item.id === workspaceId) || null;
  if (!workspace) return Object.freeze([]);

  const items = new Map();
  const evidence = scoped(missionState.evidence || [], workspaceId);
  const missionEvents = (missionState.missionEvents || []).filter((event) => event.workspaceId === workspaceId);

  for (const gate of scoped(missionState.humanGates || [], workspaceId)) {
    if (!['requested', 'waiting_human'].includes(gate.state)) continue;
    add(items, {
      id: `attention:humanGate:${gate.id}`, workspaceId, code: 'human_gate_required', sourceKind: 'humanGate', aggregateId: gate.id,
      humanGateId: gate.id, executionRunId: gate.executionRunId || gate.runId || null, taskId: gate.taskId || null,
      detail: { state: gate.state, reason: gate.reason || null },
      evidenceIds: evidence.filter((item) => item.executionRunId && item.executionRunId === (gate.executionRunId || gate.runId)).map((item) => item.id),
    });
  }

  for (const attempt of scoped(missionState.stepAttempts || [], workspaceId)) {
    if (attempt.state === 'waiting_human') {
      add(items, {
        id: `attention:attempt:${attempt.id}:waiting_human`, workspaceId, code: 'waiting_human', sourceKind: 'stepAttempt', aggregateId: attempt.id,
        missionRunId: attempt.missionRunId, stepAttemptId: attempt.id, executionRunId: attempt.executionRunId || null,
        detail: { recoveryReason: attempt.recoveryReason || null, blockers: attempt.blockers || [] },
        eventIds: missionEvents.filter((event) => event.aggregateId === attempt.id).map((event) => event.id),
      });
    }
    if (attempt.state === 'recovery_required' || attempt.recoveryReason) {
      add(items, {
        id: `attention:attempt:${attempt.id}:recovery`, workspaceId, code: 'recovery_requires_review', severity: 'critical', sourceKind: 'stepAttempt', aggregateId: attempt.id,
        missionRunId: attempt.missionRunId, stepAttemptId: attempt.id, executionRunId: attempt.executionRunId || null,
        detail: { recoveryReason: attempt.recoveryReason || 'recovery_required' },
        eventIds: missionEvents.filter((event) => event.aggregateId === attempt.id).map((event) => event.id),
      });
    }
  }

  for (const run of scoped(missionState.missionRuns || [], workspaceId)) {
    if (run.state === 'recovery_required') {
      add(items, {
        id: `attention:missionRun:${run.id}:recovery`, workspaceId, code: 'recovery_requires_review', severity: 'critical', sourceKind: 'missionRun', aggregateId: run.id,
        missionRunId: run.id, detail: { state: run.state, reason: run.recoveryReason || null },
        eventIds: missionEvents.filter((event) => event.aggregateId === run.id).map((event) => event.id),
      });
    }
  }

  for (const plan of scoped(missionState.plans || [], workspaceId)) {
    for (const step of plan.steps || []) {
      for (const blocker of step.blockers || []) {
        add(items, {
          id: `attention:step:${step.id}:${blocker.code}`, workspaceId, code: blocker.code || 'step_blocked', sourceKind: 'planStep', aggregateId: step.id,
          detail: blocker.detail || blocker,
        });
      }
    }
  }

  for (const gate of scoped(githubState.deliveryGates || [], workspaceId)) {
    for (const blocker of gate.blockers || []) {
      add(items, {
        id: `attention:deliveryGate:${gate.id}:${blocker.code}`, workspaceId, code: blocker.code || 'delivery_blocked', sourceKind: 'deliveryGate', aggregateId: gate.id,
        deliveryGateId: gate.id, detail: blocker.detail || blocker,
        evidenceIds: scoped(githubState.deliveryEvidence || [], workspaceId).filter((item) => item.pullRequestBindingId === gate.pullRequestBindingId).map((item) => item.id),
      });
    }
  }

  return Object.freeze([...items.values()].sort((a, b) => {
    const severity = { critical: 0, warning: 1, info: 2 };
    return (severity[a.severity] ?? 9) - (severity[b.severity] ?? 9) || a.code.localeCompare(b.code) || a.id.localeCompare(b.id);
  }));
}

module.exports = { aggregateAttention };
