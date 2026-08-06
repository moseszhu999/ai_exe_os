# S0 Spike Results

Status: **IMPLEMENTED — RUNTIME EXECUTION NOT YET PROVEN**

## Exact scope

This PR implements the provider-safe S0 spike skeleton:

```text
Electron local operator console
dedicated Chrome/Chromium profile workers
profile lease manager
append-only local JSONL event store
bounded task state machine
persistent task snapshots
worker registry rehydration
cross-restart GitHub observation deduplication
human-confirmed local test submission
project-owned deterministic test page
read-only GitHub adapter
unit and syntax tests
```

## Provider boundary

```text
ChatGPT web automation: NOT IMPLEMENTED
provider-output extraction: NOT IMPLEMENTED
provider pricing or limit circumvention: NOT IMPLEMENTED
```

The browser worker navigates only to the local project-owned test server in the current implementation.

## Implemented evidence

```text
source syntax validation: PASS
Node unit tests: 15 / 15 PASS
task transitions and same-state idempotency
identifier path-traversal and markup rejection
profile exclusivity, release, and stale recovery
JSONL event ordering
GitHub GET-only normalization
GitHub state-event deduplication
GitHub deduplication after process restart
task snapshot rehydration
active-task recovery to waiting_human
worker registry rehydration as stopped
local test-server provider boundary
```

## Recovery semantics implemented

```text
latest task snapshot is reconstructed from the append-only event log
an uncertain active task becomes waiting_human after application restart
previous GitHub observation signatures are reconstructed from events
an unchanged PR state does not create a duplicate event after restart
known worker definitions are reconstructed from worker.created events
previously running workers return as stopped until explicitly restarted
```

These are code-level and unit-test results. They do not prove operating-system process recovery or real browser persistence.

## Evidence still required on a real workstation

```text
npm install
Playwright browser availability
Electron application launch
Chrome and Chromium channel probes
two visible simultaneous browser workers
profile/localStorage persistence after app restart
focus / scheduler-level pause / resume / stop behavior
human confirmation UI
local task submission through each worker
forced Electron crash and profile-lease recovery
confirmation that no duplicate local submission occurs after crash
resource usage snapshot
Windows and/or macOS behavior
```

## Current verdict

```text
NO FINAL S0 VERDICT
```

The exact-head source is ready for independent review and workstation runtime validation, but no `GO`, `GO WITH ARCHITECTURE CHANGE`, or `NO-GO` claim is made until the runtime matrix is executed and recorded.
