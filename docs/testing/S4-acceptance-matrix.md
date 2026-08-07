# S4 Acceptance Matrix — Multi-Session Operator Console

## Verdict policy

Allowed final verdicts:

```text
GO
GO WITH ARCHITECTURE CHANGE
NO-GO
```

No `GO` if any critical row below is unexecuted, if selected-worker isolation is not proven, if Workspace leakage occurs, if restart replays work, or if the renderer exposes secret/profile/process-local values.

## A. Source / owner scope

| Row | Requirement | Evidence |
| --- | --- | --- |
| A1 | frozen exact product head recorded | exact 40-char SHA |
| A2 | changed files stay inside S4 owner scope | PR file audit |
| A3 | S0/S1/S2/S3 compatibility suite remains green | full validation |
| A4 | no duplicate S4 owner / conflicting shared-root writer | repo audit |

## B. Cockpit read model

| Row | Requirement | Evidence |
| --- | --- | --- |
| B1 | explicit Workspace produces one deterministic cockpit snapshot | unit test |
| B2 | unknown Workspace fails closed with zero cross-Workspace fallback | unit/integration test |
| B3 | Project/Workspace identity is explicit | snapshot assertion |
| B4 | active Mission/PlanStep/StepAttempt state is explained | read-model test |
| B5 | Agent/capability/provider-use state is explained | read-model test |
| B6 | Worker/session identity and ownership are explicit | read-model test |
| B7 | Human Gates are sourced from persisted S1 authority | integration test |
| B8 | S3 GitHub delivery evidence is linked read-only | integration test |
| B9 | read model is rebuildable/disposable and does not authorize effects | contract test |

## C. Multi-session Worker isolation

| Row | Requirement | Evidence |
| --- | --- | --- |
| C1 | at least two unrelated Workers/sessions coexist | native runtime matrix |
| C2 | Worker A and Worker B have distinct stable identity | runtime evidence |
| C3 | focus Worker A does not mutate Worker B | before/after snapshot |
| C4 | pause/resume Worker A, when supported, does not mutate Worker B | before/after snapshot |
| C5 | stop Worker A leaves Worker B alive | native runtime matrix |
| C6 | stop Worker A does not mutate unrelated Task/Mission state | canonical state diff |
| C7 | selected-worker control never fans out to stopAll/global kill semantics | static + runtime audit |

## D. Attention / blocker / recovery

| Row | Requirement | Evidence |
| --- | --- | --- |
| D1 | persisted Human Gates appear in one deterministic attention inbox | test |
| D2 | waiting_human state produces deterministic attention item | test |
| D3 | recovery_requires_review produces deterministic attention item | test |
| D4 | S1 scheduler blockers retain exact blocker code/reason | test |
| D5 | S3 delivery blockers retain exact delivery reason | test |
| D6 | attention item links affected aggregate identity | test |
| D7 | missing provenance is shown unavailable rather than inferred | test |
| D8 | UI dismissal/filter state cannot clear canonical blocker/recovery state | integration test |

## E. Evidence / explanation lineage

| Row | Requirement | Evidence |
| --- | --- | --- |
| E1 | blocker → affected Run/Step/Task link exists | explanation test |
| E2 | Run/Step/Task → Gate/Lock/DeliveryGate link exists when applicable | explanation test |
| E3 | Gate/DeliveryGate → Evidence link exists | explanation test |
| E4 | Evidence → canonical ExecutionEvent reference exists | explanation test |
| E5 | lineage does not fabricate missing edges | fail-closed test |

## F. Bounded control authority

| Row | Requirement | Evidence |
| --- | --- | --- |
| F1 | console delegates Worker controls to accepted runtime methods | adapter test |
| F2 | unknown Worker fails closed | test |
| F3 | cross-Workspace control attempt fails closed | test |
| F4 | unsupported control reports unavailable capability | test |
| F5 | Human Gate decision still executes through S1 authority | integration test |
| F6 | console cannot mark Mission/Step/Run terminal by UI-only mutation | static/integration test |
| F7 | no provider-use override path exists | static test |
| F8 | GitHub remains read-only | static + request-method audit |

## G. Restart / recovery

| Row | Requirement | Evidence |
| --- | --- | --- |
| G1 | application restart rebuilds same explainable cockpit from authority state | SQLite restart test |
| G2 | no submission is replayed on restart | submission count assertion |
| G3 | no Mission work is replayed on restart | Mission attempt assertion |
| G4 | Worker sessions are shown according to actual recovered runtime state | native restart matrix |
| G5 | attention/recovery items rebuild deterministically | digest/state comparison |

## H. Electron / IPC / renderer security

| Row | Requirement | Evidence |
| --- | --- | --- |
| H1 | S4 IPC sender validation | contract test |
| H2 | S4 payload validation | contract test |
| H3 | preload remains self-contained sandbox preload | static test |
| H4 | `contextIsolation=true` | static/runtime evidence |
| H5 | `nodeIntegration=false` | static/runtime evidence |
| H6 | `sandbox=true` | static/runtime evidence |
| H7 | `webSecurity=true` | static/runtime evidence |
| H8 | renderer has no Node/SQLite path | static test |
| H9 | safe DOM construction only | static test |
| H10 | S0/S1/S2/S3 namespaces remain compatible | contract test |

## I. Privacy

| Row | Requirement | Evidence |
| --- | --- | --- |
| I1 | no credential/token/cookie values in S4 renderer state | recursive scan |
| I2 | no profilePath/profileDir/userData/storageState fields | recursive scan |
| I3 | no processId/pid/ppid fields | recursive scan |
| I4 | immutable evidence artifact scan is clean | artifact audit |
| I5 | raw browser profile/user-data directory is not uploaded | artifact audit |

## J. Native real-Electron acceptance

S4-F must run on native arm64 macOS and use the real Electron application.

Required sequence:

```text
launch app
→ provision/start two unrelated Workers/sessions
→ verify both visible in cockpit
→ create/observe representative Mission/Gate/blocker/evidence state
→ focus Worker A
→ prove Worker B unchanged
→ stop Worker A
→ prove Worker B still alive
→ prove unrelated Task/Mission unchanged
→ inspect attention + lineage
→ restart application
→ prove no replay and deterministic cockpit rebuild
→ capture screenshots/state/evidence
→ cleanup all scoped processes
```

Critical native results:

| Row | Requirement | Required result |
| --- | --- | --- |
| J1 | native architecture | `arm64` |
| J2 | concurrent Worker/session count | `>= 2` before selected stop |
| J3 | selected stop isolation | PASS |
| J4 | unrelated Worker survival | PASS |
| J5 | unrelated Mission/task state unchanged | PASS |
| J6 | restart/no replay | PASS |
| J7 | page errors | `0` |
| J8 | console errors | `0` |
| J9 | residual scoped processes after cleanup | `0` |

## K. Final artifact

Artifact must be portable and privacy-safe and include at least:

```text
manifest.json
cockpit-state-before.json
cockpit-state-after-control.json
cockpit-state-after-restart.json
worker-session-matrix.json
attention-lineage.json
canonical-event/projection evidence
Electron screenshot(s)
SHA256SUMS.txt
```

Every manifest entry must self-validate before upload.

## L. Stop conditions

Immediate `NO-GO` or repair-before-GO if any of the following occurs:

```text
cross-Workspace data leakage
selected Worker control affects unrelated Worker
UI bypasses Human Gate/provider authority
restart replays submission or Mission work
new GitHub/provider write path appears
renderer receives credential/profile/process-local data
critical evidence row is simulated but represented as native/live
```
