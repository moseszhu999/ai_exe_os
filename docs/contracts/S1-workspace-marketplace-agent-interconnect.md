# S1 Workspace / Marketplace / Agent Interconnect Contract

Status: **NORMATIVE — IMPLEMENTATION BLOCKING**

Canonical coordination issue: **#10**

Exact starting baseline:

```text
main: 985bcd7ac959b9b3058b2c381928256f2a8d1638
S0 verdict: GO
```

## 1. Product definition

S1 turns the accepted S0 worker/runtime spike into one local execution product.

```text
Marketplace capability
→ Workspace installation
→ Agent grant
→ Task and ExecutionGraph binding
→ Worker/resource reservation
→ Human Gate
→ approved execution
→ result/evidence persisted to Workspace
```

The product is not a collection of unrelated browser scripts. Every execution belongs to one Workspace, is authorized through explicit domain relationships, and produces auditable evidence.

## 2. Authority boundaries

### Workspace

`Workspace` is the primary ownership, visibility, and authorization boundary.

A Workspace owns:

```text
agents
capability installations
tasks
execution graphs
resource locks
human gates
execution runs
evidence references
```

No grant, task, execution, or evidence reference may silently cross a Workspace boundary.

### Marketplace

`Marketplace` publishes immutable capability metadata and versions.

Marketplace may answer:

```text
what a capability does
what inputs it accepts
what evidence it produces
what resource/provider requirements it declares
what actions require a Human Gate
which version and integrity digest is installed
```

Marketplace does **not**:

```text
grant execution authority
select a Workspace
select an Agent
start a Worker
submit an external action
read browser credentials
```

### Agent

An `Agent` is a Workspace-scoped execution identity with an explicit set of capability grants.

An Agent may use a capability only when all are true:

```text
capability version is installed in the same Workspace
AgentCapabilityGrant is active
Task references the same Workspace
provider-use status is accepted for the requested surface
resource and dependency checks pass
required Human Gate is approved
```

### Worker

A `Worker` is a runtime resource. It executes an already-authorized plan.

A Worker may not:

```text
invent a capability grant
change Workspace ownership
expand task scope
choose an unapproved provider surface
automatically retry an uncertain external action
```

## 3. Canonical domain model

```text
Project
Workspace
CapabilityPackage
CapabilityVersion
CapabilityInstallation
Agent
AgentCapabilityGrant
TaskNode
DependencyEdge
ExecutionGraph
Worker
BrowserSession
ResourceLock
HumanGate
EvidenceRequirement
ExecutionRun
ExecutionEvent
```

### Project

```ts
interface Project {
  id: string;
  name: string;
  workspaceIds: string[];
  createdAt: string;
  updatedAt: string;
}
```

### Workspace

```ts
interface Workspace {
  id: string;
  projectId: string;
  name: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}
```

### Capability package and version

```ts
interface CapabilityPackage {
  id: string;
  name: string;
  publisher: 'project-owned' | 'approved-local' | 'approved-provider';
  description: string;
}

interface CapabilityVersion {
  packageId: string;
  version: string;
  integrityDigest: string;
  inputSchema: object;
  outputSchema: object;
  evidenceRequirements: EvidenceRequirement[];
  resourceRequirements: string[];
  providerContractIds: string[];
  humanGatePolicy: 'never' | 'task' | 'action';
  status: 'available' | 'deprecated' | 'blocked';
}
```

A published version is immutable. Changes require a new version and digest.

### Capability installation

```ts
interface CapabilityInstallation {
  id: string;
  workspaceId: string;
  packageId: string;
  version: string;
  integrityDigest: string;
  status: 'installed' | 'disabled' | 'removed';
  installedAt: string;
}
```

Installation does not grant execution authority to any Agent.

### Agent and grant

```ts
interface Agent {
  id: string;
  workspaceId: string;
  name: string;
  role: string;
  status: 'active' | 'disabled';
}

interface AgentCapabilityGrant {
  id: string;
  workspaceId: string;
  agentId: string;
  installationId: string;
  allowedActions: string[];
  allowedTargets: string[];
  status: 'active' | 'revoked';
  grantedAt: string;
}
```

`workspaceId` must match across Agent, installation, grant, task, and execution.

### Task and execution graph

```ts
interface TaskNode {
  id: string;
  workspaceId: string;
  graphId: string;
  agentId: string;
  installationId: string;
  capabilityAction: string;
  input: object;
  state:
    | 'draft'
    | 'queued'
    | 'ready'
    | 'waiting_dependency'
    | 'waiting_resource'
    | 'waiting_human'
    | 'active'
    | 'completed'
    | 'failed'
    | 'cancelled';
}

interface DependencyEdge {
  graphId: string;
  fromTaskId: string;
  toTaskId: string;
  condition: 'completed' | 'evidence_accepted';
}
```

A task cannot become `ready` until its grant, provider contract, dependencies, and required resources are valid.

### Resource lock

```ts
interface ResourceLock {
  id: string;
  workspaceId: string;
  resourceType:
    | 'repository'
    | 'branch'
    | 'path'
    | 'browser_profile'
    | 'provider_surface'
    | 'pr_metadata'
    | 'local_database';
  resourceKey: string;
  taskId: string;
  executionRunId: string;
  acquiredAt: string;
  releasedAt: string | null;
}
```

At most one active exclusive lock may exist for the same normalized resource key.

### Human gate

```ts
interface HumanGate {
  id: string;
  workspaceId: string;
  taskId: string;
  executionRunId: string;
  actionClass:
    | 'READ_ONLY'
    | 'REVERSIBLE_LOCAL'
    | 'EXTERNAL_WRITE'
    | 'SECURITY_SENSITIVE'
    | 'DESTRUCTIVE';
  workerId: string;
  capabilityAction: string;
  target: string;
  payloadPreview: object;
  evidenceExpected: EvidenceRequirement[];
  state: 'requested' | 'approved' | 'rejected' | 'expired';
}
```

A rejected or expired gate performs no submission and releases reserved resources.

### Execution run and event

```ts
interface ExecutionRun {
  id: string;
  workspaceId: string;
  taskId: string;
  agentId: string;
  workerId: string;
  state:
    | 'requested'
    | 'ready'
    | 'waiting_human'
    | 'active'
    | 'result_observed'
    | 'completed'
    | 'failed';
  startedAt: string | null;
  completedAt: string | null;
}

interface ExecutionEvent {
  id: string;
  workspaceId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventVersion: number;
  idempotencyKey: string;
  occurredAt: string;
  payload: object;
}
```

`idempotencyKey` is unique. Replaying the same command must not create a second external action or a duplicate semantic event.

## 4. Required lifecycle

```text
capability.published
capability.installed
capability.disabled
capability.granted
capability.grant_revoked
execution.requested
execution.ready
execution.blocked
resource.reserved
human_gate.requested
human_gate.approved
human_gate.rejected
execution.started
execution.result_observed
execution.waiting_human
execution.completed
execution.failed
resource.released
```

Every accepted command appends one canonical event before updating query projections.

## 5. Scheduling invariants

The scheduler may transition a task to `ready` only when:

```text
Workspace is active
Agent is active
installation is installed and digest matches
Agent grant is active
capability action is allowed by the grant
all dependency conditions are satisfied
provider contract status is accepted
required resources are available
```

Before execution starts, the scheduler reserves all exclusive resources in deterministic order.

Lock acquisition is all-or-nothing. Partial reservations must be released on failure.

The scheduler does not invent tasks merely to keep a Worker busy.

## 6. Provider-use gate

A CapabilityVersion that declares a provider surface must reference a reviewed ProviderUseContract.

```text
unknown → blocked
expired review → blocked
prohibited action → blocked
supported read-only path → allowed within contract
supported write path → Human Gate required unless separately accepted
```

No S1 implementation may add ChatGPT website automation or programmatic third-party AI output extraction.

## 7. Persistence contract

S1 uses local SQLite for queryable durable state.

The event log remains the canonical recovery and audit boundary.

Required properties:

```text
transactional event append + projection update
unique event idempotency keys
foreign keys enabled
WAL mode
bounded schema migrations
rebuildable projections
crash-safe restart
```

The S0 JSONL event history may be imported through a one-time, deterministic, checksum-recorded migration.

Never store in SQLite:

```text
browser cookies
passwords
password-manager data
raw authorization codes
copied provider tokens
browser profile files
```

## 8. Recovery contract

After application restart:

```text
installed capabilities remain installed
Agents and grants rehydrate
workers rehydrate as stopped
active uncertain execution becomes waiting_human
held locks are reconciled against live process identity
an external submission is never replayed automatically
projections can be rebuilt from canonical events
```

## 9. First integrated vertical slice

The first S1 implementation uses one project-owned deterministic capability:

```text
package: local.form-submit
version: 1.0.0
action: submit_payload
target: project-owned loopback test page
humanGatePolicy: action
```

Acceptance story:

1. Publish package metadata.
2. Install version into Workspace A.
3. Create Agent A in Workspace A.
4. Grant `submit_payload` to Agent A.
5. Create a task and graph.
6. Reserve the browser profile and local target.
7. Reject once and prove submission count is unchanged.
8. Approve once and prove exactly one start and one result event.
9. Restart and prove state/evidence rehydrate without duplicate submission.
10. Attempt to run from Workspace B without installation/grant and prove it is blocked.

## 10. UI contract

The Electron application exposes one integrated navigation model:

```text
Projects
Workspaces
Marketplace
Agents
Workers
Tasks
Execution Graph
Human Gates
Evidence
Events / Recovery
```

The UI must show why an execution is blocked:

```text
missing installation
missing grant
provider contract blocked
unsatisfied dependency
resource conflict
waiting for Human Gate
uncertain recovery requires review
```

## 11. Implementation ownership

Disjoint initial owners:

```text
S1-B storage:
  src/storage/**
  tests/storage/**
  migrations/**

S1-C domain and authorization:
  src/domain/workspace*.cjs
  src/domain/capability*.cjs
  src/domain/agent*.cjs
  tests/domain/**

S1-D scheduler and gates:
  src/main/scheduler/**
  src/main/human-gate/**
  tests/scheduler/**

S1-E UI:
  src/renderer/s1/**
  src/preload/s1*.cjs
  tests/ui-contract/**
```

No implementation owner may modify another owner's paths without a new coordination decision in Issue #10.

## 12. Stop conditions

Stop implementation and mark BLOCKED when:

```text
Workspace isolation cannot be proven
an execution can bypass an Agent grant
an external action may duplicate after crash
provider-use status is unknown
credential or cookie copying becomes necessary
migration cannot be reproduced or rolled back
parallel owners need the same write path
```

## 13. S1 acceptance verdict

Allowed final verdicts:

```text
GO
GO WITH ARCHITECTURE CHANGE
NO-GO
```

No final S1 verdict may be issued until the integrated Electron user story, SQLite recovery, Workspace isolation, grant enforcement, Human Gate cancellation, and no-duplicate crash recovery have all executed on a real workstation.