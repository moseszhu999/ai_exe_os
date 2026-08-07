# S2 Command / Query Interface

Status: **Normative draft**

Parent: #29

## Design rule

Renderer and external adapters never mutate S2 persistence directly. All writes cross an application command boundary; all reads use Workspace-scoped queries.

## Commands

```text
mission.create
mission.createRevision
mission.start
mission.pause
mission.resume
mission.cancel
mission.retryStepAfterReview
mission.recordCheckpoint
```

### mission.create

Input:

```text
workspaceId
title
objective
idempotencyKey
```

Result:

```text
Mission
MissionRevision(draft)
```

### mission.createRevision

Input:

```text
missionId
workspaceId
objective
steps[]
terminalStepIds[]
idempotencyKey
```

Each step includes:

```text
stepId
name
agentId
installationId
capabilityVersionId
action
target
dependsOn[]
declaredInputs[]
declaredOutputs[]
evidenceRequirements[]
resourceRequirements[]
humanGatePolicy
```

The command validates Workspace isolation, graph acyclicity, binding integrity and declared input/output topology before committing the revision.

### mission.start

Freezes the referenced MissionRevision, creates a MissionRun, evaluates initial ready steps and persists the resulting scheduling decisions. It does not bypass S1 runtime gates.

### mission.pause

Idempotently marks the MissionRun paused. No new StepAttempt may enter external-effect start while paused.

### mission.resume

Moves a paused MissionRun to running and reevaluates readiness. It must not replay completed or uncertain attempts.

### mission.cancel

Prevents future StepAttempts, releases releasable logical resources, preserves evidence/history, and records a cancellation reason. Active uncertain external work is contained and not assumed cancelled remotely.

### mission.retryStepAfterReview

Creates a new `StepAttempt` only after the prior attempt is terminal/recovery-contained and an explicit human decision authorizes a retry. It never reuses the old attempt ID.

## Queries

```text
mission.list(workspaceId)
mission.get(workspaceId, missionId)
mission.getRevision(workspaceId, revisionId)
mission.getRun(workspaceId, runId)
mission.getPlan(workspaceId, planId)
mission.listReadySteps(workspaceId, runId)
mission.listAttempts(workspaceId, runId)
mission.listHandoffs(workspaceId, runId)
mission.listCheckpoints(workspaceId, runId)
mission.timeline(workspaceId, runId)
mission.evidence(workspaceId, runId)
```

Every query requires the caller-selected Workspace and returns no records from another Workspace.

## Error / blocker contract

Stable machine-readable codes:

```text
workspace_inactive
mission_not_found
mission_revision_immutable
plan_cycle
plan_dependency_missing
plan_cross_workspace_reference
step_binding_invalid
step_input_undeclared
step_output_missing
agent_inactive
installation_missing_or_disabled
grant_missing_or_revoked
action_or_target_not_granted
provider_contract_unknown
provider_contract_changed_or_expired
dependency_unsatisfied
resource_conflict
worker_unavailable
human_gate_required
mission_paused
mission_cancelled
recovery_requires_review
idempotency_collision
terminal_evidence_unsatisfied
```

## IPC surface

S2-I may expose a bounded nested preload API:

```text
window.aiExecutionOS.s2.mission.query(...)
window.aiExecutionOS.s2.mission.create(...)
window.aiExecutionOS.s2.mission.createRevision(...)
window.aiExecutionOS.s2.mission.start(...)
window.aiExecutionOS.s2.mission.pause(...)
window.aiExecutionOS.s2.mission.resume(...)
window.aiExecutionOS.s2.mission.cancel(...)
window.aiExecutionOS.s2.mission.retryStepAfterReview(...)
```

Every IPC handler validates sender origin and plain-object payload shape before entering the application service. No raw SQL, database path, WorkerManager object, BrowserContext, credential, cookie or token crosses preload.

## Command ordering

For commands capable of eventual external effect:

```text
validate semantic input
→ validate Workspace authorization
→ append canonical command/event state
→ update projections in transaction
→ evaluate dependency / handoff readiness
→ reserve resources
→ persist Human Gate if required
→ revalidate provider contract
→ start S1 external effect once
→ persist observed result / evidence / handoff
→ release resources
→ reevaluate downstream readiness
```

Crash between external start and reliable result observation is `recovery_requires_review`; it is not an automatic retry signal.