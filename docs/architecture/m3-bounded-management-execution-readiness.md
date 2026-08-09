# M3 Bounded Management Execution — Readiness Gate

Date: 2026-08-09  
Parent: `docs/architecture/m2-a2-management-action-policy.md`  
Implementation owner for this readiness note: PR #125 only  
Execution owner: not created

## Verdict

```text
BLOCKED
```

M0-M2.2 provide a credible read-only management foundation plus a non-binding A2 eligibility policy, but AIEXE is **not yet authorized to cross from management proposal into autonomous A2 execution**.

The correct next move is to close evidence, live-observation and S8-baseline gates, not to create a second orchestration path or force AIEXE plumbing into every Domain OS.

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

Before raising authority from A1 `propose` to A2 `execute bounded`, the replay set should contain materially broader evidence across clean continue cases, owner conflicts, stale/exact-head mismatch, validation failures and recovery, policy blocks, duplicate shared-capability cases, ambiguous evidence, false-positive escalations and missed-escalation adversarial cases.

Status:

```text
BLOCKED
```

## Gate 3 — real project-owned controller/status attestations

The earlier version of this gate incorrectly implied that TrainingOS, TradeOS and Shared Media should each add AIEXE-specific receipt producer code. That requirement is superseded.

Current domain operating rules make that dependency undesirable:

- TradeOS rejects infrastructure expansion that does not remove a current product critical-path blocker.
- Video Operation rejects new orchestration/receipt framework work while M10 human review remains the earliest business blocker.
- TrainingOS requires shared infrastructure to remain bounded and non-duplicative.

AIEXE now owns:

```text
aiexe.external-controller-attestation.v1
-> aiexe.domain-controller-receipt.v1
```

Each managed project only needs a real project-owned controller or canonical status source capable of emitting explicit structured attestation fields for the exact observed head. No Domain OS repository code change is required.

The attestation must be explicit; AIEXE may not infer domain status from GitHub activity or unstructured prose.

Current state:

```text
consumer/adapter contract                     IMPLEMENTED
domain repository plumbing requirement        REMOVED
recurring real attestations from all projects NOT YET PROVEN
```

Status:

```text
PARTIAL / BLOCKED FOR M3
```

## Gate 4 — A2 action allow-set and policy envelope

M2.2 now implements an executable eligibility policy:

```text
aiexe.a2-management-action-policy.v1
aiexe.a2-management-action-eligibility.v1
```

Initial allow-set:

```text
collect_project_status
prepare_non_binding_plan
request_controller_attestation
request_existing_ci_validation
run_approved_test_profile
schedule_preapproved_bounded_work
```

Mechanically forbidden from A2:

```text
credential_grant_or_write
deploy
domain_truth_mutation
external_contractual_commitment
human_impersonation
merge
payment
policy_widening
production_mutation
```

Eligibility requires explicit policy preapproval, evidence, canonical `package@semver` capability references where applicable, and an existing approval reference for preapproved bounded work scheduling.

Every positive eligibility result still fixes:

```text
binding = false
executionAuthorized = false
delegationCreated = false
humanGateDecisionCreated = false
domainWritePerformed = false
```

So the action taxonomy and policy contract are implemented, but end-to-end execution proof through an accepted S8 baseline does not yet exist.

Status:

```text
PARTIAL / BLOCKED FOR M3
```

## Gate 5 — live read-only management observation cycle

M2.1 implements the canonical composition cycle:

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

So the contract/composition portion is implemented, but there is still no accepted live scheduled/provider-backed runner that periodically supplies current observations and attestations.

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
G4 A2 policy proven through accepted execution path   PASS
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
ManagementProposal != A2 eligibility
A2 eligibility != DelegationPolicy
A2 eligibility != HumanGate approval
A2 eligibility != Capability grant
A2 eligibility != Domain write authority
```

M3 must preserve those separations mechanically.

## Non-overlapping work that may continue before M3

While M3 is blocked, the following work is safe and useful without touching S8 ownership or Domain OS product paths:

1. expand the evidence-linked M2 replay corpus;
2. standardize controller/automation output to the external attestation fields without adding Domain OS runtime frameworks;
3. connect an authorized read-only provider runner to the M2.1 observation-cycle contract;
4. test the A2 policy against broader replay and adversarial cases without executing actions;
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
