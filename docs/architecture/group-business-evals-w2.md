# Group Business Evals W2

Status: Draft implementation slice, stacked on W1 and W0.

## Goal

Move the one-person-company operating model from “technical proof only” toward measurable business outcomes without letting metrics silently grant autonomy, execution authority or Production readiness.

```text
Work Entry / Route
  -> existing controlled execution/evidence layers
  -> group.business-eval.v1 receipts
  -> group.business-eval-series.v1
  -> group.business-review-policy.v1
  -> group.autonomy-review-proposal.v1
  -> Owner review only
```

W2 does **not** change the current autonomy policy. It only creates business evidence and an advisory owner-review proposal.

## `group.business-eval-series.v1`

The W0 `group.business-eval.v1` receipt measures one bounded evaluated work item. W2 aggregates multiple receipts for the same exact:

- action code;
- owner Domain;
- autonomy policy reference + digest;
- autonomy level.

A series cannot mix policy versions or Domain ownership.

Metrics are weighted by trial count, not by receipt count:

- success / failure / unknown rate;
- human takeover rate;
- total and mean human minutes;
- total and mean cycle time;
- total and mean cost;
- error count/rate;
- reversal count/rate;
- downstream business metric when every receipt has the same metric identity.

If downstream metrics are missing or use different metric identities, the series reports `not_comparable` rather than fabricating an aggregate.

The series is deterministic across input receipt ordering and remains business evidence only.

## `group.business-review-policy.v1`

This is an explicit owner-defined review threshold contract, not an autonomy-grant policy.

It binds to one exact autonomy policy digest and can specify:

- minimum total trials;
- minimum eval receipts;
- minimum success rate;
- maximum unknown rate;
- maximum human takeover rate;
- maximum mean human minutes;
- maximum mean cycle time;
- maximum mean cost;
- maximum error rate;
- maximum reversal rate.

The contract is time-bounded and fixes:

```text
reviewCriteriaOnly = true
canPromoteAutonomy = false
canGrantProductionReadiness = false
```

## `group.autonomy-review-proposal.v1`

This artifact compares one exact business-eval series with one active review policy.

Possible states:

- `insufficient_evidence`;
- `below_thresholds`;
- `ready_for_owner_review`;
- `consequential_manual_only`.

`ready_for_owner_review` does not mean “promote”. It means only that the measured evidence met the review thresholds and the Owner may inspect whether a future explicit policy change is justified.

L4 consequential work can never become an automatic advancement candidate from business-eval evidence. Even perfect metrics yield `consequential_manual_only`.

Every proposal fixes:

```text
proposalOnly = true
policyMutationPerformed = false
autonomyPromoted = false
productionReadinessGranted = false
executionEligibilityGranted = false
authorizationDecisionCreated = false
authorityGrantCreated = false
humanGateDecisionCreated = false
delegationCreated = false
executionAuthorized = false
domainTruthCreated = false
domainWritePerformed = false
externalActionPerformed = false
```

## Why this is a separate group-fabric slice

PR #125 still owns `src/management/**`. W2 intentionally remains under `src/group-fabric/**` and can later feed its score/evidence into the existing Management Plane cockpit after owner-safe wiring. It does not create a second portfolio system.

## Product meaning

The operating-system KPI changes from:

> How many Agents / PRs / protocols did we create?

into:

> How much successful work was completed per human minute, per dollar and per unit of elapsed time, with what error/reversal/takeover rate and downstream business result?

That is the business-evidence basis for deciding whether a bounded workflow deserves more delegation.

## Acceptance

- aggregation is trial-weighted and deterministic;
- duplicate or mixed-policy receipts fail closed;
- metric identity mismatch is explicit;
- review thresholds are explicit, version-bound and time-bounded;
- insufficient evidence never looks ready;
- quality shortfall never looks ready;
- threshold success creates only an Owner-review proposal;
- L4 never auto-advances;
- hidden approval/promotion shortcuts are rejected;
- no network/provider/Domain-write/management-write dependency;
- full repository CI green before any merge consideration.

## Follow-on W3

After W0/W1/W2 acceptance, instrument three low-risk real loops beginning at L0/L1:

1. buyer research -> CRM candidate -> follow-up draft;
2. training demand -> proposal/deck/delivery pack;
3. content idea -> script -> render -> pre-publication pack.

Each loop should emit technical evidence plus `group.business-eval.v1`, then accumulate a W2 series. No loop receives higher autonomy merely because code exists; observed business evidence and explicit Owner policy change remain separate steps.
