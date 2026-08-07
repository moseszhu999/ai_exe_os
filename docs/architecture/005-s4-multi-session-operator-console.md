# S4 Architecture — Multi-Session Operator Console

## Architectural rule

S4 is a projection/composition layer over accepted S0–S3 authorities.

```text
S0 WorkerManager
S1 SQLite + Scheduler + HumanGate
S2 Mission Orchestrator
S3 GitHub Delivery Evidence
        ↓
S4 derived cockpit read model
        ↓
S4 bounded control adapter
        ↓
Electron IPC / sandbox preload / renderer
```

No S4 component may become a second scheduler, event store, Human Gate authority, Mission state machine or provider adapter.

## Layers

### 1. Authority adapters

Read existing state through stable local interfaces:

- S1/S2/S3 application service query methods;
- WorkerManager `list()` and exact bounded control methods;
- canonical event/projection repository for provenance references only.

Do not query raw SQLite from renderer or component UI.

### 2. Console read model

A pure/deterministic composition module derives one `OperatorCockpitSnapshot` for one Workspace.

Recommended code scope:

```text
src/operator-console/read-model/**
```

Inputs are snapshots from existing authorities. Outputs are privacy-bounded immutable view data.

The read model should perform joins by explicit stable IDs only. Do not join by labels, display names or incidental ordering.

### 3. Explanation graph

A deterministic explanation module maps blocker/attention state to lineage nodes.

Recommended code scope:

```text
src/operator-console/explanation/**
```

Node kinds may include:

```text
workspace
mission
planStep
stepAttempt
task
executionRun
worker
humanGate
resourceLock
deliveryGate
deliveryEvidence
evidence
executionEvent
```

Edges are explanatory references, not executable dependencies.

### 4. Bounded control adapter

Recommended code scope:

```text
src/operator-console/control/**
```

This adapter performs payload validation and delegates to existing WorkerManager/application methods.

It may expose:

```text
focusWorker(workerId)
stopWorker(workerId)
pauseWorker(workerId)
resumeWorker(workerId)
```

Each operation must verify the exact selected identity and return a fresh authoritative Worker/session snapshot.

It must not manipulate internal Worker collections directly.

### 5. Attention aggregation

Recommended code scope:

```text
src/operator-console/attention/**
```

Normalize Human Gates, waiting-human, recovery and blocker evidence into one deterministic inbox.

Attention items are derived. Dismissal in UI must not erase authoritative blocker/recovery state.

### 6. Component UI

Recommended code scope:

```text
src/renderer/s4/**
```

Component UI receives only the privacy-bounded S4 bridge state.

Required component concepts:

```text
cockpit summary
workspace selector
mission/run cards or graph
worker/session inventory
attention inbox
blocker/recovery inspector
provider/GitHub status
lineage/event inspector
bounded control affordances
```

The UI should link related state instead of duplicating separate disconnected S0/S1/S2/S3 pages.

### 7. Shared integration

Only S4-I may modify shared root composition:

```text
src/application/** S4 additions
src/main/main.cjs
src/preload/index.cjs
src/renderer/index.html
src/renderer/app.js / root scripts
src/renderer/styles.css
tests/s4-integration*.test.cjs
```

S4-I composes accepted B/C/D/E outputs after they are independently merged to `main`.

## Read-model rebuildability

A cockpit snapshot must be reproducible from current authority snapshots and canonical event references.

S4-specific persisted canonical projections should be avoided unless a future implementation demonstrates a requirement that cannot be satisfied by deterministic derivation.

If caching is introduced, it must be disposable and never used to authorize effects.

## Worker/session identity

S0 Workers are long-lived local runtime resources. S4 must distinguish:

```text
worker identity
browser channel
runtime status
project identity
workspace/task/mission binding when authoritative
last known safe execution/recovery state
```

Do not surface:

```text
browser profile paths
user-data paths
process IDs
raw environment values
tokens/cookies/authorization headers
```

## Multi-session isolation

The architecture assumes multiple Worker/browser sessions may coexist.

Control operations must have no implicit fan-out.

A control adapter must never use patterns equivalent to:

```text
stopAll()
kill all matching browser processes
clear all profiles
release all locks
```

for a selected-worker action.

Global shutdown remains application lifecycle behavior, not an S4 selected-worker control.

## Human Gate composition

The inbox derives from S1 HumanGate projection/state.

S4 may expose navigation or call the existing accepted Gate command path, but the command must still be handled by S1 authority with existing idempotency/provider-contract checks.

## Mission composition

Mission/StepAttempt state comes from S2.

S4 may explain ready/waiting/active/waiting-human/completed state and handoff/checkpoint lineage but does not modify those projections directly.

## GitHub composition

S3 remains GET-only.

The cockpit embeds S3 repository/PR/check/review/delivery evidence and may invoke existing read-only refresh.

No S4 IPC channel may contain GitHub merge/comment/review-submit/update/delete/dispatch write semantics.

## IPC shape

S4 should expose a small bounded namespace, for example:

```text
aiExecutionOS.s4.console.query(workspaceId)
aiExecutionOS.s4.console.focusWorker({workspaceId, workerId})
aiExecutionOS.s4.console.stopWorker({workspaceId, workerId})
aiExecutionOS.s4.console.pauseWorker({workspaceId, workerId})
aiExecutionOS.s4.console.resumeWorker({workspaceId, workerId})
```

Exact method count is fixed by S4-I contract/tests once implementation is composed.

Every command must be sender-validated and payload-validated.

## Failure behavior

```text
unknown Workspace                fail closed
unknown Worker                   fail closed
Worker belongs to other scope    fail closed
unsupported control              explicit unavailable capability
runtime control throws           preserve authoritative state; surface attention item
uncertain submission/recovery    never replay automatically
missing provenance               show unavailable, do not infer
provider status uncertain        show uncertain/blocker, do not override
```

## Native acceptance architecture

S4-F must exercise the real Electron app on native arm64 with at least two concurrent browser Workers/sessions.

Acceptance must prove:

1. both Workers are visible as distinct sessions;
2. focus Worker A leaves Worker B unchanged;
3. stop Worker A leaves Worker B alive;
4. unrelated Mission/task state is unchanged;
5. cockpit updates from authoritative post-control state;
6. restart rebuilds the cockpit without duplicate submission;
7. screenshots and privacy-safe state/evidence are artifacted;
8. page and console errors are zero.
