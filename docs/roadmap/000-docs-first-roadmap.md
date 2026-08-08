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
scheduling policy / bounded utilization
optional collaboration / sync mirror
```

Technical feasibility, provider-authorized use and collaboration authority remain separate gates.

## Canonical stage registry

This file is the current stage-number authority. Earlier roadmap versions reserved `S2` for a GitHub-native workflow. During execution, the accepted sequence inserted the more foundational durable Mission orchestration milestone as S2. Accepted historical stage artifacts are not renamed retroactively.

```text
S0  Technical feasibility and provider boundary                  COMPLETE — GO
S1  Local Execution Kernel and Workspace Interconnect           COMPLETE — GO
S2  Durable Multi-Step Mission Orchestration                    COMPLETE — GO
S3  GitHub-Native Engineering Workflow                          COMPLETE — GO
S4  Multi-Session Operator Console                              COMPLETE — GO
S5  Approved Provider Adapters                                  COMPLETE — GO
S6  Scheduling Policy                                           COMPLETE — GO
S7  Optional Collaboration and Sync                             CURRENT — GATE 0
```

Current baseline:

```text
current main at S7 Gate 0 start: e7d2e7ee8d5ab0bfccbaaae59986dd97c016f0df
S0 results: docs/spikes/S0-results.md
S1 results: docs/results/S1-results.md
S2 results: docs/results/S2-results.md
S3 results: docs/results/S3-results.md
S4 results: docs/results/S4-results.md
S5 results: docs/results/S5-results.md
S6 results: docs/results/S6-results.md
canonical S7 issue: #103
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

Major durable assets:

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

Status: **COMPLETED — GO**

Accepted path:

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

Accepted initial adapters:

```text
Vercel public deployment observation
Netlify public deployment observation
```

Final accepted live targets were explicit user-owned public production aliases. Native and real Electron acceptance proved HTTP 200 observations, exact-target/provider checks, GET/HEAD-only method audit, conservative redirect/private-target handling, canonical SQLite persistence, same-userData restart with zero provider replay, privacy-safe immutable artifacts, and no provider write path.

S5 fail-closed evidence also retained rejected acceptance inputs: a Vercel generated deployment URL that redirected to SSO was not followed or bypassed, and a Netlify project with no current deployment was not treated as healthy.

Permanent first-slice boundary:

```text
GET/HEAD only
exact target required
HTTPS external targets only
bounded same-origin redirect/private-target policy
no arbitrary URL fetch IPC
no response-body harvesting/persistence
no credential/token/cookie replication
no authenticated provider API
no deploy/promote/rollback/domain/env/secret/billing mutation
restart never replays provider access
```

Normative/result documents:

```text
docs/contracts/S5-approved-provider-adapters.md
docs/architecture/006-s5-approved-provider-adapters.md
docs/testing/S5-acceptance-matrix.md
docs/results/S5-results.md
```

## S6 — Scheduling Policy

Status: **COMPLETED — GO**

Accepted path:

```text
canonical ready S1/S2 work
+ immutable SchedulingPolicySnapshot
+ global/per-Workspace concurrency budgets
+ explicit provider/action capacity
+ safe Worker/session compatibility
→ deterministic priority + bounded fairness
→ SchedulingDecision
→ AssignmentProposal
→ existing S2/S1 authority revalidation
→ existing S1 Task / ResourceLock / HumanGate path
→ canonical scheduling decision evidence
```

S6 is a policy/selection layer, not a second execution authority.

Final native acceptance at frozen product head:

```text
b9cce3a331b33c273e5eecd11fa3269fd5c9b135
```

proved:

```text
301 / 301 source tests PASS
three canonical ready candidates competing for two bounded slots
two accepted assignments and one remaining eligible/deferred candidate
hard global/per-Workspace caps
S1 browser_profile and provider_surface lock authority
HumanGate stops selected work before browser submission
deterministic digest
bounded aging without exceeding priority bound
unknown/stale provider capacity fail closed
cross-Workspace session reuse fail closed
stale proposal rejection
SQLite + real Electron restart with zero scheduling/execution replay
page/console errors 0
residual scoped processes 0
privacy-safe immutable artifacts
```

The native-readiness phase found and repaired a real integration gap before GO: S6 proposals had to be consumed inside the inherited S2 scheduler before S2 created StepAttempts, and S1 provider-surface reservations had to be visible to the S6 resource set.

Permanent boundary:

```text
no Task/Mission/PlanStep invention
no HumanGate approval/rejection
no direct Worker/provider effect start
no silent retry of failed/uncertain work
no stale-proposal execution
no ResourceLock bypass
no cross-Workspace profile/session reuse
unknown/stale provider capacity is conservative
no quota/rate/pricing/concurrency probing or circumvention
```

Normative/result documents:

```text
docs/contracts/S6-scheduling-policy.md
docs/architecture/007-s6-scheduling-policy.md
docs/testing/S6-acceptance-matrix.md
docs/results/S6-results.md
```

## S7 — Optional Collaboration and Sync

Status: **CURRENT — GATE 0**

Goal: add an opt-in collaboration mirror between independent AI Execution OS instances while preserving local SQLite/S0–S6 execution authority and offline correctness.

First S7 vertical slice:

```text
canonical local collaboration-safe state
→ explicit safe projection compiler
→ immutable SyncEnvelope / monotonic cursor / digest chain
→ exact project-owned sync transport
→ append/idempotent remote mirror
→ WorkspaceMembership / TeamRole visibility
→ read-only SharedWorkspaceSnapshot
→ S4/S7 sync-status explanation
```

Core first-slice objects:

```text
SyncConfiguration
SyncSourceInstance
SyncEnvelope
SyncCursor
SyncAck
SyncDivergence
WorkspaceMembership
TeamRole
SharedWorkspaceSnapshot
RemoteWorkerPresence
```

Hard boundary:

```text
remote mirror never overwrites canonical local execution projections
remote/member role cannot control Worker or HumanGate
remote status cannot release Mission dependency or create local work
S7 disabled/offline never breaks S0–S6 local correctness
no arbitrary URL/method/header transport
no browser cookie/token/profile/process replication
no raw canonical event forwarding without safe projection
no last-write-wins conflict hiding
cross-Workspace envelope/membership access fails closed
acknowledged envelopes do not replay as new effects after restart
```

Consistency model:

```text
same envelope id + same digest   → idempotent duplicate
same envelope id + new digest    → divergence / reject
next monotonic cursor            → append
cursor gap                       → gap/stale / reject beyond gap
unknown source/schema/class      → reject
```

Initial TeamRole values affect collaboration visibility only, not execution authority.

Gate 0 documents:

```text
docs/contracts/S7-optional-collaboration-sync.md
docs/architecture/008-s7-optional-collaboration-sync.md
docs/testing/S7-acceptance-matrix.md
```

Canonical coordination issue: #103.

Planned owner topology:

```text
S7-A docs-only Gate 0
S7-B sync envelope/cursor/integrity/divergence domain
S7-C membership/TeamRole/visibility domain
S7-D project-owned transport + remote mirror protocol
S7-E collaboration/sync explanation UI
S7-I shared SQLite/application/IPC/S4 integration
S7-F frozen-head two-instance native + real Electron acceptance
```

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
sync source identity
sync endpoint/mirror target
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
No circumvention of pricing, metering, usage, rate, concurrency, quota, or restrictions.
No hidden external writes.
No automatic production deployment or production database migration by default.
No financial, payment, wallet, token, settlement, or legal irreversible execution in the initial product.
Remote collaboration state is not execution authority unless a future separately accepted milestone explicitly says so.
```

## Current next action

```text
accept and merge S7 Gate 0 docs-only contract
→ launch disjoint S7-B / S7-C / S7-D / S7-E owners from one exact latest main
→ merge each independently after exact-head validation
→ start S7-I shared application/SQLite/IPC/S4 integration only after B/C/D/E are merged
→ freeze exact S7-I product head
→ execute S7-F native arm64 two-instance + real Electron collaboration acceptance
→ issue GO / GO WITH ARCHITECTURE CHANGE / NO-GO
```
