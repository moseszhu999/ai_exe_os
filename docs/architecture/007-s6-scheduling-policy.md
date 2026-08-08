# S6 Scheduling Policy Architecture

Status: **NORMATIVE — GATE 0**

Parent: #88

Baseline: `0fe6601c20f7c75be739c8617f92a85f3f43510a`

## Architectural intent

S6 inserts one deterministic policy layer between canonical readiness and existing start authority.

```text
S0 Worker lifecycle
S1 authorization / resources / HumanGate / runtime
S2 Mission ready-set / attempts / retry authority
S3 engineering evidence
S4 operator explainability
S5 provider-use / exact-target observation
        ↓ read only
S6 candidate + capacity projection
        ↓
SchedulingPolicyEngine
        ↓
SchedulingDecision / AssignmentProposal
        ↓ revalidate
existing S2/S1 authority
        ↓
existing runtime
```

The policy engine cannot create readiness, acquire final resources or perform execution effects.

## Component topology

### S6-B — policy domain

Pure modules for:

```text
SchedulingPolicySnapshot
priority normalization
bounded aging/fairness
stable deterministic ordering
decision digest helpers
```

No SQLite, network, runtime, IPC or provider access.

### S6-C — capacity and compatibility

Pure modules for:

```text
ConcurrencyBudget
ProviderCapacitySnapshot
WorkerCapacitySnapshot
resource compatibility
same-Workspace session reuse guard
capacity reason codes
```

No scheduler start or provider probing.

### S6-D — orchestration

Pure policy orchestration over contract-shaped inputs:

```text
canonical-ready candidate inputs
policy snapshot
capacity snapshot
worker snapshot
→ eligible/deferred records
→ ordered candidates
→ AssignmentProposal
```

It may depend only on stable accepted contracts after component merge; during sibling development it uses test doubles/contracts rather than importing siblings.

### S6-E — component UI

Renderer-only component surfaces:

```text
Policy
Capacity
Eligible Queue
Selected Assignment
Deferred Reasons
Worker Compatibility
Provider Capacity
Decision Evidence
```

No root composition or execution command.

### S6-I — single integration owner

After B/C/D/E merge:

```text
S6ApplicationService over S5
ProjectionRepository types for policy/decision/proposal evidence
candidate extraction from canonical S1/S2 state
revalidation adapter into existing S2/S1 authority
sender-validated bounded IPC
self-contained root sandbox preload additions
S4 cockpit scheduling composition
integration tests
```

Only S6-I may change shared root main/preload/renderer/application composition.

### S6-F — acceptance owner

After one frozen S6-I product head:

```text
native arm64 multi-worker matrix
capacity saturation/fairness sequence
real Electron scheduling explanation
restart/no-replay proof
privacy/checksum artifact
```

QA carrier never merges into product.

## Candidate extraction architecture

Candidate extraction is a read model over existing canonical state.

A source item is included only when the owning accepted subsystem already represents it as start-eligible. S6 may add additional conservative deferral but may never subtract an existing blocker by interpretation.

```text
canonical ready = necessary
S6 policy eligible = canonical ready AND policy/capacity compatible
```

Therefore:

```text
S6 eligible ⊆ canonical ready
```

This subset relationship is a final acceptance invariant.

## Policy snapshot architecture

Policy configuration is immutable and digest-bound.

A policy update creates a new snapshot. Decisions record the exact policy digest and bounded authority/capacity input digest used.

This allows deterministic replay for audit without replaying execution.

## Deterministic ordering

The engine first converts priority + bounded aging into an effective priority tier. It then applies stable tie-breakers.

No floating-point opaque weighted score is required. Suggested internal tuple:

```text
[
  effectivePriorityRank,
  fairnessBucket,
  workspaceActiveCount,
  reusePreference,
  readySince,
  candidateId
]
```

Any implementation may use an equivalent deterministic representation, but two equivalent snapshots must produce identical ordered IDs and decision digest independent of input collection order.

## Capacity model

Capacity is modeled as explicit upper-bound facts.

```text
Global budget
  ├─ current active count
  └─ max active

Workspace budget
  ├─ current active count
  └─ max active

Provider/action budget
  ├─ current observed active
  ├─ explicit max active
  └─ freshness status

Worker capacity
  ├─ eligible/draining/unavailable
  └─ compatibility

S1 resource locks
  └─ final exclusive-resource authority
```

A budget record cannot increase authority beyond the original Task/Mission/provider contract.

## Unknown/stale provider capacity

Unknown/stale capacity is represented explicitly. It is not inferred from request outcomes by the policy engine.

```text
unknown → defer provider-bound candidate
stale → defer provider-bound candidate
blocked → defer provider-bound candidate
current + available > 0 → policy may propose
current + exhausted → defer
```

This conservative behavior prevents S6 from becoming a rate-limit probing system.

## Session reuse architecture

S6 may prefer an already-live Worker/session only after compatibility is proven.

Reuse compatibility is computed from safe identifiers, never raw paths/cookies/process IDs.

Required checks include:

```text
same Workspace
Worker eligible
not draining
required browser channel compatible
profile/session class compatible
provider/action surface compatible where applicable
no known exclusive-resource conflict
```

Cross-Workspace reuse is rejected before proposal generation.

## Revalidation architecture

AssignmentProposal captures a bounded authority snapshot digest. Before execution, S6-I calls an adapter that delegates to existing S2/S1 readiness/resource/provider/HumanGate checks.

Outcomes:

```text
accepted_current
rejected_stale
rejected_not_ready
rejected_resource_conflict
rejected_provider_capacity
rejected_human_gate
rejected_uncertain
```

Rejection performs no effect. S6 may recompute a new decision from new canonical state; it may not force the stale proposal through.

## Persistence

Existing SQLite execution store remains the only canonical persistence authority.

Suggested projection types:

```text
schedulingPolicySnapshot
providerCapacitySnapshot
schedulingDecision
assignmentProposal
schedulingDecisionEvidence
```

Every persisted state change appends a canonical event in the same transaction/projection boundary already accepted in S1.

Suggested events:

```text
scheduling.policy_recorded
scheduling.capacity_recorded
scheduling.decision_recorded
scheduling.assignment_proposed
scheduling.assignment_accepted
scheduling.assignment_rejected
scheduling.assignment_stale
```

No event implies an external provider action unless the existing execution subsystem separately records that action.

## Restart

Startup behavior:

```text
rehydrate policies
rehydrate decisions/proposals/evidence
recompute current derived queue on query or explicit scheduling command
mark stale proposals conservatively where authority no longer matches
perform zero automatic starts
perform zero provider calls
perform zero retry
```

## UI integration

S6 scheduling explanation is embedded into the existing operator cockpit rather than creating a second control plane.

The UI can request bounded operations such as:

```text
query scheduling state
record/supersede local policy snapshot
compute decision
request proposal revalidation
```

A UI command must not directly invoke a Worker start, provider call or HumanGate decision.

## Security and privacy

Renderer/application evidence must redact/reject:

```text
credentials/tokens/cookies
browser profile paths
process IDs
raw provider response bodies
secret environment values
```

Scheduling metrics are bounded local operational facts, not hidden provider metering discovery.

## Failure model

S6 prefers explicit deferral over optimistic execution.

Examples:

```text
no eligible candidate → no_assignment
all Workers unavailable → no_compatible_worker
provider capacity unknown → provider_capacity_unknown
capacity full → *_capacity_exhausted
stale authority → stale_authority_snapshot
waiting HumanGate → human_gate_required
uncertain prior effect → uncertain_execution
```

No failure automatically creates a retry identity.

## Parallel implementation rule

S6-B/C/D/E may run concurrently only after Gate 0 merges. All start from one exact baseline and use disjoint files. S6-I starts only after all four component owners are accepted and merged. S6-F starts only after S6-I freezes one exact product head.
