# M3 Bounded Management Execution — Readiness Gate

Date: 2026-08-10 JST  
Implementation owner: PR #125 only  
Execution owner: not created  
Authority: observe-and-propose

## Current verdict

```text
G1 final S8-F controlled-delegation runtime acceptance   PASS
G2 broader real replay / evaluation                      PASS
G3 recurring real structured Controller attestations     PARTIAL
G4 A2 policy through accepted execution path              PARTIAL
G5 recurring provider-backed read-only ingestion          PASS

M3 = BLOCKED on G3 + G4
A2 execution = UNAUTHORIZED
```

M3 starts only after every required gate independently reaches `PASS`. Controller adoption, recurrence evidence, policy eligibility, provider ingestion, or delegation capability never grants execution authority by implication.

---

## G1 — accepted S8 controlled-delegation runtime baseline

Frozen accepted S8 product head:

```text
7fdf410e009ea5a1f25bc03dea3b2e54a83c9d48
```

S8 proves the bounded delegation mechanism only. Destination-local admission and HumanGate remain authoritative.

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

AIEXE accepts external Domain truth only through the bounded structured chain:

```text
aiexe.controller-adoption-source.v1
-> aiexe.external-controller-attestation-envelope.v1
-> aiexe.external-controller-attestation.v1
-> aiexe.domain-controller-receipt.v1
```

Promotion requires deterministic full-body digest verification, supported marked JSON only, exact repository binding, independently observed provider head, freshness, `readOnly=true`, and `writeAuthority=none`.

Surrounding prose is non-authoritative. LLM fact extraction is forbidden.

### Historical correction: M2.16 supersedes the original M2.14 acceptance claim

Three Domain-owned Controller channels contain real canonical marked sources:

```text
TrainingOS   Issue #477
TradeOS      Issue #567
Video/Media  Issue #115
```

M2.14 originally reused an attestation's own `headSha` as provider truth. M2.16 corrected that self-validation error by requiring an independently observed provider head. Its first-cycle revalidation was:

```text
TrainingOS   accepted_exact_head_current
TradeOS      accepted_exact_head_current
Video/Media  exact_head_mismatch -> unknown

first-cycle independent current acceptance = 2 / 3
```

The old `3 / 3 exact-head acceptance` statement remains withdrawn.

### M2.17 — second real Domain cycle

M2.17 ingested a later Domain-owned canonical cycle for all three external Domains and independently revalidated each attested head against provider `main`:

```text
TrainingOS
  current accepted head  8f0d38dca4dcd28883359c427e133d0c1a9eebb8
  accepted cycles        2
  canonical recurrence   YES

TradeOS
  current accepted head  6958c3b5fb3a8d8b6b70b7a614910b0e1ea9202b
  accepted cycles        2
  canonical recurrence   YES (historical proof)

Video / Shared Media
  current accepted head  23d92ffc4674f1581c4191e595d279a20008be53
  accepted cycles        1
  canonical recurrence   NO
```

Video's later cycle repairs current-head structured adoption but does not retroactively turn its stale first source into an accepted cycle.

Therefore current structured Controller adoption is now:

```text
structured adoption = 3 / 3
```

This is necessary but not sufficient for G3.

### Canonical recurrence proof

`aiexe.controller-recurring-structured-proof.v1` requires 2+ independently accepted cycles with:

```text
accepted_exact_head_current on every cycle
distinct sourceRef
distinct full-body sourceDigest
strictly increasing observedAt
same project/repository binding
readOnly = true
writeAuthority = none
```

`aiexe.controller-producer-readiness.v1` recomputes these invariants from embedded canonical cycle summaries. Arbitrary evidence refs or proof-shaped booleans cannot prove recurrence.

### Fixed three-Domain producer gate

`aiexe.controller-g3-readiness.v1` fixes the required Domain set in code:

```text
trainingos                    moseszhu999/training-learning-rails
tradeos                       moseszhu999/chaintrace-app
video-operation-shared-media  moseszhu999/global-tool-radar
```

The caller cannot shrink the denominator or substitute repositories. G3 requires all three Domains to have:

```text
current structured adoption
observed + enabled producer topology
structured producer contract
out-of-band persistence
canonical recurring proof
```

### M2.18 — current producer topology snapshot

M2.18 rechecked all three M2.17 provider heads against current `main`; each comparison was `identical` at the observation point. It also refreshed the native task topology without mutating any scheduler.

Canonical evidence:

```text
fixtures/management/m2-controller-producer-readiness-current-2026-08-10.json
tests/m2-controller-producer-readiness-current-topology.test.cjs
```

Current producer truth:

```text
required external Domains        3
structured adoption              3 / 3
enabled producers                2
  TrainingOS                     enabled
  Video/Media                    enabled
disabled producers               1
  TradeOS                        disabled
structured producer contracts    0 / 3 observed
contractMissingCount             3
out-of-band persistence          3 / 3 observed
persistenceMissingCount          0
current recurring producers      0 / 3
```

Important interpretation:

- TrainingOS has two accepted canonical cycles, but the currently observed native producer itself does not yet prove the structured producer contract required to promote that recurrence into current producer readiness.
- TradeOS also has two accepted canonical cycles, but its currently observed producer is disabled and its structured producer contract is unproven.
- Video/Shared Media now has an out-of-band persistence channel and an enabled producer, so the old persistence gap is closed; it still lacks both a proved structured producer contract and a second independently accepted current cycle.

Thus M2.18 closes only the old Video persistence blocker. It does **not** close G3.

```text
G3 = PARTIAL / BLOCKED FOR M3
```

### Shortest real G3 path

No AIEXE-side synthetic receipt can close these gaps. The remaining evidence must come from the Domain-owned producer path:

```text
1. each Domain producer binds to and proves the canonical structured producer contract
2. TradeOS has a current enabled Domain-owned producer
3. Video/Media emits a later independent canonical accepted cycle
4. AIEXE independently revalidates each provider head and reconstructs recurrence
5. fixed-scope G3 recomputes 3 / 3 current recurring producer readiness
```

External scheduler or Domain mutations remain outside this PR's authority.

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

Even a future G3 result of `PASS` explicitly keeps:

```text
m3EntryAuthorized = false
a2ExecutionAuthorized = false
authorityGranted = false
```

G4 must be proven separately through the accepted bounded execution path after G3 is real and current.

```text
G4 = PARTIAL / BLOCKED FOR M3
```

---

## G5 — recurring provider-backed read-only ingestion

The existing native AIEXE hourly scheduler remains the single ingestion scheduler. Multiple distinct spaced successful scheduled captures have established recurring read-only provider ingestion. No cross-repository credential or Domain write path is introduced by this gate.

```text
G5 = PASS
```

---

## M2.18 validation evidence and terminology correction

The pull-request validation after the M2.18 fixture/test change completed successfully:

```text
workflow run                 31377434383
job                          93419778855
source syntax                PASS
tests                        537 / 537 PASS
M2.18 focused regression     PASS
provider boundary scan       PASS
GITHUB_TOKEN                 Contents: read; Metadata: read
```

Validation terminology is intentionally precise. The `pull_request` workflow checked out the PR merge ref:

```text
merge ref  4c2fe8c97345e3c80dda8bd27afe886c7368c5b0
           = merge(0e47afcf7b59a2192b66a355cb217688306c2fd0
                   into dce842e6874e6842b461cd4b5958df577608da94)
```

Therefore this run is **head-bound PR merge-ref validation**, not standalone branch-head checkout validation. Any earlier wording that called this style of run "exact-head CI" must not be reused without an actual branch-head checkout proof.

The correction changes evidence terminology, not the observed fact that the M2.18 tree passed the PR validation suite.

---

## M3 entry package

```text
G1  PASS
G2  PASS
G3  PARTIAL
G4  PARTIAL
G5  PASS

M3                  BLOCKED
managementAuthority observe-and-propose
A2 execution         blocked
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
HistoricalRecurrence != CurrentProducerReadiness
PersistenceObserved != StructuredProducerContract
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
3. observe producer topology without mutating scheduler configuration;
4. recompute canonical recurrence only from independently accepted cycles;
5. continue authorized recurring read-only provider ingestion;
6. reopen G2 if new real decision failures are discovered;
7. test A2 policy mechanically without execution;
8. maintain the bounded read-only owner cockpit.

## Boundary

```text
S8 product files changed = NO
second S8 owner = NO
A2 execution enabled = NO
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
