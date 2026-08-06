# S1 Local Execution Kernel Architecture

Status: **PROPOSED — CONTRACT PR**

Canonical issue: **#10**

## Architecture decision

S1 retains the S0 Electron and browser-worker runtime, introduces a durable local domain store, and places all scheduling behind Workspace-scoped authorization.

```text
Electron Operator Console
│
├── Workspace Application Service
├── Marketplace Catalog Service
├── Agent Authorization Service
├── ExecutionGraph Scheduler
├── Human Gate Service
├── Resource Lock Service
├── Evidence Service
├── Provider Contract Gate
│
├── SQLite Unit of Work
│   ├── canonical execution events
│   ├── domain projections
│   ├── migration journal
│   └── idempotency records
│
└── S0 Runtime Boundary
    ├── BrowserWorkerManager
    ├── ProfileLeaseManager
    ├── LocalTestServer
    └── read-only GitHub observer
```

## Architectural rule

No renderer, browser worker, Marketplace package, or provider adapter writes domain state directly.

All commands flow through application services:

```text
renderer intent
→ preload schema validation
→ IPC sender validation
→ application command
→ authorization and invariant checks
→ SQLite transaction
→ canonical event append
→ projection update
→ runtime effect after commit
→ observed-result command
→ second SQLite transaction
```

## Why SQLite now

S0 proved append-only recovery with JSONL. S1 requires:

```text
Workspace queries
capability installation and grant joins
graph dependency queries
exclusive-resource uniqueness
Human Gate inbox
execution/evidence history
migration and projection rebuild
```

SQLite is the local source for queryable state. Canonical events remain the recovery/audit boundary.

## Storage layers

### Canonical event table

```sql
CREATE TABLE execution_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
```

### Domain projections

Initial tables:

```text
projects
workspaces
capability_packages
capability_versions
capability_installations
agents
agent_capability_grants
execution_graphs
tasks
dependency_edges
execution_runs
human_gates
resource_locks
evidence_refs
migration_journal
```

### Transaction boundary

For every accepted domain command:

```text
BEGIN IMMEDIATE
validate current projection and version
insert canonical event using unique idempotency key
update projections
COMMIT
```

If any write fails, no runtime effect starts.

Runtime effects occur only after the committed state says the execution is authorized and ready.

## Application services

### Workspace service

Responsibilities:

```text
create/archive Workspace
validate Workspace ownership
prevent cross-Workspace references
list Workspace agents, tasks, installations, runs, and evidence
```

### Marketplace service

Responsibilities:

```text
publish immutable project-owned capability versions
validate schemas and integrity digests
install/disable/remove versions in a Workspace
expose declared provider, resource, evidence, and Human Gate requirements
```

Marketplace is not an execution service.

### Agent authorization service

Responsibilities:

```text
create/disable Agent
create/revoke capability grant
validate action and target constraints
reject cross-Workspace grant use
```

### Scheduler

Responsibilities:

```text
resolve dependencies
validate installation and grant
validate ProviderUseContract
reserve resources in deterministic order
request Human Gate
select an eligible stopped/idle Worker
start an authorized execution
contain uncertain results in waiting_human
```

The scheduler never performs a browser action itself. It delegates an accepted ExecutionRun to the S0 runtime boundary.

### Human Gate service

A gate is a persisted domain object, not a transient `window.confirm` value.

Required preview:

```text
Workspace
Agent
capability package/version/action
Worker/browser profile
target
payload
resource locks
expected evidence
provider contract status
```

Reject/expire:

```text
no submission
execution returns to a bounded state
reserved resources released
rejection event appended
```

Approve:

```text
approval event appended
execution becomes ready/active exactly once
```

### Evidence service

Evidence references are immutable metadata pointing to local artifacts or accepted external references.

```text
id
workspaceId
executionRunId
type
location
digest
capturedAt
redactionStatus
```

Evidence records must not contain provider credentials or copied browser session data.

## S0 compatibility boundary

The following S0 behavior remains authoritative:

```text
one browser profile → one live Worker
manual/unexpected browser close reconciles worker to stopped
uncertain active task recovers to waiting_human
stale lease reclaimed only after recorded PID death
no automatic duplicate external submission
provider boundary scan
```

S1 application services wrap these capabilities; they do not weaken them.

## JSONL migration

S1 provides an importer with these phases:

1. calculate source JSONL SHA-256;
2. create a migration-journal row with status `started`;
3. parse events sequentially;
4. normalize known S0 event versions;
5. insert with deterministic idempotency keys;
6. rebuild projections;
7. verify counts and latest task/worker state;
8. mark migration `completed` with source digest and imported sequence range.

Re-running the same source digest must produce no duplicate events.

Unsupported or corrupt events stop the migration before it is marked complete. The original JSONL remains untouched.

## Concurrency model

SQLite serializes write transactions. The scheduler adds logical resource locks.

Lock order:

```text
Workspace
repository
branch
path
browser profile
provider surface
PR metadata
local database target
```

Every command normalizes and sorts its requested locks before acquisition. This prevents inconsistent lock order and reduces deadlock risk.

## Worker selection

A Worker is eligible only when:

```text
same project/Workspace authorization context
status stopped or idle as required
browser channel matches capability requirements
profile is not leased by another live process
provider surface is allowed
resource locks are held by this ExecutionRun
```

Worker reuse is an optimization after correctness, never an authorization shortcut.

## Recovery sequence

On Electron startup:

1. open SQLite with foreign keys and WAL enabled;
2. apply bounded migrations;
3. verify migration journal;
4. reconcile S0 profile leases against live PIDs;
5. rebuild/verify projections when requested;
6. move uncertain active executions to `waiting_human`;
7. release orphaned logical locks only after owner-process reconciliation;
8. expose recovery decisions in the operator console;
9. never automatically replay an external action.

## IPC boundary

The preload bridge exposes command/query methods with explicit schemas.

Initial command groups:

```text
workspace.create
capability.install
capability.disable
agent.create
agent.grantCapability
graph.create
task.create
execution.request
humanGate.approve
humanGate.reject
execution.cancel
```

Initial queries:

```text
workspace.list
workspace.getOverview
marketplace.listAvailable
agent.list
executionGraph.get
humanGate.listPending
evidence.list
recovery.getStatus
```

All IPC handlers validate the sender frame and reject unknown fields.

## UI composition

One Electron shell renders the following coordinated views:

```text
Project / Workspace switcher
Marketplace catalog and installation drawer
Agent roster and grant editor
Task/ExecutionGraph view
Worker inventory
Human Gate inbox
Evidence timeline
Recovery and blockers panel
```

The operator must not have to infer relationships across separate demo pages.

## Security and privacy

Required:

```text
nodeIntegration=false
contextIsolation=true
sandbox=true
webSecurity=true
strict IPC schemas and sender validation
navigation/window denial remains enforced
SQLite file permissions restricted to the local user
no secrets in events, projections, logs, or evidence metadata
provider contract checked before target navigation/submission
```

## Initial implementation waves

### Wave B — Storage

```text
SQLite bootstrap
schema/migrations
transactional event append
projection rebuild
S0 JSONL importer
```

### Wave C — Workspace/Marketplace/Agent domain

```text
entities and repositories
installation and grant invariants
cross-Workspace denial
provider requirement declarations
```

### Wave D — Scheduler and Human Gate

```text
graph/dependency readiness
resource locks
persisted Human Gate
S0 runtime adapter
crash containment
```

### Wave E — Integrated UI

```text
single navigation shell
Workspace overview
Marketplace installation
Agent grants
task graph
Human Gate and evidence flow
```

Each wave starts from the latest merged `main`, uses disjoint paths, and must not import an unmerged sibling branch.

## Architecture acceptance

This architecture is accepted for implementation only when the contract PR proves:

```text
all S1 domain names and state transitions are unambiguous
path ownership is disjoint
SQLite/event authority is explicit
Marketplace cannot execute directly
Agent grants cannot cross Workspaces
runtime effects occur only after committed authorization
Human Gate is persisted
provider and credential boundaries remain blocking
```