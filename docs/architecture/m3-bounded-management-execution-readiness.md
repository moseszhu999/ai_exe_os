# M3 Bounded Management Execution — Readiness Gate

Date: 2026-08-10 JST  
Implementation owner: PR #125 only  
Execution owner: not created

## Verdict

```text
BLOCKED
```

The Group Management Plane remains **observe-and-propose**. M3 starts only when every gate below is `PASS`; no earlier gate implicitly authorizes A2 execution.

```text
G1 final S8-F controlled-delegation runtime acceptance   PASS
G2 broader real replay / evaluation                      PASS
G3 recurring real structured Controller attestations     PARTIAL
G4 A2 policy through accepted execution path              PARTIAL
G5 recurring provider-backed read-only ingestion          PASS
```

Current blockers are **G3 and G4**.

---

## Gate 1 — accepted S8 controlled-delegation runtime baseline

Frozen accepted S8 product head:

```text
7fdf410e009ea5a1f25bc03dea3b2e54a83c9d48
```

Authoritative acceptance:

```text
S0 source run 31320581931                    SUCCESS
S8 native two-instance run 31320581924       SUCCESS
native artifact 9040050861
sha256:3e8c244baaab227fd200aa831e9c1e54e48c024596d24430db9f1ffb9157034f
source artifact 9040039600
sha256:45f1d7e6f70b79b4d76c07e28083ddffc4a306cf56b2c2fca0abc64b853a0c21
Issue #115                                    CLOSED / completed / GO
QA carrier #129                              CLOSED UNMERGED
```

S8 proves controlled delegation only. Destination-local admission and HumanGate remain authoritative.

```text
G1 = PASS
```

---

## Gate 2 — broader real replay / evaluation evidence

Evidence classes remain separated:

```text
historical project-level real replay     6 labelled cases
real workstream replay                    3 project scenarios
M2.12 real transition replay             10 cases
SIMULATED adversarial replay              11 cases
```

M2.12 closes the previously named real-evidence gaps:

```text
owner conflict
stale -> recovery
policy block
false project-wide pause
false / missed escalation
recovery after blocker clear
```

Representative real transition pairs:

```text
TrainingOS #576
  stale old exact-head evidence -> ESCALATE
  repaired-head merge recovery  -> CONTINUE

TradeOS #647
  Production-autodeploy policy block -> PAUSE
  release-decoupled merge recovery   -> CONTINUE

TrainingOS #476 / #480
  owner conflict              -> PAUSE
  owner-safe latest-main rebuild -> CONTINUE
```

Provider-churn cases for TrainingOS, TradeOS and Video/Media all require `ESCALATE` when canonical Controller truth is absent and must not invent project-wide `PAUSE`.

M2.12 result:

```text
real cases          10
exact matches       10
false escalations   0
missed escalations  0
recovery pairs      3
```

The adversarial corpus remains explicitly `SIMULATED` and is not counted as real history. A newly observed real failure may reopen this gate.

```text
G2 = PASS
```

---

## Gate 3 — recurring real structured Controller attestations

### Canonical consumer contract

AIEXE accepts Domain truth only through the existing deterministic chain:

```text
aiexe.controller-adoption-source.v1
-> aiexe.external-controller-attestation-envelope.v1
-> aiexe.external-controller-attestation.v1
-> aiexe.domain-controller-receipt.v1
```

A promotable source requires one marked JSON envelope, an independently verified exact-body SHA-256 digest, a current exact repository head, supported fields only and valid freshness. Surrounding prose is non-authoritative. LLM fact extraction is forbidden.

### AIEXE current-head sample repaired in M2.13

The old M2.7 AIEXE sample correctly became stale after `main` advanced. M2.13 published a new AIEXE-only out-of-band sample on PR #125:

```text
comment       5236728435
exactHeadSha  dce842e6874e6842b461cd4b5958df577608da94
sourceDigest  sha256:e4120c3bac66cf45f9c8d4ef20923f318f004278dcd3447e9c716adacb337715
```

The exact comment body was independently read back and re-hashed. The comment transport does not mutate `main`, so this repairs the AIEXE-side current structured sample only.

It does **not** count as one of the three external Domain adoptions.

### External adoption remains 0 / 3

Fresh read-only provider heads observed in M2.13:

```text
TrainingOS   8f0d38dca4dcd28883359c427e133d0c1a9eebb8
TradeOS      6958c3b5fb3a8d8b6b70b7a614910b0e1ea9202b
Video/Media  23d92ffc4674f1581c4191e595d279a20008be53
```

Direct repository searches still found no external occurrence of:

```text
aiexe.external-controller-attestation.v1
aiexe.controller-adoption-source.v1
```

TrainingOS Controller register Issue #477 and TradeOS Controller register Issue #567 also contain no canonical marker. A bounded Video/Media Controller issue search found no current out-of-band Controller register.

```text
external Domain projects             3
group integration substrate ready    3 / 3
structured Controller adoption       0 / 3
```

### M2.13 producer-readiness decomposition

M2.13 adds a complementary, read-only topology classifier:

```text
aiexe.controller-producer-readiness.v1
```

It does not create another attestation protocol and does not parse Controller prose into Domain facts. It only explains why a canonical producer source is still absent.

Real observed producer topology:

```text
TrainingOS
  scheduler observed/enabled     true / true
  latest observed run            2026-08-10T06:08:29Z
  structured producer contract   missing
  out-of-band persistence        observed via Issue #477
  state                          ACTIVE_STRUCTURED_CONTRACT_MISSING

TradeOS
  scheduler observed/enabled     true / false
  latest observed run            2026-08-09T11:04:45Z
  structured producer contract   missing
  out-of-band persistence        observed via Issue #567
  state                          PRODUCER_DISABLED

Video / Shared Media
  scheduler observed/enabled     true / true
  latest observed run            2026-08-10T05:39:12Z
  structured producer contract   missing
  out-of-band Controller channel not observed
  state                          ACTIVE_CONTRACT_AND_PERSISTENCE_MISSING
```

Summary:

```text
enabled producer schedulers              2 / 3
disabled producer schedulers             1 / 3
structured producer contract missing     3 / 3
out-of-band persistence missing           1 / 3
recurring structured producers proven    0 / 3
```

Scheduler state is not Domain status. Prompt presence is not Domain truth. A disabled scheduler does not mean a Domain is paused. An enabled scheduler does not mean structured adoption exists.

Shortest real path to G3 closure:

```text
TrainingOS
  adopt the canonical marked envelope in the existing recurring Controller output

TradeOS
  separately resolve whether the disabled Controller should run;
  if it runs, adopt the canonical marked envelope

Video / Shared Media
  establish an out-of-band Controller persistence source;
  adopt the canonical marked envelope
```

AIEXE must not manufacture those Domain facts or mutate external Controller state on their behalf.

```text
G3 = PARTIAL / BLOCKED FOR M3
```

---

## Gate 4 — A2 action allow-set and accepted execution path

M2.2 defines:

```text
aiexe.a2-management-action-policy.v1
aiexe.a2-management-action-eligibility.v1
```

The allow-set remains narrow: read, plan, bounded approved-test and explicit preapproved-work candidates. Consequential actions remain mechanically denied, including:

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

Every positive eligibility result remains non-binding:

```text
binding = false
executionAuthorized = false
delegationCreated = false
humanGateDecisionCreated = false
domainWritePerformed = false
```

G1 proves the accepted S8 delegation runtime path exists. G2 proves bounded decision evaluation against broader real transitions. G5 proves recurring read-only provider ingestion. None substitutes for current structured Domain Controller truth.

G4 remains deliberately downstream of G3. No A2 execution-path proof may treat GitHub activity, scheduler state or human-readable Controller prose as Domain truth.

```text
G4 = PARTIAL / BLOCKED FOR M3
```

---

## Gate 5 — recurring provider-backed read-only ingestion

The existing native AIEXE hourly scheduler is reused:

```text
timezone = Asia/Shanghai
cadence  = HOURLY
minute   = 48
mode     = exact_schedule
provider-ingestion binding = enabled
second scheduler created   = false
```

Canonical successful scheduled evidence includes:

```text
run #1
scheduledFor   2026-08-10T00:48:00Z
captureDigest  sha256:1327d8ca484ff84c18047ad57450d6797fe20e9c2b856711c340d4db31d72134
sourceComment  #5234770351

run #2
scheduledFor   2026-08-10T01:48:00Z
captureDigest  sha256:08bca95c1e45bc747b88cc9087e0dab5a9c643a701cc06ffea65b7e1eaba389e
sourceComment  #5235050986
```

The two capture digests are distinct and scheduled times are 3600 seconds apart. The second receipt contains canonical recurring evidence with `recurringIngestionProven=true`. A later successful receipt was also observed at `2026-08-10T04:48:00Z`.

No `02:48Z` receipt was found in the independent readback. The gap is recorded honestly; the v1 gate requires multiple distinct spaced successful scheduled captures rather than perfect every-hour delivery.

Independent G5 closure receipt:

```text
PR #125 comment #5236243699
```

No cross-repository credentials or Domain write path were added.

```text
G5 = PASS
```

---

## Required M3 entry package

```text
G1 final S8-F controlled-delegation runtime acceptance  PASS
G2 broader replay/evaluation acceptance                 PASS
G3 recurring real structured Controller attestations   PARTIAL
G4 A2 policy proven through accepted execution path     PARTIAL
G5 recurring provider-backed read-only ingestion        PASS
```

If any gate is not `PASS`:

```text
managementAuthority = observe-and-propose
A2 execution = blocked
```

Therefore M3 remains blocked on **G3 and G4**.

## Target execution chain after all gates close

```text
External source facts
+ current exact-head structured Controller attestation
+ explicit workstream facts / decision-scope completeness
        |
        v
AIEXE canonical Domain Controller Receipt
        |
        v
Portfolio + Workstream Attention
        |
        v
Evidence-backed ManagementProposal (A1)
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
receipt/evidence
        |
        v
next read-only observation
```

## Authority principles

```text
WorkstreamPause != ProjectPause
Complete != Active
Observed != CompleteScope
GitHubActivity != DomainStatus
GroupAdapter != ControllerAdoption
SchedulerEnabled != DomainActive
SchedulerDisabled != DomainPaused
PromptContract != DomainTruth
HumanReadableControllerProse != CanonicalAttestation
RepoContainedReceipt != CurrentExactHeadReceipt
ManagementProposal != A2 eligibility
A2 eligibility != DelegationPolicy
A2 eligibility != HumanGate approval
A2 eligibility != Capability grant
A2 eligibility != Domain write authority
G2 PASS != A2 authorization
G5 PASS != Domain truth authority
```

## Non-overlapping work allowed before M3

1. continue read-only observation of external Controller adoption;
2. provide the canonical adoption contract/template from AIEXE without creating second Domain Controller frameworks;
3. observe producer topology without mutating external scheduler configuration;
4. continue recurring authorized read-only provider ingestion and record gaps honestly;
5. add newly observed real decision failures to the G2 replay ledger and reopen G2 if needed;
6. test A2 policy mechanically without executing actions;
7. maintain the bounded read-only owner cockpit.

## Boundary

```text
S8 product files changed = NO
second S8 owner = NO
A2 execution enabled = NO
external Domain receipt framework added = NO
external Domain repository changes/comments = NO
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
