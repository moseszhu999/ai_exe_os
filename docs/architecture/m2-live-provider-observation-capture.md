# M2.6 Live Provider Observation Capture

Date: 2026-08-09  
Parent: `docs/architecture/m3-bounded-management-execution-readiness.md`  
Authority: read-only source observation only

## Outcome

M2.6 adds a truth-safe live-provider observation contract and one real GitHub capture across the four registered portfolio repositories.

This is **not** a recurring provider runner and **not** a Domain OS status receipt.

```text
provider observation evidence = REAL
Domain business truth inferred from GitHub activity = NO
current Controller attestations accepted = 0
scheduled runtime proven = NO
write authority = none
```

## Captured default-branch heads

At `2026-08-09T15:31:29Z` the read-only GitHub connector observed:

```text
AIEXE
  moseszhu999/ai_exe_os
  main = 7fdf410e009ea5a1f25bc03dea3b2e54a83c9d48

TrainingOS
  moseszhu999/training-learning-rails
  main = 0b69d1d7ad2c67c4ba36294ec153280c3da69352

TradeOS
  moseszhu999/chaintrace-app
  main = 355a7169bfe8e48c7f78fa874cc422a394553d56

Video Operation / Shared Media
  moseszhu999/global-tool-radar
  main = 24996407449df28b2d83fce1a145b3200fff168a
```

The same capture explicitly observed open pull requests instead of collapsing missing data into zero:

```text
AIEXE                            1
TrainingOS                       4
TradeOS                         14
Video Operation / Shared Media   0
```

`[]` therefore means provider-confirmed zero in this live-provider contract. Omission means not observed and fails validation.

## Truth-boundary corrections

### 1. Missing open work is not zero open work

The generic read-only adapter historically accepts an omitted `openPullRequests` field and normalizes it to an empty array for fixture compatibility.

That behavior is too ambiguous for a live provider capture.

M2.6 introduces:

```text
aiexe.live-provider-observation.github.v1
createLiveGithubProviderObservation(...)
```

The live wrapper requires an explicit array and records:

```text
headObserved = true
openPullRequestsObserved = true
openPullRequestsObservedAt = <timestamp>
openPullRequestCount = <provider-confirmed count>
inferenceAllowed = false
```

### 2. PR titles are not owner evidence

An intermediate capture classified PR titles into guessed `ownerScope` labels. That was rejected during the same control cycle because a title-derived label could be mistaken for authoritative ownership and create false owner-conflict signals.

The final real-provider fixture omits `ownerScope` unless an explicit authoritative owner source supplies it.

```text
PR number/title/head/draft/updatedAt = provider source facts
ownerScope inferred from title       = forbidden
```

Tests assert every current live PR observation has `ownerScope === null`.

### 3. GitHub source freshness is not Domain status

All four source heads were current at the capture time, but none had a current exact-head Controller attestation in the capture package.

Therefore all four Domain snapshots remain:

```text
status = unknown
owner = null
milestone = null
attention includes domain_status_unknown
attention includes owner_unknown
```

The resulting management proposals escalate for missing Domain truth. They do not convert repository activity into business status.

### 4. Old Controller evidence cannot ride forward

The current Video/Shared Media controller re-verification document was inspected during the capture. The document recorded an earlier observed main:

```text
7f86239d6e56522d2cec2138defae32116380dc9
```

The live provider head had advanced to:

```text
24996407449df28b2d83fce1a145b3200fff168a
```

So the old document is explicitly marked:

```text
reusableAsCurrentDomainAttestation = false
reason = exact_head_mismatch
```

This is source evidence for the fail-closed rule, not permission to infer the current Video business state.

## Durable artifacts

```text
src/management/portfolio/live-provider-observation.cjs
fixtures/management/m2-live-github-observation-capture-2026-08-09.json
tests/m2-live-github-observation-capture.test.cjs
```

The fixture is labelled:

```text
evidenceClass = REAL_PROVIDER_OBSERVATION
```

It is intentionally distinct from:

```text
aiexe.external-controller-attestation.v1
aiexe.domain-controller-receipt.v1
```

## M3 impact

M2.6 advances Gate 5 from fixture-only input toward real provider evidence, but it does not close Gate 5.

Current interpretation:

```text
one-shot real provider capture                PASS
explicit head + open-work observation contract PASS
Domain truth fail-closed without attestation   PASS
recurring provider-backed runner               NOT PROVEN
scheduled runtime                              NOT PROVEN
current recurring Controller attestations      NOT PROVEN
```

Therefore:

```text
G3 recurring Controller attestations = PARTIAL
G5 live provider-backed observation  = PARTIAL
M3 execution                         = BLOCKED
```

## Boundary

```text
GitHub writes outside PR #125 owner branch = NO
Domain OS changes = NO
S8 product changes = NO
A2 execution = NO
Domain write = NO
Merge PR #125 = NO while Draft/gated
Deploy = NO
Production mutation = NO
Payment / settlement / wallet / token action = NO
```
