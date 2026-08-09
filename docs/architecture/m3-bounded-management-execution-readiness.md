# M3 Bounded Management Execution — Readiness Gate

Date: 2026-08-09  
Parent: `docs/architecture/m2-deterministic-attention-queue.md`  
Implementation owner for this readiness note: PR #125 only  
Execution owner: not created

## Verdict

```text
BLOCKED
```

M0-M2 now provide a credible read-only management foundation, but AIEXE is **not yet authorized to cross from management proposal into autonomous A2 execution**.

The correct next move is to lock the entry conditions, not to create a second orchestration path.

## Why M3 is blocked now

### Gate 1 — existing S8 owner is still open

The current unique controlled-delegation integration owner is:

```text
AIEXE PR #122
agent/s8-controlled-delegation-integration-v1
```

M3 must reuse that accepted integration path. It must not create parallel delegation, remote worker control, HumanGate bypass or a second receipt protocol.

Until #122 is accepted into the baseline, PR #125 must not wire management proposals into S8 internals.

### Gate 2 — replay evidence is still small

The first evidence-linked historical replay corpus contains six cases and currently reproduces all six manual labels.

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

### Gate 3 — Domain Controller Receipt producers do not yet exist in the Domain OS projects

AIEXE now defines the consumer/verification contract:

```text
aiexe.domain-controller-receipt.v1
```

But TrainingOS, TradeOS and Shared Media do not yet publish this receipt as a canonical project-owned artifact.

Therefore a live management cycle still cannot reliably distinguish:

```text
repository changed
```

from:

```text
project is healthy / blocked / paused
```

M3 execution must not be based on GitHub activity alone.

### Gate 4 — no approved A2 management action policy yet

A2 needs an explicit allow-set. The first eligible actions should be low-consequence and reversible, such as:

- run an approved test profile;
- collect read-only project status;
- request a Domain Controller receipt;
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

### Gate 5 — no live management observation cycle exists yet

M1 defines the canonical observation shape, but there is no production/runtime fetch loop in AIEXE that periodically gathers the four core project sources and reconciles them with Domain Controller receipts.

M3 should consume canonical management observations; it should not embed ad-hoc GitHub/provider calls directly into the execution decision.

## Required M3 entry package

M3 may start only after all of the following are true:

```text
G1 S8 #122 accepted baseline                    PASS
G2 broader M2 replay acceptance                 PASS
G3 real Domain Controller receipt producers     PASS
G4 A2 action allow-set + policy envelope         PASS
G5 read-only live portfolio observation cycle    PASS
```

If any gate is false:

```text
managementAuthority = observe-and-propose
A2 execution = blocked
```

## Target execution chain after gates close

```text
External project facts
+ exact-head Domain Controller receipt
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

While M3 is blocked, the following work is safe and useful without touching S8 ownership:

1. expand the evidence-linked M2 replay corpus;
2. define and implement Domain Controller Receipt producers in each Domain OS under their own owners;
3. add a read-only management-cycle runner that consumes already-authorized observations;
4. define the A2 action taxonomy and policy contract without wiring execution;
5. build the read-only owner cockpit around M2 outputs;
6. measure attention reduction, false escalation and missed escalation.

## Exit condition for this readiness note

This note should be superseded only when the current S8 integration owner is accepted and all five M3 gates have exact evidence.

## Boundary

```text
S8 files changed = NO
second S8 owner = NO
A2 execution enabled = NO
Domain writes = NO
Merge = NO
Deploy = NO
Production mutation = NO
```
