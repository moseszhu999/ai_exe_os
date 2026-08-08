# S6 Scheduling Policy Acceptance Matrix

Status: **NORMATIVE — GO BLOCKING**

Parent: #88

Exact Gate 0 baseline: `0fe6601c20f7c75be739c8617f92a85f3f43510a`

A final S6 GO requires every required row below to have executed evidence on one frozen product head. Unit coverage alone cannot substitute for native/restart/Electron rows.

## A — source / owner scope

| ID | Requirement | Evidence |
|---|---|---|
| A1 | S6-A docs merged before implementation | PR/commit |
| A2 | B/C/D/E start from one exact common main | branch SHAs |
| A3 | sibling component scopes are disjoint | compare audit |
| A4 | no sibling imports unmerged sibling code | source audit |
| A5 | S6-I is sole shared-root integration owner | PR scope |
| A6 | S6-F carrier changes QA/results files only | exact diff |
| A7 | S0–S5 full source suite remains green | exact-head CI |

## B — candidate subset / authority

| ID | Requirement | Expected |
|---|---|---|
| B1 | already-ready S1 Task becomes candidate | included |
| B2 | already-ready S2 PlanStep becomes candidate | included |
| B3 | waiting_dependency work | excluded |
| B4 | waiting_human work | excluded |
| B5 | failed work | excluded |
| B6 | cancelled work | excluded |
| B7 | uncertain prior external execution | excluded |
| B8 | paused/cancelled Mission | excluded |
| B9 | unknown Workspace | fail closed |
| B10 | policy engine cannot create Task/Mission/PlanStep | source + behavioral proof |
| B11 | `S6 eligible ⊆ canonical ready` on exercised state | PASS |

## C — deterministic priority / fairness

| ID | Requirement | Expected |
|---|---|---|
| C1 | critical outranks high/normal/low under equal hard constraints | deterministic |
| C2 | high outranks normal/low | deterministic |
| C3 | identical snapshots produce identical order/digest | exact equality |
| C4 | input collection order permutation | same order/digest |
| C5 | canonical IDs provide stable final tie-break | deterministic |
| C6 | bounded aging never exceeds configured boost | PASS |
| C7 | bounded aging never makes ineligible work eligible | PASS |
| C8 | continuously eligible lower-priority work eventually selected in bounded fairness sequence | PASS |
| C9 | hard capacity may legitimately defer work despite fairness | explicit reason |

## D — concurrency capacity

| ID | Requirement | Expected |
|---|---|---|
| D1 | global max active = 0 | no proposal |
| D2 | global active == max | `global_capacity_exhausted` |
| D3 | Workspace active == max | `workspace_capacity_exhausted` |
| D4 | free global capacity but Workspace full | only other eligible Workspace may progress |
| D5 | more candidates than slots | proposals never exceed slots |
| D6 | active-count inputs cannot be negative/invalid | reject |
| D7 | policy caps are upper bounds, not utilization targets | no invented filler work |

## E — provider capacity

| ID | Requirement | Expected |
|---|---|---|
| E1 | current explicit provider capacity available | provider candidate may remain eligible |
| E2 | current provider capacity exhausted | `provider_capacity_exhausted` |
| E3 | provider capacity unknown | `provider_capacity_unknown` |
| E4 | provider capacity stale | `provider_capacity_stale` |
| E5 | blocked provider capacity | defer |
| E6 | local-only candidate does not require provider capacity | unaffected |
| E7 | no adaptive provider quota probing/retry path | source audit |
| E8 | no provider write method introduced | source/runtime audit |

## F — Worker/session compatibility

| ID | Requirement | Expected |
|---|---|---|
| F1 | compatible same-Workspace idle Worker | eligible |
| F2 | Worker draining | no new assignment |
| F3 | Worker unavailable | no assignment |
| F4 | browser channel mismatch | incompatible |
| F5 | safe profile/session class mismatch | incompatible |
| F6 | cross-Workspace session/profile reuse | fail closed |
| F7 | compatible existing session may be preferred after safety checks | deterministic preference |
| F8 | no raw profile path/process ID enters policy evidence | privacy PASS |

## G — resources / stale proposal

| ID | Requirement | Expected |
|---|---|---|
| G1 | S1 exclusive lock conflict | defer/reject |
| G2 | no conflict | proposal may continue |
| G3 | proposal authority digest current at revalidation | may accept |
| G4 | candidate changed after proposal | stale/reject |
| G5 | resource acquired elsewhere after proposal | stale/reject |
| G6 | HumanGate becomes required after proposal | reject before start |
| G7 | provider capacity becomes stale/full | reject before start |
| G8 | stale rejection causes zero external effect | PASS |
| G9 | recomputation creates new decision/proposal identity rather than mutating old evidence | PASS |

## H — retry / waiting-human

| ID | Requirement | Expected |
|---|---|---|
| H1 | waiting HumanGate candidate | never auto-started |
| H2 | uncertain external effect | never auto-retried |
| H3 | failed attempt | never silently reintroduced |
| H4 | cancelled attempt | never reintroduced |
| H5 | reviewed retry creates new accepted S2/S1 identity first | only new identity may later become candidate |
| H6 | scheduler policy contains no retry-until-success loop | source audit |

## I — persistence / restart

| ID | Requirement | Expected |
|---|---|---|
| I1 | immutable policy snapshot persists | PASS |
| I2 | same snapshot ID + changed semantics | collision/reject |
| I3 | decision/proposal/evidence persists in canonical SQLite | PASS |
| I4 | identical decision input replay is idempotent | no semantic duplicate |
| I5 | restart rehydrates policy/decision/proposal | PASS |
| I6 | restart starts zero Tasks/PlanSteps/Workers | PASS |
| I7 | restart performs zero provider calls | PASS |
| I8 | projection/event digest stable absent explicit new command | PASS |

## J — UI / IPC / sandbox

| ID | Requirement | Expected |
|---|---|---|
| J1 | S6 component UI is Workspace fail-closed | PASS |
| J2 | displays policy/capacity/eligible queue/selected/deferred reasons | PASS |
| J3 | displays Worker/session compatibility | PASS |
| J4 | displays provider capacity state | PASS |
| J5 | displays decision/proposal evidence | PASS |
| J6 | no direct Worker start/provider write/HumanGate decision control | PASS |
| J7 | root preload remains sandbox self-contained | one Electron require only |
| J8 | S0–S5 bridge method counts preserved | exact counts |
| J9 | S6 IPC sender validated and payload bounded | PASS |
| J10 | no arbitrary process/database/profile/provider access in renderer | PASS |

## K — integration authority revalidation

| ID | Requirement | Expected |
|---|---|---|
| K1 | policy proposes one currently ready candidate | proposal only |
| K2 | existing S2/S1 authority revalidates before start | proven call chain |
| K3 | accepted proposal start occurs through old scheduler/runtime | PASS |
| K4 | S6 never calls provider/browser effect directly | source/runtime audit |
| K5 | existing HumanGate remains authoritative | PASS |
| K6 | existing ResourceLock remains authoritative | PASS |
| K7 | provider-use contract remains authoritative | PASS |
| K8 | stale proposal cannot cause effect | PASS |

## L — native multi-session matrix

Run on one frozen product head using native Apple Silicon arm64 evidence class.

Required scenario:

```text
at least 2 concurrent Workers
at least 2 Workspaces or unrelated Missions where policy permits
more eligible candidates than available assignment slots
explicit global + per-Workspace capacity
at least one provider-capacity-constrained candidate
at least one compatible-session reuse opportunity
at least one incompatible/cross-Workspace reuse attempt
at least one continuously eligible lower-priority candidate across multiple decision rounds
```

Required results:

| ID | Requirement | Expected |
|---|---|---|
| L1 | arm64 / no Rosetta | PASS |
| L2 | source suite on frozen head | PASS |
| L3 | proposals never exceed capacity | PASS |
| L4 | higher priority chosen first when limits equal | PASS |
| L5 | bounded fairness exercised, lower priority eventually selected | PASS |
| L6 | stop/complete one assignment frees only corresponding capacity | PASS |
| L7 | unrelated Worker/Mission remains intact | PASS |
| L8 | cross-Workspace reuse blocked | PASS |
| L9 | provider capacity unknown/full blocks only affected candidate | PASS |
| L10 | no invented work | PASS |
| L11 | no silent retry | PASS |

## M — real Electron

| ID | Requirement | Expected |
|---|---|---|
| M1 | real Electron starts on native arm64 | PASS |
| M2 | S0–S6 bridges available with prior counts preserved | PASS |
| M3 | S4 cockpit renders scheduling section | PASS |
| M4 | operator can see eligible/selected/deferred reason state | PASS |
| M5 | capacity saturation visible | PASS |
| M6 | policy decision refresh produces deterministic evidence | PASS |
| M7 | same-userData restart restores evidence without start/replay | PASS |
| M8 | page errors | 0 |
| M9 | console errors | 0 |

## N — privacy / artifact

Artifact must contain at minimum:

```text
exact-product-head.txt
source validation evidence
policy snapshot
candidate snapshot
capacity snapshot
decision/proposal evidence
native scheduling matrix
restart digest evidence
Electron UI audit
screenshots
cleanup audit
manifest.json
SHA256SUMS.txt
```

Required checks:

| ID | Requirement | Expected |
|---|---|---|
| N1 | portable SHA256SUMS verifies | PASS |
| N2 | artifact ZIP digest recorded | PASS |
| N3 | no credential/cookie/token/private key | PASS |
| N4 | no raw profile/userData path | PASS |
| N5 | no process-local PID/PPID evidence | PASS |
| N6 | no provider response body | PASS |
| N7 | no hidden provider-write method | PASS |
| N8 | scoped residual processes | 0 |

## Final verdict rule

`GO` requires all required A–N rows on one frozen product head and an independently audited immutable artifact.

`GO WITH ARCHITECTURE CHANGE` is allowed only when the evidence proves the user story but a documented architecture correction is required before merge.

`NO-GO` is required for any authority expansion, invented work, HumanGate bypass, hidden retry, capacity-limit bypass, quota probing/circumvention, cross-Workspace session reuse, stale-proposal effect, restart replay, privacy leak, or unexecuted native/Electron critical row.
