# W4 — Group CEO Portfolio Cockpit

## Purpose

W4 adds the first deterministic, read-only CEO portfolio projection for the Group AI Operating System.

It is intentionally **not** a second Management Plane. Open PR #125 remains the sole owner of `src/management/**`, management scheduling/attention semantics, and the future owner-safe UI/intake wiring.

W4 lives only in `src/group-fabric` and turns already-bounded Domain evidence into one compact daily brief:

```text
Domain controllers / Group business evidence
→ group.domain-portfolio-card.v1
→ group.ceo-portfolio-brief.v1
→ later owner-safe Management Plane / attention-surface wiring
```

The primary brief shows human-readable portfolio health, goals, opportunities, projects, exceptions, CEO-attention decisions, and measured agent business performance. SHA-256/evidence trace stays in `detailIndex` rather than crowding the primary cards.

## Canonical ownership

Domain truth remains with the Domain owners:

```text
TradeOS       → trade/business truth
TrainingOS    → learning/training truth
Shared Media  → render/media technical truth
AIEXE         → Group contracts, bounded aggregation, proposals, business evidence
Management #125 → management/attention owner
```

W4 does not fetch Domain repositories, call providers, mutate Domain truth, create management tasks, decide HumanGate, grant authorization, or execute work.

## Portfolio cards

Schema:

```text
group.domain-portfolio-card.v1
```

Initial owner domains:

```text
aiexe
tradeos
trainingos
shared-media
```

Card kinds:

```text
goal
opportunity
project
exception
```

Each card binds:

```text
cardRef
ownerDomain
cardKind
title
exact Group Work Entry ref + digest
source schema/ref/digest
source observation time
health/state/reason
attention flag
optional next action code
optional owner-decision proposal
evidence refs
```

The source digest accepts either raw SHA-256 hex or `sha256:<hex>` and normalizes it to `sha256:<hex>`. This allows W0/W1/W2 AIEXE digests and Domain-local W3 digests to meet at one read-only cross-domain display boundary without changing their canonical source schemas.

## Fixed freshness rule

W4 fixes the first cockpit card freshness window at 24 hours.

```text
MAX_CARD_AGE_SECONDS = 86400
```

The caller cannot widen it.

If a source is older than 24 hours, W4 fails closed:

```text
freshness = stale
health = unknown
attentionRequired = true
reasonCode = source_stale
staleSourceMayGrantPositiveTruth = false
```

A future source timestamp is rejected.

This means a stale `on_track` source can never keep the CEO dashboard green merely because its last observation was positive.

## CEO decision queue

W4 accepts only explicit owner-decision **proposals** carried by cards. It never invents a decision to make the dashboard look full.

Target display range:

```text
minimum target = 3
maximum visible = 10
```

Deterministic priority:

```text
critical
→ high
→ normal
→ decisionRef lexical order
```

Coverage states:

```text
below_target   # fewer than 3 real decision proposals
within_target  # 3–10
above_capacity # more than 10; top 10 shown, remainder counted
```

Even when a card says the CEO should review/approve/reject/choose something, W4 records no chosen outcome:

```text
proposalOnly = true
ownerDecisionRecorded = false
humanGateDecisionCreated = false
authorizationDecisionCreated = false
externalActionPerformed = false
```

The words `approve` and `reject` are decision categories for display; they are not approval truth.

## Portfolio health

Aggregate health is deterministic:

```text
any blocked          → blocked
else any attention   → attention
else any unknown     → attention
else                 → on_track
```

No LLM is asked to classify or summarize source facts inside this slice.

## Measured business performance

W4 can consume canonical W2 `group.business-eval-series.v1` objects.

Before extraction it recomputes the exact W2 series digest and checks the no-authority/business-evidence boundary. Tampered series are rejected.

The primary performance cards expose only measured fields such as:

```text
actionCode
ownerDomain
autonomyLevel
trialCount
success/failure/unknown rates
human takeover rate
mean human minutes
mean cycle time
mean cost
error/reversal rates
downstream metric
observedAt
```

W4 cannot turn good business metrics into autonomy or Production readiness:

```text
autonomyPromoted = false
productionReadinessGranted = false
```

The separate W2 owner-review policy/proposal remains the only advisory path for evaluating such changes, and even that path does not mutate policy.

## Primary view vs details

Primary cards deliberately omit:

```text
cardDigest
workEntryDigest
sourceDigest
evidenceRefs
```

Those fields remain available in `detailIndex` with source schema/ref/time so the CEO sees a clean operating view while engineers/auditors can drill into exact evidence.

## Closed boundaries

Every W4 card and brief fixes:

```text
sourceSemanticsVerifiedByThisModule = false
llmFactGenerationAllowed = false
managementPlaneMutationPerformed = false
decisionTruthCreated = false
authorizationDecisionCreated = false
authorityGrantCreated = false
humanGateDecisionCreated = false
delegationCreated = false
executionAuthorized = false
domainTruthCreated = false
domainWritePerformed = false
externalActionPerformed = false
paymentPerformed = false
productionDeploymentPerformed = false
```

Therefore W4 is a deterministic portfolio **read model**, not an execution controller.

## Scope and follow-on

This W4 slice is stacked on W3A AIEXE consumer PR #161, which itself stacks on W2 → W1 → W0. It changes only:

```text
src/group-fabric/group-ceo-portfolio-cockpit.cjs
tests/group-ceo-portfolio-cockpit-w4.test.cjs
docs/architecture/group-ceo-portfolio-cockpit-w4.md
.github/workflows/group-ceo-portfolio-cockpit-w4.yml
```

No `src/management/**` path is touched.

Follow-on after exact-head proof: define the smallest owner-safe adapter by which #125 can consume `group.ceo-portfolio-brief.v1` into its existing attention surface without copying W4 aggregation logic or creating a second management owner.

Merge = NO. Deploy = NO. External action = NO.
