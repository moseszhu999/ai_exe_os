# M3 Bounded Management Execution — Readiness Gate

Date: 2026-08-10 JST  
Implementation owner: PR #125 only  
Execution owner: not created

## Verdict

```text
BLOCKED
```

The Group Management Plane remains **observe-and-propose**. M3 starts only when every gate below is `PASS`; no earlier gate implicitly authorizes A2 execution.

Current gate matrix:

```text
G1 final S8-F controlled-delegation runtime acceptance   PASS
G2 broader real replay / evaluation                      PASS
G3 recurring real structured Controller attestations     PARTIAL
G4 A2 policy through accepted execution path              PARTIAL
G5 recurring provider-backed read-only ingestion          PASS
```

Current blockers for M3 are **G3 and G4**.

---

## Gate 1 — accepted S8 controlled-delegation runtime baseline

Accepted product path:

```text
PR #122  S8-I controlled delegation integration     MERGED
PR #128  Electron product-root authority repair      MERGED
PR #130  persistent destination-gate explanation     MERGED
```

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

S8 proves controlled delegation only. Destination-local admission and HumanGate remain authoritative. S8 does not grant payment, deployment, credential forwarding, remote Worker control or remote HumanGate authority.

Status:

```text
PASS
```

---

## Gate 2 — broader real replay / evaluation evidence

Earlier evidence remains separated by class:

```text
historical project-level real replay     6 labelled cases
real workstream replay                    3 project scenarios
SIMULATED adversarial replay              11 cases
```

The initial real corpus left explicit gaps in:

```text
owner conflict
stale -> recovery
policy block
false project-wide pause
false / missed escalation
recovery after blocker clear
```

M2.12 adds:

```text
fixtures/management/m2-real-transition-replay-2026-08-10.json
schema        = aiexe.real-transition-replay.v1
evidenceClass = REAL_HISTORICAL_AND_PROVIDER_TRANSITION
real cases    = 10
```

Real transition coverage includes:

```text
TrainingOS PR #576   stale exact-head evidence -> repaired-head recovery
TradeOS PR #647      Production-autodeploy policy block -> release-decoupled recovery
TrainingOS #476/#480 route-owner conflict -> latest-main owner-safe rebuild recovery
TrainingOS live      provider churn + no canonical Controller -> ESCALATE, not project PAUSE
TradeOS live         provider churn + no canonical Controller -> ESCALATE, not project PAUSE
Video/Media live     provider churn + no canonical Controller -> ESCALATE, not project PAUSE
AIEXE live           old structured receipt exact-head mismatch -> ESCALATE
```

Exact replay acceptance:

```text
run                    31358930299  SUCCESS
job                    93363772751  SUCCESS
PR merge-ref            9a5374948a9cf1a186ef2276d9dddf92bae76a07
Source syntax check      PASS
tests                    511 / 511 PASS
Provider boundary scan   PASS

M2.12 real cases         10
exact matches            10
false escalations        0
missed escalations       0
recovery pairs           3
provider unknown cases   3 / 3 ESCALATE without false project-wide PAUSE
```

The 11 adversarial cases remain explicitly `SIMULATED`; they are not counted as real history. The named real-evidence gaps that previously blocked G2 are now covered across multiple projects. The acceptance rationale is recorded in `docs/architecture/m2-real-transition-replay-acceptance.md`.

This is bounded evaluation acceptance, not a universal-accuracy claim. A newly observed real failure may reopen G2.

Status:

```text
PASS
```

---

## Gate 3 — recurring real structured Controller attestations

AIEXE owns the consumer-side contract:

```text
aiexe.external-controller-attestation.v1
-> aiexe.domain-controller-receipt.v1
```

M2.7 established the canonical out-of-band envelope:

```text
aiexe.external-controller-attestation-envelope.v1
```

A same-main receipt cannot be treated as current exact-head truth because publishing the receipt advances the same git head. Current attestations therefore require a non-head-mutating transport such as a coordinator PR/Issue comment or equivalent receipt store.

The first real AIEXE structured sample on PR #125 proved the transport and parser, but it attests S8 main:

```text
7fdf410e009ea5a1f25bc03dea3b2e54a83c9d48
```

while current AIEXE provider main is:

```text
dce842e6874e6842b461cd4b5958df577608da94
```

so that old sample is now correctly **stale / non-promotable**.

Current external adoption truth after the M2.11/M2.12 read-only audit:

```text
TrainingOS    group integration substrate ready   structured Controller adoption NO
TradeOS       group integration substrate ready   structured Controller adoption NO
Video/Media   group integration substrate ready   structured Controller adoption NO

external group integration substrate = 3 / 3
external structured Controller adoption = 0 / 3
```

Direct current searches found no external occurrence of:

```text
aiexe.external-controller-attestation.v1
aiexe.controller-adoption-source.v1
```

TrainingOS Controller register Issue #477 and TradeOS Controller register Issue #567 also contain no canonical structured marker. Human-readable Controller prose, repository activity and group adapter names remain non-authoritative.

Status:

```text
PARTIAL / BLOCKED FOR M3
```

---

## Gate 4 — A2 action allow-set and accepted execution path

M2.2 defines:

```text
aiexe.a2-management-action-policy.v1
aiexe.a2-management-action-eligibility.v1
```

The allow-set remains deliberately narrow: read, plan, bounded approved-test and explicit preapproved-work candidates. Consequential actions remain mechanically denied, including:

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

G1 proves the accepted S8 delegation runtime path exists. G2 proves the attention/evaluation layer against broader real transitions. G5 proves recurring read-only provider ingestion. None of those facts prove management A2 end-to-end execution.

G4 remains deliberately blocked while G3 has no recurring current structured Domain Controller adoption. A2 must not use GitHub activity as a substitute for Domain truth just because the transport and evaluation layers are now green.

Status:

```text
PARTIAL / BLOCKED FOR M3
```

---

## Gate 5 — recurring provider-backed read-only ingestion

M2.10 reused the existing native AIEXE hourly scheduler rather than creating a second scheduler:

```text
timezone = Asia/Shanghai
cadence  = HOURLY
minute   = 48
mode     = exact_schedule
provider-ingestion binding = enabled
```

The provider-ingestion contract requires a coherent canonical:

```text
aiexe.live-github-observation-capture.v1
```

and persists out-of-band scheduled receipts rather than modifying Domain repositories.

Post-binding runtime evidence now includes at least two independent canonical successful scheduled runs:

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

The digests are distinct and scheduled times are 3600 seconds apart. The second evidence comment contains:

```text
schema = aiexe.recurring-scheduled-provider-evidence.v1
successfulScheduledRunCount = 2
minimumSuccessfulRuns = 2
minimumSpacingSeconds = 60
observedSpacingSeconds = 3600
recurringIngestionProven = true
state = RECURRING_SCHEDULED_PROVIDER_INGESTION_PROVEN
readOnly = true
writeAuthority = none
```

A later successful canonical scheduled receipt was also observed at `2026-08-10T04:48:00Z` with digest:

```text
sha256:46c606a18386cff054cef34040bd1d6b6d51bf7d6002b2b064ced914633e7fa3
```

No `02:48Z` receipt was found in independent readback. This gap is explicit and does not invalidate the v1 recurrence rule, which requires multiple distinct spaced successful canonical observations rather than perfect every-hour delivery.

Independent G5 closure receipt:

```text
PR #125 comment #5236243699
```

No cross-repository token, hidden PAT or Domain write path was added.

Status:

```text
PASS
```

---

## Current provider-source heads at the M2.11/M2.12 closure window

```text
AIEXE        dce842e6874e6842b461cd4b5958df577608da94
TrainingOS   1f1550c58866eb9f49d6041a8b5e7ed459374ff7
TradeOS      6958c3b5fb3a8d8b6b70b7a614910b0e1ea9202b
Video/Media  672298b5573d3815e31aca14ac24e597b1783f30
```

These are provider/source facts only. They never imply Domain status, ownership, HumanGate decisions or execution authority.

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
2. provide the canonical out-of-band adoption contract/template from AIEXE without creating second Domain controller frameworks;
3. continue recurring authorized read-only provider ingestion and record gaps honestly;
4. add newly observed real decision failures to the G2 replay ledger and reopen G2 if needed;
5. test A2 policy mechanically without executing actions;
6. maintain the bounded read-only owner cockpit.

## Boundary

```text
S8 product files changed = NO
second S8 owner = NO
A2 execution enabled = NO
Domain OS receipt framework added = NO
external Domain repository changes/comments = NO
cross-repository credentials added = NO
Domain writes = NO
Merge PR #125 = NO while gated
Deploy = NO
Production mutation = NO
Payment / settlement / wallet / token action = NO
remote Worker control = NO
HumanGate decision = NO
```
