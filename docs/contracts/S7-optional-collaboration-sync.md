# S7 Optional Collaboration and Sync Contract

## Status

Gate 0 contract for S7. Canonical coordination issue: #103.

Exact starting main:

```text
e7d2e7ee8d5ab0bfccbaaae59986dd97c016f0df
```

S0–S6 are accepted GO milestones. S7 is optional collaboration infrastructure and must not weaken local correctness.

## Product goal

S7 adds an opt-in shared Workspace mirror so separate AI Execution OS instances can exchange collaboration-safe status while each instance retains its own local execution authority.

```text
local canonical state
→ collaboration-safe projection
→ immutable SyncEnvelope
→ bounded project-owned sync transport
→ remote append-only mirror
→ membership/visibility filter
→ SharedWorkspaceSnapshot
→ local read-only collaboration UI
```

The remote mirror is not a scheduler, Task authority, HumanGate authority, Worker controller, capability authority, resource-lock authority, provider-effect authority, or canonical replacement for local SQLite.

## Local correctness invariant

S7 may be disabled, offline, stale, divergent or unavailable without breaking S0–S6 local execution.

```text
S7 disabled/unavailable
≠ local execution unavailable
```

Local Task, Mission, ResourceLock, HumanGate, ExecutionRun, scheduling and evidence semantics continue to operate using accepted local authorities.

## Durable objects

### SyncConfiguration

Workspace-scoped opt-in configuration.

Required fields:

```text
id
workspaceId
status: disabled | enabled | paused
endpointId
schemaVersion
createdAt
```

The renderer never receives arbitrary transport headers, cookies, tokens or unrestricted URLs.

### SyncSourceInstance

Stable identity for one local application/data root.

```text
id
instancePublicId
createdAt
status: active | retired
```

The public source identity must not reveal userData paths, profile paths, device secrets, process ids or machine credentials.

### SyncEnvelope

Immutable append record.

```text
id
workspaceId
sourceInstanceId
cursor
schemaVersion
recordClass
recordId
recordRevision
payload
payloadDigest
previousEnvelopeDigest
envelopeDigest
createdAt
```

Properties:

- cursor is strictly monotonic per Workspace/source instance;
- payload is recursively collaboration-safe;
- payloadDigest binds the canonicalized payload;
- previousEnvelopeDigest makes gaps/reordering visible;
- envelopeDigest binds all semantic envelope fields;
- envelope id reuse with a different digest is a divergence error.

### SyncCursor

Tracks local outbound and remote acknowledged position.

```text
workspaceId
sourceInstanceId
lastProducedCursor
lastAcknowledgedCursor
lastEnvelopeDigest
status: current | stale | gap | divergent | unavailable
updatedAt
```

Cursor gaps must never be silently filled with invented data.

### SyncAck

Remote acknowledgement for one envelope/batch.

```text
workspaceId
sourceInstanceId
cursor
envelopeDigest
state: accepted | duplicate | rejected | divergent
observedAt
```

`duplicate` is valid only when identity and digest match exactly.

### SyncDivergence

Explicit conflict evidence.

```text
workspaceId
sourceInstanceId
cursor
envelopeId
expectedDigest
observedDigest
reasonCode
observedAt
```

Divergence does not mutate canonical local execution state.

### WorkspaceMembership

Visibility relation for one collaborator identity.

```text
id
workspaceId
subjectId
teamRoleId
status: active | suspended | revoked
createdAt
```

Membership grants read visibility only in S7 v1.

### TeamRole

Visibility policy, not execution authority.

Initial roles:

```text
owner-view
operator-view
reviewer-view
observer-view
```

A TeamRole may hide classes/fields but cannot authorize Worker control, HumanGate decisions, capability grants, provider effects or retries.

### SharedWorkspaceSnapshot

Read-only materialization of remote collaboration-safe state.

```text
workspaceId
remoteSourceInstanceId
syncCursor
syncStatus
missionSummaries
humanGateSummaries
schedulingSummaries
githubDeliverySummaries
providerObservationSummaries
evidenceSummaries
workerPresence
observedAt
```

It is stored separately from canonical local projections and must never overwrite local execution truth.

### RemoteWorkerPresence

Presence/read-only information only.

Allowed examples:

```text
workerPublicId
workspaceId
statusClass: available | busy | paused | offline | unknown
browserChannelClass: chrome | chromium | unknown
role
observedAt
```

Forbidden:

```text
profilePath
profileDir
userDataDir
storageState
processId
pid
ppid
raw debugging endpoint
remote control handle
```

## Collaboration-safe record classes

Initial allowlist:

```text
workspace.summary
mission.summary
plan-step.summary
human-gate.summary
scheduling.summary
github-delivery.summary
provider-observation.summary
evidence.summary
worker-presence.summary
```

No unknown record class may sync by default.

## Recursive forbidden-field policy

The payload encoder must reject forbidden fields at any depth. Initial forbidden names/patterns include:

```text
authorization
proxy-authorization
cookie / cookies / set-cookie
password / passwd
access_token / refresh_token / id_token / token
secret
private key
profilePath / profileDir / profileDirectory / browserProfile
userData / userDataDir
storageState
processId / pid / ppid
environment / env when containing raw secrets
raw request/response bodies outside the declared safe schema
wallet / seed / signing material
```

A sensitive-looking value such as a Bearer token or private-key block must also fail even when the field name is innocuous.

## Outbound derivation boundary

S7 may derive collaboration-safe summaries from canonical local projections/events. It must not forward arbitrary canonical payloads wholesale.

The derivation function is explicit and class-specific.

Examples:

```text
Mission → id/title/status/revision summary
HumanGate → id/state/reason/timestamps only
SchedulingDecision → ids/reason codes/digests only
ProviderObservation → provider/action/state/status metadata; no response body
Evidence → id/type/digest/timestamp; bounded safe summary only
Worker → safe presence; no profile/process internals
```

## Remote mirror consistency rules

Append-oriented, fail-closed behavior:

```text
same envelope id + same digest   → duplicate/idempotent
same envelope id + new digest    → divergent/reject
same cursor + different envelope → divergent/reject
cursor = previous + 1            → append allowed
cursor gap                        → gap/stale; reject append beyond gap
unknown source instance          → reject
cross-Workspace envelope         → reject
unsupported schema version       → reject
unknown record class             → reject
command-shaped payload           → reject
```

No last-write-wins merge of canonical execution truth.

## Inbound boundary

Inbound records can update only S7 mirror/read-model projections.

They cannot call or mutate:

```text
WorkerManager start/stop/focus/pause/resume
S1 capability install/grant
S1 ResourceLock manager
HumanGate coordinator approve/reject
S2 Mission execution methods
S3 GitHub write methods
S5 provider writes
S6 scheduling execution start/retry paths
```

Inbound synced state cannot release local dependencies or convert local work to ready.

## Transport contract

First-slice transport is project-owned and explicit.

Allowed shape:

```text
one exact configured endpoint identity
bounded schema-defined POST for append
bounded schema-defined GET for mirror/cursor read
same approved origin after redirect policy
JSON only
bounded request/response size
explicit timeouts
no ambient browser credentials
no arbitrary headers supplied by renderer
```

Loopback/project-owned test transport is used for deterministic native tests. Real cloud acceptance, if performed, must use an explicitly user/project-owned HTTPS target and separate provider/use approval.

## Offline and restart semantics

When transport is unavailable:

- local execution continues;
- produced local envelopes remain persisted and pending;
- no busy retry loop;
- no cursor advancement without acknowledgement;
- cockpit shows `unavailable` / `stale` as appropriate.

On application restart:

- source identity is stable for that data root;
- produced/acknowledged cursors rehydrate;
- acknowledged envelopes are not resent automatically as new work;
- remote mirror rehydrates from local S7 mirror projections;
- no local execution effect is replayed.

## Membership and visibility

Every SharedWorkspace query requires:

```text
workspace exact match
active WorkspaceMembership
recognized TeamRole
record-class permission
field-level safe projection
```

Unknown/revoked membership returns no mirrored Workspace data.

TeamRole affects only S7 visibility in v1.

## IPC surface boundary

S7-I may expose a bounded namespace such as:

```text
querySyncState(workspaceId)
configureSync(input)
pushPending(workspaceId)
pullMirror(workspaceId)
querySharedWorkspace(input)
recordMembership(input)
```

Any final IPC set must remain explicit and schema-bounded. No generic fetch, remote command, arbitrary SQL or arbitrary URL/method/header interface is allowed.

## Required evidence

S7-F must prove at frozen product head:

- S0–S6 regression green;
- two independent source identities/data roots;
- exact monotonic cursors;
- envelope/digest determinism;
- duplicate idempotency;
- gap/divergence detection;
- cross-Workspace injection rejection;
- privacy-safe recursive encoding;
- membership/TeamRole visibility filtering;
- separate mirror vs local canonical projection invariance;
- offline local correctness;
- restart no replay/no duplicate acknowledged push;
- real Electron separate-userData collaboration view;
- zero page/console errors;
- zero residual scoped processes;
- immutable artifact + SHA256SUMS.

## Permanent boundary

S7 is optional collaboration infrastructure. Remote state remains read-only with respect to local execution authority until a future, separately documented and independently accepted milestone explicitly authorizes remote execution commands.