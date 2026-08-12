# Group CEO Work Entry W1

Status: Draft implementation slice, stacked on W0 (`group.work-entry.v1` / `group.autonomy-policy.v1`).

## Goal

Create one bounded front door for the one-person-company operating model without creating another Management Plane, scheduler, authorization owner, HumanGate owner, provider runtime or Domain truth store.

```text
CEO / Owner
  -> group.work-entry.v1
  -> deterministic policy router first
  -> group.work-route.v1
  -> existing AIEXE Management Plane intake when matched
  -> group.owner-decision-item.v1 when owner attention is required
```

W1 is intentionally an adapter contract. It does not import or modify `src/management/**` because open PR #125 is the sole current Group Management Plane owner. A later wiring slice should consume `group.work-route.v1` from that owner after branch/merge sequencing is resolved.

## Deterministic-first rule

The router evaluates the current active `group.autonomy-policy.v1` catalog before any model suggestion.

- exactly one active policy for the requested action -> route through the W0 decision-escalation contract;
- no active policy -> `needs_human_review`, with manager fallback eligible;
- more than one active policy for the same action -> fail closed as `conflicting_active_policies`;
- caller-requested Domain cannot override the policy-owned Domain;
- expired policy is never treated as current routing authority.

`managementIntakeEligible=true` means only that the matched work may be handed to the existing management intake surface for its own checks. It is not execution authorization.

## Manager fallback boundary

A manager/model suggestion is allowed only when deterministic routing has no active policy match.

The suggestion must resolve to exactly one **existing active** policy candidate. It may not invent a new action or Domain and is always recorded as:

```text
proposalOnly = true
applied = false
ownerApprovalRequired = true
managerMayMintDomainTruth = false
```

The router never auto-applies the manager suggestion. Owner acceptance must result in a new/updated canonical Work Entry through an explicit later flow; it is not hidden inside W1.

## Owner decision queue

`group.owner-decision-item.v1` exists only when `ownerAttentionRequired=true`.

Priority is bounded:

- blocked route -> high;
- L4 consequential route -> critical;
- unresolved classification -> normal.

The item records no approval or rejection truth and creates no HumanGate decision.

## Authority boundaries

Every W1 route and decision item fixes:

```text
authorizationDecisionCreated = false
authorityGrantCreated = false
humanGateDecisionCreated = false
delegationCreated = false
executionAuthorized = false
domainTruthCreated = false
domainWritePerformed = false
externalActionPerformed = false
```

W1 additionally performs no network/provider call, filesystem mutation, child process execution, Domain write, scheduling, payment, contract signature, deployment or Production mutation.

## Why this is stacked rather than merged into #125

Open PR #125 currently owns `src/management/**` and the management-policy/portfolio implementation. W1 stays under `src/group-fabric/**` and adds only a product-neutral intake adapter. This keeps branch ownership non-overlapping and prevents the one-person-company initiative from forking the already-built Management Plane.

## Follow-on W1B

After W0/W1 exact-head acceptance and owner sequencing with #125:

1. consume matched `group.work-route.v1` in the existing Management Plane intake;
2. map blocked / needs-human-review route results into the existing attention/cockpit surface;
3. keep deterministic routing authoritative for known actions;
4. invoke a Manager model only to produce proposal-only classification for unresolved inputs;
5. bind resulting management proposal/evidence to the exact Work Entry and route digests;
6. preserve all existing A2/S8/execution.authorization.v1/HumanGate checks.

## Acceptance

- one Work Entry route contract;
- active-policy freshness enforced;
- policy conflict fails closed;
- requested Domain cannot override owner Domain;
- Manager cannot auto-apply a route or invent policy authority;
- only owner-attention work creates a CEO decision item;
- no execution authority or Domain truth created;
- no `src/management/**` path collision;
- full repository tests green before any merge consideration.
