# M2.10 Recurring Provider Runner Binding

Status: bounded G3/G5 evidence increment on AIEXE PR #125. Management authority remains `observe-and-propose`.

## Outcome

M2.10 separates facts that must not be collapsed:

```text
scheduler substrate exists
!= scheduler enabled
!= provider ingestion bound
!= successful scheduled provider run
!= recurring scheduled provider ingestion
```

The existing AIEXE hourly controlled-progress task is reused as the single scheduler substrate. M2.10 does not create a second scheduler implementation.

## G3 update: group substrate is now 3 / 3

A fresh read-only external audit found real group-facing integration substrate in all three external Domain repositories:

```text
TrainingOS
  group Work Entry adapter exists on accepted history
  current observed main: 39932eb934961bfddee61fe92dc6582afc6b1e26

TradeOS
  group.work-inbox.v1 + provider-neutral Work Entry read transport on main
  current observed main: c51b766aefecb5fcc49c27c3c51bd982c13a30e0

Video / Shared Media
  bounded group service adapter exists on main
  current observed main: 9e3391d8d0eea52004026c5643370c72ba0506cb
```

The canonical marker search still found no `aiexe.external-controller-attestation.v1` and no verified current adoption envelope in any of the three repositories or their searched issue/comment surfaces.

Therefore:

```text
group integration substrate ready = 3 / 3
structured Controller adoption     = 0 / 3
G3                                 = PARTIAL
```

Group integration readiness remains a transport/composition fact, not Domain truth and not Controller adoption.

## Provider observation under high concurrency

The fourth provider read window occurred while source repositories and TrainingOS open-work were moving. M2.10 intentionally did not fabricate a full canonical `aiexe.live-github-observation-capture.v1` by stitching per-PR metadata fetched across that moving window.

Instead it records `aiexe.live-provider-observation-summary.v1`. The summary explicitly does **not** claim one single-instant snapshot. Its final re-read heads are:

```text
AIEXE       main dce842e6874e6842b461cd4b5958df577608da94
TrainingOS  main 39932eb934961bfddee61fe92dc6582afc6b1e26
TradeOS     main c51b766aefecb5fcc49c27c3c51bd982c13a30e0
Video/Media main 9e3391d8d0eea52004026c5643370c72ba0506cb
```

Provider-returned open PR number sets from the read window:

```text
AIEXE       1
TrainingOS  8
TradeOS     14
Video/Media 1
```

Cycle 3 -> summary cycle 4 final re-read default-head movement:

```text
AIEXE
  7fdf410e009ea5a1f25bc03dea3b2e54a83c9d48
  -> dce842e6874e6842b461cd4b5958df577608da94

TrainingOS
  d75d7cb9c0c3ab6c0af3e2df147ac3f8aeecd5fc
  -> 39932eb934961bfddee61fe92dc6582afc6b1e26

TradeOS
  355a7169bfe8e48c7f78fa874cc422a394553d56
  -> c51b766aefecb5fcc49c27c3c51bd982c13a30e0
```

Video / Shared Media remained stable in the same comparison.

The initial M2.10 summary draft had retained AIEXE's prior S8 main while later exact-head CI proved current main had advanced to `dce842e...`. Because the exact merge instant could not be independently proven from a PR record, M2.10 repaired the summary conservatively to the final re-read head and widened the recorded transition set. The repair is explicit rather than hidden.

The three earlier full canonical captures remain the accepted full-capture corpus. The fourth summary is real provider evidence, but it is not promoted into that corpus as a full capture.

## Scheduled run receipt

M2.10 adds `aiexe.provider-scheduled-run-receipt.v1`.

A successful proof receipt requires all of:

```text
trigger = scheduled
schedulerEnabled = true
providerIngestionBindingObserved = true
immutableReceiptPersistenceObserved = true
runOutcome = success
captureSchema = aiexe.live-github-observation-capture.v1
captureRef = explicit
captureDigest = sha256:<64 hex>
readOnly = true
writeAuthority = none
```

The receipt derives one-run facts only:

```text
successfulScheduledRunObserved
scheduledRuntimeProven
```

A caller cannot supply either proof boolean.

Manual trigger, malformed digest, non-canonical capture schema, missing binding, missing immutable persistence, failed run with a claimed completed capture, or write authority fails closed.

## Recurring proof

M2.10 also adds `aiexe.recurring-scheduled-provider-evidence.v1`.

Default recurring proof requires at least two canonical successful scheduled receipts with:

```text
unique capture digests
strictly increasing scheduled times
minimum spacing >= 60 seconds
```

Only this aggregator may derive:

```text
recurringIngestionProven = true
state = RECURRING_SCHEDULED_PROVIDER_INGESTION_PROVEN
```

The older scheduler-readiness projection was repaired in M2.10 so one successful scheduled run no longer sets `recurringIngestionProven=true`. Scheduler readiness now points to `aiexe.recurring-scheduled-provider-evidence.v1` as the recurrence proof authority.

## Real native scheduler binding

At `2026-08-10T00:27:22.939529Z`, the existing AIEXE hourly controlled-progress automation was updated in place and enabled.

The existing schedule remained unchanged:

```text
timezone = Asia/Shanghai
cadence  = HOURLY
minute   = 48
mode     = exact_schedule
```

The complete pre-existing AIEXE controller prompt was preserved and the M2 provider-ingestion clause was appended before the persistent-prompt end marker. No second scheduler was created.

The appended binding may only:

```text
read the four canonical repository default heads
read explicit open PR sets
produce canonical live-provider capture when one coherent read window can be proven
never infer Domain status/owner/authority/Controller adoption from GitHub activity
write one evidence-only scheduled-run receipt to AIEXE PR #125 when a canonical scheduled capture actually succeeds
```

It may not comment or modify TrainingOS, TradeOS or Video / Shared Media.

Real post-binding readiness is:

```text
schedulerObserved                    true
hourlyCadenceObserved                true
schedulerEnabled                     true
providerIngestionBindingObserved     true
immutableReceiptPersistenceObserved  false
successfulScheduledRunObserved       false
state = SCHEDULER_BOUND_RECEIPT_PERSISTENCE_UNPROVEN
scheduledRuntimeProven               false
recurringIngestionProven             false
```

The prior `lastRunObservedAt` predates this binding and is not promoted into provider-ingestion proof. The next required evidence is the first canonical successful scheduled provider run receipt after binding.

The binding does not authorize:

```text
Domain repository writes
Domain Controller decisions
merge
deploy
Production mutation
credential writes
payment / settlement / wallet / token action
remote Worker control
HumanGate approval
```

## M3 effect

```text
G1 PASS
G2 PARTIAL
G3 PARTIAL  # 3/3 group substrate, 0/3 structured adoption
G4 PARTIAL
G5 PARTIAL  # real scheduler enabled+bound; first post-binding scheduled receipt still absent
M3 BLOCKED
```

Source readiness and scheduler configuration are not scheduled-run evidence. PR #125 remains Draft until evidence gates are actually closed.
