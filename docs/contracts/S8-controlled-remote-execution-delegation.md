# S8 Controlled Remote Execution Delegation Contract

## Status

Gate 0 contract for S8. Canonical coordination issue: #115.

Exact starting main:

```text
7872ec55d5b7c12fb9eed2f7a535457f41c186c7
```

S0–S7 are accepted GO milestones. S7 remains an optional read-only collaboration mirror. S8 introduces a separate, explicit delegation authority and must not retroactively convert S7 mirror state into executable commands.

## Product goal

S8 lets one trusted AI Execution OS instance request bounded work from another trusted instance while keeping the destination sovereign over local execution.

```text
source canonical ready work
+ active bilateral delegation policy
+ exact destination Workspace binding
+ exact capability/action/target request
→ immutable DelegationRequest
→ bounded project-owned transport
→ destination IncomingDelegationProposal
→ destination-local authority validation
→ destination-local HumanGate
→ destination-local delegated execution identity
→ existing S6/S2/S1 scheduler / ResourceLocks / Worker runtime
→ DelegationReceipt + bounded result evidence
→ source read-only result mirror
```

A remote request is a proposal, not an execution command.

## Local sovereignty invariant

The destination remains the sole execution authority.

Remote state cannot directly:

```text
start / stop / focus / pause / resume Worker
approve / reject HumanGate
install / grant capability
acquire / release ResourceLock
select browser profile or process handle
invoke provider effect
retry failed / uncertain work
force-cancel running execution
change destination scheduling/provider limits
```

Only accepted destination-local S1/S2/S6 paths may create runnable work or external effects.

## Durable objects

### DelegationPeerBinding

Bilateral identity and Workspace mapping.

```text
id
sourceInstanceId
sourceWorkspaceId
destinationInstanceId
destinationWorkspaceId
status: active | suspended | revoked
createdAt
updatedAt
```

Properties:

- exact source and destination instance ids;
- exact source and destination Workspace ids;
- no wildcard Workspace binding in v1;
- suspended/revoked binding rejects new requests;
- binding does not itself grant capability or execution authority.

### DelegationPolicySnapshot

Immutable destination-authorized allow-set.

```text
id
version
peerBindingId
destinationWorkspaceId
status: active | superseded | revoked
allowedCapabilityVersionIds
allowedActions
allowedTargets
maxPendingRequests
maxAcceptedNotStarted
expiresAt | null
createdAt
```

The policy is an upper bound, never a mandate to accept work.

Unknown, stale, expired, superseded or revoked policy fails closed.

### DelegationRequest

Immutable source request.

```text
id
sourceInstanceId
sourceWorkspaceId
destinationInstanceId
destinationWorkspaceId
peerBindingId
policyId
policyVersion
sourceMissionId | null
sourcePlanStepId | null
capabilityVersionId
action
target
payloadClass
payload
payloadDigest
requestSequence
previousRequestDigest
requestDigest
createdAt
```

Properties:

- request payload is schema-bounded and recursively privacy-safe;
- request digest binds all semantic fields;
- requestSequence is monotonic per peer binding/source;
- request id reuse with a different digest is divergence;
- a request never contains credentials, browser profile state or process controls.

### IncomingDelegationProposal

Destination-local read/admission record.

```text
id
delegationRequestId
peerBindingId
policyId
workspaceId
state: received | inadmissible | waiting_human | accepted | rejected | cancelled_before_start | bound | terminal
reasonCode | null
receivedAt
updatedAt
```

Receiving a proposal must not create a Task, StepAttempt, ResourceLock or provider effect.

### DelegationAdmissionSnapshot

Immutable evidence of destination-local revalidation.

```text
id
proposalId
workspaceId
peerBindingDigest
policyDigest
capabilityInstallationId
agentCapabilityGrantId
providerUseDigest | null
resourceStateDigest
schedulingStateDigest
requestDigest
admissible
reasonCodes
observedAt
```

Admission checks must independently confirm local authority rather than trusting source claims.

### DelegationAcceptance

Destination-local operator decision.

```text
id
proposalId
workspaceId
humanGateId
state: accepted | rejected
admissionSnapshotId
decidedAt
```

The destination HumanGate belongs to the destination. The source cannot approve or reject it remotely.

### DelegatedExecutionBinding

Exactly-once bridge from accepted remote request to local execution identity.

```text
id
proposalId
delegationRequestId
workspaceId
localMissionId | null
localPlanStepId | null
localTaskId | null
localStepAttemptId | null
localExecutionRunId | null
createdAt
```

Rules:

- one accepted DelegationRequest maps to at most one local execution identity;
- the binding is created only after destination HumanGate acceptance;
- local execution then follows existing S2/S6/S1 authority;
- replay cannot create a second binding.

### DelegationReceipt

Bounded destination result summary.

```text
id
delegationRequestId
delegatedExecutionBindingId
sourceInstanceId
destinationInstanceId
state: accepted | running | completed | failed | cancelled | uncertain
resultClass | null
resultSummary | null
evidenceDigests
receiptRevision
receiptDigest
observedAt
```

Receipt is collaboration evidence. It is not source-side execution truth and cannot mutate source canonical Task/Mission state directly.

### DelegationResultEvidence

Privacy-safe evidence references only.

```text
id
receiptId
evidenceType
digest
summary
createdAt
```

No raw credentials, profiles, process ids, cookies, tokens or secret-bearing request/response bodies.

### DelegationCancellationProposal

Source request to withdraw pending work.

```text
id
delegationRequestId
reasonClass
createdAt
```

Before local execution starts, destination may locally accept the cancellation proposal. After local execution starts, remote cancellation is non-authoritative.

## Bilateral authority requirements

A destination may move a request from `received` toward a local HumanGate only when all are true:

```text
peer binding active
source instance exact match
source Workspace exact match
destination instance exact match
destination Workspace exact match
policy active and exact version match
policy not expired/revoked/superseded
capabilityVersionId allowed
action allowed
target allowed
destination capability installation already exists
destination AgentCapabilityGrant already exists
request sequence/digest current
payload privacy-safe and schema-valid
provider-use state accepted when applicable
resource/scheduling state current
pending-request bounds not exceeded
```

Any missing or stale evidence produces `inadmissible` with explicit reason code.

## Required reason codes

Initial reason-code vocabulary includes:

```text
peer_binding_missing
peer_binding_suspended
peer_binding_revoked
cross_workspace
wrong_destination_instance
unknown_source_instance
policy_missing
policy_stale
policy_expired
policy_revoked
policy_version_mismatch
capability_not_allowed
action_not_allowed
target_not_allowed
local_installation_missing
local_grant_missing
provider_authority_missing
provider_authority_stale
resource_state_stale
scheduling_state_stale
request_sequence_gap
request_digest_conflict
payload_schema_rejected
privacy_boundary_rejected
pending_limit_reached
human_gate_required
human_gate_rejected
already_bound
already_terminal
post_start_remote_cancel_non_authoritative
```

## Request integrity and replay semantics

```text
same request id + same digest       → duplicate / idempotent
same request id + different digest → reject divergence
same sequence + different request  → reject divergence
next exact sequence                → append allowed
sequence gap                       → fail closed
accepted + already bound           → never create second execution identity
receipt replay                     → idempotent mirror update only
restart                            → rehydrate, no auto-accept / auto-submit / auto-retry
```

No last-write-wins conflict handling for execution authority.

## HumanGate semantics

S8 requires a destination-local delegation gate before runnable delegated work exists.

The gate must show at least:

```text
source instance
source Workspace
destination Workspace
peer binding
policy id/version
capability version
action
target
bounded payload summary
local Agent/capability grant
provider/resource/scheduling admission evidence
what local identity will be created after acceptance
```

HumanGate acceptance authorizes only creation of the bounded destination-local delegated execution identity. Existing S1/S2 gates required by the actual action still remain in force.

S8 must not collapse delegation admission and action authorization into one hidden remote command.

## Capability and provider boundary

The destination must already have:

```text
CapabilityInstallation
AgentCapabilityGrant
accepted target/action scope
provider-use authority where required
```

The source cannot install/grant a capability remotely.

S8 v1 adds no authenticated third-party provider write authority. Native acceptance uses project-owned local test surfaces and already accepted execution paths.

## Transport boundary

S8 may reuse the project-owned S7 transport substrate only as a bounded carrier, not as S7 mirror semantics.

Allowed first-slice shape:

```text
exact configured destination endpoint
schema-defined POST delegation request
schema-defined GET/POST acknowledgement / receipt retrieval as needed
JSON only
bounded request/response sizes
explicit timeouts
no ambient browser credentials
no renderer-provided arbitrary headers
no arbitrary URL/method IPC
```

A transport success does not mean delegation acceptance.

## Privacy boundary

Cross-instance data must never include:

```text
authorization headers
cookies / set-cookie
passwords
access / refresh / id tokens
private keys
wallet / seed / signing material
browser profile paths/data
userData directories
storageState
process ids / control handles
raw debugging endpoints
raw environment secrets
secret-bearing provider request/response bodies
```

Payloads use explicit safe schemas and recursive forbidden-field/value checks.

## Cancellation semantics

### Before local execution binding

Source may emit a `DelegationCancellationProposal`.

Destination may:

```text
accept locally → proposal cancelled_before_start
ignore/reject   → proposal remains locally governed
```

### After local execution binding

Remote cancellation is informational only.

The destination may independently use existing local S1/S2 pause/cancel/stop rules, but no remote cancellation message may directly invoke those controls.

## Failure and recovery

### Transport unavailable

- source request remains persisted as pending transport;
- no busy retry loop;
- destination local execution remains unaffected;
- source local execution remains unaffected unless the source explicitly chose delegation as a dependency and remains waiting on its own declared state.

### Destination unavailable

- source sees unavailable/stale delegation state;
- no implicit fallback that creates duplicate local+remote effects;
- fallback requires explicit source-side plan/review authority.

### Destination restart

- proposals, admission evidence, HumanGate state, bindings and receipts rehydrate;
- no previously accepted request creates a second local identity;
- no HumanGate is auto-approved;
- no provider effect is replayed.

### Source restart

- request identity/sequence/digest state rehydrates;
- acknowledged request is not reissued as a new request;
- receipt mirror rehydrates without mutating source execution truth.

## Source-side completion boundary

A receipt may satisfy a source Mission dependency only through an explicit source-local S2 handoff/output contract that validates:

```text
expected delegation request id
expected receipt state
expected evidence digest/class
current source Mission revision
```

A raw remote receipt or S7 mirror record cannot release a dependency by itself.

This source-side integration belongs to S8-I and must preserve S2 revision identity rules.

## IPC boundary

S8-I may expose a bounded namespace such as:

```text
queryDelegationState(workspaceId)
recordPeerBinding(input)
recordDelegationPolicy(input)
createDelegationRequest(input)
pushDelegationRequest(id)
pullDelegationInbox(workspaceId)
approveDelegationProposal(input)
rejectDelegationProposal(input)
proposeDelegationCancellation(input)
pullDelegationReceipts(workspaceId)
```

Names are illustrative until implementation freezes them.

No generic remote command, arbitrary fetch, arbitrary SQL, arbitrary Worker control or arbitrary HumanGate decision endpoint is allowed.

## UI surfaces

S8-E / S8-I should explain, not hide, the authority chain:

```text
Delegation / Overview
Peer Bindings
Policies
Outbound Requests
Incoming Proposals
Admission Evidence
Local HumanGate
Local Execution Binding
Receipts / Evidence
Divergence / Replay / Rejection Reasons
```

Remote Worker controls are intentionally absent.

## Required final evidence

S8-F must prove on one frozen product head:

- S0–S7 regression green;
- two independent source instances/data roots;
- exact active peer binding and policy version;
- admissible request remains non-runnable before destination HumanGate;
- HumanGate rejection creates zero local execution identity;
- HumanGate acceptance creates exactly one destination-local execution identity;
- existing S6/S2/S1 scheduler, ResourceLocks and action HumanGate remain authoritative;
- duplicate request and restart cannot create duplicate binding/effect;
- stale/revoked/expired policy fails closed;
- cross-Workspace, wrong-destination, unknown-source, digest-conflict and sequence-gap fail closed;
- missing destination installation/grant fails closed;
- no credential/profile/process material crosses instances;
- no remote Worker controls or HumanGate decision surface;
- pre-start cancellation is proposal-only and locally accepted/rejected;
- post-start remote cancel cannot invoke local stop/cancel directly;
- receipt/result mirror is bounded and privacy-safe;
- source canonical execution does not mutate merely by pulling receipts;
- explicit source-local handoff can consume a validated completed receipt exactly once;
- restart no replay / no reapproval / no duplicate execution;
- native Apple Silicon two-instance real Electron acceptance;
- real Chrome and Chromium Workers on project-owned local test surfaces;
- page/console errors = 0;
- zero residual scoped processes;
- immutable artifact + SHA256SUMS.

## Permanent boundary

S8 is controlled delegation, not remote administration.

Direct remote Worker control, remote HumanGate approval, remote ResourceLock mutation, credential forwarding, authenticated third-party provider mutation, automatic production deployment/database migration, financial/payment/wallet/legal execution, or bypass of pricing/rate/quota/concurrency restrictions remains outside S8 and requires another separately accepted Gate 0.