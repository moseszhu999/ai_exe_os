# M3 Bounded Management Execution — Readiness Gate

Date: 2026-08-09  
Parent: `docs/architecture/m2-external-controller-attestation-cycle.md`  
Implementation owner for this readiness note: PR #125 only  
Execution owner: not created

## Verdict

```text
BLOCKED
```

M0-M2.1 provide a credible read-only management foundation, but AIEXE is **not yet authorized to cross from management proposal into autonomous A2 execution**.

The correct next move is to close evidence and policy gates, not to create a second orchestration path or force AIEXE plumbing into every Domain OS.

## Gate 1 — existing S8 owner is still open

The current unique controlled-delegation integration owner is:

```text
AIEXE PR #122
agent/s8-controlled-delegation-integration-v1
```

M3 must reuse that accepted integration path. It must not create parallel delegation, remote worker control, HumanGate bypass or a second receipt protocol.

Until #122 is accepted into the baseline, PR #125 must not wire management proposals into S8 internals.

Status:

```text
BLOCKED
```

## Gate 2 — replay evidence is still small

The first evidence-linked historical replay corpus contains six cases and reproduces all six manual labels.

That proves the deterministic policy is executable and auditable. It does **not** prove general management quality.

Before raising authority from A1 `propose` to A2 `execute bounded`, the replay set should contain materially broader evidence across:

- clean continue cases;
- owner conflicts;
- stale/exact-head mismatch cases;
- validation failures and recovery;
- policy blocks;
- duplicate shared-capability cases;
- ambiguous or conflicting evidence;
- false-positive escalation cases;
- missed-escalation adversarial cases.

Status:

```text
BLOCKED
```

## Gate 3 — real project-owned controller/status attestations

The earlier version of this gate incorrectly implied that TrainingOS, TradeOS and Shared Media should each add AIEXE-specific receipt producer code.

That is now superseded.

Current domain operating rules make that dependency undesirable:

- TradeOS rejects infrastructure expansion that does not remove a current product critical-path blocker.
- Video Operation rejects new orchestration/receipt framework work while M10 human review remains the earliest business blocker.
- TrainingOS requires shared infrastructure to remain bounded and non-duplicative.

AIEXE now owns an external adapter:

```text
aiexe.external-controller-attestation.v1
-> aiexe.domain-controller-receipt.v1
```

Therefore the gate is:

> Each managed project must have a real project-owned controller or canonical status source that can emit explicit structured attestation fields for the exact observed head. No Domain OS repository code change is required.

The attestation must be explicit; AIEXE may not infer domain status from GitHub activity or unstructured prose.

Current state:

- consumer/adapter contract: implemented;
- domain repository plumbing requirement: removed;
- real recurring attestation emission from all managed project controllers: not yet proven.

Status:

```text
PARTIAL / BLOCKED FOR M3
```

## Gate 4 — no approved A2 management action policy yet

A2 needs an explicit allow-set. The first eligible actions should be low-consequence and reversible, such as:

- run an approved test profile;
- collect read-only project status;
- request an explicit controller attestation;
- request an existing CI validation;
- construct a non-binding implementation plan;
- schedule an already-approved bounded work item.

The initial A2 allow-set must exclude:

```text
merge
deploy
payment
production mutation
credential grant/write
domain-truth mutation
external contractual commitment
policy widening
human impersonation
```

Status:

```text
BLOCKED
```

## Gate 5 — live read-only management observation cycle

M2.1 now implements the canonical composition cycle:

```text
GitHub read-only observations
+ external controller attestations
-> exact-head/freshness reconciliation
-> Portfolio
-> Attention Queue
-> Cockpit
```

Schema:

```text
aiexe.management-observation-cycle.v1
```

The current implementation is intentionally a bounded input cycle:

```text
providerFetchPerformed = false
scheduledRuntimeStarted = false
writeAuthority = none
```

So the contract/composition portion of Gate 5 is implemented, but there is still no accepted live scheduled/provider-backed runner that periodically supplies current observations and attestations.

Status:

```text
PARTIAL / BLOCKED FOR M3
```

## Required M3 entry package

M3 may start only after all of the following are true:

```text
G1 S8 #122 accepted baseline                         PASS
G2 broader M2 replay acceptance                      PASS
G3 recurring real controller attestations            PASS
G4 A2 action allow-set + policy envelope              PASS
G5 live provider-backed read-only observation cycle   PASS
```

If any gate is false:

```text
managementAuthority = observe-and-propose
A2 execution = blocked
```

## Target execution chain after gates close

```text
External project facts
+ exact-head project-owned controller attestation
        |
        v
AIEXE canonical Domain Controller Receipt
        |
        v
Observed Portfolio
        |
        v
Deterministic Attention Queue
        |
        v
Evidence-backed ManagementProposal (A1)
        |
        v
A2 policy eligibility check
        |
        v
canonical capability package@version
        |
        v
existing S8 delegation policy
        |
        v
destination-local admission / HumanGate as required
        |
        v
bounded execution
        |
        v
receipt/evidence
        |
        v
next management observation
```

## Authority principle

A management recommendation is not execution authority.

```text
ManagementProposal != DelegationPolicy
ManagementProposal != HumanGate approval
ManagementProposal != Capability grant
ManagementProposal != Domain write authority
```

M3 must preserve those separations mechanically.

## Non-overlapping work that may continue before M3

While M3 is blocked, the following work is safe and useful without touching S8 ownership or Domain OS product paths:

1. expand the evidence-linked M2 replay corpus;
2. standardize controller/automation output to the external attestation fields without adding Domain OS runtime frameworks;
3. connect an authorized read-only provider runner to the M2.1 observation-cycle contract;
4. define the A2 action taxonomy and policy contract without wiring execution;
5. build the read-only owner cockpit around M2 outputs;
6. measure attention reduction, false escalation and missed escalation.

## Exit condition

This note should be superseded only when the current S8 integration owner is accepted and all five M3 gates have exact evidence.

## Boundary

```text
S8 files changed = NO
second S8 owner = NO
A2 execution enabled = NO
Domain OS receipt framework added = NO
Domain writes = NO
Merge = NO
Deploy = NO
Production mutation = NO
```
