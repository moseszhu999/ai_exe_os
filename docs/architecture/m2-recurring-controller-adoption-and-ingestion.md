# M2.8 Controller Adoption Kit + Repeated Real Provider Ingestion

Date: 2026-08-10 JST  
Parent: `docs/architecture/m2-out-of-band-controller-attestations.md`  
Readiness parent: `docs/architecture/m3-bounded-management-execution-readiness.md`  
Owner: PR #125 only

## Verdict

```text
M2.8 IMPLEMENTED
G3 PARTIAL
G5 PARTIAL
M3 BLOCKED
```

M2.8 does two things without widening management authority:

1. makes the accepted M2.7 out-of-band Controller envelope easy for an existing Domain Controller to emit without installing an AIEXE runtime or adding a second Domain receipt framework;
2. records and verifies more than one real read-only provider capture while explicitly refusing to represent manual multi-run evidence as a proven recurring schedule.

## 1. Controller Adoption Kit

Module:

```text
src/management/portfolio/controller-adoption-kit.cjs
schema = aiexe.controller-adoption-source.v1
```

The builder accepts only:

```text
payload
sourceKind
sourceRef
optional surrounding prose
```

The payload field set is not redefined. It reuses the accepted M2.7 fields exactly:

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

The builder performs the same operation an adopting Controller should perform:

```text
explicit Domain facts
-> one marked JSON block
-> full source-body SHA-256
-> existing M2.7 parser
-> canonical external Controller attestation
```

There is deliberately no second parsing path.

Executable boundary:

```text
externalRepositoryFrameworkRequired = false
externalRepositoryWriteRequiredByThisBuilder = false
crossRepositoryCredentialRequiredByThisBuilder = false
factExtraction = marked-json-only
llmFactGenerationAllowed = false
readOnly = true
writeAuthority = none
```

Unsupported authority fields such as `writeAuthority` are rejected. Duplicate attestation markers are rejected by the existing parser.

### What external Domain Controllers need to adopt

TrainingOS, TradeOS and Video/Shared Media already have Controller-style outputs. They do **not** need to import AIEXE code or give AIEXE repository credentials.

They only need to publish, through an out-of-band channel which does not change the attested git head, one source body conforming to the existing M2.7 envelope.

Current target repositories and provider-observed heads at the corrected second real capture:

```text
TrainingOS   moseszhu999/training-learning-rails  0b69d1d7ad2c67c4ba36294ec153280c3da69352
TradeOS      moseszhu999/chaintrace-app            355a7169bfe8e48c7f78fa874cc422a394553d56
Video/Media  moseszhu999/global-tool-radar         24996407449df28b2d83fce1a145b3200fff168a
```

Those SHA values are provider facts only. AIEXE still refuses to invent each Domain's `domainStatus`, `owner`, `milestone` or blocker semantics. Those fields must come from the Domain Controller.

Therefore current G3 truth remains:

```text
AIEXE real current structured receipt          PASS
external Domain current structured receipt     0 / 3
recurring structured adoption                  NOT PROVEN
```

## 2. Second real provider capture

First capture:

```text
fixtures/management/m2-live-github-observation-capture-2026-08-09.json
capturedAt = 2026-08-09T15:31:29Z
```

Corrected second independent provider read:

```text
fixtures/management/m2-live-github-observation-capture-2026-08-10.json
capturedAt = 2026-08-09T22:58:48Z
```

Both were produced from authorized read-only GitHub connector observations of the registered portfolio repositories and explicit repository-scoped open PR reads.

### Provider completeness incident

An initial second-capture assembly at `2026-08-09T22:54:07Z` saw only four TrainingOS open PRs. A subsequent live GitHub index read showed that TrainingOS PR #674 had actually been created at `2026-08-09T22:53:59Z` and was already part of the open-work set.

That initial assembly was therefore **not accepted as complete evidence**. The capture was re-read and repaired before M2.8 validation.

Corrected TrainingOS open-work truth in the second capture:

```text
open PR count = 5
includes PR #674
PR #674 head = acc1c03369e6b885bdf2b574e3923589c0ad5f28
```

This incident reinforces an existing M2.6 invariant:

```text
provider returned rows != automatically complete provider truth
```

A live capture intended to assert an explicit open-work set must be completeness-checked when the provider index is changing near the observation boundary.

Across the two accepted real captures, default-branch heads remained stable:

```text
AIEXE        7fdf410e009ea5a1f25bc03dea3b2e54a83c9d48
TrainingOS   0b69d1d7ad2c67c4ba36294ec153280c3da69352
TradeOS      355a7169bfe8e48c7f78fa874cc422a394553d56
Video/Media  24996407449df28b2d83fce1a145b3200fff168a
```

Open-work evidence did change. In particular, AIEXE PR #125 advanced materially and TrainingOS gained PR #674 while the relevant default-branch heads remained unchanged.

That distinction matters:

```text
stable source head != duplicate provider capture
```

A legitimate repeated observation can see the same default-branch SHA while independently observing changed open-work state.

## 3. Immutable multi-run evidence

Module:

```text
src/management/portfolio/repeated-provider-ingestion.cjs
schema = aiexe.management-repeated-provider-ingestion.v1
```

Every run must provide an immutable capture source:

```text
full capture body
sourceRef
sha256(full capture body)
runId
evaluatedAt
ingestedAt
explicit attestationSources[]
```

The module verifies:

- capture body digest;
- `REAL_PROVIDER_OBSERVATION` schema/class;
- unique run id;
- unique source ref;
- unique source digest;
- strictly increasing ingestion time;
- minimum spacing between real captures;
- stable registered project set;
- each capture still passes the existing live-provider management cycle;
- deterministic default-head fingerprint;
- deterministic open-work fingerprint.

The real two-run result is expected to show:

```text
runCount = 2
multiRunIngestionObserved = true
stableDefaultBranchHeadsAcrossRuns = true
openWorkChangedAcrossRuns = true
```

The corrected second-capture test also pins the provider-completeness repair by asserting the TrainingOS open-work count and PR #674 exact head.

## 4. No schedule overclaim

M2.8 deliberately distinguishes:

```text
multi-run real observation
!= recurring scheduled ingestion
```

The canonical evidence stays:

```text
recurringIngestionProven = false
scheduledRuntimeStarted = false
scheduledRuntimeProven = false
recurringEvidenceState = MULTI_RUN_REAL_PROVIDER_OBSERVED_SCHEDULE_UNPROVEN
```

The run schema does not accept a caller-supplied `scheduledRuntimeProven` field. A caller cannot turn two manual observations into schedule evidence by setting a flag.

This is intentional. G5 should close only when an authorized recurring provider runner or equivalent scheduler produces durable repeated receipts with the same read-only boundary.

## 5. Credential boundary

TrainingOS and TradeOS are private repositories. M2.8 does not add a repository secret, Personal Access Token, cross-repository Actions credential, credential forwarding path or hidden provider credential.

The real observations continue to arrive through an authorized external read-only connector and are then processed by deterministic AIEXE code.

```text
providerTransport = external-read-only-connector
crossRepositoryCredentialRequiredByThisModule = false
writeAuthority = none
```

A future scheduled runner must preserve the same principle. If the scheduler runs outside the AIEXE repository, its read authority must remain explicit, bounded and separately auditable rather than being smuggled into this PR.

## 6. Gate impact

### G3

Improvement:

```text
consumer parser                       PASS
adoption source builder               PASS
real AIEXE current receipt            PASS
external adoption                     0 / 3
recurring structured adoption         NOT PROVEN
```

Status:

```text
PARTIAL
```

### G5

Improvement:

```text
one-shot real capture                 PASS
second independent real capture       PASS
provider completeness repair          PASS
immutable multi-run verification      PASS
changed open-work observation         PASS
scheduled recurring ingestion         NOT PROVEN
```

Status:

```text
PARTIAL
```

M2.8 materially narrows G3/G5 without falsely closing either gate.

## 7. Next bounded work

Allowed next work before M3:

1. have each existing Domain Controller publish the already-defined envelope out of band; no Domain runtime framework required;
2. consume those receipts only when exact-head current and digest-verified;
3. run the same read-only provider capture through an actually recurring authorized scheduler and preserve per-run source/digest/time receipts;
4. keep stale/missing Domain receipts as `unknown`;
5. continue broader real replay evidence for G2;
6. keep G4 execution proof blocked until the evidence gates are ready.

## Boundary

```text
TrainingOS repository write = NO
TradeOS repository write = NO
Video/Shared Media repository write = NO
Domain OS receipt framework added = NO
cross-repository credentials added = NO
A2 execution = NO
Domain write = NO
Merge PR #125 = NO
Deploy = NO
Production mutation = NO
Payment / settlement / wallet / token action = NO
```
