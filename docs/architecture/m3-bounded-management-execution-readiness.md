# M3 Bounded Management Execution — Readiness Gate

Date: 2026-08-09  
Parent: `docs/architecture/m2-workstream-scoped-attention.md`  
Implementation owner for this readiness note: PR #125 only  
Execution owner: not created

## Verdict

```text
BLOCKED
```

M0-M2.5 provide a credible read-only management foundation, a non-binding A2 eligibility policy, real exact-head attestation temporal evidence, workstream-scoped attention and an explicitly simulated adversarial replay corpus. AIEXE is still **not authorized to cross from management proposal into autonomous A2 execution**.

S8 controlled delegation is now an accepted runtime baseline. The remaining work is to close replay/evaluation, recurring Controller-attestation, A2 end-to-end proof and live read-only observation gates without creating a second orchestration path or forcing AIEXE plumbing into every Domain OS.

## Gate 1 — accepted S8 controlled-delegation runtime baseline

The unique controlled-delegation integration path is in `main` through PR #122 and bounded S8 repairs. No second S8 owner is required or permitted.

Accepted product path:

```text
PR #122  S8-I controlled delegation integration     MERGED
PR #128  Electron product-root authority repair      MERGED
PR #130  persistent destination-gate explanation     MERGED
```

Final frozen S8-F product head:

```text
7fdf410e009ea5a1f25bc03dea3b2e54a83c9d48
```

Authoritative acceptance:

```text
S0 source validation run 31320581931                   SUCCESS
S8 native two-instance acceptance run 31320581924      SUCCESS
native artifact 9040050861
native artifact digest sha256:3e8c244baaab227fd200aa831e9c1e54e48c024596d24430db9f1ffb9157034f
source artifact 9040039600
source artifact digest sha256:45f1d7e6f70b79b4d76c07e28083ddffc4a306cf56b2c2fca0abc64b853a0c21
```

The native Apple Silicon matrix validated the exact frozen product, two independent real Electron instances, Google Chrome + Playwright Chromium, bilateral policy, destination-local admission/HumanGate sovereignty, exact-one execution binding/idempotency, receipt/cancellation/restart boundaries, zero automatic network replay, privacy-safe artifacts and zero residual scoped processes. Independent post-run verification rechecked `SHA256SUMS.txt`, found zero forbidden sensitive fields/strings in JSON/JSONL evidence, and visually rechecked both instances before/after restart.

QA carrier PR #129 was closed unmerged after recording the final verdict. Issue #115 was closed `completed` with final verdict:

```text
S8 = GO
```

M3 must reuse this accepted path. The S8 GO does not grant payment, production deployment, credential forwarding, remote Worker control or remote HumanGate authority.

Status:

```text
PASS
```

## Gate 2 — broader replay/evaluation evidence

The original evidence-linked historical replay corpus contains six project-level cases and reproduces all six manual labels.

M2.3 added a real workstream evidence set. M2.4 corrected a truth-boundary defect exposed by that set:

```text
complete != active safe capacity
observed workstreams != complete decision scope
```

The corrected real-workstream replay is:

```text
TrainingOS                     -> ESCALATE incomplete decision scope; no project-wide pause
TradeOS                        -> REPRIORITIZE around blocked N2; active BusinessChannel can continue
Video Operation / Shared Media -> PAUSE current critical path only because decision scope is explicit and complete
```

M2.5 adds an explicitly labelled simulation corpus:

```text
schema = aiexe.management-adversarial-replay.v1
evidenceClass = SIMULATED
cases = 11
```

The adversarial cases cover:

- explicit owner conflict;
- exact-head stale attestation and exact-head recovery;
- duplicate/conflicting Controller attestations;
- critical blocked work plus independent active safe work;
- held work with incomplete decision scope;
- held work with explicitly complete decision scope;
- unknown workstream truth;
- forbidden A2 merge;
- policy-eligible but still non-binding approved test execution;
- scheduling without an existing approval reference.

This strengthens deterministic failure-mode coverage and explicitly measures false/missed escalation for the workstream adversaries. It does **not** convert simulated cases into real project history and therefore does not, by itself, prove general management quality.

Remaining evidence gaps include:

- more real owner-conflict / duplicate-owner episodes;
- real stale/recovery sequences from multiple projects;
- policy blocks and duplicate shared-capability episodes;
- ambiguous/conflicting real Controller sources;
- false-positive escalation and false project-wide pause measured over a larger labelled set;
- missed escalation adversarial and real cases;
- recovery after blockers clear in real workstreams;
- independent parallel work becoming newly unsafe;
- incorrect or stale decision-scope completeness claims from real Controller output.

Status:

```text
PARTIAL / BLOCKED FOR M3
adversarial simulation coverage = EXPANDED
real replay breadth = INSUFFICIENT FOR PASS
```

## Gate 3 — real project-owned controller/status attestations

Domain OS repositories do not need AIEXE-specific receipt producer code.

AIEXE owns:

```text
aiexe.external-controller-attestation.v1
-> aiexe.domain-controller-receipt.v1
```

Each managed project only needs a real project-owned controller or canonical status source capable of emitting explicit structured attestation fields for the exact observed head. The attestation must be explicit; AIEXE may not infer domain status from GitHub activity or unstructured prose.

The current executable temporal sample uses the Video Operation handoff:

```text
handoff exact head = 0eb4a4ee1bdf27567edc4e2c6cf2dd6a5daa3a42
M10 human review = blocked
```

At that exact observed head the attestation is accepted. After the repository advances to a newer head, the same old handoff becomes non-authoritative:

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

An accepted S8 runtime path now exists, but the management A2 policy has not yet been proven end-to-end through that path. S8 acceptance is a prerequisite, not implicit A2 execution authorization.

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

M2.4 extends the decision model beneath a project:

```text
project truth
+ explicit workstream facts
+ explicit decision-scope completeness
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

There is still no accepted live scheduled/provider-backed runner periodically supplying observations, Controller attestations, workstream facts and scope-completeness evidence.

Status:

```text
PARTIAL / BLOCKED FOR M3
```

## Required M3 entry package

Current gate state:

```text
G1 final S8-F controlled-delegation runtime acceptance  PASS
G2 broader replay/evaluation acceptance                 PARTIAL
G3 recurring real controller attestations               PARTIAL
G4 A2 policy proven through accepted execution path      PARTIAL
G5 live provider-backed read-only observation cycle      PARTIAL
```

M3 may start only when all five gates are `PASS`.

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
+ explicit decision-scope completeness
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
Complete != Active
Observed != CompleteScope
ManagementProposal != A2 eligibility
A2 eligibility != DelegationPolicy
A2 eligibility != HumanGate approval
A2 eligibility != Capability grant
A2 eligibility != Domain write authority
```

A `reprioritize` proposal means only: contain explicitly blocked workstreams and prefer already-authorized **active** safe work. It does not schedule, delegate, create or approve work.

An `escalate` caused by incomplete decision scope means AIEXE lacks evidence to choose between project-wide pause and continued work. It must not guess either direction.

## Non-overlapping work that may continue before M3

1. broaden project-level and workstream-level real replay;
2. standardize recurring Controller/automation output to explicit attestation and decision-scope fields without adding Domain OS runtime frameworks;
3. connect an authorized read-only provider runner to the observation-cycle contract;
4. measure false escalation, false project-wide pause and missed escalation;
5. test A2 policy against broader replay without executing actions;
6. build the read-only owner cockpit around workstream-aware outputs.

## Exit condition

This note should be superseded only when all five M3 gates have exact evidence.

## Boundary

```text
S8 files changed = NO
second S8 owner = NO
A2 execution enabled = NO
Domain OS receipt framework added = NO
Domain OS changes = NO
Domain writes = NO
Deploy = NO
Production mutation = NO
```
