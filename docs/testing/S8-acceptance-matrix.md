# S8 Controlled Remote Execution Delegation — Acceptance Matrix

## Status

Gate 0 acceptance definition for canonical issue #115.

Exact starting main:

```text
7872ec55d5b7c12fb9eed2f7a535457f41c186c7
```

Final S8 verdict is issued only against one frozen product head after S8-I.

Allowed verdicts:

```text
GO
GO WITH ARCHITECTURE CHANGE
NO-GO
```

## A. Baseline and ownership

| ID | Requirement | Evidence | Pass condition |
|---|---|---|---|
| A1 | exact frozen product SHA | source artifact | one immutable SHA used by all final tests |
| A2 | S0–S7 regression | full validation | all accepted tests green |
| A3 | owner/path audit | PR file lists | no overlapping implementation owners |
| A4 | QA-only final carrier | PR scope | native acceptance scripts/workflows never merge into product head |
| A5 | two real app roots | native evidence | independent SQLite/userData roots |

## B. Peer binding and policy

| ID | Requirement | Pass condition |
|---|---|---|
| B1 | exact bilateral peer binding | source/destination instance + Workspace exact match |
| B2 | wildcard peer rejected | no wildcard source/destination identity |
| B3 | wildcard Workspace rejected | exact Workspace mapping required |
| B4 | active policy required | missing policy → fail closed |
| B5 | version exactness | request policy version must equal active destination policy |
| B6 | expiry | expired policy rejected |
| B7 | revocation | revoked policy rejected |
| B8 | supersession | superseded stale policy rejected |
| B9 | capability allow-set | unlisted capability rejected |
| B10 | action allow-set | unlisted action rejected |
| B11 | target allow-set | unlisted target rejected |
| B12 | request bounds | pending/accepted-not-started caps are hard upper bounds |

## C. Request integrity and privacy

| ID | Requirement | Pass condition |
|---|---|---|
| C1 | deterministic request digest | identical semantic input → identical digest |
| C2 | monotonic sequence | exact next sequence accepted |
| C3 | sequence gap | gap rejected, not silently repaired |
| C4 | exact duplicate | same id/digest idempotent |
| C5 | digest conflict | same id/new digest rejected |
| C6 | cross-Workspace | rejected |
| C7 | wrong destination | rejected |
| C8 | unknown source | rejected |
| C9 | unsupported schema | rejected |
| C10 | forbidden field recursion | sensitive field at any depth rejected |
| C11 | forbidden value scan | Bearer/private-key/token-like values rejected |
| C12 | process/profile privacy | pid/profile/userData/storageState/control handles absent |

## D. Destination admission

| ID | Requirement | Pass condition |
|---|---|---|
| D1 | receipt alone non-runnable | inbound request creates no Task/StepAttempt/ResourceLock/effect |
| D2 | local installation required | missing CapabilityInstallation → inadmissible |
| D3 | local AgentCapabilityGrant required | missing grant → inadmissible |
| D4 | provider authority | missing/stale provider authorization → inadmissible when applicable |
| D5 | current resource state | stale/blocked resources prevent acceptance/binding |
| D6 | current scheduling state | stale/over-capacity state prevents binding/start |
| D7 | admission evidence | immutable DelegationAdmissionSnapshot persisted |
| D8 | explicit reason codes | every rejected admission is explainable |

## E. HumanGate authority

| ID | Requirement | Pass condition |
|---|---|---|
| E1 | delegation HumanGate required | no runnable delegated identity before local gate acceptance |
| E2 | rejection | local gate reject → zero local execution identity |
| E3 | source cannot approve | no remote/transport/renderer path can approve destination gate |
| E4 | source cannot reject | no remote path can reject destination gate |
| E5 | gate evidence | UI/evidence identifies source, policy, capability/action/target and local authority inputs |
| E6 | action gate preserved | accepting delegation does not bypass existing action HumanGate |

## F. Exactly-once local binding

| ID | Requirement | Pass condition |
|---|---|---|
| F1 | one request one binding | accepted request creates at most one DelegatedExecutionBinding |
| F2 | one binding one local identity | binding references one destination-local execution identity |
| F3 | duplicate transport | repeated request cannot create second binding |
| F4 | restart | restart after acceptance/binding cannot duplicate identity/effect |
| F5 | stale revalidation | authority drift before binding rejects creation |
| F6 | already terminal | terminal request cannot be rebound |

## G. Local execution authority

| ID | Requirement | Pass condition |
|---|---|---|
| G1 | S6 selection | Worker selection occurs through accepted local scheduling policy |
| G2 | S1 ResourceLocks | local locks remain final resource authority |
| G3 | S2/S1 execution | execution follows existing local orchestration/runtime path |
| G4 | no Worker RPC | remote side cannot start/stop/focus/pause/resume Worker |
| G5 | no direct effect RPC | remote side cannot invoke provider/browser effect directly |
| G6 | no remote retry | failed/uncertain work is not remotely auto-retried |
| G7 | local recovery | destination restart/recovery uses existing local authority semantics |

## H. Cancellation semantics

| ID | Requirement | Pass condition |
|---|---|---|
| H1 | pre-start proposal | source cancellation creates only cancellation proposal |
| H2 | local pre-start decision | destination decides whether pending proposal is cancelled |
| H3 | post-start non-authority | remote cancellation cannot directly stop/cancel local execution |
| H4 | uncertain effect protection | cancellation cannot trigger duplicate or unsafe retry |

## I. Receipt and source consumption

| ID | Requirement | Pass condition |
|---|---|---|
| I1 | bounded receipt | no credential/profile/process/raw secret data |
| I2 | deterministic receipt digest | semantic receipt revisions are digest-bound |
| I3 | receipt replay | idempotent mirror update only |
| I4 | source truth invariant | pulling receipt alone does not mutate source Task/Mission execution truth |
| I5 | explicit source handoff | completed receipt releases source dependency only through declared S2 handoff/output validation |
| I6 | stale source revision | stale Mission revision cannot consume receipt |
| I7 | exactly-once receipt consumption | same receipt cannot release same handoff twice |

## J. Transport

| ID | Requirement | Pass condition |
|---|---|---|
| J1 | project-owned acceptance target | final native acceptance uses loopback/project-owned target |
| J2 | exact endpoint | destination endpoint configured outside arbitrary renderer input |
| J3 | bounded methods | only schema-defined GET/POST routes used |
| J4 | bounded size/timeouts | oversized/timeout conditions fail cleanly |
| J5 | no ambient credentials | Authorization/Cookie absent unless a future separate contract explicitly permits |
| J6 | renderer isolation | no arbitrary URL/method/header IPC |
| J7 | transport ≠ acceptance | HTTP success cannot create execution binding without local admission/gate |

## K. Offline and restart

| ID | Requirement | Pass condition |
|---|---|---|
| K1 | source offline | local source correctness preserved |
| K2 | destination offline | local destination correctness preserved |
| K3 | no busy retry loop | bounded retry/manual push semantics only |
| K4 | acknowledged request no replay | restart does not issue new request identity |
| K5 | gate no auto-approval | restart does not approve pending gate |
| K6 | binding no duplicate | restart does not create second local identity |
| K7 | effect no replay | restart does not replay completed/uncertain external effect |
| K8 | receipt no mutation replay | receipt mirror rehydrates without source execution mutation |

## L. UI / explainability

Final real Electron UI must visibly explain:

```text
Delegation / Overview
Peer Binding
Policy id/version/status
Outbound Requests
Incoming Proposals
Admission Evidence
Destination HumanGate
Local Execution Binding
Receipts / Evidence
Cancellation Proposal
Divergence / Replay / Rejection reason
```

Acceptance requires:

| ID | Requirement | Pass condition |
|---|---|---|
| L1 | source view | outbound request identity/status visible |
| L2 | destination inbox | incoming proposal visible before gate |
| L3 | gate explanation | authority inputs visible |
| L4 | bound execution | local execution identity visible after acceptance |
| L5 | receipt/evidence | bounded result visible on both sides as appropriate |
| L6 | rejection reason | fail-closed reason visible |
| L7 | no remote Worker controls | no remote start/stop/pause/resume/focus buttons |
| L8 | no remote gate controls from source | source UI cannot approve destination gate |
| L9 | page errors | zero |
| L10 | console errors | zero |

## M. Native two-instance acceptance

Required topology:

```text
native Apple Silicon arm64
instance A: independent userData + SQLite + stable source identity
instance B: independent userData + SQLite + stable source identity
project-owned delegation endpoint
real Google Chrome Worker on one instance
real Playwright Chromium Worker on the other
```

Required flow:

1. start both instances;
2. establish exact active bilateral peer binding and destination policy;
3. prove a request with missing destination grant is inadmissible;
4. provision the required destination-local accepted grant through existing local authority;
5. create one valid source DelegationRequest;
6. transport it to destination;
7. prove zero local runnable identity before delegation HumanGate acceptance;
8. reject one request and prove zero execution identity;
9. accept a second valid request;
10. create exactly one destination-local binding;
11. run through existing scheduling / ResourceLock / action HumanGate path;
12. complete bounded project-owned local test effect;
13. emit receipt/evidence;
14. source pulls receipt and remains canonically unchanged until explicit handoff consumption;
15. consume completed receipt through source-local declared handoff exactly once;
16. exercise duplicate request, digest conflict, sequence gap, stale/revoked policy, cross-Workspace and wrong destination failures;
17. exercise pre-start cancellation proposal and post-start remote-cancel non-authority;
18. restart both Electron instances with same userData;
19. prove identity/request/gate/binding/receipt rehydration with zero replay;
20. graceful teardown with zero residual scoped processes.

## N. Immutable artifact requirements

Final S8-F artifact must include privacy-safe files sufficient to independently audit:

```text
frozen-product-head.txt
source-validation.txt
peer-policy-evidence.json
request-integrity-matrix.json
admission-matrix.json
human-gate-matrix.json
binding-exactly-once.json
local-authority-matrix.json
cancellation-matrix.json
receipt-handoff-matrix.json
restart-no-replay.json
transport-audit.json
privacy-audit.json
runtime-cleanup-audit.json
Electron screenshots for source/destination before/after/restart
manifest.json
SHA256SUMS.txt
```

Forbidden fields/values are recursively scanned before artifact upload.

## O. Final stop conditions

Immediate `NO-GO` unless repaired and re-frozen if final acceptance finds any of:

- remote Worker control path;
- remote HumanGate decision path;
- remote ResourceLock mutation;
- execution identity created before local delegation gate;
- duplicate request creates duplicate execution;
- credential/profile/process replication;
- policy bypass or wildcard Workspace authority;
- remote retry of uncertain/failed effect;
- post-start remote cancellation directly stops local work;
- receipt pull mutates source canonical execution truth;
- restart replays request, approval or effect;
- source/destination cross-Workspace leakage;
- page/console errors in required UI flow;
- residual scoped processes;
- missing immutable evidence/checksum verification.

## P. Permanent exclusions

S8 acceptance does not authorize:

```text
direct remote administration
remote browser/profile/session takeover
remote HumanGate approval
remote capability installation/grant
credential/token/cookie forwarding
authenticated third-party provider mutation
production deployment/database migration by default
financial/payment/wallet/token execution
legal irreversible execution
quota/rate/pricing/concurrency circumvention
```

Those remain separate future gates.