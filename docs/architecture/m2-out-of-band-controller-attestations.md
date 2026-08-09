# M2.7 Out-of-Band Controller Attestations

Date: 2026-08-10 JST  
Parent: `docs/architecture/m3-bounded-management-execution-readiness.md`  
Owner: PR #125 only  
Authority: read-only observation and attestation promotion only

## Why M2.7 exists

M2.6 proved that AIEXE can capture real GitHub source facts without converting repository activity into Domain OS business truth. The next blocker was not absence of Controllers: TrainingOS and TradeOS already have recurring Controller progress registers, and Video Operation / Shared Media has project-owned controller handoff receipts.

The blocker was **promotion semantics**.

Existing Controller evidence is mostly human-readable. It may contain exact heads, statuses, blockers and owner discussion, but AIEXE must not use an LLM or title/prose inference to manufacture canonical Domain truth.

A second structural issue appeared in Video Operation / Shared Media: an exact-head receipt committed into the same repository/default branch that it observes advances that branch when the receipt lands. The receipt therefore becomes one commit behind its own repository as a side effect of publication.

```text
observe main H
-> commit receipt saying exactHead=H into main
-> main becomes H+1
-> receipt is now stale for current main
```

This is not a Video-specific defect. It is a self-reference property of same-branch exact-head receipts.

## Decision

Current exact-head Controller attestations must be transportable **out of band** from the git branch they attest.

Allowed transport examples include:

```text
coordinator issue / PR comment
automation receipt store
external Controller status service
other append-only source that does not mutate the attested git head
```

The transport does not become Domain truth by itself. It carries an explicit bounded envelope which AIEXE verifies and then passes through the existing exact-head/freshness receipt contract.

## Canonical envelope

M2.7 introduces:

```text
src/management/portfolio/controller-attestation-envelope.cjs
schema = aiexe.external-controller-attestation-envelope.v1
```

A source body must contain exactly one marker pair:

```text
<!-- aiexe.external-controller-attestation.v1 -->
```json
{ ... explicit fields only ... }
```
<!-- /aiexe.external-controller-attestation.v1 -->
```

Eligible payload fields are fixed:

```text
projectId
controllerId
repository
exactHeadSha
domainStatus
owner
milestone
blockerCodes
evidenceRefs
observedAt
```

Transport metadata is bound externally after the source exists:

```text
sourceKind
sourceRef
sourceDigest
```

`sourceDigest` is the SHA-256 of the **exact full source body**, including surrounding prose. The parser recomputes the digest and rejects mismatch before promoting the marked JSON.

Surrounding prose is explicitly non-authoritative:

```text
factExtraction = marked-json-only
surroundingProseAuthoritative = false
llmFactGenerationAllowed = false
writeAuthority = none
```

## Real AIEXE out-of-band sample

A real structured attestation was posted to PR #125 without changing `main`:

```text
sourceRef = https://github.com/moseszhu999/ai_exe_os/pull/125#issuecomment-5232406288
sourceDigest = sha256:9893c901cb3a397b28f69afb3c98b2e7b2ff4a3944336ef8cb4db79d95294ac5
attested main = 7fdf410e009ea5a1f25bc03dea3b2e54a83c9d48
current provider main = 7fdf410e009ea5a1f25bc03dea3b2e54a83c9d48
```

The attestation states AIEXE is active while the Group Management Plane is still gated before M3. It does not authorize M3 or A2 execution.

The executable test verifies:

```text
exact comment body digest matches recorded digest
marked JSON parses deterministically
current exact-head attestation -> accepted
same structured payload with old exact head -> exact_head_mismatch -> unknown
human-readable prose without marker -> rejected
digest mismatch -> rejected
duplicate envelope -> rejected
unsupported inferred field -> rejected
```

## Real cross-project Controller evidence scan

M2.7 records a read-only scan in:

```text
fixtures/management/m2-controller-evidence-scan-2026-08-09.json
```

Observed sources:

```text
AIEXE        current structured out-of-band sample       promotable = YES
TrainingOS   recurring coordinator issue comments        promotable = NO
TradeOS      recurring coordinator issue comments        promotable = NO
Video/Media  repo-contained controller reverification    promotable = NO
```

At scan time:

```text
promotable current attestations = 1
external Domain promotable current attestations = 0
```

TrainingOS and TradeOS are not rejected because they lack Controllers. They are rejected for canonical promotion because the observed outputs are human-readable rather than deterministic structured envelopes and the sampled reported heads are behind current main.

Video/Media is rejected because the repo-contained receipt records an earlier observed head and the act of committing the receipt advanced main.

## Real provider + attestation cycle

M2.7 also introduces:

```text
src/management/portfolio/live-provider-cycle.cjs
schema = aiexe.management-live-provider-cycle.v1
```

It consumes:

```text
REAL_PROVIDER_OBSERVATION capture
+ verified out-of-band attestation sources
-> canonical read-only management observation cycle
```

Using the M2.6 four-repository provider capture plus the real AIEXE comment receipt yields:

```text
projectCount = 4
attestedProjectCount = 1
AIEXE = active
TrainingOS = unknown
TradeOS = unknown
Video/Media = unknown
unresolvedProjectIds = [tradeos, trainingos, video-operation-shared-media]
```

This is the intended fail-closed result.

The cycle remains explicit about transport/runtime limits:

```text
providerTransport = external-read-only-connector
providerFetchPerformedInProcess = false
scheduledRuntimeStarted = false
recurringIngestionProven = false
writeAuthority = none
```

## Why G3 is still PARTIAL

M2.7 proves the structured out-of-band contract and one real current-head AIEXE attestation. It does not yet prove recurring structured adoption by TrainingOS, TradeOS and Video/Media.

```text
out-of-band schema/parser                    PASS
real current AIEXE structured receipt        PASS
exact-head/freshness promotion               PASS
human prose inference forbidden              PASS
external Domain recurring structured output  NOT PROVEN
```

Therefore G3 remains `PARTIAL`.

## Why G5 is still PARTIAL

The four repositories are not all publicly readable from an AIEXE repository-scoped GitHub Actions token: TrainingOS and TradeOS are private. M2.7 therefore does not introduce a hidden cross-repository token, credential forwarding or an unauthorized Actions secret.

The current accepted model is:

```text
external authorized read-only connector fetches source facts
-> AIEXE deterministic code validates/canonicalizes them
```

One real provider-backed deterministic cycle is now proven. A recurring/scheduled authorized ingestion path is still not proven.

```text
real provider capture                  PASS
real provider + current receipt cycle  PASS
recurring ingestion                    NOT PROVEN
scheduled runner                       NOT PROVEN
```

Therefore G5 remains `PARTIAL`.

## Validation

First exact-head M2.7 implementation validation:

```text
head = a888a33d7af681ebcaf03c956a487a494a27dafe
S0 source validation run = 31322592857
job = 93267772322
Source syntax check = PASS
tests = 469
pass = 469
fail = 0
Provider boundary scan = PASS
```

A final exact-head validation must be rerun after documentation/readiness closure commits.

## Boundary

```text
Domain OS repository changes = NO
cross-repository credentials added = NO
LLM fact extraction = NO
A2 execution = NO
Domain write = NO
S8 product changes = NO
Merge PR #125 = NO while gated
Deploy = NO
Production mutation = NO
Payment / settlement / wallet / token action = NO
```
