# M2.1 External Controller Attestation and Read-only Management Cycle

Date: 2026-08-09  
Parent: `docs/architecture/m2-deterministic-attention-queue.md`  
Implementation owner: AIEXE PR #125 only

## Decision

Do **not** require TrainingOS, TradeOS, or Video Operation / Shared Media to add AIEXE-specific receipt frameworks to their repositories merely so AIEXE can manage them.

That would invert the dependency and violate current domain operating rules:

- TradeOS explicitly rejects infrastructure expansion that does not remove a current product critical-path blocker.
- Video Operation explicitly rejects new orchestration/receipt infrastructure while its earliest business blocker is M10 full human review.
- TrainingOS requires shared infrastructure to remain bounded and non-duplicative.

The corrected architecture is:

```text
Domain OS / existing controller
        |
        | existing structured status / handoff / automation receipt
        v
External Controller Attestation
        |
        v
AIEXE canonical Domain Controller Receipt
        |
        v
exact-head + freshness reconciliation
        |
        v
Portfolio -> Attention Queue -> Cockpit
```

Domain repositories do not need AIEXE-specific runtime code for this path.

## Canonical external attestation

Schema:

```text
aiexe.external-controller-attestation.v1
```

The attestation must provide explicit structured fields:

```text
projectId
controllerId
repository
exactHeadSha
domainStatus
owner
milestone
blockerCodes[]
evidenceRefs[]
observedAt
sourceKind
sourceRef
sourceDigest?  # sha256:<64 hex>
```

Allowed `sourceKind` values are intentionally bounded:

```text
automation-receipt
canonical-status
controller-handoff
coordinator-issue
current-handoff
```

The adapter never scrapes prose to manufacture status fields.

```text
factExtraction = explicit-structured-fields-only
llmFactGenerationAllowed = false
```

If a controller output is only natural language, a trusted controller must first emit the structured attestation fields. AIEXE does not infer them by reading tone or activity.

## Projection into canonical AIEXE receipt

`createExternalControllerAttestation()` immediately validates the domain fields through the existing canonical:

```text
aiexe.domain-controller-receipt.v1
```

The source reference becomes part of the receipt evidence set.

The attestation remains:

```text
readOnly = true
writeAuthority = none
domainRepositoryMutationRequired = false
binding = false  # inherited canonical receipt semantics
```

## Exact-head reconciliation remains mandatory

An external controller attestation is not trusted merely because it names a project.

AIEXE accepts the domain status only when:

```text
attestation.canonicalReceipt.exactHeadSha
== GitHub observation.source.headSha

AND

receipt freshness == current
```

If the repository moved after the controller attested:

```text
status -> unknown
signal -> domain_receipt_head_mismatch
bucket -> needs_attention
```

This is a desired management behavior. It prevents a historical handoff from silently becoming current truth.

## Read-only management observation cycle

Schema:

```text
aiexe.management-observation-cycle.v1
```

The cycle consumes already-authorized inputs:

```text
canonical GitHub read-only observations
+ optional canonical external controller attestations
```

It then builds:

```text
resolved/enriched observations
-> portfolio snapshot
-> deterministic attention packets
-> management cockpit
```

The initial cycle is deliberately a **bounded input cycle**, not a provider runtime:

```text
providerFetchPerformed = false
scheduledRuntimeStarted = false
writeAuthority = none
```

This distinction matters: the implementation proves the management composition contract but does not claim that AIEXE is already polling GitHub or project controllers in production.

## No inline domain truth in the live cycle

For the strict read-only cycle, a GitHub observation may not carry non-unknown domain status/owner/milestone by itself.

If it does and there is no matching external controller attestation, the cycle rejects it.

This locks the invariant:

```text
GitHub says what changed.
Controller says what the project means.
AIEXE reconciles them.
```

## Why this is better than domain-specific producer packages

A producer package in every Domain OS would create four problems:

1. AIEXE management concerns would leak into domain repositories.
2. Each domain would accumulate another framework unrelated to its user-facing critical path.
3. Receipt versions could drift independently.
4. Shared Media / TradeOS anti-infrastructure guardrails would be violated.

The external attestation model instead makes AIEXE the sole owner of the management contract while allowing any existing controller surface to supply explicit structured truth.

## Implementation files

```text
src/management/portfolio/external-controller-attestation.cjs
src/management/portfolio/observation-cycle.cjs
tests/m2-external-controller-attestation-cycle.test.cjs
```

## M3 impact

This changes the interpretation of M3 Gate 3.

Old wording:

```text
Domain OS repositories must implement AIEXE-specific receipt producers.
```

Correct wording:

```text
Each managed project must have a real project-owned controller/status source
capable of emitting the bounded external attestation fields.
No domain repository code change is required.
```

It also partially closes the design portion of Gate 5: a canonical read-only management cycle now exists, but a live scheduled/provider-backed observation runner is still not claimed.

## Boundary

```text
TrainingOS repo changes = NO
TradeOS repo changes = NO
Video Operation / Shared Media repo changes = NO
provider fetch = NO
scheduler = NO
S8 wiring = NO
Domain write = NO
Merge = NO
Deploy = NO
Production mutation = NO
```
