# 008 — S7 Optional Collaboration and Sync Architecture

## Decision

Adopt an **optional, append-oriented collaboration mirror** that sits beside the accepted local execution authority.

```text
                         ┌──────────────────────────────┐
                         │ project-owned sync endpoint  │
                         │ append envelopes / read view │
                         └──────────────┬───────────────┘
                                        │
                         safe SyncEnvelope / SyncAck
                                        │
┌───────────────────────────────────────┼───────────────────────────────────────┐
│ AI Execution OS instance A            │                                      │
│                                       ▼                                      │
│ canonical local SQLite        S7 sync repositories                           │
│ S1–S6 execution truth   →     envelope/cursor/ack/mirror                     │
│        │                              │                                      │
│        └──────────────┐               ▼                                      │
│                       │       SharedWorkspaceSnapshot                         │
│                       │               │                                      │
│                       ▼               ▼                                      │
│                    S4/S7 operator cockpit                                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

A second instance uses the same protocol with a different stable source identity. Each instance keeps its own local execution authority.

## Why this architecture

S0–S6 proved local execution, Mission orchestration, delivery observation, provider observation, operator control and bounded scheduling. Collaboration should reuse that durable state without turning a remote database into a new command plane.

The architecture therefore separates:

```text
canonical local execution projections
from
replicated collaboration-safe summaries
```

This separation is mandatory, not an implementation convenience.

## Authority map

### Existing authorities retained

```text
Worker lifecycle              → S0 WorkerManager
capability/grant/task/lock     → S1
HumanGate / ExecutionRun      → S1
Mission / PlanStep execution  → S2
GitHub observation            → S3
operator controls             → existing S4 delegated controls
provider observation          → S5
scheduling selection          → S6 over S2/S1
```

### New S7 authorities

S7 owns only:

```text
sync opt-in configuration
source-instance identity
sync envelopes/cursors/acks/divergence evidence
membership/team-role visibility metadata
remote collaboration mirror projections
sync-status explanation
```

S7 does **not** own local execution commands.

## Layering

### Layer 1 — safe projection compiler

Input: accepted local projection objects.

Output: one of a finite allowlist of collaboration-safe record classes.

Responsibilities:

- explicit class mapping;
- recursive forbidden-field rejection;
- bounded scalar/list/object sizes;
- stable canonical serialization;
- no arbitrary event payload forwarding.

This should be a pure domain module and belongs to S7-B/C boundaries rather than transport.

### Layer 2 — envelope / cursor integrity

Pure domain responsibilities:

```text
monotonic cursor
previous-envelope digest chain
payload digest
envelope digest
source instance identity
schema version
idempotency/divergence classification
```

No network or SQLite dependency in the pure S7-B domain.

### Layer 3 — collaboration membership / visibility

Pure domain responsibilities:

```text
WorkspaceMembership
TeamRole
record-class permission
field visibility
revoked/suspended fail-closed behavior
```

Roles cannot call execution APIs.

### Layer 4 — transport adapter

S7-D owns the bounded project-owned protocol.

Proposed interface:

```text
appendEnvelopes({ endpoint, workspaceId, sourceInstanceId, envelopes })
readMirror({ endpoint, workspaceId, sinceCursor })
readCursor({ endpoint, workspaceId, sourceInstanceId })
```

The renderer never receives this raw interface.

Transport invariants:

- exact configured endpoint;
- bounded POST/GET only;
- JSON schemas only;
- explicit request size/timeouts;
- no ambient browser credentials;
- no arbitrary headers supplied by UI;
- conservative redirect/origin rules;
- offline is an expected state.

### Layer 5 — application / persistence integration

S7-I composes the pure modules and transport into existing SQLite persistence.

New projection namespaces should remain clearly S7-specific, for example:

```text
syncConfiguration
syncSourceInstance
syncEnvelope
syncCursor
syncAck
syncDivergence
workspaceMembership
teamRole
sharedWorkspaceSnapshot
```

The existing canonical S1–S6 projection keys are never overwritten by inbound sync.

### Layer 6 — renderer explanation

S7-E supplies component-only view-model/controller/rendering primitives.

S7-I may integrate these into the existing S4 cockpit with surfaces such as:

```text
Sync Status
Source Instances
Outbound Cursor
Remote Cursor
Pending / Acknowledged
Gap / Divergence
Members / Roles
Shared Workspace
Remote Worker Presence
```

No remote Worker control buttons are permitted in S7 v1.

## Source identity

One stable source identity is persisted per local data root.

It must be:

- opaque;
- safe to replicate;
- unrelated to filesystem/userData/profile paths;
- stable across restart;
- different across independent userData roots.

A source identity is not an authentication credential.

## Cursor and chain model

For each `(workspaceId, sourceInstanceId)`:

```text
cursor 1  prev = null
cursor 2  prev = digest(envelope 1)
cursor 3  prev = digest(envelope 2)
...
```

Receiver checks:

1. exact Workspace and registered source;
2. supported schema;
3. next expected cursor or exact duplicate;
4. previous digest chain;
5. payload and envelope digests;
6. allowed record class / safe payload.

Gap or digest mismatch produces evidence and does not invent a merge.

## Mirror model

The collaboration mirror is append/materialize, not shared mutable execution state.

For each remote source, S7 can materialize the latest collaboration-safe summary by `(recordClass, recordId, recordRevision)` after integrity checks.

The local read model can show both:

```text
local canonical status
remote mirrored status + remote source + observed cursor/time
```

but a remote status never changes the local canonical state.

## Membership model

Workspace membership is local S7 policy deciding what a viewer may query from the mirror.

Initial role intent:

```text
owner-view     broad collaboration-safe visibility
operator-view  operational status/evidence visibility
reviewer-view  Mission/gate/evidence/review visibility
observer-view  high-level status only
```

No role grants execute/approve/retry/start/stop authority in S7 v1.

## Offline behavior

Offline is not exceptional failure for local execution.

```text
transport down
→ keep local envelope pending
→ cursor acknowledgement does not advance
→ bounded retry only on explicit/controlled sync action
→ cockpit = unavailable/stale
→ S0–S6 continue normally
```

No unbounded background retry loop is needed in the first slice.

## Restart behavior

Restart must rehydrate:

```text
source identity
sync configuration
last produced cursor
last acknowledged cursor
digest chain
pending envelopes
divergence evidence
remote mirror projections
membership/roles
```

Restart must not:

```text
replay local execution
reissue HumanGate decisions
start Workers
recreate Tasks/Missions
resend acknowledged envelopes as new envelopes
```

## Two-instance topology for acceptance

S7-F should run two independent app instances/data roots:

```text
Instance A ─┐
            ├─ project-owned acceptance sync service
Instance B ─┘
```

Requirements:

- different stable source IDs;
- same test Workspace collaboration identity where explicitly configured;
- each produces safe summaries;
- each can read the other's mirror after membership allows it;
- no browser profile/process/control handle crosses instances;
- local execution state of A is not mutated by B's mirror, and vice versa.

## Security and privacy

S7 introduces outbound structured data, so privacy is a primary architectural gate.

Required controls:

- explicit safe record allowlist;
- recursive field/value scanner before persistence/transport;
- artifact privacy scanner in tests;
- bounded payload sizes;
- no arbitrary object serialization from existing execution events;
- no cookies/tokens/profile/process/raw-secret environment material;
- no browser-session credential reuse for sync transport.

## Failure classes

```text
disabled
unavailable
stale
gap
divergent
unauthorized_member
unsupported_schema
unsafe_payload
cross_workspace
unknown_source
transport_rejected
```

These are collaboration/sync states. They do not become execution blockers unless a future milestone explicitly introduces such a dependency.

## Owner topology

```text
S7-A docs Gate 0
S7-B envelope/cursor/integrity domain
S7-C membership/role/visibility domain
S7-D transport + mirror protocol
S7-E collaboration/sync explanation UI
S7-I SQLite/application/IPC/S4 composition
S7-F frozen-head two-instance native/Electron acceptance
```

Shared root files remain reserved for S7-I.

## Rejected alternatives

### Remote database becomes canonical execution DB

Rejected for S7 v1. It would change S0–S6 authority and offline correctness simultaneously.

### Last-write-wins shared Task/Mission state

Rejected. It can erase causal conflicts and create ambiguous execution authority.

### Replicate raw SQLite events wholesale

Rejected. Existing events can contain fields unsuitable for collaboration transport and were not designed as a public sync schema.

### Reuse browser profile/session authentication for sync

Rejected. Profile/cookie/token replication violates permanent boundaries.

### Remote Worker control in the collaboration milestone

Rejected. Presence is sufficient for v1; control requires a separate authority contract.

## Gate 0 exit criteria

S7-A may merge when:

- contract, architecture and acceptance matrix agree on read-only remote authority;
- data allowlist/forbidden classes are explicit;
- owner scopes are disjoint;
- S7 disabled/offline local correctness is explicit;
- transport is project-owned/exact-target only;
- two-instance native acceptance is defined;
- roadmap identifies S7 as current without rewriting historical accepted stage numbers.