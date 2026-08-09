# M3 Bounded Management Execution — Readiness Gate

Date: 2026-08-10 JST  
Parent: `docs/architecture/m2-workstream-scoped-attention.md`  
Implementation owner: PR #125 only  
Execution owner: not created

## Verdict

```text
BLOCKED
```

M0-M2.7 now provide a read-only management foundation, non-binding A2 eligibility policy, workstream-scoped attention, historical and simulated replay, real GitHub provider observation, and a deterministic out-of-band Controller-attestation path.

AIEXE is still **not authorized to cross from management proposal into autonomous A2 execution**. M3 starts only when all five gates below are `PASS`.

## Gate 1 — accepted S8 controlled-delegation runtime baseline

Accepted product path:

```text
PR #122  S8-I controlled delegation integration     MERGED
PR #128  Electron product-root authority repair      MERGED
PR #130  persistent destination-gate explanation     MERGED
```

Frozen S8 product head:

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

S8 proves controlled delegation only. It does not grant payment, deployment, credential forwarding, remote Worker control or remote HumanGate authority.

Status:

```text
PASS
```

## Gate 2 — broader replay/evaluation evidence

Evidence now includes:

```text
historical project-level replay          6 labelled cases
real workstream replay                    TrainingOS / TradeOS / Video-Media
SIMULATED adversarial replay              11 cases
```

The workstream model preserves:

```text
complete != active safe capacity
observed workstreams != complete decision scope
```

Current real-workstream replay:

```text
TrainingOS   -> ESCALATE incomplete decision scope
TradeOS      -> REPRIORITIZE around blocked N2 while active safe work can continue
Video/Media  -> PAUSE only where current critical decision scope is explicit and complete
```

M2.5 adversarial simulation covers owner conflict, stale→recovery, duplicate Controller attestations, blocked+active work, incomplete/complete decision scope, unknown truth and A2 allow/deny boundaries. It is explicitly `SIMULATED` and is not represented as real history.

Remaining gaps include more real owner-conflict, stale/recovery, policy-block, false-pause, false/missed escalation and recovery-after-blocker-clear episodes across multiple projects.

Status:

```text
PARTIAL / BLOCKED FOR M3
```

## Gate 3 — recurring real Controller attestations

AIEXE owns the consumer side:

```text
aiexe.external-controller-attestation.v1
-> aiexe.domain-controller-receipt.v1
```

M2.7 adds a deterministic out-of-band envelope:

```text
aiexe.external-controller-attestation-envelope.v1
```

Only a marked JSON payload with explicit fields and a verified SHA-256 source digest can be promoted. Surrounding prose is non-authoritative and LLM fact extraction is forbidden.

This solves an exact-head self-reference problem discovered in real Video/Media evidence:

```text
observe main H
-> commit an exact-head receipt for H into the same main
-> main advances to H+1
-> receipt is stale immediately
```

Current exact-head receipts therefore need an out-of-band transport such as a coordinator issue/PR comment, automation receipt store or external status service which does not mutate the attested git head.

### Real current-head proof

A structured AIEXE receipt was posted out of band on PR #125:

```text
sourceRef = https://github.com/moseszhu999/ai_exe_os/pull/125#issuecomment-5232406288
sourceDigest = sha256:9893c901cb3a397b28f69afb3c98b2e7b2ff4a3944336ef8cb4db79d95294ac5
attested main = 7fdf410e009ea5a1f25bc03dea3b2e54a83c9d48
current main = 7fdf410e009ea5a1f25bc03dea3b2e54a83c9d48
promotion = accepted
```

Executable tests prove:

```text
verified current structured envelope -> accepted
same envelope with old exact head      -> exact_head_mismatch -> unknown
human-readable prose only              -> rejected
digest mismatch                        -> rejected
duplicate envelope                     -> rejected
unsupported inferred field             -> rejected
```

### Cross-project read-only scan

Real Controller evidence was observed for all four portfolio sources, but current promotion status is:

```text
AIEXE        structured out-of-band current receipt     PROMOTABLE
TrainingOS   recurring human-readable controller issue  NOT PROMOTABLE
TradeOS      recurring human-readable controller issue  NOT PROMOTABLE
Video/Media  repo-contained controller receipt          NOT PROMOTABLE
```

TrainingOS and TradeOS do have recurring Controllers; the sampled outputs are not canonical current structured envelopes and their reported heads lag current main. Video/Media's repo-contained receipt is current-source evidence but is exact-head stale after its own publication commit.

Current state:

```text
structured out-of-band schema/parser              PASS
real AIEXE current-head structured receipt         PASS
external Domain current structured receipt         0 / 3
recurring structured adoption across all projects NOT PROVEN
```

Status:

```text
PARTIAL / BLOCKED FOR M3
```

## Gate 4 — A2 action allow-set and accepted execution path

M2.2 defines:

```text
aiexe.a2-management-action-policy.v1
aiexe.a2-management-action-eligibility.v1
```

Allowed candidates remain narrow read/plan/approved-test/preapproved-work actions. Consequential actions such as merge, deploy, payment, credentials, policy widening, Domain truth mutation and production mutation are mechanically denied.

Every positive eligibility result remains:

```text
binding = false
executionAuthorized = false
delegationCreated = false
humanGateDecisionCreated = false
domainWritePerformed = false
```

S8 is now an accepted runtime path, but the management A2 policy has not been proven end-to-end through that path. S8 acceptance is a prerequisite, not implicit A2 authorization.

Status:

```text
PARTIAL / BLOCKED FOR M3
```

## Gate 5 — live provider-backed read-only observation cycle

M2.6 captured real GitHub facts for all four registered repositories and fixed two source-truth ambiguities:

```text
missing open-work observation != zero open PRs
PR title != owner evidence
```

M2.7 now composes the real provider capture with verified out-of-band attestations:

```text
REAL_PROVIDER_OBSERVATION
+ verified structured Controller sources
-> aiexe.management-live-provider-cycle.v1
```

Using the real four-project provider capture plus the real AIEXE receipt yields:

```text
projectCount = 4
attestedProjectCount = 1
AIEXE = active
TrainingOS = unknown
TradeOS = unknown
Video/Media = unknown
unresolvedProjectIds = [tradeos, trainingos, video-operation-shared-media]
```

That is the required fail-closed behavior.

Transport/runtime remains explicit:

```text
providerTransport = external-read-only-connector
providerFetchPerformedInProcess = false
scheduledRuntimeStarted = false
recurringIngestionProven = false
writeAuthority = none
```

TrainingOS and TradeOS are private repositories. PR #125 does not add cross-repository credentials, hidden tokens or credential forwarding to make an AIEXE repository-scoped Actions token read them. Current evidence is fetched through an authorized external read-only connector and then processed deterministically by AIEXE.

Current state:

```text
one-shot real provider capture                 PASS
real provider + current receipt cycle          PASS
fail-closed unresolved Domain truth            PASS
recurring authorized ingestion                 NOT PROVEN
scheduled provider-backed runner               NOT PROVEN
```

Status:

```text
PARTIAL / BLOCKED FOR M3
```

## M2.7 validation

First implementation exact head:

```text
a888a33d7af681ebcaf03c956a487a494a27dafe
S0 source validation run 31322592857   SUCCESS
job 93267772322                       SUCCESS
Source syntax check                   PASS
tests                                 469 / 469 PASS
Provider boundary scan                PASS
```

A fresh exact-head validation is required after this readiness/documentation closure commit.

## Required M3 entry package

```text
G1 final S8-F controlled-delegation runtime acceptance  PASS
G2 broader replay/evaluation acceptance                 PARTIAL
G3 recurring real Controller attestations               PARTIAL
G4 A2 policy proven through accepted execution path      PARTIAL
G5 live provider-backed read-only observation cycle      PARTIAL
```

If any gate is not `PASS`:

```text
managementAuthority = observe-and-propose
A2 execution = blocked
```

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
HumanReadableControllerProse != CanonicalAttestation
RepoContainedReceipt != CurrentExactHeadReceipt
ManagementProposal != A2 eligibility
A2 eligibility != DelegationPolicy
A2 eligibility != HumanGate approval
A2 eligibility != Capability grant
A2 eligibility != Domain write authority
```

## Non-overlapping work allowed before M3

1. broaden real replay/evaluation evidence;
2. migrate recurring Controller outputs toward the out-of-band structured envelope without adding Domain OS runtime frameworks;
3. prove recurring authorized read-only ingestion of provider facts and structured receipts;
4. measure false escalation, false project-wide pause and missed escalation over larger real labelled sets;
5. test A2 policy against broader evidence without executing actions;
6. maintain the read-only owner cockpit around current bounded truth.

## Boundary

```text
S8 files changed = NO
second S8 owner = NO
A2 execution enabled = NO
Domain OS receipt framework added = NO
Domain OS repository changes = NO
cross-repository credentials added = NO
Domain writes = NO
Merge PR #125 = NO while gated
Deploy = NO
Production mutation = NO
Payment / settlement / wallet / token action = NO
```
