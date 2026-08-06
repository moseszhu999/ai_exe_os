# S0 Zero-Stage Feasibility Decision

Status: **GO FOR A BOUNDED SPIKE**

This document answers the first question for AI Execution OS:

> Can an Electron-based desktop control plane coordinate persistent signed-in browser sessions and use them as long-lived workers for software-engineering task orchestration?

## Decision

Yes, with one important architecture constraint:

```text
Electron is the control plane.
Real Chrome / Chromium profiles are the primary execution substrate.
Embedded Electron web content is optional, isolated, and not the default OAuth path.
```

The system should not assume that every provider login can safely or reliably complete inside an Electron `BrowserWindow` or `WebContentsView`.

## What is technically supported

### Persistent Electron sessions

Electron exposes persistent browser sessions through partitions such as:

```text
persist:project-a-session-01
```

Electron documents that `session.fromPartition()` returns the same session for the same partition and that partitions prefixed with `persist:` survive app restarts.

This is sufficient for isolated cookies, cache, permissions, and browser state where the target site supports Electron-hosted browsing.

### Browser automation

Playwright provides Electron automation support and can inspect the Electron main process and application windows. That support is currently documented as experimental.

For the primary execution path, the project should prefer normal Playwright Chromium or Chrome control with persistent user-data directories. Electron then manages workers, windows, state, and confirmations without making Electron's experimental automation API the sole dependency.

### Multiple isolated workers

The architecture can assign one persistent profile to each long-lived worker:

```text
project-a / controller
project-a / implementation-1
project-a / review-1
project-b / controller
```

Each worker may hold its own signed-in state, tabs, current task, prompt history reference, Git branch, and recovery checkpoint.

## Critical constraint: Google login

Google OAuth policies disallow authorization endpoints in embedded user-agents under developer control. Google explicitly documents the `disallowed_useragent` error and directs desktop applications toward the operating system's default browser or supported external-user-agent flows.

Therefore AI Execution OS must not depend on Google social login completing inside an embedded Electron renderer.

The accepted paths are:

```text
A. user logs in through a managed real Chrome / Chromium profile;
B. an OAuth flow opens in the operating system browser and returns through a supported redirect;
C. a target service's own supported desktop sign-in mechanism is used.
```

Forbidden workaround:

```text
user-agent spoofing
browser fingerprint impersonation
cookie extraction from unrelated profiles
CAPTCHA bypass
credential interception
```

## Security boundary

Remote websites are untrusted content.

For any remote content displayed by Electron:

```text
nodeIntegration = false
contextIsolation = true
sandbox = true
webSecurity = true
```

No privileged Electron API may be exposed directly to a remote page. IPC senders must be validated. Navigation and new-window creation must be allowlisted.

## Why the hybrid design is correct

The hybrid design matches the practical distinction between two browser needs:

```text
isolated in-app browser state
versus
existing real Chrome profile, signed-in session, tabs, and extensions
```

OpenAI's own desktop documentation makes the same distinction: its built-in browser uses its own state, while tasks needing an existing Chrome profile and signed-in session should use Chrome.

This does not prove that every third-party site permits automated use. It does show that a control-plane-plus-real-browser architecture is technically coherent.

## Feasibility verdict by capability

| Capability | Verdict | Notes |
|---|---|---|
| Electron desktop control plane | PASS | Mature platform for local UI, processes, IPC, and state |
| Persistent isolated sessions | PASS | Electron persistent partitions and Chrome user-data directories |
| Multiple concurrent workers | PASS WITH LIMITS | Requires resource limits, recovery, and explicit profile ownership |
| Manual sign-in persistence | PASS TO TEST | Must be proven per target service |
| Google social login inside embedded Electron | DO NOT DEPEND ON IT | Embedded OAuth user-agent restrictions |
| Real Chrome profile control | PASS TO SPIKE | Preferred login and execution path |
| Playwright-driven orchestration | PASS TO SPIKE | Normal browser support is mature; Electron support is experimental |
| Automatic task completion across arbitrary sites | NOT PROVEN | Must be validated site by site |
| GitHub-driven scheduling | PASS TO DESIGN | PR, branch, check, and review states form a usable task graph |

## S0 exit rule

The project may enter product architecture only after the S0 spike proves:

```text
1. two persistent browser workers can be created;
2. their signed-in states remain isolated;
3. state survives application restart;
4. Electron can open, focus, pause, resume, and inspect both workers;
5. one task can move through queued → active → waiting-human → completed;
6. one GitHub PR state can trigger the next local task decision;
7. no credentials are copied into application logs or storage;
8. no user-agent spoofing or embedded OAuth workaround is required.
```

## Stop conditions

Stop or redesign if any of the following is true:

```text
persistent sign-in cannot survive restart without credential extraction;
required providers consistently reject managed real Chrome sessions;
automation requires bypassing anti-abuse or identity controls;
remote pages require privileged Node integration;
the scheduler cannot recover worker ownership safely after a crash;
the browser product path is materially more expensive than the observed manual workflow.
```

## Primary references

- Electron session API: https://www.electronjs.org/docs/latest/api/session
- Electron security guidance: https://www.electronjs.org/docs/latest/tutorial/security
- Playwright Electron API: https://playwright.dev/docs/api/class-electron
- Google OAuth for desktop apps: https://developers.google.com/identity/protocols/oauth2/native-app
- Google OAuth policies: https://developers.google.com/identity/protocols/oauth2/policies
- OpenAI desktop built-in browser guidance: https://help.openai.com/en/articles/20001277-using-the-built-in-browser-in-the-chatgpt-desktop-app
