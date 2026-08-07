# Architecture 004 — S3 GitHub-Native Engineering Workflow

Status: **DRAFT — Gate 0**

Parent: Issue #43

## Context

S0 introduced a bounded read-only GitHub PR observer backed by legacy JSONL events. S1 established canonical SQLite events/projections and Workspace/Agent authority. S2 established durable Mission/PlanStep orchestration, typed handoffs, recovery, and a real Electron operator path.

S3 turns GitHub engineering delivery state into durable evidence that can gate Mission progress without granting GitHub write authority.

## Architecture decision

```text
registered Workspace repository
        |
        v
Repository / Ownership Domain
        |
        v
Read-only GitHub Observation Port
(PR / checks / reviews / merge)
        |
        v
Canonical SQLite event + projections
        |
        v
Delivery Gate Orchestrator
(head/base/check/review/ownership/order)
        |
        +---- blocked/stale ---> explainable blockers / RepairProposal
        |
        v
immutable DeliveryEvidence
        |
        v
declared S2 Mission dependency
        |
        v
S2 ready-set re-evaluation
```

## Canonical authority

`src/storage/**` remains the canonical event/projection authority. S3 observations must be appended through the same application/storage transaction boundary used by S1/S2.

The legacy S0 `GitHubStateObserver` remains compatibility/read-only code until S3-I integration. It must not become a parallel S3 canonical writer.

## Ports

### GitHubObservationPort

```text
observePullRequest(repository, number)
observeChecks(repository, headSha)
observeReviewThreads(repository, number, headSha)
observeCommit(repository, sha)
compare(repository, base, head)
```

All methods are reads. The port returns normalized values without exposing Authorization headers or raw provider payloads to domain/application code.

### DeliveryStateRepositoryPort

Provides durable Workspace-scoped projections for registrations, reservations, PR bindings, observations, gates, evidence, constraints, and repair proposals.

### MissionDeliveryDependencyPort

A narrow integration port used by S3-I to notify S2 that a declared delivery dependency has become satisfied. The actual Mission ready-set remains owned by S2.

## Observation normalization

Provider timestamps are evidence, not idempotency identity. Each normalized observation gets a semantic digest over bounded fields.

```text
PR digest = state + draft + merged + head/base + refs + merge commit + mergeability fields
check digest = sorted normalized checks by stable identity
review digest = sorted normalized thread ids/resolved/outdated/count
merge digest = repository + PR + accepted head + merge commit
```

An unchanged digest creates no new canonical observation event.

## Head invalidation

Exact-head readiness is never a floating property of a PR number.

```text
binding.expectedHeadSha = H1
observed head = H1
checks/reviews ready
DeliveryGate = ready

later observed head = H2
=> DeliveryGate = stale(head_mismatch)
=> H1 DeliveryEvidence remains historical
=> no downstream release from H1 for the H2 binding
```

Rebinding to H2 is an explicit local command that creates/supersedes local metadata; it is not an automatic GitHub mutation.

## Base freshness

S3 distinguishes:

- configured base ref identity;
- observed base SHA;
- merge-base/behind state when available;
- whether the gate requires current base.

If current-base evidence is required and cannot be established, the gate is blocked with `observation_incomplete` or `base_stale`, not optimistically ready.

## Ownership model

Branch reservations and path claims are local execution-control data. They do not claim GitHub branch protection authority.

Normalization:

```text
leading slash removed
`.` and empty segments removed
`..` rejected
backslash normalized/rejected
path is repository-relative
prefix comparison is segment-aware
```

Exclusive-prefix overlap blocks only the conflicting owners. Read-only claims do not conflict with each other.

## Merge-order model

MergeOrderConstraint is an acyclic local DAG between PullRequestBindings. A successor DeliveryGate carries `merge_order_unsatisfied` until immutable predecessor `merge_observed` evidence exists.

A merge observation is not inferred from a closed PR alone. The normalized PR/commit evidence must explicitly establish merge and merge commit/head provenance.

## Security model

S3 first-version GitHub provider capability is read-only.

Process-local secret use, when configured, is allowed only at the adapter boundary. The following are forbidden in canonical payloads/projections/UI/artifacts:

```text
authorization
bearer
access_token
refresh_token
github_token
token
cookie
password
private key
```

Provider error messages must be normalized so response headers/bodies cannot accidentally persist credentials.

## Failure model

Network/provider failures do not mutate last-good evidence into success. They create bounded observation failure state in the application layer and leave affected DeliveryGates blocked or stale.

No automatic retry may create GitHub writes. Read-only observation retry policy remains bounded by provider usage rules and later S6 scheduling policy.

## UI architecture

S3-E supplies mountable components/view-models only. S3-I mounts them into the root Electron shell after component owners merge.

Required operator explanation:

```text
repository / Workspace
bound PR
expected vs observed head
base freshness
required checks and current conclusions
review-thread state
ownership claims/conflicts
merge-order dependencies
current DeliveryGate state + blocker codes
immutable DeliveryEvidence
RepairProposal (proposal only)
```

## Integration sequence

```text
S3-A contract accepted
→ B/C/D/E implement in parallel from one exact main
→ each exact-head validated and merged independently
→ S3-I integrates canonical SQLite + S2 Mission + Electron
→ S3-F performs exact-head, restart, privacy, and bounded live GitHub read-only acceptance
→ GO / GO WITH ARCHITECTURE CHANGE / NO-GO
```
