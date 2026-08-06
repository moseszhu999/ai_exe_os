# S1 Integrated Acceptance Matrix

Status: **NORMATIVE — FINAL VERDICT BLOCKING**

Canonical issue: **#10**

## Evidence rules

Every executable row records:

```text
exact repository SHA
operating system and architecture
Node / npm / Electron / Playwright versions
SQLite schema version
commands executed
PASS / FAIL / BLOCKED
screenshots or structured artifacts
persisted event sequence
known limitations
```

A controller exit code without structured state/event evidence is not a PASS.

## A. Storage and migration

- [ ] SQLite starts with `foreign_keys=ON` and WAL mode.
- [ ] Schema migrations run once and are recorded in `migration_journal`.
- [ ] Re-running migrations is idempotent.
- [ ] Canonical event append and projection update commit in one transaction.
- [ ] Duplicate `idempotency_key` does not append a second semantic event.
- [ ] Projection rebuild from canonical events reproduces the same domain state.
- [ ] S0 JSONL importer records source digest and imported range.
- [ ] Re-importing the same JSONL digest creates zero duplicates.
- [ ] Corrupt/unsupported input stops migration without marking it complete.
- [ ] No cookie, password, token, authorization code, or browser profile data enters SQLite.

## B. Workspace isolation

- [ ] Create two Workspaces under one Project.
- [ ] Install the same CapabilityVersion independently into both Workspaces.
- [ ] Installation IDs and lifecycle are independent.
- [ ] Agent A in Workspace A cannot use an installation from Workspace B.
- [ ] A Task cannot reference an Agent, grant, or installation from another Workspace.
- [ ] Evidence queries return only the selected Workspace's records.
- [ ] Archive status prevents new execution while preserving history.

## C. Marketplace capability lifecycle

- [ ] Publish a project-owned deterministic package/version.
- [ ] Integrity digest is required and immutable.
- [ ] Changed metadata requires a new version.
- [ ] Install a version into a Workspace.
- [ ] Disable installation and prove new scheduling is blocked.
- [ ] Re-enable or reinstall through an explicit event.
- [ ] Marketplace UI never exposes a direct execute action without Workspace/Agent context.
- [ ] Capability declares inputs, outputs, resources, evidence, provider contracts, and Human Gate policy.

## D. Agent authorization

- [ ] Create an Agent in a Workspace.
- [ ] Grant one capability action and target.
- [ ] Scheduling succeeds only for the granted action/target.
- [ ] An ungranted action is rejected before resource reservation.
- [ ] A revoked grant blocks new execution.
- [ ] Existing completed evidence remains visible after revocation.
- [ ] Disabled Agent cannot schedule.
- [ ] Cross-Workspace grant construction is rejected.

## E. ExecutionGraph and dependencies

- [ ] Create a graph with at least three tasks and two dependency edges.
- [ ] Downstream task remains `waiting_dependency` until conditions are met.
- [ ] `completed` and `evidence_accepted` conditions are distinguished.
- [ ] Cycle creation is rejected.
- [ ] Cancelling an upstream task produces an explicit blocked/cancelled downstream state.
- [ ] Replay of a readiness evaluation produces no duplicate transition event.

## F. Resource locks and parallelism

- [ ] Normalize lock keys before storage.
- [ ] Reserve multiple resources in deterministic order.
- [ ] Two non-conflicting tasks may be ready/running concurrently.
- [ ] Two tasks requiring the same exclusive browser profile cannot run concurrently.
- [ ] Branch/path ownership conflict blocks the second task.
- [ ] Partial acquisition failure releases all locks acquired by that command.
- [ ] Releasing one execution's locks does not release another execution's locks.
- [ ] Stale logical locks are released only after runtime/process reconciliation.

## G. Persisted Human Gate

- [ ] Human Gate shows Workspace, Agent, package/version/action, Worker, target, payload, locks, provider status, and expected evidence.
- [ ] Reject produces no browser submission.
- [ ] Reject appends one rejection event and releases resources.
- [ ] Approve appends one approval event.
- [ ] Repeated approve command does not start a second execution.
- [ ] Expired gate cannot execute.
- [ ] Restart preserves a pending gate.
- [ ] Operator can inspect the reason a gate is required.

## H. S0 runtime integration

- [ ] Authorized ExecutionRun selects an eligible Worker.
- [ ] Worker profile lease remains exclusive.
- [ ] Project-owned loopback target receives the approved payload exactly once.
- [ ] Execution start and result are persisted as canonical events.
- [ ] Task/ExecutionRun enter a bounded state when result observation is uncertain.
- [ ] Unexpected browser close records `browser_context_closed`, releases the lease, and permits restart.
- [ ] Stopping one Worker does not affect another Worker.
- [ ] Native Apple Silicon Chrome prerequisite is detected/documented without modifying the user's normal profile.

## I. Crash and restart recovery

- [ ] Graceful Electron restart rehydrates Workspaces, installations, Agents, grants, graphs, tasks, gates, runs, and evidence.
- [ ] Workers rehydrate as stopped.
- [ ] Active uncertain execution recovers to `waiting_human`.
- [ ] Recovery reason is persisted and visible.
- [ ] Forced Electron termination does not automatically repeat an external action.
- [ ] Submission count proves exactly one authorized action.
- [ ] Profile and logical locks are reclaimed only after owner process death/reconciliation.
- [ ] Projection rebuild after crash matches canonical event state.

## J. Provider-use and security boundary

- [ ] Unknown provider contract blocks navigation and submission.
- [ ] Expired provider review blocks execution.
- [ ] Project-owned local capability executes without implying third-party provider authorization.
- [ ] `nodeIntegration=false`.
- [ ] `contextIsolation=true`.
- [ ] `sandbox=true`.
- [ ] `webSecurity=true`.
- [ ] IPC sender validation remains active.
- [ ] unexpected navigation and new windows remain denied.
- [ ] no provider credentials, cookies, copied tokens, or third-party AI output are stored.
- [ ] no CAPTCHA, anti-abuse, fingerprint, user-agent, TCP, TLS, or protocol evasion exists.

## K. Integrated Electron UI

- [ ] One application shell contains Projects, Workspaces, Marketplace, Agents, Workers, Tasks, Graph, Human Gates, Evidence, and Recovery.
- [ ] Install capability from Marketplace into selected Workspace.
- [ ] Grant capability to Agent.
- [ ] Create graph/task using installed capability.
- [ ] UI displays missing installation/grant/provider/dependency/resource reasons.
- [ ] Reject gate and observe unchanged submission count.
- [ ] Approve gate and observe exactly one result.
- [ ] Evidence timeline links events, execution, Worker, and local artifact.
- [ ] Restart UI and observe the same state without manual reconstruction.

## First vertical-slice scenario

Use only:

```text
package: local.form-submit
version: 1.0.0
action: submit_payload
target: project-owned loopback page
Workspace A and Workspace B
Agent A and Agent B
one Chrome Worker and one Chromium Worker
```

Required scenario:

1. Install package only in Workspace A.
2. Grant action to Agent A.
3. Create same Agent/task shape in Workspace B without installation/grant.
4. Prove Workspace B execution is blocked.
5. In Workspace A, reject first gate and prove no submission.
6. Approve second gate and prove exactly one submission/result.
7. Start a bounded delayed execution and force-kill Electron.
8. Restart and prove `waiting_human`, no duplicate action, locks reconciled, and evidence visible.
9. Rebuild projections and prove state equality.

## Required artifacts

```text
s1-result.json
s1-events.jsonl or canonical event export
SQLite schema and migration journal export
projection-rebuild comparison
Workspace isolation assertions
Human Gate cancellation and approval counts
resource-lock snapshots
pre/post-crash state
renderer/main process errors
screenshots of integrated UI
scoped residual process report
exact-head and worktree cleanliness report
```

## Final verdict

Allowed:

```text
GO
GO WITH ARCHITECTURE CHANGE
NO-GO
```

Do not issue `GO` while any critical Workspace isolation, grant enforcement, transactional persistence, Human Gate cancellation, exact-once execution, crash recovery, provider gate, or integrated UI row remains unexecuted.