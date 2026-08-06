# S0 Real-Workstation Runtime Matrix

Status: **GO — FINAL EXACT-HEAD macOS MATRIX PASSED**

This document records the completed S0 real-workstation runtime matrix for the bounded, provider-safe Electron / Chrome / Chromium orchestration spike.

## Final verdict

```text
GO
```

The critical launch, isolation, human-gate, persistence, browser-close, forced-crash, duplicate-submission, stale-lease, resource, and security rows were executed successfully on a real Apple Silicon Mac against the current exact source head.

This verdict does not authorize ChatGPT web automation, third-party provider-output extraction, credential replication, anti-abuse bypass, or production deployment.

## Exact source and ownership boundary

```text
repository: moseszhu999/ai_exe_os
parent implementation PR: #2
parent exact head: 7740ae8276deafda3965f2bbb6bc928feed70ce9
lifecycle hardening PR: #3
lifecycle exact head: 63084d8d79cbc4d86845c2c8f0b85edea099765a
IPC / stable-origin PR: #6
IPC exact head: cfd32fe4410e95103fb8e6341795931cb9fbf2c4
recovery-matrix PR: #7
final recovery exact head: 3339181f579f3c1d0c3d76b51b7fb052b4d1f234
canonical tracker: Issue #4
evidence branch: agent/s0-real-workstation-runtime-matrix-evidence-v1
final workstation run: 2026-08-06
```

PR #2 and PR #3 owner branches were not modified, reset, rebased, cherry-picked, deleted, or taken over by the runtime-matrix controller. All runtime work used isolated detached worktrees or dedicated stacked branches.

## Exact-head CI

```text
workflow: S0 source validation
run: 31116559016
exact commit: 3339181f579f3c1d0c3d76b51b7fb052b4d1f234
status: completed
conclusion: success
source syntax: PASS
unit tests: PASS
provider-boundary scan: PASS
```

The first job attempt encountered a GitHub Actions `Service Unavailable` before checkout. The retry passed without a code change.

## Real workstation environment

```text
platform: macOS real desktop session
host: Apple Silicon
shell execution: /usr/bin/arch -arm64
Node process architecture: arm64
Rosetta translated: no
Electron: 43.2.0
Playwright: 1.62.0
Playwright Chromium revision: 1234
installed Chrome: real local Google Chrome channel
stable owned test origin: http://127.0.0.1:43119
```

A translated x64 / Rosetta shell previously caused the installed Chrome channel to time out. Running the same matrix under a native arm64 shell resolved the failure. Chrome reinstall and Chromium substitution were not required. This is an execution-environment requirement, not an S0 product architecture change.

## Final runtime matrix

| Area | Check | Status | Final evidence |
|---|---|---:|---|
| Installation | pinned npm dependencies | PASS | Completed in isolated exact-head worktree. |
| Installation | Electron binary | PASS | Electron 43.2.0 installed and launched. |
| Installation | Playwright Chromium | PASS | Installed and launched on Apple Silicon. |
| Source | `npm run validate` | PASS | Exact-head CI and real Mac validation passed. |
| Electron | main / preload / renderer launch | PASS | Preload bridge available; renderer page errors: 0. |
| IPC | renderer → preload → main → event store | PASS | Real persisted IPC event chain proven by PR #6 and retained by PR #7. |
| Chromium | visible persistent Chromium worker | PASS | Real persistent arm64 Chromium worker launched. |
| Chrome | visible installed Chrome worker | PASS | Real installed Chrome channel launched under native arm64 shell. |
| Multi-worker | Chrome + Chromium simultaneous workers | PASS | Chrome `idle`; Chromium `waiting_human` in the same live phase. |
| Controls | focus / pause / resume | PASS | Real runtime events and state transitions recorded. |
| Controls | selected-worker stop isolation | PASS | Chrome stopped while Chromium remained active in `waiting_human`. |
| Human gate | confirmation dialog | PASS | Real dialog path exercised. |
| Human gate | cancellation performs no submission | PASS | `task.submission_started` count remained `{ before: 0, after: 0 }`. |
| Human gate | acceptance targets owned local surface | PASS | Submission was limited to `127.0.0.1:43119`. |
| State | result returns task and worker to `waiting_human` | PASS | Persisted snapshots and worker state confirmed. |
| Persistence | stable origin across restart | PASS | Fixed loopback origin remained `127.0.0.1:43119`. |
| Persistence | localStorage read after graceful restart | PASS | Readback contained `previous=persist-value-before-restart`. |
| Recovery | workers rehydrate as stopped | PASS | Confirmed after graceful and forced restarts. |
| Recovery | active task becomes `waiting_human` | PASS | Reason: `application_recovery_requires_review`. |
| Lifecycle | unexpected browser close reconciliation | PASS | `worker.stopped` recorded with `reason=browser_context_closed`. |
| Lifecycle | restart after unexpected close | PASS | Same Chromium worker restarted cleanly. |
| Crash | forced Electron termination | PASS | Real process-level termination performed after active snapshot. |
| Duplicate safety | no automatic duplicate submission | PASS | Submission count moved from 2 to 3 exactly once; no restart duplicate. |
| Lease safety | stale lease reclaim only after dead PID | PASS | Worker restarted only after the recorded Electron process was dead. |
| Resources | idle CPU / RSS | PASS | Snapshot recorded. |
| Resources | one-worker CPU / RSS | PASS | Snapshot recorded. |
| Resources | two-worker CPU / RSS | PASS | Snapshot recorded. |
| Resources | pre-crash CPU / RSS | PASS | Snapshot recorded. |
| Cleanliness | tracked worktree changes | PASS | No tracked modifications after the run. |
| Cleanliness | residual scoped processes | PASS | No probe-scoped residual process remained. |

## Final exact-head evidence summary

```text
matrix status: PASS
persisted events: 27
renderer pageErrors: 0
confirmation cancel: before 0 / after 0
cross-restart localStorage: PASS
Chrome + Chromium dual-worker state: PASS
browser_context_closed: PASS
forced-crash recovery: PASS
no duplicate submission: before 2 / after 3
resource snapshots: 4 / 4 present
tracked worktree: clean
residual processes: none
```

## Local immutable evidence

```text
/Users/zhudapeng/Movies/RemotionActions/projects/ai_exe_os/evidence/s0-final-exact-head-20260806-234618/
/Users/zhudapeng/Movies/RemotionActions/projects/ai_exe_os/evidence/s0-final-exact-head-20260806-234618.zip
```

The local bundle contains `matrix-result.json`, `events.jsonl`, three screenshots, four resource snapshots, controller and validation logs, and `FINAL-EXACT-HEAD-ASSESSMENT.md`.

## Security and provider boundary

| Boundary | Status |
|---|---:|
| `nodeIntegration=false` | PASS |
| `contextIsolation=true` | PASS |
| `sandbox=true` | PASS |
| `webSecurity=true` | PASS |
| unexpected navigation denied | PASS |
| new windows denied | PASS |
| restrictive profile lock permissions | PASS |
| project-owned local test target only | PASS |
| provider credential / cookie / copied token storage | NOT IMPLEMENTED / PROHIBITED |
| ChatGPT or third-party AI web automation | NOT IMPLEMENTED / PROHIBITED |
| programmatic provider-output extraction | NOT IMPLEMENTED / PROHIBITED |
| CAPTCHA, anti-abuse, fingerprint, TCP, TLS, or protocol impersonation | NOT IMPLEMENTED / PROHIBITED |

## Known operational constraint

On Apple Silicon, the S0 real-Chrome matrix must run from a native arm64 Node / shell. A Rosetta-translated x64 launcher can select an unsupported Chrome / Chromium execution path and time out. This is treated as an explicit workstation prerequisite, not a reason to change the S0 architecture or replace real Chrome with Playwright Chromium.

## Final bounded decision

```text
SOURCE LAYER: PASS
EXACT-HEAD CI: PASS
REAL MAC IPC: PASS
REAL CHROME + CHROMIUM ISOLATION: PASS
PERSISTENCE / RECOVERY / CRASH SAFETY: PASS
RESOURCE EVIDENCE: PASS
PROVIDER BOUNDARY: PASS
FINAL S0 VERDICT: GO
```
