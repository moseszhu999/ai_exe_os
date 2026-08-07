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
operator cockpit / explainability
```

Technical feasibility and provider-authorized use remain separate gates.

## Canonical stage registry

This file is the current stage-number authority. Earlier versions of the roadmap had reserved `S2` for a GitHub-native workflow. During execution, the accepted product sequence inserted the more foundational durable Mission orchestration milestone as S2. The registry remains reconciled without renaming accepted S0/S1/S2 artifacts retroactively.

```text
S0  Technical feasibility and provider boundary                  COMPLETE — GO
S1  Local Execution Kernel and Workspace Interconnect           COMPLETE — GO
S2  Durable Multi-Step Mission Orchestration                    COMPLETE — GO
S3  GitHub-Native Engineering Workflow                          COMPLETE — GO
S4  Multi-Session Operator Console                              COMPLETE — GO
S5  Approved Provider Adapters                                  CURRENT — GATE 0
S6  Scheduling Policy                                           PLANNED
S7  Optional Collaboration and Sync                             FUTURE
```

Current baseline:

```text
current main at S5 Gate 0 start: 4982b2bd6fd896f26c85f6dc5146653804ebec07
S0 results: docs/spikes/S0-results.md
S1 results: docs/results/S1-results.md
S2 results: docs/results/S2-results.md
S3 results: docs/results/S3-results.md
S4 results: docs/results/S4-results.md
canonical S5 issue: #73
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

Status: **COMPLETED — GO**

Accepted path:

```text
registered repository
→ branch/path ownership
→ exact-head PR binding
→ GET-only PR/check/review/base observation
→ fail-closed delivery gate
→ immutable merge evidence
→ declared S2 Mission continuation release
```

Major durable assets:

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
canonical SQLite GitHub observation events/projections
integrated Electron repository/PR/CI/review evidence UI
```

S3 provider authority remains read-only. GitHub writes are not part of S3 and require a future separately accepted write contract.

Final acceptance proved exact-head invalidation, stale-base fail-closed behavior, required check/review evidence, ownership and merge-order constraints, restart idempotency, merge-only Mission dependency release, native Electron UI, live private-repository GET-only GitHub observation, and privacy-safe immutable evidence.

Normative documents:

```text
docs/contracts/S3-github-native-engineering-workflow.md
docs/architecture/004-s3-github-native-engineering-workflow.md
docs/testing/S3-acceptance-matrix.md
docs/results/S3-results.md
```

## S4 — Multi-Session Operator Console

Status: **COMPLETED — GO**

Accepted architecture:

```text
S0 Worker/session state
+ S1 authorization / HumanGate / canonical events
+ S2 Mission state
+ S3 GitHub delivery evidence
→ derived Workspace-scoped OperatorCockpitSnapshot
→ explanation / attention / lineage
→ bounded selected-Worker controls delegated to existing runtime
→ secure Electron cockpit
```

Accepted surfaces:

```text
Cockpit / Overview
Projects & Workspaces
Missions / Execution Graph
Workers & Sessions
Agents / Capabilities / Provider Use
Human Gate Inbox
Blockers & Recovery
GitHub Delivery
Evidence & Event Lineage
```

S4 final native acceptance proved two concurrent unrelated Chrome/Chromium Workers, exact selected-worker focus/pause/resume/stop isolation, persisted Human Gate attention/evidence lineage, Workspace fail-closed behavior, deterministic restart with zero submission/Mission replay, real Electron operation on native arm64, privacy-safe immutable evidence and zero residual scoped processes.

S4 did not introduce a second scheduler/store/HumanGate/provider authority and did not add GitHub writes.

Normative/result documents:

```text
docs/contracts/S4-multi-session-operator-console.md
docs/architecture/005-s4-multi-session-operator-console.md
docs/testing/S4-acceptance-matrix.md
docs/results/S4-results.md
```

## S5 — Approved Provider Adapters

Status: **CURRENT — GATE 0**

Goal: add reusable external-provider adapters only through explicitly accepted provider-use contracts and exact approved targets, without turning the product into a generic HTTP client or deployment engine.

First vertical slice:

```text
accepted Workspace / Agent / Capability authority
→ accepted ProviderUseContract snapshot
→ exact approved provider target
→ immutable provider adapter definition
→ bounded HTTPS GET/HEAD observation
→ normalized body-free ProviderObservation
→ canonical SQLite evidence/event
→ S4 Operator Cockpit explanation
```

Initial provider-specific targets:

```text
Vercel public deployment observation
Netlify public deployment observation
```

First-slice hard boundary:

```text
GET/HEAD only
exact target required
HTTPS external targets only
bounded redirect/private-target policy
no arbitrary URL fetch IPC
no response-body harvesting/persistence
no credential/token/cookie replication
no deploy/promote/rollback/domain/env/secret/billing mutation
no GitHub write
no Supabase/Neon data/schema/config mutation
restart never replays provider access
```

Authenticated provider APIs and every provider write action remain outside the first S5 contract. Any later write capability requires its own reviewed provider contract and Human-Gate semantics before implementation.

Normative Gate 0 documents:

```text
docs/contracts/S5-approved-provider-adapters.md
docs/architecture/006-s5-approved-provider-adapters.md
docs/testing/S5-acceptance-matrix.md
```

Canonical coordination issue: #73.

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
accept and merge S5 Gate 0 docs-only contract
→ launch disjoint S5-B / S5-C / S5-D / S5-E owners from one exact latest main
→ merge each independently after exact-head validation
→ start S5-I shared application/SQLite/IPC/S4 integration only after B/C/D/E are merged
→ freeze exact S5-I product head
→ execute S5-F native arm64 + live Vercel/Netlify read-only acceptance
→ issue GO / GO WITH ARCHITECTURE CHANGE / NO-GO
```
