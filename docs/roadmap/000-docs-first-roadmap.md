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
controlled remote execution delegation
```

Technical feasibility, provider-authorized use, scheduling authority, collaboration authority and delegated execution authority remain separate gates.

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
S7  Optional Collaboration and Sync                             COMPLETE — GO
S8  Controlled Remote Execution Delegation                      CURRENT — GATE 0
```

S8 is the first milestone that may convert an explicitly trusted remote request into a destination-local execution identity. It does not activate direct remote Worker control, remote HumanGate decisions or credential/session forwarding.

## Current accepted baseline

Latest main at S8 Gate 0 start:

```text
7872ec55d5b7c12fb9eed2f7a535457f41c186c7
```

S7 frozen accepted product head:

```text
004bfc9f6972b0bfc0295256dcdb7aada308b70b
```

Canonical result documents:

```text
S0: docs/spikes/S0-results.md
S1: docs/results/S1-results.md
S2: docs/results/S2-results.md
S3: docs/results/S3-results.md
S4: docs/results/S4-results.md
S5: docs/results/S5-results.md
S6: docs/results/S6-results.md
S7: docs/results/S7-results.md
```

Canonical S8 coordination issue: #115.

## S0 — Technical feasibility and provider boundary

Status: **COMPLETED — GO**

Accepted foundation:

```text
Electron operator control plane
persistent Chrome / Chromium Workers
profile lease exclusivity
renderer → sandbox preload → IPC → browser execution
project-owned loopback test surface
unexpected-close / forced-crash recovery
no automatic duplicate submission
native Apple Silicon operation
provider boundary separation
```

S0 does not authorize unsupported third-party AI automation or output extraction.

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
→ bounded effect
→ canonical SQLite event/projection
→ evidence / recovery
```

Canonical assets include Workspace isolation, CapabilityPackage/Version/Installation, Agent grants, Task/ExecutionGraph, ResourceLock, HumanGate, ExecutionRun and Evidence.

Normative/result documents:

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
→ typed StepOutput / AgentHandoff
→ pause/resume/cancel/recovery/checkpoint
→ terminal evidence
→ Mission completion
```

S2 retained sandboxed preload isolation and recovered safely without replaying uncertain external effects.

Result: `docs/results/S2-results.md`.

## S3 — GitHub-Native Engineering Workflow

Status: **COMPLETED — GO**

Accepted path:

```text
registered repository
→ branch/path ownership
→ exact-head PR binding
→ GET-only PR/check/review/base observation
→ fail-closed delivery gate
→ immutable delivery evidence
→ declared S2 Mission continuation release
```

GitHub provider authority remains read-only in S3. GitHub writes require a separately accepted contract.

Result: `docs/results/S3-results.md`.

## S4 — Multi-Session Operator Console

Status: **COMPLETED — GO**

Accepted architecture:

```text
S0 Worker/session state
+ S1 authorization / HumanGate
+ S2 Mission state
+ S3 delivery evidence
→ Workspace-scoped OperatorCockpitSnapshot
→ explanation / attention / lineage
→ bounded selected-Worker controls delegated to existing runtime
```

S4 introduced no second scheduler/store/HumanGate/provider authority.

Result: `docs/results/S4-results.md`.

## S5 — Approved Provider Adapters

Status: **COMPLETED — GO**

Accepted first slice:

```text
accepted Workspace / Agent / Capability authority
→ ProviderUseContract snapshot
→ exact approved public provider target
→ bounded GET/HEAD observation
→ body-free ProviderObservation
→ canonical SQLite evidence
→ S4 explanation
```

Initial accepted adapters cover public Vercel and Netlify deployment observation. No authenticated provider writes, arbitrary URL fetch, response-body harvesting, credential replication, deployment mutation or billing mutation are authorized by S5.

Result: `docs/results/S5-results.md`.

## S6 — Scheduling Policy

Status: **COMPLETED — GO**

Frozen accepted product head:

```text
b9cce3a331b33c273e5eecd11fa3269fd5c9b135
```

Accepted path:

```text
canonical ready S1/S2 work
+ immutable SchedulingPolicySnapshot
+ global/per-Workspace/provider bounds
+ safe Worker/session compatibility
→ deterministic priority + bounded fairness
→ SchedulingDecision / AssignmentProposal
→ existing S2/S1 revalidation
→ existing ResourceLock / HumanGate / runtime authority
```

S6 remains a policy/selection layer, not a second execution authority. It cannot invent work, approve HumanGates, bypass locks, infer unlimited provider capacity or directly start external effects.

Result: `docs/results/S6-results.md`.

## S7 — Optional Collaboration and Sync

Status: **COMPLETED — GO**

Frozen accepted product head:

```text
004bfc9f6972b0bfc0295256dcdb7aada308b70b
```

Accepted path:

```text
canonical local collaboration-safe state
→ explicit safe projection compiler
→ immutable SyncEnvelope / monotonic cursor / digest chain
→ exact project-owned sync transport
→ append/idempotent remote mirror
→ WorkspaceMembership / TeamRole visibility
→ read-only SharedWorkspaceSnapshot
→ S4/S7 collaboration explanation
```

Accepted durable objects:

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

Final acceptance proved:

```text
351 / 351 frozen-product tests PASS
two independent stable source identities
two independent SQLite/userData roots
project-owned GET/POST-only mirror with no ambient Authorization/Cookie
bidirectional collaboration-safe visibility
membership/TeamRole visibility filtering
exact duplicate idempotency
conflict/gap/cross-Workspace/unknown-source fail closed
local canonical execution invariance under remote mirror pulls
real Electron A + B on native arm64
real Chrome Worker A + Chromium Worker B
canonical dual WorkerBinding presence explanation
cross-instance local Worker control isolation
browser submissions 0
graceful shutdown and restart
acknowledged envelope replay 0
page errors 0
console errors 0
residual scoped processes 0
privacy scan hits 0
```

S7-F v1 also found a real local-test-server shutdown defect. PR #111 repaired graceful shutdown by closing remaining active localhost HTTP connections and added a regression test before the final frozen-head acceptance.

Permanent S7 authority boundary:

```text
remote mirror never overwrites canonical local execution projections
remote/member role cannot control Worker or HumanGate
remote status cannot release Mission dependency or create local work
S7 disabled/offline never breaks S0–S6 local correctness
no arbitrary renderer URL/method/header transport
no browser cookie/token/profile/process replication
no raw canonical event forwarding without safe projection
no last-write-wins conflict hiding
cross-Workspace envelope/membership access fails closed
acknowledged envelopes do not replay as new effects after restart
```

Normative/result documents:

```text
docs/contracts/S7-optional-collaboration-sync.md
docs/architecture/008-s7-optional-collaboration-sync.md
docs/testing/S7-acceptance-matrix.md
docs/results/S7-results.md
```

## S8 — Controlled Remote Execution Delegation

Status: **CURRENT — GATE 0**

Goal: permit one trusted instance to request bounded work from another instance while preserving destination-local execution sovereignty.

First S8 vertical slice:

```text
source canonical ready work
+ exact active DelegationPeerBinding
+ immutable destination-owned DelegationPolicySnapshot
→ immutable DelegationRequest
→ bounded project-owned transport
→ destination IncomingDelegationProposal
→ destination-local capability/grant/provider/resource/scheduling admission
→ destination-local delegation HumanGate
→ exactly-once DelegatedExecutionBinding
→ existing destination S6/S2/S1 execution authority
→ bounded DelegationReceipt / evidence
→ source read-only receipt mirror
→ explicit source-local S2 handoff consumption
```

Core proposed objects:

```text
DelegationPeerBinding
DelegationPolicySnapshot
DelegationRequest
IncomingDelegationProposal
DelegationAdmissionSnapshot
DelegationAcceptance
DelegatedExecutionBinding
DelegationReceipt
DelegationResultEvidence
DelegationCancellationProposal
```

Permanent first-slice boundaries:

```text
remote request is proposal, not command
destination HumanGate required before runnable delegated identity
existing action HumanGate remains in force
no remote Worker control
no remote HumanGate approve/reject
no remote ResourceLock mutation
no remote capability install/grant
no cookie/token/profile/process-control forwarding
no direct remote provider effect
no remote auto-retry of failed/uncertain work
no authoritative post-start remote cancellation
no scheduling/provider limit bypass
receipt mirror alone cannot mutate source canonical execution truth
```

Gate 0 documents:

```text
docs/contracts/S8-controlled-remote-execution-delegation.md
docs/architecture/009-s8-controlled-remote-execution-delegation.md
docs/testing/S8-acceptance-matrix.md
```

Canonical coordination issue: #115.

Planned owner topology:

```text
S8-A docs-only Gate 0
S8-B delegation policy / peer binding / request integrity domain
S8-C destination admission / local-authority revalidation domain
S8-D bounded request / receipt transport protocol
S8-E delegation inbox / status / evidence UI
S8-I shared SQLite/application/IPC/S4/S7 composition
S8-F frozen-head native arm64 two-instance + real Electron acceptance
```

B/C/D/E may start only after S8-A merges and must all start from the same exact latest main with disjoint write scopes. S8-I remains blocked until all four sibling components are accepted into main.

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
delegation peer binding
delegation request identity
delegation transport target
local/cloud target when applicable
```

Two writers may run concurrently only when their write sets and exclusive resources do not overlap. Sibling implementation owners may not import unmerged sibling branches. Shared root integration must have one explicit owner.

## Documentation required before any future implementation wave

```text
goal
exact starting main
allowed files
forbidden/shared files
state transitions
authority boundary
provider-use status
Human Gates
failure/recovery behavior
acceptance evidence
stop conditions
owner topology
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
S7 remote collaboration state remains non-executable mirror state.
S8 may create destination-local execution identity only through explicit bilateral policy, destination-local admission and HumanGate acceptance.
Direct remote Worker control or remote HumanGate approval remains outside accepted authority.
```

## Current next action

```text
accept and merge S8-A Gate 0 docs-only contract
→ freeze the resulting latest main as the common S8-B/C/D/E sibling baseline
→ launch disjoint S8-B / S8-C / S8-D / S8-E owners
→ independently exact-head validate and merge each component
→ start S8-I only after B/C/D/E are merged
→ freeze one exact S8-I product head
→ execute S8-F native arm64 two-instance + real Electron delegation acceptance
→ issue GO / GO WITH ARCHITECTURE CHANGE / NO-GO
```
