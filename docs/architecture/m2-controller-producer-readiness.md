# M2.13–M2.16 Controller Producer and G3 Readiness

Date: 2026-08-10 JST  
Owner: PR #125 / `agent/group-management-plane-m0`  
Authority: read-only observation and proposal only

## Purpose

This line explains and deterministically gates external Controller adoption without creating a second Controller protocol or granting execution authority.

Canonical Domain-truth chain remains:

```text
aiexe.controller-adoption-source.v1
-> aiexe.external-controller-attestation-envelope.v1
-> aiexe.external-controller-attestation.v1
-> aiexe.domain-controller-receipt.v1
```

Additional readiness contracts are:

```text
aiexe.controller-producer-readiness.v1
aiexe.controller-recurring-structured-proof.v1
aiexe.controller-g3-readiness.v1
```

None of these modules parses human prose into facts, grants Domain authority, mutates an external repository, enables a scheduler, approves HumanGate, merges, deploys or executes A2 actions.

## M2.13 producer topology

Producer topology explains operational blockers but is not Domain truth.

```text
scheduler enabled != Domain active
scheduler disabled != Domain paused
prompt contract present != Domain healthy
GitHub activity != Controller adoption
out-of-band channel present != canonical receipt
```

Historical producer topology observed in M2.13:

```text
TrainingOS
  scheduler observed/enabled     true / true
  latest observed run            2026-08-10T06:08:29Z
  structured producer contract   missing
  out-of-band persistence        observed

TradeOS
  scheduler observed/enabled     true / false
  latest observed run            2026-08-09T11:04:45Z
  structured producer contract   missing
  out-of-band persistence        observed

Video / Shared Media
  scheduler observed/enabled     true / true
  latest observed run            2026-08-10T05:39:12Z
  structured producer contract   missing
  out-of-band persistence        unobserved at that audit point
```

Producer states remain explicit:

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

A disabled or unobserved scheduler is evaluated before any convenience state derived from historical adoption. A prior structured source therefore cannot hide a currently disabled producer.

## M2.14 source existence and M2.16 independent-head correction

Three real external marked sources exist:

```text
TrainingOS   3 / source exists
TradeOS      3 / source exists
Video/Media  3 / source exists
```

The source bodies and digests are captured in:

```text
fixtures/management/m2-real-external-controller-adoption-cycle-2026-08-10.json
```

However M2.16 discovered that the original M2.14 acceptance test reused the source fixture's attested `headSha` as the provider observation head. Source claims and provider truth must be independent.

Independent revalidation is now stored in:

```text
fixtures/management/m2-external-controller-adoption-revalidation-2026-08-10.json
```

Corrected result:

```text
TrainingOS
  attested = provider current head
  accepted = true

TradeOS
  attested = provider current head
  accepted = true

Video / Shared Media
  attested = 24996407449df28b2d83fce1a145b3200fff168a
  provider = 23d92ffc4674f1581c4191e595d279a20008be53
  accepted = false
  reason   = exact_head_mismatch
```

Superseding first-cycle truth:

```text
external structured source existence       3 / 3
independent first-cycle current acceptance  2 / 3
first-cycle acceptance complete              NO
recurring structured producer proof          0 / 3
G3                                            PARTIAL
```

The old `3 / 3 exact-head acceptance` statement is withdrawn.

## M2.15 canonical recurrence proof

M2.15 introduced:

```text
aiexe.controller-recurring-structured-proof.v1
```

A real recurrence proof requires at least two independently accepted cycles with:

```text
accepted_exact_head_current on every cycle
same project/repository binding
distinct sourceRef
distinct sourceDigest / changed full body
strictly increasing observedAt
readOnly = true
writeAuthority = none
```

`recurringStructuredEvidenceRefs` is audit metadata only. Two arbitrary strings cannot prove recurrence.

## M2.16 proof recomputation

M2.16 removes another caller-trust path. `controller-producer-readiness.cjs` no longer accepts a proof merely because it has the expected schema plus caller-supplied booleans such as:

```text
allCyclesAcceptedExactHeadCurrent = true
distinctSourceRefs = true
distinctSourceDigests = true
strictlyIncreasingObservedAt = true
proven = true
```

Producer readiness now recomputes the claim from the proof's embedded cycle summaries. It verifies:

```text
project/repository binding
sourceRef/sourceDigest format
40-character exact head SHA
observedAt and observedAtMs agreement
acceptanceReason = accepted_exact_head_current
readOnly / writeAuthority
strict cycle ordering
distinct refs and digests
top-level arrays exactly match embedded cycle order
firstObservedAt / lastObservedAt match cycle boundaries
```

The output explicitly records:

```text
arbitraryEvidenceRefsCannotProveRecurrence = true
recurrenceProofRecomputedFromEmbeddedCycles = true
```

A proof-shaped object without embedded canonical cycles fails closed.

## M2.16 fixed-scope G3 gate

M2.16 adds:

```text
aiexe.controller-g3-readiness.v1
```

The required external Domain set is code-fixed and cannot be supplied or reduced by a caller:

```text
trainingos
  moseszhu999/training-learning-rails

tradeos
  moseszhu999/chaintrace-app

video-operation-shared-media
  moseszhu999/global-tool-radar
```

Therefore these invalid shortcuts fail closed:

```text
omit one project and claim 2 / 2 PASS
substitute another repository
claim recurring proof without canonical embedded cycles
count a disabled producer as current recurrence
use source-attested head as independent provider head
```

Per required project the gate checks:

```text
structured Controller currently adopted
producer topology observed
producer enabled
structured producer contract observed
out-of-band persistence observed
canonical recurring structured proof present
```

All three must pass for `g3Pass=true`.

Even a future G3 PASS remains non-authorizing by itself:

```text
m3EntryAuthorized = false
a2ExecutionAuthorized = false
authorityGranted = false
```

G4 remains a separate downstream gate.

## Current G3 truth

At the M2.16 observation point:

```text
required external Domain set                3
real structured source existence            3 / 3
independent first-cycle current acceptance  2 / 3
verified recurring structured producers     0 / 3
caller may reduce denominator                NO
proof booleans trusted without rebuild       NO
G3                                            PARTIAL
G4 / A2 execution                             UNAUTHORIZED
```

The shortest real path remains Domain-owned evidence generation, not AIEXE fabrication. Each Domain must emit later canonical cycles through its existing Controller channel; every cycle must be independently revalidated against provider truth.

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
