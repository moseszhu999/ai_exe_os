# S4 Contract — Multi-Session Operator Console

## Status

Gate 0 contract for S4.

Parent: Issue #58.

Starting baseline: `91d01473c8bddc3ffe818e92656a903e57e73a11`.

S0–S3 are accepted `GO / COMPLETE` and remain authoritative.

## Product intent

S4 turns the accepted execution kernel into one coherent operator cockpit. It must make parallel execution understandable and boundedly controllable without creating a new scheduler, state authority, provider-write path, or UI-only truth.

The console answers five operator questions at all times:

1. **What is running?**
2. **Why is it allowed to run?**
3. **What is it waiting on or blocked by?**
4. **What evidence proves the current state?**
5. **What bounded control can I safely apply right now?**

## Canonical authorities

S4 consumes existing authorities; it does not replace them.

```text
S0 BrowserWorkerManager         Worker/browser lifecycle
S1 SQLite execution_events      canonical application history/projections
S1 Scheduler / HumanGate        authorization, locks and human approval
S2 Mission orchestrator         Mission/PlanStep/StepAttempt state
S3 GitHub delivery evidence     read-only engineering-delivery state
```

Console read models are derived, disposable and rebuildable.

## Derived console model

S4 may introduce the following read-model concepts:

```text
OperatorCockpitSnapshot
WorkspaceExecutionSummary
WorkerSessionSummary
MissionExecutionSummary
AttentionItem
BlockerExplanation
RecoverySummary
EvidenceLineage
ControlCapability
```

These objects are not independent execution truth.

### OperatorCockpitSnapshot

A Workspace-scoped aggregate containing:

- project/workspace identity;
- Mission summaries;
- Worker/session summaries;
- Agent/capability/provider-use summary;
- persisted Human Gates;
- blockers and recovery attention items;
- S3 delivery state;
- evidence/event lineage references;
- bounded control availability.

### WorkerSessionSummary

Must contain stable non-sensitive identity sufficient to explain ownership and isolation:

```text
workerId
projectId
workspaceId when known
browserChannel / runtime kind
role
status
bound Mission/Step/Task identity when known
control capabilities
last safe state transition/evidence reference
```

Must not expose profile paths, user-data directories, process IDs or credentials.

### AttentionItem

Normalized deterministic inbox item for states requiring operator attention, including:

```text
human_gate_required
waiting_human
recovery_requires_review
resource_conflict
dependency_unsatisfied
provider_contract_changed_or_expired
head_mismatch
base_stale
required_check_missing/pending/failed
review_evidence_incomplete
ownership_conflict
merge_order_unsatisfied
```

Every AttentionItem must link to affected aggregate identity and evidence/provenance.

## Workspace boundary

All S4 query paths require an explicit Workspace identity except the top-level Workspace selector.

Unknown explicit Workspace IDs fail closed and return no fallback data from another Workspace.

Cross-Workspace Mission, Worker binding, Gate, GitHub delivery or evidence leakage is forbidden.

## Bounded controls

S4 does not invent control semantics. It delegates only to already accepted runtime methods.

Allowed S4 control intents are limited to existing local controls such as:

```text
focus selected Worker
stop selected Worker
pause selected Worker where supported
resume selected Worker where supported
navigate to existing Human Gate decision flow
navigate to existing Mission recovery/retry flow
refresh read-only GitHub evidence
```

S4 must not:

- directly mark Mission/Step/Run completed;
- directly approve/reject a Human Gate outside S1 authority;
- release locks by editing projections;
- fabricate recovery completion;
- introduce GitHub/provider write commands;
- bypass provider-use validation.

## Exact Worker control

Every Worker control command must identify one exact Worker/session.

Isolation invariant:

```text
stop(worker A) must not stop, pause, restart, mutate or submit work on worker B
```

The same applies to focus/pause/resume.

## Explainability contract

The cockpit must explain state using links, not copied truth.

Minimum lineage path:

```text
AttentionItem / Blocker
→ Mission / PlanStep / StepAttempt or Task / ExecutionRun
→ HumanGate / ResourceLock / DeliveryGate where applicable
→ Evidence / DeliveryEvidence
→ canonical ExecutionEvent(s)
```

When provenance is unavailable, the UI must say so rather than infer a reason.

## Human Gate contract

The unified Human Gate inbox is a view over persisted S1 HumanGate authority.

It may group/filter/explain gates but may not create a second approval state.

Repeated approval/rejection protections remain S1 behavior.

## GitHub contract

S4 embeds S3 delivery evidence as read-only cockpit state.

S4 does not add GitHub writes.

Allowed provider action from the console is bounded refresh/observation through the accepted S3 GET-only path.

## Renderer privacy boundary

Before any S4 state reaches renderer display, recursively redact at least:

```text
password / passwd
authorization
cookie / session identifiers
access/refresh/id tokens
profilePath / profileDir / browserProfile
userData / userDataDir / storageState
processId / pid / ppid
private-key-like material
Bearer-like strings
```

## Electron security

S4 must preserve:

```text
contextIsolation: true
nodeIntegration: false
sandbox: true
webSecurity: true
single self-contained sandbox preload
sender validation for IPC
no renderer Node/SQLite access
safe DOM construction
```

## Restart semantics

After restart:

- canonical Mission/Gate/GitHub/evidence state is rehydrated from accepted authorities;
- Worker sessions are represented according to actual recovered WorkerManager state;
- no previous submission is automatically replayed;
- no UI-only active state survives unless the authoritative runtime proves it;
- attention/recovery items are deterministically rebuilt.

## S4 owner topology

```text
S4-B  console read model + explanation graph
S4-C  bounded Worker/session controls + isolation
S4-D  attention/blocker/recovery aggregation
S4-E  component cockpit UI
S4-I  shared application/IPC/preload/root Electron composition
S4-F  independent exact-head native acceptance
```

B/C/D/E may begin only after S4-A merges.

Sibling implementation branches must not import one another before merge.

## Definition of done

S4 is not complete until native Electron acceptance proves:

- one Workspace cockpit explains active execution and evidence;
- two unrelated browser Workers/sessions coexist;
- exact Worker focus/stop isolation;
- Mission/Gate/blocker/recovery provenance;
- Workspace fail-closed behavior;
- restart/no-replay behavior;
- zero renderer page/console errors;
- privacy-safe artifact;
- no new provider write path.
