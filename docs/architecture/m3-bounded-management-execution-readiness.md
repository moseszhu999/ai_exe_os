# M3 Bounded Management Execution — Readiness Gate

Date: 2026-08-10 JST  
Implementation owner: PR #125 only  
Execution owner: not created  
Authority: observe-and-propose

## Current verdict

```text
BLOCKED
```

M3 starts only after every required gate independently reaches `PASS`. No read-only ingestion, Controller adoption, replay result, policy eligibility or delegation capability grants A2 execution by implication.

```text
G1 final S8-F controlled-delegation runtime acceptance   PASS
G2 broader real replay / evaluation                      PASS
G3 recurring real structured Controller attestations     PARTIAL
G4 A2 policy through accepted execution path              PARTIAL
G5 recurring provider-backed read-only ingestion          PASS

M3 = BLOCKED on G3 + G4
A2 execution = UNAUTHORIZED
```

---

## G1 — accepted S8 controlled-delegation runtime baseline

Frozen accepted S8 product head:

```text
7fdf410e009ea5a1f25bc03dea3b2e54a83c9d48
```

Accepted evidence includes the final S0 source validation, native two-instance controlled-delegation validation and the closed GO tracker. S8 proves the bounded delegation mechanism only. Destination-local admission and HumanGate remain authoritative.

```text
G1 = PASS
```

---

## G2 — broader real replay / evaluation

Evidence classes remain separated:

```text
historical project-level real replay     6 labelled cases
real workstream replay                    3 project scenarios
M2.12 real transition replay             10 cases
SIMULATED adversarial replay              11 cases
```

M2.12 real transition result:

```text
real cases          10
exact matches       10
false escalations   0
missed escalations  0
recovery pairs      3
```

The simulated corpus is not counted as real history. A newly observed real failure may reopen G2.

```text
G2 = PASS
```

---

## G3 — recurring real structured Controller attestations

### Canonical truth chain

AIEXE accepts external Domain truth only through:

```text
aiexe.controller-adoption-source.v1
-> aiexe.external-controller-attestation-envelope.v1
-> aiexe.external-controller-attestation.v1
-> aiexe.domain-controller-receipt.v1
```

A source requires deterministic full-body digest verification, supported marked JSON only, exact repository binding, independently observed provider head, receipt freshness and read-only/no-write-authority boundaries.

Surrounding prose is non-authoritative. LLM fact extraction is forbidden.

### M2.16 supersedes the M2.14 3/3 acceptance claim

Three real marked structured sources exist, one in each Domain-owned Controller channel:

```text
TrainingOS   Issue #477
TradeOS      Issue #567
Video/Media  Issue #115

structured source existence = 3 / 3
```

M2.14's original focused test made a truth-boundary error: it used the attestation source's own `headSha` as the provider observation head. M2.16 requires an independently observed provider head and records the result in:

```text
fixtures/management/m2-external-controller-adoption-revalidation-2026-08-10.json
```

Correct independent revalidation:

```text
TrainingOS
  attested head  8f0d38dca4dcd28883359c427e133d0c1a9eebb8
  provider main  8f0d38dca4dcd28883359c427e133d0c1a9eebb8
  result         accepted_exact_head_current

TradeOS
  attested head  6958c3b5fb3a8d8b6b70b7a614910b0e1ea9202b
  provider main  6958c3b5fb3a8d8b6b70b7a614910b0e1ea9202b
  result         accepted_exact_head_current

Video / Shared Media
  attested head  24996407449df28b2d83fce1a145b3200fff168a
  provider main  23d92ffc4674f1581c4191e595d279a20008be53
  result         exact_head_mismatch -> unknown
```

Therefore:

```text
real source existence                      3 / 3
independent first-cycle current acceptance 2 / 3
first-cycle acceptance complete             NO
```

The old `3 / 3 exact-head acceptance` statement is superseded and must not be used for G3.

### Canonical recurrence proof

M2.15 introduced:

```text
aiexe.controller-recurring-structured-proof.v1
```

A real recurring proof requires 2+ independently accepted cycles with:

```text
accepted_exact_head_current on every cycle
distinct sourceRef
distinct full-body sourceDigest
strictly increasing observedAt
same project/repository binding
readOnly = true
writeAuthority = none
```

### M2.16 proof reconstruction

M2.16 removes caller-trusted proof booleans. `aiexe.controller-producer-readiness.v1` now recomputes recurrence invariants from embedded cycle summaries and records:

```text
arbitraryEvidenceRefsCannotProveRecurrence = true
recurrenceProofRecomputedFromEmbeddedCycles = true
```

A proof-shaped object with the expected schema and top-level `true` fields but no canonical embedded cycles fails closed.

### M2.16 fixed-scope G3 gate

M2.16 adds:

```text
aiexe.controller-g3-readiness.v1
```

The required project/repository set is fixed in code:

```text
trainingos
  moseszhu999/training-learning-rails

tradeos
  moseszhu999/chaintrace-app

video-operation-shared-media
  moseszhu999/global-tool-radar
```

The caller cannot shrink the denominator or substitute repositories. G3 requires all three projects to satisfy current structured adoption, observed/enabled producer topology, structured producer contract, out-of-band persistence and canonical recurring proof.

Invalid shortcuts fail closed:

```text
2 / 2 after omitting one Domain              REJECTED
repository substitution                       REJECTED
arbitrary evidence refs                        REJECTED
proof-shaped booleans without canonical cycles REJECTED
source-attested head reused as provider truth   REJECTED
disabled producer counted as current recurrence REJECTED
```

Current real state:

```text
required external Domain set                3
real structured source existence            3 / 3
independent first-cycle current acceptance  2 / 3
verified recurring structured producers     0 / 3
G3                                            PARTIAL
```

A fresh Controller-channel scan found no second canonical marker in the three Domain channels at the M2.16 observation point. AIEXE does not manufacture the missing cycles.

```text
G3 = PARTIAL / BLOCKED FOR M3
```

---

## G4 — A2 policy through accepted execution path

The A2 policy remains deliberately non-binding. Consequential actions remain mechanically denied, including:

```text
merge
deploy
payment / settlement / wallet / token
credential write
policy widening
Domain truth mutation
Production mutation
remote Worker control
HumanGate decision
```

Even a future G3 gate result of `PASS` explicitly returns:

```text
m3EntryAuthorized = false
a2ExecutionAuthorized = false
authorityGranted = false
```

This prevents G3 truth-readiness from silently becoming execution authority. G4 must be proven separately through the accepted bounded execution path after G3 is real and current.

```text
G4 = PARTIAL / BLOCKED FOR M3
```

---

## G5 — recurring provider-backed read-only ingestion

The existing native AIEXE hourly scheduler remains the single ingestion scheduler:

```text
timezone = Asia/Shanghai
cadence  = HOURLY
minute   = 48
mode     = exact_schedule
second scheduler created = false
```

Multiple distinct spaced successful scheduled captures have already established recurring read-only provider ingestion. No cross-repository credentials or Domain write path were introduced.

```text
G5 = PASS
```

---

## M3 entry package

```text
G1  PASS
G2  PASS
G3  PARTIAL
G4  PARTIAL
G5  PASS
```

If any gate is not `PASS`:

```text
managementAuthority = observe-and-propose
A2 execution         = blocked
```

Therefore M3 remains blocked on **G3 and G4**.

## Target chain after all gates independently close

```text
independent provider facts
+ current exact-head structured Controller attestation
+ current recurring proof
        |
        v
fixed-scope G3 readiness
        |
        v
portfolio / workstream attention
        |
        v
evidence-backed ManagementProposal (A1)
        |
        v
A2 policy eligibility
        |
        v
canonical capability package@version
        |
        v
accepted S8 delegation policy
        |
        v
destination-local admission / HumanGate
        |
        v
bounded execution
        |
        v
receipt / evidence
        |
        v
next independent read-only observation
```

## Authority principles

```text
WorkstreamPause != ProjectPause
Complete != Active
Observed != CompleteScope
GitHubActivity != DomainStatus
GroupAdapter != ControllerAdoption
SourceExistence != CurrentExactHeadAcceptance
AttestedHead != IndependentProviderHead
SchedulerEnabled != DomainActive
SchedulerDisabled != DomainPaused
PromptContract != DomainTruth
HumanReadableControllerProse != CanonicalAttestation
EvidenceRefs != RecurrenceProof
ProofBooleans != CanonicalCycleReconstruction
G3 PASS != M3 entry authorization
G3 PASS != A2 execution authorization
ManagementProposal != A2 eligibility
A2 eligibility != DelegationPolicy
A2 eligibility != HumanGate approval
A2 eligibility != Capability grant
A2 eligibility != Domain write authority
G2 PASS != A2 authorization
G5 PASS != Domain truth authority
```

## Allowed work before M3

1. continue read-only observation of Domain Controller channels and independent provider heads;
2. ingest later Domain-owned canonical cycles through the existing protocol only;
3. keep recurrence proof deterministic and source/provider truth separated;
4. observe producer topology without mutating scheduler configuration;
5. continue authorized recurring read-only provider ingestion;
6. reopen G2 if new real decision failures are discovered;
7. test A2 policy mechanically without execution;
8. maintain the bounded read-only owner cockpit.

## Boundary

```text
S8 product files changed = NO
second S8 owner = NO
A2 execution enabled = NO
external Domain receipt framework added = NO
external Domain repository mutation = NO
external Domain scheduler mutation = NO
LLM prose-to-truth extraction = NO
cross-repository credentials added = NO
Domain writes = NO
Merge PR #125 = NO while gated
Deploy = NO
Production mutation = NO
Payment / settlement / wallet / token action = NO
remote Worker control = NO
HumanGate decision = NO
```
