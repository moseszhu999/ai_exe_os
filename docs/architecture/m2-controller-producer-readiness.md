# M2.13 Controller Producer Readiness

Date: 2026-08-10 JST  
Owner: PR #125 / `agent/group-management-plane-m0`  
Authority: read-only observation and proposal only

## Purpose

M2.13 does not create a second Controller-attestation protocol. It composes the existing G3 adoption classifier with observed producer/runtime topology so AIEXE can distinguish **why** an external Domain has not produced a canonical structured Controller envelope.

The existing contract remains authoritative:

```text
aiexe.controller-adoption-source.v1
-> aiexe.external-controller-attestation-envelope.v1
-> aiexe.external-controller-attestation.v1
-> aiexe.domain-controller-receipt.v1
```

M2.13 adds only:

```text
aiexe.controller-producer-readiness.v1
```

This layer does not parse Controller prose, generate Domain facts, grant authority, modify external repositories, or enable/disable external schedulers.

## Why this layer exists

Before M2.13, G3 could accurately say:

```text
external Domain structured adoption = 0 / 3
```

but that result did not distinguish these operationally different cases:

```text
scheduler running, structured contract missing
scheduler disabled
scheduler running, but no out-of-band persistence channel
structured source present once, recurrence not yet proven
recurring structured producer proven
```

Those states require different remediation and must not be collapsed into one generic `missing` label.

## Truth boundary

Producer topology is not Domain truth.

```text
scheduler enabled != Domain active
scheduler disabled != Domain paused
prompt contract present != Domain healthy
GitHub activity != Controller adoption
out-of-band channel present != canonical receipt
```

The module therefore returns:

```text
schedulerStateIsNotDomainTruth = true
promptPresenceIsNotDomainTruth = true
domainTruthInferred = false
authorityGranted = false
readOnly = true
writeAuthority = none
llmFactGenerationAllowed = false
```

## Producer states

```text
RECURRING_STRUCTURED_PRODUCER_PROVEN
STRUCTURED_SOURCE_PRESENT_RECURRENCE_UNPROVEN
PRODUCER_TOPOLOGY_UNOBSERVED
PRODUCER_DISABLED
ACTIVE_CONTRACT_AND_PERSISTENCE_MISSING
ACTIVE_STRUCTURED_CONTRACT_MISSING
ACTIVE_OUT_OF_BAND_PERSISTENCE_MISSING
ACTIVE_STRUCTURED_SOURCE_NOT_YET_OBSERVED
```

Recurring proof requires at least two explicit structured evidence references and is rejected unless the existing adoption classifier already reports structured Controller adoption.

## Real M2.13 audit

Current provider heads observed:

```text
TrainingOS   8f0d38dca4dcd28883359c427e133d0c1a9eebb8
TradeOS      6958c3b5fb3a8d8b6b70b7a614910b0e1ea9202b
Video/Media  23d92ffc4674f1581c4191e595d279a20008be53
```

Exact marker searches remained empty across all three repositories. TrainingOS Issue #477 and TradeOS Issue #567 also contain no canonical marker. No current Video/Media Controller issue was found by the bounded issue search.

Observed producer topology:

```text
TrainingOS
  scheduler observed/enabled     true / true
  latest observed run            2026-08-10T06:08:29Z
  canonical producer contract    missing
  out-of-band persistence        observed via Controller Issue #477
  state                          ACTIVE_STRUCTURED_CONTRACT_MISSING

TradeOS
  scheduler observed/enabled     true / false
  latest observed run            2026-08-09T11:04:45Z
  canonical producer contract    missing
  out-of-band persistence        observed via Controller Issue #567
  state                          PRODUCER_DISABLED

Video / Shared Media
  scheduler observed/enabled     true / true
  latest observed run            2026-08-10T05:39:12Z
  canonical producer contract    missing
  out-of-band Controller channel not observed
  state                          ACTIVE_CONTRACT_AND_PERSISTENCE_MISSING
```

No external scheduler was enabled, disabled, or reconfigured by M2.13.

## AIEXE current-head structured source repair

The old M2.7 AIEXE structured sample attested the accepted S8 main head and correctly became stale after `main` advanced.

M2.13 published a new out-of-band AIEXE-only attestation on PR #125:

```text
comment = 5236728435
exactHeadSha = dce842e6874e6842b461cd4b5958df577608da94
sourceDigest = sha256:e4120c3bac66cf45f9c8d4ef20923f318f004278dcd3447e9c716adacb337715
```

The exact comment body was read back and the digest recomputed. Publishing the comment does not mutate `main`, so the attested head remains current at the observation point.

This repairs the AIEXE-side sample only. It does not count toward the three external Domain adoptions.

## Current G3 blocker decomposition

```text
external Domain projects                 3
group integration ready                  3 / 3
structured Controller adopted            0 / 3
enabled producer schedulers              2 / 3
disabled producer schedulers             1 / 3
structured producer contract missing     3 / 3
out-of-band persistence missing           1 / 3
recurring structured producers proven    0 / 3
G3                                        PARTIAL
```

Therefore the shortest real path is not another AIEXE parser. It is producer adoption in the Domain-owned Controller output path:

```text
TrainingOS  -> add canonical marked envelope to existing recurring Controller output
TradeOS     -> separately resolve whether its disabled Controller should run; then adopt envelope
Video/Media -> establish out-of-band Controller persistence + canonical marked envelope
```

AIEXE must not infer or manufacture those Domain facts on their behalf.

## Boundary

```text
external Domain repository write/comment   NO
external scheduler mutation                NO
LLM prose-to-truth extraction               NO
cross-repository credentials                NO
A2 execution                                NO
Domain write                                NO
Merge PR #125                               NO while gated
Deploy                                      NO
Production mutation                         NO
Payment / settlement / wallet / token       NO
remote Worker control                       NO
HumanGate decision                          NO
```
