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

M2.13 originally used two explicit structured evidence references as the minimum recurrence signal. **M2.15 supersedes that rule.** Arbitrary references are now audit hints only and cannot prove recurrence.

## Historical M2.13 audit

At the original M2.13 observation point, provider heads were:

```text
TrainingOS   8f0d38dca4dcd28883359c427e133d0c1a9eebb8
TradeOS      6958c3b5fb3a8d8b6b70b7a614910b0e1ea9202b
Video/Media  23d92ffc4674f1581c4191e595d279a20008be53
```

At that time exact marker searches remained empty across all three repositories. TrainingOS Issue #477 and TradeOS Issue #567 contained no canonical marker, and no current Video/Media Controller persistence source had been accepted.

Observed producer topology at that point:

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

The exact comment body was read back and the digest recomputed. Publishing the comment does not mutate `main`, so the attested head remained current at the observation point.

This repaired the AIEXE-side sample only and did not count toward the three external Domain adoptions.

## M2.14 first real external adoption update

M2.14 subsequently observed one canonical marked out-of-band structured source for each external Domain and accepted all three at exact current heads through the existing parser/enrichment path.

```text
external structured source existence = 3 / 3
first-cycle exact-head acceptance     = 3 / 3
recurring structured producer proof   = 0 / 3
G3                                     = PARTIAL
```

This first cycle is real evidence, but it is not recurrence evidence.

## M2.15 recurrence-proof hardening

M2.15 adds:

```text
aiexe.controller-recurring-structured-proof.v1
```

Canonical recurrence now requires this deterministic chain:

```text
marked Controller source body
-> full-body SHA-256 verified envelope
-> canonical external Controller attestation
-> exact-head + freshness accepted enriched observation
-> second or later independently accepted cycle
-> distinct sourceRef
-> distinct sourceDigest (changed body)
-> strictly increasing observedAt
-> aiexe.controller-recurring-structured-proof.v1
-> aiexe.controller-producer-readiness.v1
```

A recurrence proof fails closed when any cycle:

```text
is not accepted_exact_head_current
has a project/repository binding mismatch
reuses a sourceRef
reuses a sourceDigest
moves observedAt backward or keeps it equal
lacks the canonical read-only envelope/enriched-observation schemas
```

`recurringStructuredEvidenceRefs` remains in the producer observation only as auditable source hints. Two strings such as `receipt:a` and `receipt:b` no longer have any ability to set `recurringStructuredProven=true`.

Producer readiness also now preserves scheduler topology before adoption convenience states:

```text
scheduler unobserved -> PRODUCER_TOPOLOGY_UNOBSERVED
scheduler disabled   -> PRODUCER_DISABLED
```

Therefore a Domain cannot hide a disabled producer merely because one structured source was observed previously. A historical canonical recurrence proof also does not count as **current recurring readiness** while its producer is disabled.

## Current G3 interpretation after M2.15 hardening

```text
external Domain projects                    3
first-cycle structured adoption             3 / 3
arbitrary refs allowed to prove recurrence  NO
verified recurring structured producers     0 / 3 until real cycle 2+
G3                                           PARTIAL
G4 / A2 execution                            UNAUTHORIZED
```

The shortest real path is now explicit: each existing Domain-owned Controller must emit a later fresh canonical source through its existing channel. AIEXE may consume that source only after the same digest, exact-head and freshness checks succeed. AIEXE must not manufacture the second cycle itself.

## Boundary

```text
external Domain repository write/comment   NO by this hardening slice
external scheduler mutation                NO
second scheduler                            NO
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
