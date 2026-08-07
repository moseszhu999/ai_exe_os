# S3 GitHub-Native Engineering Workflow Contract

Status: **DRAFT — Gate 0**

Parent: Issue #43

## Purpose

S3 makes GitHub delivery state a durable, explainable input to the accepted S2 Mission orchestrator. It does not grant GitHub write authority.

```text
Mission / PlanStep
→ RepositoryBinding
→ BranchReservation + PathOwnershipClaim
→ PullRequestBinding
→ exact head/base observation
→ checks + review-thread observation
→ DeliveryGate evaluation
→ merge observation / DeliveryEvidence
→ downstream Mission readiness
```

## Authority

- Workspace is the ownership, visibility, and authorization boundary.
- RepositoryRegistration is explicit and Workspace-scoped.
- GitHub observation is read-only in S3.
- Canonical SQLite `execution_events` remains the only canonical event write authority.
- S0 JSONL GitHub observation is legacy input only; S3 must not dual-write canonical delivery events to JSONL.
- GitHub credentials may exist only in process/runtime configuration. Authorization/token values must never enter canonical events, projections, evidence, UI state, screenshots, or exported artifacts.

## Canonical entities

### RepositoryRegistration

```text
id
workspaceId
provider = github
owner
repository
visibilityHint
status = active | archived
createdAt
```

The repository identity is immutable while active. Reusing an id for a different owner/repository is a semantic collision.

### RepositoryBinding

Binds a Mission, MissionRevision, PlanStep, or bounded engineering task to one registered repository.

```text
id
workspaceId
repositoryRegistrationId
missionRunId?
planStepId?
createdAt
```

Cross-Workspace binding is forbidden.

### BranchReservation

```text
id
workspaceId
repositoryRegistrationId
branch
mode = exclusive_write | read_only
ownerKind = mission_step | task | operator
ownerId
state = active | released | superseded
createdAt
releasedAt?
```

An `exclusive_write` reservation conflicts with another active exclusive write reservation for the same repository/branch unless both refer to the same semantic owner.

### PathOwnershipClaim

```text
id
workspaceId
repositoryRegistrationId
branchReservationId
pathPattern
mode = exclusive_write | read_only
ownerId
state
```

S3 v1 path patterns are normalized repository-relative prefixes. No glob engine or shell expansion is required. `src/a/**`-style user input must be normalized to a bounded prefix representation before comparison.

Two active exclusive claims conflict when one normalized prefix contains the other. Conflict evaluation is deterministic and fail-closed.

### PullRequestBinding

```text
id
workspaceId
repositoryRegistrationId
planStepId?
number
expectedHeadSha
expectedBaseRef?
createdAt
state = active | superseded | merged | closed
```

The expected head SHA is a semantic identity. A different observed head does not mutate the expected head; it makes exact-head evidence stale.

### PullRequestSnapshot

Read-only observation:

```text
repository
number
state
draft
merged
headSha
headRef
baseSha
baseRef
mergeCommitSha?
mergeableState?
updatedAt
observedAt
```

### CheckObservation

Normalized exact-head check evidence:

```text
headSha
checks[] = {
  name,
  status,
  conclusion,
  source,
  observedAt
}
```

S3 must distinguish pending/queued/in-progress from success and failure. Missing required checks are not success.

### ReviewThreadObservation

```text
pullRequestNumber
headSha
threads[] = {
  id,
  resolved,
  outdated,
  commentsCount
}
observedAt
```

S3 records review-thread state. It does not infer reviewer intent beyond explicit GitHub state.

### MergeOrderConstraint

```text
id
workspaceId
repositoryRegistrationId
predecessorPullRequestBindingId
successorPullRequestBindingId
state = active | satisfied | invalidated
```

Constraints form an acyclic graph. A successor DeliveryGate cannot be ready until every active predecessor constraint is satisfied by observed merge evidence.

### DeliveryGate

```text
id
workspaceId
pullRequestBindingId
requiredCheckNames[]
requireNoUnresolvedThreads
requireCurrentBase
requireOwnershipClear
state = waiting | ready | stale | blocked | satisfied
blockers[]
lastEvaluatedAt
```

Required blocker codes:

```text
repository_inactive
cross_workspace_binding
ownership_conflict
head_mismatch
base_stale
required_check_missing
required_check_pending
required_check_failed
review_thread_unresolved
merge_order_unsatisfied
pull_request_closed_unmerged
observation_incomplete
```

### DeliveryEvidence

Immutable evidence created only from observed facts.

```text
id
workspaceId
pullRequestBindingId
kind = exact_head_ready | merge_observed
headSha
baseSha
mergeCommitSha?
checkDigest
reviewDigest
observedAt
```

A `merge_observed` evidence row may release a dependent S2 PlanStep or local Mission continuation when the plan explicitly declares that dependency.

### RepairProposal

Proposal-only object:

```text
id
workspaceId
pullRequestBindingId
reasonCode
description
suggestedAction
state = proposed | dismissed | superseded
```

Creating a RepairProposal has zero GitHub side effects. S3 contains no push/rebase/merge/comment/review/write API.

## Exact-head and stale-base rules

1. Every DeliveryGate binds to an immutable expected head SHA.
2. Any observed different head immediately yields `head_mismatch`; prior exact-head evidence remains historical and cannot satisfy the current gate.
3. Base freshness is evaluated against the configured current base reference/observed merge-base policy. A base change does not silently update a binding.
4. A new acceptable head requires an explicit new/superseding PullRequestBinding or operator-approved rebinding command inside the local product. This local metadata update is not a GitHub write.
5. DeliveryEvidence is immutable; stale evidence is retained with provenance but cannot satisfy current readiness.

## S2 integration rule

S3 may release S2 work only through declared evidence dependencies. It must not mutate StepOutput/Handoff history or fabricate terminal evidence.

```text
DeliveryGate satisfied
→ immutable DeliveryEvidence
→ declared delivery dependency satisfied
→ S2 evaluateRun()
```

A GitHub observation failure or incomplete observation keeps the dependent path blocked; unrelated Mission branches remain eligible.

## Read-only provider contract

Allowed GitHub network operations in S3 v1 are bounded GET/read observations for registered repositories and explicitly bound PRs/commits. Examples:

```text
pull request metadata
commit/check status / check runs
review threads / reviews where supported
commit / compare / merge observation
```

Forbidden in S3 v1:

```text
push
force-push
branch creation/deletion on GitHub
PR creation/update/close/merge
review/comment/label writes
workflow dispatch or rerun writes
repository setting changes
```

## Idempotency and canonical events

Observation commands are semantically idempotent. An unchanged normalized snapshot must not append duplicate canonical events.

Canonical event types include:

```text
github.repository_registered
github.branch_reserved
github.path_claimed
github.pull_request_bound
github.pull_request_observed
github.checks_observed
github.review_threads_observed
github.delivery_gate_changed
github.delivery_evidence_recorded
github.repair_proposed
```

The event idempotency key must encode the semantic aggregate plus normalized observation digest, not a poll timestamp alone.

## Owner topology after Gate 0

### S3-B — Repository / ownership domain

Exclusive paths:

```text
src/domain/github-repository*.cjs
src/domain/github-ownership*.cjs
src/domain/github-delivery*.cjs
tests/s3-github-domain*.test.cjs
```

No network, SQLite, IPC, or root UI writes.

### S3-C — Read-only GitHub observation adapters

Exclusive paths:

```text
src/main/github-observation/**
tests/s3-github-observation*.test.cjs
```

May read legacy `src/main/github-readonly-adapter.cjs` and `src/main/github-state-observer.cjs`; do not modify legacy shared files during the parallel component phase.

### S3-D — Delivery gate orchestration

Exclusive paths:

```text
src/orchestration/github-delivery/**
tests/s3-github-delivery*.test.cjs
```

Uses contract-defined interfaces/test doubles only until integration.

### S3-E — Component UI

Exclusive paths:

```text
src/renderer/s3/**
src/preload/s3*.cjs
tests/s3-github-ui*.test.cjs
```

No root shell edits.

### S3-I — Final integration owner

Starts only after accepted B/C/D/E merge to main.

Exclusive shared composition scope:

```text
src/application/** S3 additions
src/main/main.cjs
src/preload/index.cjs
src/renderer/index.html
src/renderer/app.js
src/renderer/styles.css
tests/s3-integration*.test.cjs
```

### S3-F — Independent acceptance

Product read-only. Acceptance-only writes:

```text
scripts/s3-acceptance-*.cjs
.github/workflows/s3-*-acceptance.yml
docs/results/S3-results.md
```

## Stop conditions

Do not issue S3 GO if any of the following remains true:

- GitHub writes are reachable without a separately accepted write contract;
- head movement can retain a ready/satisfied exact-head gate;
- overlapping exclusive path owners are accepted;
- unresolved required review evidence is treated as clear;
- missing/pending required checks are treated as success;
- stale-base state is silently ignored;
- restart duplicates canonical delivery events;
- credentials or authorization material enter durable state/evidence;
- integrated UI cannot explain why a delivery is ready/blocked/stale;
- live read-only GitHub acceptance is unexecuted.
