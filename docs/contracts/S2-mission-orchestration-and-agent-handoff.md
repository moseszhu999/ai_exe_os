# S2 Mission Orchestration and Agent Handoff Contract

Status: **Normative draft**

Canonical issue: #29

Exact starting baseline: `4d724bd4cc225fb33c3262980bfba146de1fb7c2`

## Purpose

S2 turns the accepted S1 single-task execution kernel into a durable multi-step mission system. S1 entities remain authoritative for Workspace, capability installation/grant, Worker, ExecutionRun, HumanGate, Evidence and ResourceLock.

## Canonical S2 entities

```text
Mission
MissionRevision
ExecutionPlan
PlanStep
StepBinding
StepAttempt
StepOutput
AgentHandoff
MissionCheckpoint
MissionRun
MissionEvent
```

## Mission and revision

A `Mission` is a Workspace-owned durable objective container. A `MissionRevision` is an immutable executable specification.

```text
Mission {
  id
  workspaceId
  title
  status: draft | active | archived
  currentRevisionId
}

MissionRevision {
  id
  missionId
  workspaceId
  revision
  objective
  planId
  createdAt
  frozenAt?
  contentDigest
}
```

Once a MissionRevision has produced a MissionRun, the revision is immutable. Editing creates a new revision.

## Execution plan

`ExecutionPlan` is an immutable DAG bound to one MissionRevision.

```text
ExecutionPlan {
  id
  missionRevisionId
  workspaceId
  stepIds[]
  terminalStepIds[]
  contentDigest
}

PlanStep {
  id
  planId
  workspaceId
  name
  bindingId
  dependsOn[]
  declaredInputs[]
  declaredOutputs[]
  evidenceRequirements[]
  humanGatePolicy
  resourceRequirements[]
}
```

A plan is rejected if it contains a cycle, missing dependency, cross-Workspace reference, duplicate semantic step ID, or terminal step that cannot be reached.

## Step binding

A `StepBinding` pins the exact S1 authorization inputs used to evaluate one step.

```text
StepBinding {
  id
  workspaceId
  agentId
  installationId
  capabilityVersionId
  action
  target
  providerSnapshotId
}
```

The referenced Agent, installation, grant, capability version, target and provider snapshot must all belong to the same Workspace and pass the existing S1 authorization rules at scheduling time and immediately before external effect.

## Step attempt

Each runnable execution of a PlanStep is represented by a `StepAttempt`.

```text
StepAttempt {
  id
  missionRunId
  stepId
  workspaceId
  attemptNumber
  state:
    pending |
    ready |
    waiting_resource |
    waiting_human |
    active |
    result_observed |
    completed |
    blocked |
    cancelled |
    recovery_required
  executionRunId?
  recoveryReason?
}
```

`StepAttempt.id` is a semantic exact-once key. One attempt may create at most one S1 external execution-start effect. Uncertain external work is never automatically replayed.

## Typed outputs and Agent handoff

Step outputs are explicit immutable values, not hidden shared mutable state.

```text
StepOutput {
  id
  workspaceId
  missionRunId
  stepAttemptId
  outputName
  schemaDigest
  value
  evidenceIds[]
  createdAt
}

AgentHandoff {
  id
  workspaceId
  missionRunId
  fromStepAttemptId
  toStepId
  inputName
  outputId
  createdAt
}
```

A downstream step may read only outputs declared by the plan and only through a persisted AgentHandoff. Undeclared, cross-Workspace, or missing output access is rejected.

## Mission run state machine

```text
created
→ running
→ paused | waiting_human | blocked | recovery_required
→ running
→ completed | cancelled | failed
```

Rules:

- `pause` prevents creation/start of new StepAttempts but does not terminate a currently executing external action.
- `resume` evaluates only currently-ready work.
- `cancel` prevents future starts, releases releasable logical resources, preserves all history/evidence, and does not fabricate completion.
- `completed` requires all terminal steps completed and every declared terminal evidence requirement satisfied.
- restart/crash recovery reconstructs MissionRun, StepAttempt and handoff projections from canonical SQLite events.

## Scheduler semantics

For a step to become ready:

1. MissionRun state must be `running`.
2. all declared dependencies must satisfy their completion/evidence conditions;
3. required upstream handoffs must exist;
4. S1 Workspace/Agent/install/grant/provider authorization must pass;
5. required Worker must be same-Workspace and available;
6. resource reservation must succeed atomically;
7. persisted Human Gate must be satisfied when policy requires it.

Independent steps may be ready concurrently. A resource conflict blocks only the conflicting step/attempt, not unrelated ready work.

## Canonical events

S2 does not create a second event authority. All S2 lifecycle events append to the existing SQLite `execution_events` authority.

Required event types include:

```text
mission.created
mission.revision_created
mission.revision_frozen
mission.run_created
mission.run_started
mission.run_paused
mission.run_resumed
mission.run_cancelled
plan.step_ready
plan.step_blocked
step.attempt_created
step.attempt_waiting_human
step.attempt_started
step.output_recorded
agent.handoff_recorded
step.attempt_completed
step.attempt_recovery_required
mission.checkpoint_recorded
mission.run_completed
```

Every command is idempotent by semantic key. Reusing a key with different semantic intent is a collision error.

## Persistence and privacy

Canonical storage must never contain:

```text
browser profile paths or user-data directories
process IDs / process-local launch fields
credentials / cookies / passwords / tokens
provider private output not explicitly admitted as bounded evidence
```

The S1 persistence-safe runtime result boundary remains mandatory.

## Permanent execution boundary

S2 remains limited to project-owned or explicitly approved bounded execution surfaces. It does not authorize third-party AI website automation, programmatic extraction of provider output, credential replication, protective-measure evasion, or automatic production/financial/legal execution.