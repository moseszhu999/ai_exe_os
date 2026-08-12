# M2.9 Controller Adoption Readiness + Provider Transition Evidence

Date: 2026-08-10 JST  
Owner: PR #125 / `agent/group-management-plane-m0`  
Authority: read-only observation and proposal only

## Verdict

M2.9 advances G3 and G5 without relabelling either gate as complete.

```text
G3 structured external Controller adoption  PARTIAL
G5 recurring provider ingestion             PARTIAL
M3                                           BLOCKED
```

The two new distinctions are:

```text
group integration readiness != structured Controller adoption
multi-run live observation != scheduled recurring ingestion
```

## G3 — real external adoption readiness

M2.8 already provides the canonical adoption builder and M2.7 parser:

```text
aiexe.controller-adoption-source.v1
-> aiexe.external-controller-attestation-envelope.v1
-> aiexe.external-controller-attestation.v1
-> aiexe.domain-controller-receipt.v1
```

M2.9 adds:

```text
aiexe.controller-adoption-readiness.v1
```

It classifies external projects only from explicit read-only evidence:

```text
STRUCTURED_CONTROLLER_ADOPTED
UNVERIFIED_CONTROLLER_MARKER_PRESENT
GROUP_ADAPTER_READY_ENVELOPE_MISSING
NO_STRUCTURED_ADOPTION_EVIDENCE
```

A group-facing adapter is not sufficient evidence of structured Controller adoption. A marker match is still not sufficient until a current envelope is independently verified.

### Live external audit

Exact repository heads observed during this round:

```text
TrainingOS   d75d7cb9c0c3ab6c0af3e2df147ac3f8aeecd5fc
TradeOS      355a7169bfe8e48c7f78fa874cc422a394553d56
Video/Media  9e3391d8d0eea52004026c5643370c72ba0506cb
```

An exact repository search across all three external projects found no occurrence of the canonical Controller marker:

```text
<!-- aiexe.external-controller-attestation.v1 -->
```

It also found no `aiexe.controller-adoption-source.v1` identity.

At the same time, two real group integration adapters now exist:

```text
TrainingOS
  merged main d75d7cb9c0c3ab6c0af3e2df147ac3f8aeecd5fc
  trainingos.group-work-entry.capability-prerequisite.v1
  trainingos.group-work-entry.work-item.v1

Video / Shared Media
  merged main 9e3391d8d0eea52004026c5643370c72ba0506cb
  shared-media.group-service-status.v1
  shared-media.group-work-item.v1
```

Both are intentionally read-only projections and preserve their Domain ownership boundaries. Neither emits the AIEXE Controller-attestation envelope.

Therefore the current machine-classified state is:

```text
TrainingOS   GROUP_ADAPTER_READY_ENVELOPE_MISSING
TradeOS      NO_STRUCTURED_ADOPTION_EVIDENCE
Video/Media  GROUP_ADAPTER_READY_ENVELOPE_MISSING
```

Summary:

```text
external projects                    3
group integration ready              2 / 3
structured Controller adopted        0 / 3
unverified marker present            0 / 3
G3                                   PARTIAL
```

The new classifier never infers Domain truth and never grants authority.

## G5 — third real provider cycle

M2.8 established two independent real provider captures:

```text
2026-08-09T15:31:29Z
2026-08-09T22:58:48Z
```

M2.9 adds a third live capture:

```text
2026-08-09T23:16:39Z
```

Current third-cycle facts:

```text
AIEXE        main 7fdf410e009ea5a1f25bc03dea3b2e54a83c9d48   open PRs 1
TrainingOS   main d75d7cb9c0c3ab6c0af3e2df147ac3f8aeecd5fc   open PRs 4
TradeOS      main 355a7169bfe8e48c7f78fa874cc422a394553d56   open PRs 14
Video/Media  main 9e3391d8d0eea52004026c5643370c72ba0506cb   open PRs 1
```

TrainingOS PR #674 is no longer in the open set because it reached main. Video/Media now has open PR #112.

The third cycle proves that the read-only observation path can detect actual default-branch transitions, not only changing PR metadata under stable heads.

M2.9 adds:

```text
aiexe.provider-observation-head-transitions.v1
```

Observed intervals:

```text
first -> second
  default branch heads unchanged
  open-work fingerprint changed

second -> third
  TrainingOS:
    0b69d1d7ad2c67c4ba36294ec153280c3da69352
    -> d75d7cb9c0c3ab6c0af3e2df147ac3f8aeecd5fc

  Video/Media:
    24996407449df28b2d83fce1a145b3200fff168a
    -> 9e3391d8d0eea52004026c5643370c72ba0506cb
```

The transition evidence is read-only and explicitly refuses to infer Domain status from head movement.

## Scheduler readiness audit

M2.9 adds:

```text
aiexe.provider-scheduler-readiness.v1
```

This is deliberately separate from the multi-run provider evidence.

A read-only inspection of the user's native scheduler configuration found an AIEXE hourly task substrate, but the currently observed task was disabled and its persistent prompt was not bound to the M2 provider-ingestion capture contract. Personal task identifiers and full scheduler metadata are deliberately not copied into this public repository.

The bounded observation is therefore:

```text
schedulerObserved                       true
hourlyCadenceObserved                   true
schedulerEnabled                        false
providerIngestionBindingObserved        false
immutableReceiptPersistenceObserved     false
successfulScheduledRunObserved          false
state                                    SCHEDULER_SUBSTRATE_PRESENT_DISABLED_INGESTION_UNBOUND
scheduledRuntimeProven                   false
recurringIngestionProven                 false
```

An existing hourly Controller task is not equivalent to a provider-ingestion runner. Enabling a scheduler alone is also insufficient. The proof state advances only after all of the following are explicit:

```text
scheduler enabled
+ provider ingestion binding
+ immutable receipt persistence
+ successful scheduled run
= SCHEDULED_PROVIDER_INGESTION_PROVEN
```

Caller-supplied `scheduledRuntimeProven` is rejected.

## Current G5 state

```text
real provider capture #1                 PASS
real provider capture #2                 PASS
real provider capture #3                 PASS
provider completeness repair             PASS
open-work change detection                PASS
real default-head transition detection    PASS
immutable multi-run verification          PASS
scheduler substrate observed              PASS
scheduler currently enabled               NO
provider ingestion binding                NOT PROVEN
immutable scheduled receipt persistence   NOT PROVEN
successful scheduled provider run         NOT PROVEN
G5                                         PARTIAL
```

## M3 implication

M2.9 improves evidence quality but does not authorize execution.

```text
G1 S8 controlled-delegation acceptance    PASS
G2 broader real replay/evaluation         PARTIAL
G3 structured recurring Controller output PARTIAL
G4 A2 accepted execution-path proof       PARTIAL
G5 recurring provider ingestion           PARTIAL
M3                                         BLOCKED
```

## Boundary

```text
TrainingOS repository write            NO
TradeOS repository write               NO
Video/Shared Media repository write    NO
scheduler configuration mutation       NO
cross-repository credentials           NO
S8 product files                       NO
A2 execution                           NO
Domain truth mutation                  NO
Merge PR #125                          NO while gated
Deploy                                 NO
Production mutation                    NO
Payment / settlement / wallet / token  NO
```
