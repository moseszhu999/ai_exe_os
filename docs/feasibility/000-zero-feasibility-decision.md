# S0 Zero-Stage Feasibility Decision

Status: **CONDITIONAL GO FOR A BOUNDED SPIKE**

This document answers two separate questions:

```text
A. Can Electron coordinate persistent browser workers?
B. May a specific provider surface be automated in that way?
```

The answer to A is a bounded technical **GO**. The answer to B must be decided separately for every provider and product surface.

## Technical decision

```text
Electron is the control plane.
Dedicated Chrome / Chromium profiles are the primary browser workers.
Playwright or CDP provides bounded control.
GitHub delivery state provides durable scheduling evidence.
```

Electron-hosted remote content is optional and isolated. Embedded OAuth is not a required login path.

## Provider decision

No browser worker may automate a provider merely because the browser control is technically possible.

The normative provider gate is:

```text
docs/compliance/000-provider-terms-and-supported-paths-gate.md
```

Default rule:

```text
unknown provider status → automation blocked
```

OpenAI's current individual Terms of Use prohibit automatically or programmatically extracting data or Output and prohibit circumventing rate limits, restrictions, protective measures, or safety mitigations.

Therefore the S0 spike must not automate ChatGPT web prompt/output workflows or use browser automation to avoid OpenAI pricing, metering, usage limits, concurrency limits, or supported commercial interfaces.

## What is technically supported

### Persistent sessions

Electron persistent partitions and browser user-data directories can preserve cookies, cache, local storage, and other session state across restarts.

For the primary browser-worker path, each worker receives a dedicated profile directory. The system must never launch two browser processes against the same profile directory.

Playwright's `launchPersistentContext()` stores session state in a user-data directory and explicitly requires a separate automation profile rather than the user's normal default Chrome profile.

### Browser automation

Playwright can automate Electron, but its Electron support is documented as experimental.

The product must not depend exclusively on that experimental API. The preferred execution probe is a dedicated Chrome/Chromium persistent context or a bounded CDP connection.

### Multiple isolated workers

The architecture may assign one durable profile to each role:

```text
project-a / controller
project-a / implementation-1
project-a / review-1
project-b / controller
```

Each worker has explicit profile ownership, task ownership, process identity, recovery state, and human owner.

## Google login constraint

Google OAuth authorization endpoints may reject embedded user-agents with `disallowed_useragent`.

AI Execution OS must not depend on Google social login completing inside an embedded Electron renderer.

Accepted authentication patterns are limited to provider-supported paths such as:

```text
user-controlled login in a dedicated real Chrome / Chromium profile;
operating-system default browser OAuth;
provider-supported desktop authentication.
```

Forbidden:

```text
user-agent spoofing
browser fingerprint impersonation
cookie extraction from unrelated profiles
credential interception
CAPTCHA or anti-abuse bypass
TCP/TLS/protocol impersonation
```

## Security boundary

Remote websites are untrusted content.

Any remote Electron renderer must use:

```text
nodeIntegration = false
contextIsolation = true
sandbox = true
webSecurity = true
```

The application must also implement:

```text
strict IPC schemas
IPC sender validation
navigation allowlists
new-window allowlists
permission request handlers
no arbitrary shell.openExternal
```

## S0 technical scope

The bounded spike may prove:

```text
Electron operator console
two dedicated persistent Chrome/Chromium workers
profile isolation
restart persistence
profile leases
start / stop / focus / pause / resume
human-gated task transitions
local test-form submission
local test-response observation
read-only GitHub PR/check state transitions
crash recovery without duplicate external action
```

The spike must use local, project-owned, or explicitly authorized test surfaces. ChatGPT web output is not an S0 evidence source.

## S0 exit rule

S0 may receive a technical `GO` only when:

```text
1. two persistent workers are created from separate profile directories;
2. their state remains isolated;
3. state survives application restart;
4. one profile can be leased to only one live worker;
5. Electron can focus, pause, resume, stop, and recover each worker independently;
6. a task moves idempotently through queued → active → waiting-human → completed;
7. one GitHub PR/check transition creates exactly one scheduler event;
8. uncertain external actions become waiting-human after a crash;
9. no credentials or copied browser tokens appear in logs or application storage;
10. no provider restriction, rate limit, identity control, or protective measure is bypassed.
```

## Final verdicts

```text
GO
GO WITH ARCHITECTURE CHANGE
NO-GO
```

A technical `GO` does not approve any provider adapter. Provider approval is a separate gate.

## Stop conditions

Stop or redesign if:

```text
persistent state requires credential extraction;
a profile cannot be recovered safely after a crash;
a required test depends on a prohibited provider workflow;
automation requires identity or anti-abuse bypass;
remote content requires privileged Node integration;
external actions cannot be made idempotent;
the commercial thesis depends on circumventing provider pricing or usage limits.
```

## Primary references

- Electron session API: https://www.electronjs.org/docs/latest/api/session
- Electron security guidance: https://www.electronjs.org/docs/latest/tutorial/security
- Playwright Electron API: https://playwright.dev/docs/api/class-electron
- Playwright persistent contexts: https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context
- Google OAuth desktop apps: https://developers.google.com/identity/protocols/oauth2/native-app
- OpenAI Terms of Use: https://openai.com/policies/terms-of-use/
