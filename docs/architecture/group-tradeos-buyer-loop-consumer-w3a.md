# Group W3A — TradeOS Buyer Research Consumer

Status: Draft implementation slice, stacked on W2/W1/W0.

## Purpose

Consume the TradeOS `tradeos.group-buyer-research-loop.v1` evidence receipt at the Group control-plane boundary without importing TradeOS source code, creating a second Domain truth owner, or converting a domain receipt into execution authority.

```text
TradeOS Presales truth
  -> tradeos.group-buyer-research-loop.v1
  -> AIEXE exact receipt validation + W0 provenance binding
  -> group.domain-loop-intake.v1
  -> group.next-work-proposal.v1 (when safe)
  -> later canonical Work Entry / policy route / capability-provider resolution
```

The consumer is intentionally network-free and provider-free. It creates only a next-work proposal. Existing AIEXE owners remain responsible for Work Entry routing, authorization, scheduling, provider runtime and HumanGate.

## Exact cross-domain binding

The consumer requires the full W0 `group.work-entry.v1` and `group.autonomy-policy.v1` objects and verifies their digests.

The TradeOS receipt must bind exactly to the same:

- Work Entry reference + digest;
- autonomy-policy reference + digest;
- action code `buyer_research`;
- policy owner Domain `tradeos`;
- autonomy level L0 or L1.

A mismatched Work Entry, policy digest, owner Domain or autonomy level fails closed.

The TradeOS receipt's own `loopDigest` is recomputed with the same recursively key-sorted JSON / SHA-256 canonicalization used by the TradeOS source contract. Tampered receipts fail closed before state is consumed.

## Closed TradeOS schema boundary

The consumer accepts only the W3A fields required to make a bounded Group routing decision. Unknown fields fail closed.

In particular, the draft-intent surface may contain only:

```text
kind
leadKey
buyerOrPublisher
a fixed objective
evidenceFactRefs
draftOnly = true
recipientResolved = false
contactDataImported = false
sendAuthorized = false
externalActionPerformed = false
```

It rejects source free-text additions such as `evidenceNote`, message bodies, recipient addresses or send commands.

The source boundaries must retain:

```text
sourceReadOnly = true
canonicalBusinessObjectCreated = false
domainTruthMutated = false
crmRecordCreated = false
contactDataImported = false
sourceFreeTextCopiedToDraft = false
messageBodyPersisted = false
recipientResolved = false
externalSendPerformed = false
supplierCreated = false
opportunityCreated = false
financingPerformed = false
paymentPerformed = false
chainActionPerformed = false
```

## `group.domain-loop-intake.v1`

This is a Group-side receipt that says the TradeOS evidence was accepted structurally and bound to the exact W0 request/policy.

It records only bounded state and technical evidence references. It deliberately does not copy the buyer organization, source next-action text, source facts, inference or evidence note into the Group intake.

```text
sourceDomainTruthPreserved = true
sourceFreeTextImported = false
businessEvalMeasurementRequired = true
businessEvalCreated = false
providerRouteResolved = false
capabilityResolved = false
executionEligibilityGranted = false
```

## Next-work proposal mapping

### `needs_more_research`

Creates a proposal only for:

```text
requestedActionCode = buyer_research
requiredAutonomyLevel = L0
workKind = research_evidence
intentCode = continue_buyer_research
```

This is not a retry or an execution start. It requires a new canonical Work Entry and a fresh policy match through the existing Group router.

### `candidate_review_ready`

Creates a proposal only for a future L1 `buyer_outreach_draft` Work Entry.

### `draft_review_ready`

Maps the exact TradeOS draft kind:

- `follow_up_draft` -> `buyer_follow_up_draft`;
- `response_draft` -> `buyer_response_draft`.

Both require L1 and `ownerApprovalBeforeExternalEffect=true`.

This still does not mean a message can be sent. Any later external send would be a separate L3 action/policy/eval problem.

### `blocked`

Creates no next-work proposal. Owner attention remains required.

## Business-eval handoff

The consumer does not infer a business result from TradeOS counters.

It carries technical evidence refs and fixes:

```text
businessEvalMeasurementRequired = true
businessEvalCreated = false
```

Only an observed completed trial may later become W0 `group.business-eval.v1`, then W2 series/review evidence.

## Why provider execution is not wired here

Unified provider runtime PRs #144–#150 already own the shared provider contracts/executors and remain Draft. This W3A consumer therefore does not create a competing provider client or adapter.

The next owner-safe wiring step is:

```text
group.next-work-proposal.v1
-> new canonical group.work-entry.v1
-> W1 deterministic policy route
-> existing capability/runtime owner
-> execution.authorization.v1 / HumanGate as already required
-> observed outcome
-> group.business-eval.v1
```

## Fixed authority boundary

Every Group intake / next-work proposal fixes:

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

No network call, provider call, message send, CRM write, payment, contract signature, deployment or Production mutation occurs in W3A consumer.

## Acceptance

- exact W0 Work Entry/policy binding;
- TradeOS loop digest recomputation;
- closed input schema;
- current TradeOS privacy/execution boundaries revalidated;
- source free text not imported into Group intake;
- blocked state produces no next work;
- research state proposes only L0 research;
- draft states propose only L1 draft Work Entries;
- next work remains proposal-only and requires a fresh Work Entry/policy match;
- no provider/capability resolution in this slice;
- no execution authorization or external effect;
- focused + full repository tests green before merge consideration.
