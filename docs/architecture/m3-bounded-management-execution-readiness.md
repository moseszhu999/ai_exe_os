# M3 Bounded Management Execution — Readiness Gate

Date: 2026-08-09  
Parent: `docs/architecture/m2-workstream-scoped-attention.md`  
Implementation owner for this readiness note: PR #125 only  
Execution owner: not created

## Verdict

```text
BLOCKED
```

M0-M2.3 provide a credible read-only management foundation, a non-binding A2 eligibility policy, real exact-head attestation temporal evidence and workstream-scoped attention. AIEXE is still **not authorized to cross from management proposal into autonomous A2 execution**.

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

## Gate 2 — broader replay evidence

The original evidence-linked historical replay corpus contains six project-level cases and reproduces all six manual labels.

M2.3 now adds a second real evidence set captured from the current portfolio:

```text
TrainingOS                     -> REPRIORITIZE, not project-wide pause
TradeOS                        -> REPRIORITIZE, not project-wide pause
Video Operation / Shared Media -> PAUSE current critical path
```

The fixture contains eight explicitly evidenced workstreams across the three projects and tests the distinction:

```text
WorkstreamPause != ProjectPause
```

This materially improves the replay base because it exercises the false-project-pause failure mode that the original project-only engine could not represent.

It still does **not** prove general management quality. More replay is required for:

- owner conflicts and duplicate owners;
- exact-head stale/recovery sequences;
- policy blocks and duplicate shared capabilities;
- ambiguous/conflicting Controller sources;
- false-positive escalation and false project-wide pause;
- missed escalation adversarial cases;
- recovery after a blocker clears;
- independent parallel work becoming newly unsafe.

Status:

```text
PARTIAL / BLOCKED FOR M3
```

## Gate 3 — real project-owned controller/status attestations

Domain OS repositories do not need AIEXE-specific receipt producer code.

AIEXE owns:

```text
aiexe.external-controller-attestation.v1
-> aiexe.domain-controller-receipt.v1
```

Each managed project only needs a real project-owned controller or canonical status source capable of emitting explicit structured attestation fields for the exact observed head. The attestation must be explicit; AIEXE may not infer domain status from GitHub activity or unstructured prose.

M2.3 adds an executable real temporal sample using the Video Operation current handoff:

```text
handoff exact head = 0eb4a4ee1bdf27567edc4e2c6cf2dd6a5daa3a42
M10 human review = blocked
```

At that exact observed head the attestation is accepted. After the repository advances through #106/#107 to:

```text
current main = e4728a0b1694bb9e89bd17f7f03bc3d3746e61e8
```

the same old handoff becomes:

```text
accepted = false
reason = exact_head_mismatch
project status = unknown
```

This is positive evidence that stale Controller truth cannot silently ride forward with newer code.

Current state:

```text
consumer/adapter contract                         IMPLEMENTED
real exact-head temporal attestation sample       IMPLEMENTED
domain repository plumbing requirement            REMOVED
recurring structured attestations from all repos  NOT YET PROVEN
```

Status:

```text
PARTIAL / BLOCKED FOR M3
```

## Gate 4 — A2 action allow-set and policy envelope

M2.2 implements:

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

The policy contract is implemented, but end-to-end proof through an accepted S8 baseline does not exist.

Status:

```text
PARTIAL / BLOCKED FOR M3
```

## Gate 5 — live read-only management observation cycle

M2.1 implements:

```text
GitHub read-only observations
+ external controller attestations
-> exact-head/freshness reconciliation
-> Portfolio
-> Attention Queue
-> Cockpit
```

M2.3 extends the decision model beneath a project:

```text
project truth
+ explicit workstream facts
-> workstream attention
-> project workstream rollup
-> continue / reprioritize / escalate / pause proposal
```

The implementation remains intentionally input-bounded:

```text
providerFetchPerformed = false
scheduledRuntimeStarted = false
writeAuthority = none
```

There is still no accepted live scheduled/provider-backed runner periodically supplying observations, Controller attestations and workstream facts.

Status:

```text
PARTIAL / BLOCKED FOR M3
```

## Required M3 entry package

M3 may start only after:

```text
G1 S8 #122 accepted baseline                         PASS
G2 broader replay/evaluation acceptance              PASS
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
+ exact-head project-owned Controller attestation
+ explicit workstream facts
        |
        v
AIEXE canonical Domain Controller Receipt
        |
        v
Observed Portfolio + Workstreams
        |
        v
Workstream Attention + Project Rollup
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

## Authority principles

```text
WorkstreamPause != ProjectPause
ManagementProposal != A2 eligibility
A2 eligibility != DelegationPolicy
A2 eligibility != HumanGate approval
A2 eligibility != Capability grant
A2 eligibility != Domain write authority
```

A `reprioritize` proposal means only: contain explicitly blocked workstreams and prefer already-authorized safe work. It does not schedule, delegate, create or approve work.

## Non-overlapping work that may continue before M3

1. broaden project-level and workstream-level replay;
2. standardize recurring Controller/automation output to explicit attestation fields without adding Domain OS runtime frameworks;
3. connect an authorized read-only provider runner to the observation-cycle contract;
4. measure false escalation, false project-wide pause and missed escalation;
5. test A2 policy against broader replay without executing actions;
6. build the read-only owner cockpit around workstream-aware outputs.

## Exit condition

This note should be superseded only when the current S8 integration owner is accepted and all five M3 gates have exact evidence.

## Boundary

```text
S8 files changed = NO
second S8 owner = NO
A2 execution enabled = NO
Domain OS receipt framework added = NO
Domain OS changes = NO
Domain writes = NO
Merge = NO
Deploy = NO
Production mutation = NO
```
