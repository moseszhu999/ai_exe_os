# S7 Optional Collaboration and Sync — Final Results

## Final verdict

**GO** at frozen product head:

```text
004bfc9f6972b0bfc0295256dcdb7aada308b70b
```

S7 is accepted as optional, collaboration-safe synchronization layered beside the existing local S0–S6 execution authority.

Remote/shared state is a mirror. It is not a second scheduler, HumanGate authority, Worker control plane, capability authority, resource-lock authority or provider-effect authority.

## Scope and ownership closure

S7 completed through the planned owner topology:

- S7-A Gate 0 contract / architecture / acceptance / roadmap: PR #104
- S7-B SyncEnvelope / cursor / integrity / privacy domain: PR #105
- S7-C WorkspaceMembership / TeamRole / visibility domain: PR #106
- S7-D project-owned transport / append-only mirror protocol: PR #107
- S7-E collaboration/sync explanation UI: PR #108
- S7-I SQLite / application / IPC / preload / cockpit integration: PR #109
- product lifecycle repair discovered by native acceptance: PR #111
- S7-F v1 QA carrier: PR #110, closed without merge
- S7-F v2 QA carrier: PR #113, closed without merge

The final product head contains only accepted product implementation and the lifecycle repair. S7-F QA carrier files were never merged into product `main`.

## Frozen source validation

Frozen accepted product head:

```text
004bfc9f6972b0bfc0295256dcdb7aada308b70b
```

Authoritative exact-source evidence:

```text
workflow run: 31256189697
exact-source job: SUCCESS
351 / 351 tests PASS
0 failed
```

Ordinary repository source validation for the same QA-carrier exact head also succeeded:

```text
run: 31256189696
status: SUCCESS
```

## Authoritative native acceptance

Workflow:

```text
S7 native two-instance collaboration acceptance
run: 31256189697
```

Jobs:

```text
Exact frozen S7 product source validation                      SUCCESS
Native arm64 two-instance service + Electron acceptance       SUCCESS
```

The native job exercised:

- native Apple Silicon arm64;
- two independent SQLite/data roots;
- two stable, distinct `SyncSourceInstance` identities;
- one project-owned loopback HTTP sync mirror;
- exact bounded GET/POST transport behavior;
- two real Electron instances with separate userData roots;
- real Google Chrome Worker in instance A;
- real Playwright Chromium Worker in instance B;
- bidirectional collaboration-safe sync;
- same-userData restart of both instances;
- graceful process teardown and residual-process audit.

## Immutable artifacts

Native two-instance artifact:

```text
artifact id: 9021453723
sha256: 7cd9d99fc3181d5bc083153fd7f554537eaecdfec4d66c44a029ea7881267371
```

Exact-source artifact:

```text
artifact id: 9021446985
sha256: 891a32c19db6e15295f646b53eb6fbdf339f93de08023e12bbacafe363159ff3
```

Independent post-run audit confirmed:

- downloaded ZIP SHA256 values exactly match GitHub artifact digests;
- every internal checksum entry verifies;
- exact product validation is 351/351 PASS;
- recursive JSON privacy scan is clean;
- all four Electron full-page screenshots are present and readable;
- trace ends with successful graceful closes, restart no-replay and `matrix.complete`;
- manifest product SHA equals the frozen product SHA.

## Source identity and cursor result

The two real application instances produced different stable source identities:

```text
instance A: sync-source-96fd1e7b-005b-4823-a1ff-03d47fd2ca74
instance B: sync-source-9555a998-4606-4f5e-a3ce-621693edbf23
```

The identities are opaque collaboration identifiers. They contain no profile path, userData path, process id or credential material.

Across same-userData restart:

```text
source A identity: unchanged
source B identity: unchanged
A produced cursor: unchanged until new canonical local state exists
A acknowledged cursor: unchanged
B produced cursor: unchanged until new canonical local state exists
B acknowledged cursor: unchanged
```

Acknowledged envelopes were not re-created or resent as new work after restart.

## Envelope integrity and failure behavior

The acceptance matrix proved:

```text
same envelope id + same digest     → duplicate / idempotent
same envelope id + different digest → envelope_id_digest_conflict
cursor gap                         → cursor_gap
cross-Workspace envelope           → cross_workspace
unknown source instance            → unknown_source
```

No last-write-wins conflict hiding was used.

Cursor and previous-envelope digest chains remain explicit. Gaps and conflicts fail closed instead of being silently repaired with invented records.

## Collaboration-safe payload boundary

S7 derives explicit collaboration summaries rather than forwarding arbitrary canonical events wholesale.

Accepted classes include bounded summaries for:

```text
Workspace
Mission
PlanStep
HumanGate status
SchedulingDecision
GitHub delivery observation
Provider observation
Evidence
Worker presence
```

Recursive privacy enforcement rejects credential/profile/process material. The final immutable artifact scan found zero forbidden fields or sensitive-looking values.

The accepted mirror does not replicate:

```text
authorization headers
cookies
passwords
access/refresh/id tokens
private keys
browser profile paths/data
userData directories
storageState
process ids / control handles
raw secret-bearing request/response bodies
wallet / signing material
```

## Membership and TeamRole result

`WorkspaceMembership` and `TeamRole` govern collaboration visibility only.

Initial accepted roles remain:

```text
owner-view
operator-view
reviewer-view
observer-view
```

No active membership means mirrored record payloads are not exposed through `SharedWorkspaceSnapshot`.

Revoked/suspended membership fails closed.

TeamRole does not grant:

- Worker start/stop/focus/pause/resume;
- HumanGate approval/rejection;
- capability installation/grant authority;
- provider writes;
- retry authority;
- local resource-lock mutation.

## Local execution authority separation

The two-instance matrix compared local canonical execution state before and after remote mirror pulls.

Result:

```text
remote mirror pull → local canonical execution state unchanged
```

Remote Mission/HumanGate/scheduling/Worker-presence summaries cannot release local dependencies, create local Tasks, approve gates, acquire locks or start effects.

S7 writes inbound collaboration data only to its own mirror/read-model namespace.

## Transport boundary

The accepted transport is configured by the main process, not by renderer-supplied arbitrary networking parameters.

Electron main receives the configured endpoint from:

```text
AI_EXE_OS_SYNC_ENDPOINT
```

Loopback acceptance additionally requires the explicit test flag:

```text
AI_EXE_OS_SYNC_ALLOW_LOOPBACK=1
```

The renderer bridge exposes exactly:

```text
queryState
configureSync
pushPending
pullMirror
recordMembership
```

It does not expose arbitrary URL, method or header control.

Observed acceptance traffic used only:

```text
GET
POST
```

and contained no ambient Authorization or Cookie headers.

## Worker presence and instance isolation

S1 canonically binds both accepted Worker identities to `workspace-a`:

```text
s1-worker-chrome
s1-worker-chromium
```

S7 therefore mirrors both bounded presence records for the Workspace.

During native dual-Electron acceptance:

```text
instance A:
  s1-worker-chrome      available
  s1-worker-chromium    offline

instance B:
  s1-worker-chrome      offline
  s1-worker-chromium    available
```

This explains canonical Workspace binding separately from local runtime activity.

Stopping A's local Chrome Worker did not change B's local Chromium Worker state. Remote presence remains read-only.

## HumanGate / execution-effect result

S7 introduced no remote execution authority.

Across the accepted two-instance flow:

```text
browser submission events: 0
remote Worker control actions: 0
remote HumanGate decisions: 0
S7 direct local execution starts: 0
```

Static authority audit also confirmed no S7 application path calls Worker start, authorized task submission, HumanGate approve/reject, reviewed retry or direct ResourceLock acquire/release.

## Restart and no-replay result

The Electron trace explicitly contains successful stages for:

```text
close.begin
close.complete
restart.identity-cursor-stable
restart.no-replay
matrix.evidence-written
close.complete
matrix.complete
```

After restart, explicit `pushPending` on both instances returned:

```text
networkRequested: false
```

because all prior collaboration envelopes were already acknowledged and no canonical local business state had changed.

## Lifecycle defect found and repaired before GO

S7-F v1 found a real product lifecycle defect: Electron graceful quit could block while waiting for the project-owned localhost test server to stop if an HTTP connection remained active.

PR #111 hardened `LocalTestServer.stop()` by:

1. calling `server.close()` to stop accepting new connections;
2. force-closing any remaining active HTTP connections through `closeAllConnections()`;
3. retaining idempotent shutdown behavior;
4. adding a regression test that opens an intentionally incomplete localhost HTTP connection and requires shutdown to complete within 1.5 seconds.

The repaired exact product head passed 351/351 tests and the final real two-Electron matrix subsequently proved graceful shutdown.

## QA correction discovered during acceptance

After the lifecycle repair, S7-F exposed a second failure that was correctly classified as QA-only rather than a product defect.

The original harness selected the first `worker-presence.summary` and assumed instance B would return Chromium first. S1's canonical model intentionally binds both Chrome and Chromium to the Workspace, so record ordering does not imply local activity.

The final acceptance harness therefore selects presence by exact `workerPublicId` and separately verifies the other canonical binding is non-active.

No product code was changed for this QA correction.

## S4/S7 cockpit result

All four full-page Electron screenshots visibly contain the S7 collaboration panel with the required surfaces:

```text
Sync Status
Source Instance
Endpoint / Mode
Outbound Cursor
Acknowledged Cursor
Pending Envelopes
Remote Sources
Gap / Divergence
Members / Roles
Shared Workspace
Remote Worker Presence
```

The UI contains only the bounded S7 controls:

```text
Record sync mode
Push pending safe envelopes
Pull collaboration mirror
Record local operator visibility
```

It contains no remote Worker control button.

Both instances show the opposite source and shared Workspace state after sync, and the collaboration view remains present after restart.

## Runtime hygiene

Final native acceptance results:

```text
Electron page errors:       0
Electron console errors:    0
browser submissions:        0
residual scoped processes:  0
privacy scan hits:          0
```

## Compatibility with S0–S6

Frozen product validation remained green:

```text
351 / 351 PASS
```

S7 preserves the accepted inheritance/composition chain:

```text
S7 application service
→ S6 scheduling service
→ S5 provider observation
→ S4 operator cockpit
→ S3 delivery observation
→ S2 Mission orchestration
→ S1 execution authority
```

S7 is optional. Disabled, paused, stale, divergent or unavailable collaboration does not become a prerequisite for local S0–S6 correctness.

## Permanent S7 boundary

S7 remains optional collaboration infrastructure.

It must not:

- make remote/cloud state canonical local execution truth;
- remotely control Workers;
- remotely approve/reject HumanGates;
- mutate local ResourceLocks from remote mirror state;
- grant/install capabilities from remote mirror state;
- perform hidden provider writes;
- replay synchronized records as local execution commands;
- replicate credentials, cookies, tokens, profile data or process control handles;
- expose arbitrary networking to renderer code;
- silently resolve divergent execution truth with last-write-wins;
- make S0–S6 local correctness depend on cloud availability.

Any future remote execution authority requires a separate, explicit Gate 0 milestone and independent acceptance.

## Closure

All S7 final acceptance requirements in issue #103 are satisfied at the frozen product head.

**S7 final verdict: GO.**
