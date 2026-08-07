# Docs-First Delivery Roadmap

## Product principle

AI Execution OS is an execution-control product, not a collection of browser scripts.

Durable product assets include:

```text
Workspace authorization boundary
Marketplace capability contracts
Agent grants
Mission / ExecutionPlan orchestration
Worker/session lifecycle
resource ownership
Human Gates
evidence and recovery
provider-use contracts
provider adapters
engineering-delivery evidence
```

Technical feasibility and provider-authorized use remain separate gates.

## Canonical stage registry

This file is the current stage-number authority. Earlier versions of the roadmap had reserved `S2` for a GitHub-native workflow. During execution, the accepted product sequence inserted the more foundational durable Mission orchestration milestone as S2. The registry is reconciled here without renaming any accepted S0/S1/S2 artifact or result retroactively.

```text
S0  Technical feasibility and provider boundary                  COMPLETE — GO
S1  Local Execution Kernel and Workspace Interconnect           COMPLETE — GO
S2  Durable Multi-Step Mission Orchestration                    COMPLETE — GO
S3  GitHub-Native Engineering Workflow                          CURRENT
S4  Multi-Session Operator Console                              PLANNED
S5  Approved Provider Adapters                                  PLANNED
S6  Scheduling Policy                                           PLANNED
S7  Optional Collaboration and Sync                             FUTURE
```

Current baseline:

```text
current main at S3 Gate 0 start: 2c42919d24c8a24f4abfbae03c1ca209e9828fd1
S0 results: docs/spikes/S0-results.md
S1 results: docs/results/S1-results.md
S2 results: docs/results/S2-results.md
canonical S3 issue: #43
```

## S0 — Technical feasibility and provider boundary

Status: **COMPLETED — GO**

Proved:

```text
Electron operator control plane
persistent Chrome / Chromium Workers
profile lease exclusivity
renderer → sandbox preload → IPC → browser execution
stable loopback project-owned test surface
unexpected-close reconciliation
forced-crash recovery
no automatic duplicate submission
native Apple Silicon operation
provider boundary separation
```

Permanent S0 evidence does not include ChatGPT website automation or unsupported third-party AI output extraction.

## S1 — Local Execution Kernel and Workspace Interconnect

Status: **COMPLETED — GO**

Accepted path:

```text
Marketplace capability
→ install into Workspace
→ authorize for Agent
→ bind task/execution
→ reserve Worker/resources
→ persisted Human Gate
→ execute bounded effect
→ canonical SQLite event/projection
→ evidence / recovery
```

Major durable assets:

```text
SQLite canonical events/projections
Workspace isolation
CapabilityPackage / Version / Installation
Agent / AgentCapabilityGrant
Task / ExecutionGraph
ResourceLock
HumanGate
ExecutionRun / Evidence
integrated secure Electron UI
```

Normative documents:

```text
docs/contracts/S1-workspace-marketplace-agent-interconnect.md
docs/architecture/002-s1-local-execution-kernel.md
docs/testing/S1-acceptance-matrix.md
docs/results/S1-results.md
```

## S2 — Durable Multi-Step Mission Orchestration

Status: **COMPLETED — GO**

Accepted path:

```text
Mission objective
→ immutable MissionRevision / ExecutionPlan DAG
→ same-Workspace Agent/capability bindings
→ deterministic ready-set
→ local step OR S1 authorization/runtime
→ typed StepOutput
→ declared AgentHandoff
→ pause/resume/cancel/recovery/checkpoint
→ terminal evidence
→ Mission completion
```

Major assets:

```text
Mission / MissionRevision
ExecutionPlan / PlanStep / StepBinding
MissionRun / StepAttempt
StepOutput / AgentHandoff
MissionCheckpoint
S2 IPC + integrated Electron Mission UI
```

S2 final real Electron acceptance found and closed a sandbox-preload defect before GO. The accepted preload remains sandboxed and self-contained.

Normative documents:

```text
docs/contracts/S2-durable-mission-orchestration.md (or canonical S2 contract documents in repository)
docs/testing/S2-acceptance-matrix.md
docs/results/S2-results.md
```

## S3 — GitHub-Native Engineering Workflow

Status: **CURRENT — GATE 0**

Goal:

```text
turn registered GitHub repository, branch/path ownership, PR exact-head,
checks, review threads, base freshness, merge order and merge observation
into durable evidence for S2 Mission delivery dependencies
```

Deliverables:

```text
RepositoryRegistration / RepositoryBinding
BranchReservation / PathOwnershipClaim
PullRequestBinding / PullRequestSnapshot
CheckObservation
ReviewThreadObservation
MergeOrderConstraint
DeliveryGate
DeliveryEvidence
RepairProposal (proposal-only)
canonical SQLite observation events/projections
integrated Electron repository/PR/CI/review evidence UI
```

S3 provider authority is read-only. GitHub writes are not part of S3 and require a future separately accepted write contract.

Acceptance includes:

```text
Workspace repository isolation
exclusive path conflict detection
exact-head invalidation on head movement
required check/review evidence
fail-closed stale-base handling
merge-order constraints
immutable merge/delivery evidence
restart idempotency
S2 Mission dependency release only from declared evidence
real Electron explanation UI
bounded live read-only GitHub acceptance
no provider writes
privacy-safe portable artifact
```

Normative Gate 0 documents:

```text
docs/contracts/S3-github-native-engineering-workflow.md
docs/architecture/004-s3-github-native-engineering-workflow.md
docs/testing/S3-acceptance-matrix.md
```

## S4 — Multi-Session Operator Console

Status: **PLANNED**

Goal: make parallel execution understandable and controllable across Workspaces, Missions, delivery evidence, Workers, Human Gates, blockers and recovery.

Expected surfaces:

```text
project/workspace cockpit
Marketplace / Agent views
Mission / ExecutionPlan graph
Worker/session inventory
provider-use status
Human Gate inbox
blocker/recovery views
GitHub delivery evidence view
```

Acceptance requires the operator to explain every active Worker, authorization, dependency, blocker and recovery state, and to stop one Worker without affecting unrelated Workers.

## S5 — Approved Provider Adapters

Status: **PLANNED**

Goal: observe or act on external delivery surfaces only through explicitly accepted provider paths.

Possible adapters:

```text
GitHub write contract (only if separately accepted)
Vercel
Netlify
Supabase
Neon
other explicitly approved surfaces
```

Every new provider adapter starts read-only unless a separate write contract is accepted. No ChatGPT website adapter may be created while that provider gate remains blocked.

## S6 — Scheduling Policy

Status: **PLANNED**

Goal: optimize long-lived Worker and Mission utilization under bounded concurrency, evidence dependencies and provider rules.

Potential work:

```text
priority policy
resource/session reuse policy
local cost / throughput metrics
retry / waiting-human policy
Worker health scoring
provider quota awareness
```

The scheduler must not invent work, expand task scope, or circumvent pricing, metering, usage, rate, concurrency, or product restrictions.

## S7 — Optional Collaboration and Sync

Status: **FUTURE**

Possible work only after local correctness remains proven:

```text
cloud event replication
team roles
shared Workspace/Mission state
remote Worker inventory
organization policy
```

Online databases are not required for S0–S4.

## Parallelism rules

Before execution, reserve the relevant subset of:

```text
Workspace
repository
branch
allowed file paths
Mission / PlanStep owner
browser profile
provider surface
PR metadata target
local/cloud target when applicable
```

Two writers may run concurrently only when their write sets and exclusive resources do not overlap. Sibling implementation owners may not import unmerged sibling branches.

## Documentation required before each implementation wave

```text
goal
allowed files
forbidden/shared files
state transitions
provider-use status
Human Gates
failure/recovery behavior
acceptance evidence
stop conditions
```

## Permanent product boundaries

```text
No credential, cookie, password, authorization-code, or copied-token replication.
No CAPTCHA, identity-control, anti-abuse, fingerprint, user-agent, TCP, TLS, or protocol evasion.
No automated third-party AI output extraction where terms prohibit it.
No circumvention of pricing, metering, usage, rate, concurrency, or restrictions.
No hidden external writes.
No automatic production deployment or production database migration by default.
No financial, payment, wallet, token, settlement, or legal irreversible execution in the initial product.
```

## Current next action

```text
accept and merge S3 Gate 0 docs-only contract
→ launch disjoint S3-B / S3-C / S3-D / S3-E owners from one exact latest main
→ merge each independently after exact-head validation
→ start S3-I shared integration only after B/C/D/E are merged
→ execute S3-F frozen-head + live read-only GitHub + real Electron acceptance
→ issue GO / GO WITH ARCHITECTURE CHANGE / NO-GO
```
