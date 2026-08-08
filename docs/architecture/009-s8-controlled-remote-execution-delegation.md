# ADR-009 — S8 Controlled Remote Execution Delegation

## Status

Proposed for S8 Gate 0. Canonical issue: #115.

Exact starting main:

```text
7872ec55d5b7c12fb9eed2f7a535457f41c186c7
```

## Context

S0–S6 established local execution authority, mission orchestration, delivery observation, operator control, approved provider observations and bounded scheduling. S7 added optional collaboration-safe state mirroring between independent instances while explicitly forbidding remote execution authority.

The next product step is not to turn S7 mirror records into commands. The next step is to define a new, narrow authority boundary for **delegation**: one instance may ask another instance to perform bounded work, but the destination remains sovereign over whether and how local execution occurs.

## Decision

S8 will use a proposal/admission/acceptance/binding architecture.

```text
SOURCE INSTANCE
canonical ready work
→ DelegationRequest
→ bounded transport

DESTINATION INSTANCE
IncomingDelegationProposal
→ local peer/policy validation
→ local capability/grant/provider/resource/scheduling validation
→ destination HumanGate
→ exactly-once DelegatedExecutionBinding
→ existing S6/S2/S1 execution authority
→ DelegationReceipt / bounded evidence

SOURCE INSTANCE
receipt mirror
→ explicit source-local S2 handoff/output validation
```

No remote call enters WorkerManager, HumanGate approval, ResourceLock mutation or provider execution directly.

## Authority decomposition

### Source authority

Source owns:

- deciding which canonical source work may be delegated;
- constructing immutable bounded request data;
- choosing one exact destination peer binding already permitted by local source policy;
- persisting request identity, sequence and digest;
- interpreting receipts only through source-local Mission/handoff rules.

Source does **not** own destination execution.

### Destination admission authority

Destination owns:

- peer binding acceptance;
- delegation policy;
- capability installation/grant existence;
- provider/resource/scheduling validation;
- HumanGate decision;
- creation of destination-local execution identity;
- runtime, recovery, retries and cancellation after local binding.

### S7 authority

S7 remains collaboration mirror infrastructure. S8 may reuse a transport substrate or source identity, but S7 mirror records remain read-only and non-executable.

## Why proposal-first

Direct remote execution would collapse several accepted trust boundaries:

```text
remote identity → local Worker control
remote Workspace → local capability authority
remote status → local scheduling truth
remote command → HumanGate bypass risk
```

Proposal-first preserves existing local authorities and makes every authority expansion explicit and auditable.

## Canonical data separation

Destination storage is separated into:

```text
S8 request/admission projections
S8 HumanGate/binding metadata
existing S1/S2/S6 canonical execution projections
```

Inbound remote data may write only S8 request/admission state before local acceptance.

After local acceptance, S8 records a binding to an execution identity created through existing destination services. S8 does not duplicate Task/Mission/ResourceLock/ExecutionRun truth.

## Exactly-once binding

The critical invariant is:

```text
one accepted DelegationRequest
→ at most one DelegatedExecutionBinding
→ at most one destination-local execution identity
```

Implementation must enforce this with durable identity, digest and uniqueness semantics, not only in-memory guards.

Duplicate transport deliveries remain harmless.

## Admission snapshot

Admission is evidence-driven rather than implicit.

A `DelegationAdmissionSnapshot` captures the exact bounded inputs used to decide whether a request may proceed to HumanGate:

```text
peer binding digest
policy digest
request digest
capability installation id
AgentCapabilityGrant id
provider-use digest when applicable
resource-state digest
scheduling-state digest
reason codes
observedAt
```

If any authority input becomes stale before binding, S8-I must revalidate before creating local execution identity.

## HumanGate layering

S8 introduces a **delegation admission HumanGate**, not a replacement for existing action HumanGates.

```text
remote request
→ delegation gate accepted
→ local execution identity created
→ existing local action HumanGate still applies when the action requires it
```

This keeps "accept work from this peer" distinct from "authorize this external effect".

## Capability mapping

S8 does not transmit executable code packages or install capabilities remotely in v1.

The destination must already contain the exact accepted capability version and local grant. The request refers to public bounded identifiers only.

If destination capability/grant is absent, the request remains inadmissible.

## Scheduling integration

S8 must not reserve a Worker or bypass S6.

Once local binding exists, delegated work enters the same readiness and scheduling path as locally-originated work under destination policy.

S6 remains final bounded selection policy; S1 ResourceLocks remain final resource authority.

## Transport architecture

S8 may use the same project-owned endpoint family as S7, but with separate schema/classes and separate handlers.

Illustrative routes:

```text
POST /v1/delegations/requests
GET  /v1/delegations/inbox
POST /v1/delegations/acks
GET  /v1/delegations/receipts
POST /v1/delegations/cancellations
```

Actual routes may differ, but the following remain mandatory:

- exact configured endpoint;
- fixed schema-defined methods;
- no renderer arbitrary URL/method/header control;
- JSON only;
- bounded sizes and timeouts;
- no ambient browser credentials;
- transport success is not authority acceptance.

## Trust model

Trust is explicit and bilateral.

A `DelegationPeerBinding` identifies exactly:

```text
source instance + source Workspace
↔ destination instance + destination Workspace
```

No wildcard peer, wildcard Workspace or implicit discovery is accepted in v1.

A `DelegationPolicySnapshot` is destination-defined and immutable by version.

Remote TeamRole from S7 does not automatically create S8 execution delegation authority.

## Cancellation architecture

Remote cancellation is split by local lifecycle:

```text
pre-binding:
  cancellation proposal → destination may cancel pending proposal locally

post-binding:
  cancellation proposal → informational only
  destination local operator/runtime decides pause/cancel/stop
```

This avoids remote process-control authority and uncertain external-effect duplication.

## Result architecture

Destination emits bounded `DelegationReceipt` revisions and evidence digests.

Source stores them in an S8 result mirror. They do not directly mutate source Task/Mission state.

An explicit S2 handoff adapter may consume a completed receipt only when:

- expected request id matches;
- expected receipt state matches;
- evidence class/digest matches;
- source Mission revision is current;
- receipt has not already been consumed by that handoff identity.

## Failure modes

### Duplicate request

Exact same id/digest: idempotent.

Same id with different digest: divergence and reject.

### Sequence gap

Reject beyond gap; never invent missing requests.

### Policy revoked after receipt but before binding

Revalidation rejects binding.

### HumanGate rejected

No local execution identity exists.

### Destination restart after acceptance but before binding

Persisted acceptance is rehydrated, but binding creation must be exactly-once and explicitly resumed through local service logic; no duplicate effect.

### Destination restart after binding

Existing S1/S2 recovery rules govern execution. S8 does not re-submit the request.

### Source restart

Acknowledged requests are not sent again as new identities. Receipts rehydrate as mirror state.

### Transport outage

No local correctness dependency. No busy retry loop.

## Security properties

S8 must preserve:

- Workspace exactness;
- destination sovereignty;
- least privilege;
- no credential/profile/process replication;
- no remote HumanGate approval;
- no remote Worker control;
- no ResourceLock bypass;
- no hidden provider writes;
- no remote retry of uncertain effects;
- no arbitrary renderer networking;
- no last-write-wins authority merge;
- deterministic identity/digest evidence;
- restart no replay.

## First implementation wave

After S8-A merges from one exact main:

```text
S8-B  policy / peer binding / request integrity domain
S8-C  destination admission / authority revalidation domain
S8-D  bounded request / receipt transport protocol
S8-E  delegation inbox / status / evidence UI
```

Sibling owners use disjoint paths and may not import each other before merge.

After B/C/D/E independently merge:

```text
S8-I  shared SQLite/application/IPC/preload/S4/S7 composition
```

Only after S8-I freezes one accepted product head:

```text
S8-F  independent native arm64 two-instance + real Electron acceptance
```

## Consequences

### Positive

- enables real cross-instance work sharing without remote administration;
- preserves S0–S7 authority architecture;
- supports exact replay/idempotency evidence;
- keeps credentials and browser session internals local;
- makes delegation understandable in HumanGate and cockpit UI;
- allows later stronger remote-execution features to be separately gated.

### Costs

- two-stage authorization can add operator friction;
- destination must pre-install/grant required capabilities;
- result consumption requires explicit source-local handoff semantics;
- offline behavior cannot promise immediate delegated completion;
- direct remote Worker control remains intentionally unavailable.

## Rejected alternatives

### Treat S7 mirror records as commands

Rejected because S7 is explicitly read-only collaboration state.

### Remote Worker control RPC

Rejected because it bypasses destination scheduling/HumanGate/resource authority.

### Forward browser profile/cookies/tokens

Rejected because it violates permanent privacy/security boundaries.

### Remote capability installation

Rejected in S8 v1 because it couples delegation with capability supply-chain authority.

### Last-write-wins distributed execution state

Rejected because execution authority conflicts must fail closed.

## Gate 0 conclusion

S8 is feasible only as **controlled delegation with destination-local acceptance and execution sovereignty**. Implementation that turns it into a remote control plane is outside this ADR and must be rejected.