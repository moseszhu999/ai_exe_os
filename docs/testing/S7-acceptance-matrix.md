# S7 Optional Collaboration and Sync — Acceptance Matrix

## Purpose

S7 acceptance proves that optional collaboration can replicate bounded, privacy-safe status between independent AI Execution OS instances without creating remote execution authority or making cloud availability a prerequisite for S0–S6 local correctness.

Canonical issue: #103.

Exact Gate 0 baseline:

```text
e7d2e7ee8d5ab0bfccbaaae59986dd97c016f0df
```

## Verdict vocabulary

```text
PASS
FAIL
NOT RUN
NOT APPLICABLE
```

Final S7 verdict:

```text
GO
GO WITH ARCHITECTURE CHANGE
NO-GO
```

## A. Frozen source / owner scope

| ID | Requirement | Evidence |
|---|---|---|
| A1 | One exact frozen product head is named before S7-F | SHA in artifact and results |
| A2 | Full S0–S6 validation passes at exact head | CI output |
| A3 | Acceptance carrier changes QA/result paths only | diff audit |
| A4 | B/C/D/E owners start from one common post-Gate-0 main | branch/base evidence |
| A5 | S7-I alone owns shared application/main/preload/root composition | changed-file audit |

## B. Optional/offline local correctness

| ID | Requirement | Evidence |
|---|---|---|
| B1 | Sync disabled does not alter Task/Mission/Worker/Scheduling behavior | regression test |
| B2 | Transport unavailable does not block local S0–S6 execution | offline native case |
| B3 | Stale mirror does not overwrite local canonical state | projection comparison |
| B4 | Divergence does not block unrelated local execution | fail-closed collaboration case |
| B5 | Local execution requires no online database | restart/offline evidence |

## C. Source identity / envelope integrity

| ID | Requirement | Evidence |
|---|---|---|
| C1 | Source identity is stable across restart for one data root | before/after identity |
| C2 | Separate userData/data roots have different source identities | two-instance evidence |
| C3 | Source identity contains no path/profile/process secret | privacy scan |
| C4 | Cursor begins at defined base and advances exactly monotonically | cursor sequence |
| C5 | `previousEnvelopeDigest` forms an intact chain | digest-chain audit |
| C6 | payload digest is deterministic for semantic-equivalent payload | pure test |
| C7 | envelope digest is deterministic | pure test |
| C8 | same envelope id + same digest is idempotent | duplicate case |
| C9 | same envelope id + different digest is divergent/rejected | conflict case |
| C10 | same cursor + conflicting envelope is divergent/rejected | conflict case |
| C11 | cursor gap is explicit and cannot be silently skipped | gap case |
| C12 | unsupported schema is rejected | schema case |

## D. Collaboration-safe payload boundary

| ID | Requirement | Evidence |
|---|---|---|
| D1 | Only declared record classes are accepted | allowlist tests |
| D2 | Unknown record class fails closed | negative test |
| D3 | Recursive forbidden field scan covers nested objects/lists | privacy tests |
| D4 | Sensitive-looking values fail even under innocuous key | value scanner tests |
| D5 | Mission summary excludes raw execution payloads | fixture inspection |
| D6 | HumanGate summary contains status metadata but no decision authority/token | fixture inspection |
| D7 | provider observation summary contains no response body/credential material | fixture inspection |
| D8 | Worker presence excludes profile path/userData/process/debugging handle | fixture inspection |
| D9 | payload/request size is bounded | transport guard |
| D10 | immutable artifact privacy scan finds zero forbidden material | S7-F scan |

## E. Workspace isolation / injection resistance

| ID | Requirement | Evidence |
|---|---|---|
| E1 | Envelope Workspace must exactly match configured Workspace | cross-Workspace negative case |
| E2 | Unknown remote source instance is rejected until registered | negative case |
| E3 | A source registered for Workspace A cannot inject into Workspace B | native two-Workspace case |
| E4 | inbound remote record cannot call local execution APIs | static + runtime audit |
| E5 | command-shaped payload is rejected as unsupported/unsafe | negative test |
| E6 | remote status cannot release local Mission dependency | projection invariance |
| E7 | remote HumanGate status cannot approve/reject local gate | runtime invariance |
| E8 | remote Worker presence cannot control local Worker | IPC/static audit |

## F. Membership / TeamRole visibility

| ID | Requirement | Evidence |
|---|---|---|
| F1 | no membership → no SharedWorkspaceSnapshot visibility | query test |
| F2 | revoked/suspended membership fails closed | query test |
| F3 | active membership requires recognized TeamRole | query test |
| F4 | `owner-view` sees only collaboration-safe broad view | snapshot fixture |
| F5 | `operator-view` sees bounded operational/evidence summaries | snapshot fixture |
| F6 | `reviewer-view` sees review/gate/evidence summaries without decision controls | snapshot fixture |
| F7 | `observer-view` receives high-level status only | snapshot fixture |
| F8 | TeamRole does not grant Worker/HumanGate/provider execution authority | IPC/static audit |
| F9 | cross-Workspace membership does not leak mirror state | negative query |

## G. Transport boundary

| ID | Requirement | Evidence |
|---|---|---|
| G1 | exact configured project-owned endpoint only | adapter test |
| G2 | arbitrary renderer URL is impossible | preload/IPC audit |
| G3 | arbitrary renderer method/header is impossible | preload/IPC audit |
| G4 | only contract-defined GET/POST (or accepted equivalent) is used | method audit |
| G5 | redirect to unrelated origin fails closed | transport case |
| G6 | browser-session cookies/tokens are not used by sync transport | request audit |
| G7 | explicit timeouts are present | unit/native case |
| G8 | bounded retry or explicit operator sync; no busy retry loop | offline observation |
| G9 | duplicate acknowledged envelope is not resent as new envelope on restart | request/cursor audit |
| G10 | loopback acceptance service is project-owned/test-scoped | source + network audit |

## H. Mirror / local authority separation

| ID | Requirement | Evidence |
|---|---|---|
| H1 | inbound mirror persists only under S7 mirror projection namespace | SQLite projection audit |
| H2 | local canonical projection digest is unchanged by mirror pull | before/after digest |
| H3 | remote `Mission completed` summary does not complete local Mission | negative native case |
| H4 | remote scheduling summary does not create local Task/StepAttempt | negative native case |
| H5 | remote HumanGate summary does not mutate local HumanGate | negative native case |
| H6 | remote Worker presence does not acquire/release local ResourceLock | lock audit |
| H7 | divergence/gap evidence remains S7-specific | projection audit |

## I. Two-instance synchronization

S7-F uses two independent data roots / source identities A and B plus one project-owned test sync service.

| ID | Requirement | Evidence |
|---|---|---|
| I1 | A and B start with different source identities | identity evidence |
| I2 | A pushes safe Workspace/Mission summary | request/envelope log |
| I3 | B sees A summary after authorized pull | SharedWorkspaceSnapshot |
| I4 | B pushes independent safe summary | request/envelope log |
| I5 | A sees B summary after authorized pull | SharedWorkspaceSnapshot |
| I6 | A local execution projection unchanged by B mirror | local digest |
| I7 | B local execution projection unchanged by A mirror | local digest |
| I8 | one source offline does not break other source local execution | offline case |
| I9 | cursor gap/divergence on one source is isolated/explained | negative case |
| I10 | no profile/process/control handle crosses instances | privacy/runtime audit |

## J. Restart / idempotency

| ID | Requirement | Evidence |
|---|---|---|
| J1 | source identity stable after restart | identity comparison |
| J2 | local produced cursor stable after restart | cursor comparison |
| J3 | last acknowledged cursor stable after restart | cursor comparison |
| J4 | pending envelopes rehydrate without new semantic IDs | envelope comparison |
| J5 | acknowledged envelopes are not recreated/resubmitted as new | request audit |
| J6 | mirror snapshot rehydrates without remote execution | restart snapshot |
| J7 | local event/projection counts do not gain execution effects on restart | before/after counts |
| J8 | no local Worker start/submission due solely to restart | S0 event audit |

## K. S4/S7 UI

Required explanation surfaces:

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

| ID | Requirement | Evidence |
|---|---|---|
| K1 | sync disabled state is visible | Electron screenshot |
| K2 | enabled/current state is visible | screenshot |
| K3 | unavailable/stale state is visible | screenshot |
| K4 | gap/divergence state has reason code/evidence | screenshot/view-model test |
| K5 | member/team-role visibility is explainable | screenshot |
| K6 | remote presence has no control actions | UI/static audit |
| K7 | local vs remote state is visually distinguishable | screenshot |
| K8 | renderer recursively redacts forbidden data | UI test |
| K9 | no `innerHTML`/unsafe HTML injection from mirror values | source audit |

## L. Electron / native runtime

| ID | Requirement | Evidence |
|---|---|---|
| L1 | native Apple Silicon arm64 | runner audit |
| L2 | two real Electron instances use separate userData roots | launch audit |
| L3 | full S0–S7 bridge surface loads under sandbox preload | bridge audit |
| L4 | no remote execution-authority S7 IPC exists | bridge/static audit |
| L5 | each instance can continue local execution while other/sync service is unavailable | native case |
| L6 | same-userData restart for each instance preserves source/cursor/mirror | restart case |
| L7 | page errors = 0 | audit |
| L8 | console errors = 0 | audit |
| L9 | zero residual scoped Electron/browser/sync-test processes | process audit |

## M. Artifact integrity

Required S7-F artifact classes:

```text
exact-product-head.txt
source validation output
source-instance-identities.json
sync-configuration.json
outbound-envelopes-A.json
outbound-envelopes-B.json
sync-request-audit.json
sync-cursor-matrix.json
sync-divergence-matrix.json
membership-visibility-matrix.json
shared-workspace-A.json
shared-workspace-B.json
local-projection-invariance.json
restart-matrix.json
electron-ui-audit.json
cleanup-audit.json
screenshots
manifest.json
SHA256SUMS.txt
```

| ID | Requirement | Evidence |
|---|---|---|
| M1 | artifact product SHA equals frozen product SHA | manifest |
| M2 | all internal checksums verify | SHA256SUMS |
| M3 | downloaded ZIP digest independently matches GitHub artifact digest | post-run audit |
| M4 | JSON/JSONL privacy scan is clean | post-run scan |
| M5 | screenshots contain required S7 surfaces | visual audit |

## Stop / NO-GO conditions

Any of the following blocks S7 GO:

- remote mirror can mutate canonical local execution projections;
- remote/member role can approve HumanGate or control Worker in S7 v1;
- profile/cookie/token/private-key/process control material appears in sync payload/evidence;
- cross-Workspace injection succeeds;
- duplicate/conflicting envelopes are silently last-write-wins merged;
- acknowledged envelopes replay as new local/external effects after restart;
- sync service outage breaks local S0–S6 correctness;
- arbitrary URL/method/header transport is exposed to renderer;
- native two-instance matrix cannot prove local authority isolation;
- page/console errors or residual scoped processes remain unexplained.

## Gate 0 exit

S7-A is complete when the contract, architecture and this matrix agree on:

```text
optional/offline-safe sync
append-only integrity chain
explicit collaboration-safe allowlist
remote mirror ≠ local execution truth
TeamRole = visibility only
exact project-owned transport
separate source identities
two-instance native acceptance
shared root files reserved for S7-I
```
