# ADR 003 — S2 Durable Mission Orchestrator

Status: **Proposed for S2 contract acceptance**

Parent: #29

## Context

S1 established a secure local execution kernel with Workspace isolation, Marketplace installation, Agent grants, SQLite canonical events, resource locks, persisted Human Gates, a browser Worker adapter, exact-once bounded local effects, and restart/crash containment.

S2 must compose those primitives into multi-step work without creating a second scheduler, event store, authorization path, or hidden shared state.

## Decision

Introduce an orchestration layer above the S1 application/runtime services.

```text
Electron UI
  ↓ commands / queries
S2 Mission Application Service
  ↓
Mission Repository / Plan Repository / Attempt Repository / Handoff Repository
  ↓
S2 Orchestration Engine
  ↓ delegates one ready step at a time
S1 authorization + scheduler + Human Gate + runtime adapter
  ↓
Canonical SQLite execution_events + projections
```

The S2 engine decides **which declared step is ready**. S1 remains responsible for **whether the bound execution is authorized and safe to start**.

## No duplicated authority

S2 must not duplicate:

- Workspace authorization;
- capability installation/grant validation;
- ProviderUseContract validation;
- Worker lifecycle authority;
- browser profile lease authority;
- external-effect exact-once boundary;
- Human Gate decision authority;
- canonical event persistence.

## Ready-set algorithm

For a running MissionRun:

1. load immutable MissionRevision + ExecutionPlan;
2. list terminal/completed/active/recovery-contained attempts;
3. derive pending steps without successful terminal attempt;
4. verify declared dependencies and evidence;
5. materialize declared AgentHandoffs;
6. exclude steps blocked by mission pause/cancel/recovery state;
7. call the S1 readiness boundary for each candidate;
8. acquire resources atomically per attempt;
9. create/persist Human Gate when required;
10. start only attempts that pass every S1 gate.

The derived ready set is deterministic for the same canonical event state.

## Concurrency

Independent steps may progress concurrently when:

- their dependencies are satisfied;
- their resource sets do not conflict;
- they use valid same-Workspace authorization;
- the MissionRun is running;
- their own Human Gate/provider state allows progress.

Failure, rejection or resource conflict in one branch does not stop unrelated branches unless the plan explicitly declares that dependency.

## Checkpoint model

A MissionCheckpoint is a durable summary pointer, not a second source of truth.

```text
MissionCheckpoint {
  id
  workspaceId
  missionRunId
  canonicalEventSequence
  projectionDigest
  readyStepIds[]
  activeAttemptIds[]
  recoveryRequiredAttemptIds[]
  createdAt
}
```

On restart, projections are loaded/rebuilt from canonical events; checkpoint digest is verified; orchestration resumes only after recovery reconciliation.

## Pause / cancel semantics

Pause is a scheduling barrier. It does not claim to stop an external action already in flight.

Cancel is a future-start barrier. It preserves completed evidence and records unresolved active work as review-required when necessary.

## Retry semantics

A retry is always a new StepAttempt with a new exact-once semantic identity. A previous uncertain attempt is never reused or automatically replayed.

## UI architecture

S2 component UI may independently implement Mission Builder / Plan Graph / Run Timeline / Handoff / Checkpoint views against contract-faithful interfaces. Root Electron preload/renderer/main composition is owned only by S2-I after component PRs merge.

## Security consequence

No S2 value object may carry raw browser profile paths, user-data directories, process IDs, cookies, tokens, passwords, provider credentials or private third-party provider output outside explicitly bounded evidence policy.

## Alternatives rejected

### Separate workflow database
Rejected: would create dual authority against S1 canonical SQLite events.

### Agent-to-Agent direct mutable memory
Rejected: undeclared handoffs would be unauditable and violate Workspace/output contracts.

### Automatic retry after crash
Rejected: an uncertain external effect may already have occurred.

### Marketplace-driven orchestration
Rejected: Marketplace publishes capability contracts but has no execution authority.