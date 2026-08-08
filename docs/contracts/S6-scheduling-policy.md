# S6 Scheduling Policy Contract

Status: **NORMATIVE — IMPLEMENTATION BLOCKING**

Canonical coordination issue: **#88**

Exact Gate 0 baseline:

```text
main: 0fe6601c20f7c75be739c8617f92a85f3f43510a
S0–S5: COMPLETE — GO
```

## 1. Product definition

S6 adds a deterministic policy layer that chooses among work already declared eligible by existing S1/S2 authority.

```text
canonical ready work
+ explicit policy snapshot
+ bounded concurrency budgets
+ safe Worker/session capacity
+ explicit provider capacity
→ deterministic candidate ordering
→ AssignmentProposal
→ existing S2/S1 revalidation
→ existing runtime start
```

S6 is not a new scheduler authority, task generator, retry engine, quota probe or provider executor.

## 2. Authority boundary

Canonical execution truth remains owned by accepted S0–S5 components.

S6 may answer:

```text
which already-ready candidate should be considered next
which compatible Worker/session is preferred
why a candidate is deferred
which explicit concurrency/provider/resource budget blocks assignment
what stable deterministic decision digest was produced
```

S6 may not:

```text
create a Task/Mission/PlanStep to fill capacity
change blocked/waiting_human/failed/cancelled/uncertain state into ready
approve/reject HumanGate
install/grant capability
acquire or override S1 ResourceLock authority
start an external effect directly
silently retry failed/uncertain work
probe/retry around provider quota/rate/pricing limits
infer unlimited capacity from missing quota evidence
reuse browser profile/session across Workspace boundaries
```

Every proposed assignment must be revalidated by the existing execution authority immediately before start.

## 3. Canonical policy model

### SchedulingPolicySnapshot

```ts
interface SchedulingPolicySnapshot {
  id: string;
  workspaceId: string;
  version: string;
  status: 'active' | 'superseded';
  globalMaxActive: number;
  workspaceMaxActive: number;
  priorityOrder: ['critical', 'high', 'normal', 'low'];
  fairness: {
    mode: 'bounded-aging';
    agingIntervalSeconds: number;
    maxPriorityBoostSteps: number;
  };
  sessionReuse: 'compatible-only' | 'disabled';
  createdAt: string;
  digest: string;
}
```

Published policy snapshots are immutable. Changes require a new version/digest.

### ProviderCapacitySnapshot

```ts
interface ProviderCapacitySnapshot {
  id: string;
  workspaceId: string;
  providerId: string;
  action: string;
  maxActive: number;
  activeObserved: number;
  status: 'current' | 'stale' | 'unknown' | 'blocked';
  observedAt: string;
  expiresAt: string | null;
  source: 'explicit-local-policy' | 'accepted-provider-evidence';
  digest: string;
}
```

Unknown/stale capacity is not interpreted as unlimited capacity.

### SchedulingCandidate

```ts
interface SchedulingCandidate {
  id: string;
  workspaceId: string;
  sourceKind: 'task' | 'plan_step';
  sourceId: string;
  executionIdentity: string;
  readyState: 'ready';
  readySince: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  requiredResources: string[];
  providerRequirement: null | {
    providerId: string;
    action: string;
  };
  workerRequirements: {
    browserChannel?: 'chrome' | 'chromium';
    exactProfileClass?: string;
  };
}
```

Candidates are derived only from canonical work already ready under S1/S2. S6 cannot manufacture candidate readiness.

### WorkerCapacitySnapshot

```ts
interface WorkerCapacitySnapshot {
  workerId: string;
  workspaceId: string;
  status: 'eligible' | 'draining' | 'unavailable';
  browserChannel: string;
  activeAssignmentCount: number;
  reusableSession: boolean;
  safeCompatibilityKeys: string[];
}
```

No raw profile path, process ID, credentials or browser storage enters the policy record.

### SchedulingDecision / AssignmentProposal

```ts
interface SchedulingDecision {
  id: string;
  policySnapshotId: string;
  inputDigest: string;
  evaluatedAt: string;
  orderedCandidateIds: string[];
  selectedCandidateId: string | null;
  selectedWorkerId: string | null;
  reasonCodes: string[];
  decisionDigest: string;
}

interface AssignmentProposal {
  id: string;
  decisionId: string;
  workspaceId: string;
  candidateId: string;
  workerId: string;
  executionIdentity: string;
  authoritySnapshotDigest: string;
  state: 'proposed' | 'accepted' | 'rejected' | 'stale';
}
```

AssignmentProposal is not execution authority. Acceptance requires existing scheduler/runtime revalidation.

## 4. Candidate eligibility

S6 candidate extraction is fail-closed.

A candidate may enter the S6 ready set only when existing canonical state already proves all applicable conditions:

```text
Workspace active
Task/PlanStep state already ready
Mission not paused/cancelled/terminal
Agent/capability/install/grant authority valid where applicable
dependencies satisfied
no waiting Human Gate requirement that blocks start
not failed/uncertain/cancelled
required provider-use contract accepted
resource requirements declared
execution identity current
```

If S6 cannot prove existing readiness, the record is not a candidate.

## 5. Deterministic ranking

S6 v1 uses explicit deterministic ranking, not opaque ML scoring.

Stable ordering:

```text
1. effective bounded priority
2. readySince age bucket
3. Workspace fairness state
4. safe compatible session-reuse preference
5. canonical candidate ID
6. canonical Worker ID
```

Priority classes:

```text
critical > high > normal > low
```

Bounded aging may lift a candidate by at most `maxPriorityBoostSteps`. It cannot turn ineligible work into eligible work.

For identical policy/candidate/capacity snapshots, the decision and digest must be identical independent of input array order.

## 6. Fairness

Fairness prevents indefinite starvation among continuously eligible candidates while respecting hard limits.

Required behavior:

```text
critical work may outrank normal work immediately
aging is bounded and deterministic
per-Workspace active caps are hard
lower-priority work is not guaranteed execution when permanently blocked by hard capacity
fairness never overrides provider/resource/HumanGate authority
```

Acceptance must exercise a sequence with more eligible candidates than available capacity and prove eventual selection of a continuously eligible lower-priority candidate under configured bounded aging.

## 7. Concurrency budgets

Hard upper bounds:

```text
globalMaxActive
workspaceMaxActive
existing S1 exclusive ResourceLocks
provider/action maxActive when current explicit evidence exists
Worker availability/draining state
```

A budget of zero means no new assignment. Missing capacity is never converted to a guessed positive number.

Reason codes include:

```text
global_capacity_exhausted
workspace_capacity_exhausted
provider_capacity_unknown
provider_capacity_stale
provider_capacity_exhausted
resource_conflict
worker_unavailable
worker_draining
no_compatible_worker
candidate_not_ready
human_gate_required
uncertain_execution
stale_authority_snapshot
```

## 8. Provider capacity rule

S6 must not discover provider limits through repeated failing requests or adaptive probing.

Allowed provider capacity sources:

```text
explicit local policy configured by operator
bounded accepted provider evidence from an approved adapter/contract
```

Disallowed:

```text
retry-until-success quota discovery
binary-searching rate/concurrency limits
changing identity/session/network behavior to obtain more capacity
using undocumented/private provider behavior
assuming unlimited capacity when evidence is absent
```

S5 remains read-only. S6 does not add a provider write action.

## 9. Worker/session reuse

Session reuse is a preference after safety compatibility, never an authority shortcut.

Reuse requires all applicable conditions:

```text
same Workspace
Worker eligible and not draining
browser channel compatible
profile/session ownership compatible
provider surface compatible
no conflicting ResourceLock
candidate authority current
```

Cross-Workspace browser profile/session reuse is prohibited even if it could increase throughput.

## 10. Retry / waiting-human policy

S6 never manufactures retry authority.

```text
waiting_human -> excluded until existing authority changes state
uncertain external execution -> excluded
failed -> excluded unless reviewed retry creates a new canonical execution identity
cancelled -> excluded
stale AssignmentProposal -> rejected and recomputed; never auto-started
```

## 11. Decision persistence

S6 uses the existing local SQLite canonical authority.

Persisted policy evidence may include:

```text
immutable SchedulingPolicySnapshot
bounded ProviderCapacitySnapshot
SchedulingDecision
AssignmentProposal
SchedulingDecisionEvidence
```

Never persist:

```text
credentials/cookies/tokens
raw browser profiles
process-local identifiers
provider response bodies
undocumented quota-probing data
```

Restart rehydrates records but performs zero scheduling starts and zero provider calls automatically.

## 12. Integration contract

S6 integration flow:

```text
query existing S1/S2/S4/S5 canonical state
→ derive eligible candidates/capacity
→ compute deterministic SchedulingDecision
→ persist decision/proposal
→ caller requests accepted S2/S1 revalidation
→ existing scheduler accepts or rejects current proposal
→ existing runtime performs start only if all old gates still pass
```

No S6 component may call browser/provider effect methods directly.

## 13. UI contract

S4 cockpit gains a scheduling section explaining:

```text
active policy snapshot
global/Workspace/provider capacity
eligible candidates
selected candidate/Worker
deferred candidates + reason codes
session reuse compatibility
stale/rejected proposals
recent deterministic decision evidence
```

The renderer gets no arbitrary scheduling-state mutation or provider write control.

## 14. Owner scopes

```text
S6-B:
  src/scheduling/policy/**
  tests/s6-scheduling-policy*.test.cjs

S6-C:
  src/scheduling/capacity/**
  tests/s6-scheduling-capacity*.test.cjs

S6-D:
  src/scheduling/orchestration/**
  tests/s6-scheduling-orchestration*.test.cjs

S6-E:
  src/renderer/s6/**
  src/preload/s6-bridge-contract.cjs
  tests/s6-scheduling-ui*.test.cjs

S6-I only after B/C/D/E merge:
  shared application/SQLite/IPC/main/preload/root renderer composition

S6-F only after frozen S6-I product head:
  acceptance scripts/workflow/results evidence
```

Sibling component branches may not import unmerged siblings.

## 15. Permanent boundary

S6 optimizes only inside authority already accepted by S0–S5. No task invention, HumanGate bypass, credential replication, provider-write path, quota/rate/pricing/concurrency circumvention, hidden retry, automatic production deployment/database mutation, or financial/legal irreversible execution is authorized.
