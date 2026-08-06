# S0 Real-Workstation Runtime Matrix

Status: **BLOCKED — REAL macOS WORKSTATION EXECUTION CHANNEL NOT AVAILABLE**

This document records the bounded evidence collected by the dedicated S0 runtime-matrix controller. It does **not** claim that a real-workstation matrix has completed.

## Exact source and ownership boundary

```text
repository: moseszhu999/ai_exe_os
parent PR: #2
parent branch: agent/s0-provider-safe-browser-orchestration-spike
parent exact head: 7740ae8276deafda3965f2bbb6bc928feed70ce9
lifecycle hardening PR: #3
validation branch: agent/s0-browser-lifecycle-hardening-v1
exact source SHA: 63084d8d79cbc4d86845c2c8f0b85edea099765a
canonical tracker: Issue #4
evidence branch: agent/s0-real-workstation-runtime-matrix-evidence-v1
observed at: 2026-08-06T09:23:32Z
```

PR #2 and PR #3 remained open, draft, mergeable, and unchanged at the exact SHAs above. No competing S0 runtime branch was present before this evidence branch was created. This branch does not modify, reset, rebase, cherry-pick, delete, or take ownership of either implementation branch.

## Required command audit

The following repository-control commands were required for a local workstation run:

```bash
git fetch origin --prune
git worktree list
git branch -vv
git status
git rev-parse origin/agent/s0-browser-lifecycle-hardening-v1
git log --oneline --decorate -15 origin/agent/s0-browser-lifecycle-hardening-v1
gh pr view 2
gh pr view 3
gh issue view 4
```

Result: **BLOCKED in this execution channel**. The available executor was not a checkout on the user's Mac and had no `gh` binary or authenticated local Git worktree. Equivalent authoritative PR, branch, issue, changed-file, exact-head, and workflow-run reads were completed through the connected GitHub API.

## Executor environment observed

| Item | Result |
|---|---|
| Required workstation | macOS real workstation |
| Available executor | Debian GNU/Linux 13 (trixie) container |
| Architecture | x86_64 |
| Kernel | Linux 6.18.35 |
| Node | v22.16.0 |
| npm / npx | 10.9.2 / 10.9.2 |
| git | 2.47.3 |
| GitHub CLI | not installed |
| Google Chrome | not found |
| System Chromium | `/usr/bin/chromium` |
| Electron binary | not found |
| GUI session | no usable X11 socket; not a real workstation desktop |

This Linux container is not accepted as a substitute for the required macOS real-workstation run.

## Exact-head CI evidence

```text
workflow: S0 source validation
run id: 31088233581
exact commit: 63084d8d79cbc4d86845c2c8f0b85edea099765a
status: completed
conclusion: success
runner: ubuntu-latest
```

The workflow installs the pinned dependency graph with `npm install --ignore-scripts`, then executes `npm run validate`, and scans runtime source for prohibited OpenAI/ChatGPT targets. This proves the source layer and exact-head CI layer only. It does not satisfy the required real-workstation `npm install` with lifecycle scripts enabled.

## Runtime matrix

| Area | Check | Status | Evidence / blocker |
|---|---|---:|---|
| Installation | `npm install` with lifecycle scripts | BLOCKED | No connected macOS worktree or remote Mac command channel. CI uses `--ignore-scripts`, which is not substituted. |
| Installation | `npx playwright install chromium` | BLOCKED | No connected macOS worktree or browser-install channel. |
| Source | `npm run validate` | PASS (CI) / BLOCKED (workstation) | Exact-head workflow run 31088233581 succeeded; real-workstation execution not run. |
| Electron | application/main/renderer launch | BLOCKED | Electron is not installed in the available executor and no macOS GUI session is connected. |
| Chrome | visible persistent worker | BLOCKED | Google Chrome is absent from the available executor; no Mac Chrome session is connected. |
| Chromium | visible Playwright worker | BLOCKED | A Linux system Chromium exists, but the required Playwright 1.62.0 macOS installation and visible workstation session are unavailable. |
| Multi-worker | Chrome + Chromium simultaneous visible workers | BLOCKED | Requires a connected GUI workstation. |
| Controls | independent focus / pause / resume / stop | BLOCKED | Requires live visible workers. |
| Human gate | cancel performs no submission | STATIC PASS / RUNTIME BLOCKED | Renderer returns immediately when `window.confirm` is rejected; no live UI execution captured. |
| Human gate | acceptance submits only to owned local page | STATIC PASS / RUNTIME BLOCKED | Worker target is the loopback `LocalTestServer` task page; no live submission captured. |
| State | worker/task enter `waiting_human` | UNIT/STATIC PASS / RUNTIME BLOCKED | Source and tests implement uncertain/result containment; no real browser trace captured. |
| Persistence | profile/localStorage after graceful restart | BLOCKED | Requires real persistent profiles and app restart. |
| Manual close | stopped + lease release + clean restart | UNIT PASS / RUNTIME BLOCKED | PR #3 regression tests cover context close and idempotent restart; no real window close captured. |
| Forced crash | active task recovers to `waiting_human` | UNIT/STATIC PASS / RUNTIME BLOCKED | Repository recovery code exists; no OS-level forced Electron termination executed. |
| Duplicate safety | no automatic duplicate submission | STATIC PASS / RUNTIME BLOCKED | Recovery changes active tasks to `waiting_human` and has no automatic resubmit path; real crash evidence absent. |
| Lease safety | reclaim only when recorded PID is dead | UNIT/STATIC PASS / RUNTIME BLOCKED | `process.kill(pid, 0)` gate is present; real PID lifecycle not exercised. |
| Resources | idle / one worker / two workers CPU and memory | BLOCKED | Requires real Electron and browser processes. |

## Static security audit

| Boundary | Status | Exact-source evidence |
|---|---:|---|
| `nodeIntegration=false` | PASS | Electron `BrowserWindow.webPreferences` |
| `contextIsolation=true` | PASS | Electron `BrowserWindow.webPreferences` |
| `sandbox=true` | PASS | `app.enableSandbox()` and window preference |
| `webSecurity=true` | PASS | Electron `BrowserWindow.webPreferences` |
| New windows denied | PASS | `setWindowOpenHandler(() => ({ action: 'deny' }))` |
| Unexpected navigation denied | PASS | `will-navigate` permits only the local renderer file URL |
| IPC sender validation | PASS | IPC handlers reject sender frames not matching the renderer URL |
| Renderer injection boundary | PASS | Renderer creates nodes and assigns `textContent`; no runtime `innerHTML` use in the reviewed UI path |
| Profile lock permissions | PASS | lease files are written with mode `0600` |
| Stale lease PID guard | PASS | existing live PID blocks acquisition; dead PID permits replacement |
| Owned test target | PASS | browser worker navigates only to the loopback project test server |

## Provider boundary

```text
ChatGPT web automation: NOT IMPLEMENTED / PROHIBITED
third-party AI output extraction: NOT IMPLEMENTED / PROHIBITED
credential, cookie, or copied token replication: NOT IMPLEMENTED / PROHIBITED
provider pricing or limit circumvention: NOT IMPLEMENTED / PROHIBITED
CAPTCHA or anti-abuse bypass: NOT IMPLEMENTED / PROHIBITED
user-agent, fingerprint, TCP, TLS, or protocol impersonation: NOT IMPLEMENTED / PROHIBITED
```

The exact-head CI provider scan passed. The reviewed worker target is the project-owned loopback test surface. The optional GitHub token is consumed only by the bounded read-only GitHub adapter and is not copied into browser profiles by the reviewed path.

## Evidence paths

```text
GitHub PR #2: parent implementation metadata and source boundary
GitHub PR #3: lifecycle hardening metadata and regression scope
GitHub Issue #4: canonical runtime checklist
GitHub Actions run 31088233581: exact-head source validation
local HTML report: ai_exe_os_s0_runtime_matrix_2026-08-06.html
```

No screenshots of Electron, Chrome, Chromium, dual workers, manual close, forced crash, or resource monitors exist because no real macOS workstation was connected to this controller.

## Changes, commit, PR, and CI

```text
implementation owner files modified: none
PR #2 owner branch modified: no
PR #3 owner branch modified: no
evidence file modified: docs/spikes/S0-results.md
evidence branch: agent/s0-real-workstation-runtime-matrix-evidence-v1
new implementation fix: none
new runtime CI: none
existing exact-head CI: PASS (run 31088233581)
```

## Bounded verdict

```text
NO FINAL S0 VERDICT — REAL-WORKSTATION CRITICAL ROWS REMAIN BLOCKED
```

A `GO`, `GO WITH ARCHITECTURE CHANGE`, or `NO-GO` verdict is intentionally withheld because critical launch, visible multi-worker, persistence, OS-level crash recovery, duplicate-submission, and resource rows remain unexecuted on a real workstation.
