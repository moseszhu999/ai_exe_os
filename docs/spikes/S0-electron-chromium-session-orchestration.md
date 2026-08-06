# S0 Electron + Chromium Session Orchestration Spike

## Purpose

Prove or disprove the local orchestration kernel before building the full product.

This spike validates whether an Electron control plane can create, observe, pause, resume, and recover multiple persistent browser workers while preserving user-controlled session state.

It does **not** validate ChatGPT web automation and must not programmatically extract ChatGPT output.

## Normative provider gate

The spike is governed by:

```text
docs/compliance/000-provider-terms-and-supported-paths-gate.md
```

Only these target surfaces are allowed:

```text
local test pages
project-owned test services
explicitly authorized test surfaces
read-only GitHub state through supported GitHub tooling
```

Unknown provider status means automation is blocked.

## Time-boxed vertical slice

```text
Electron operator console
→ create two managed Chrome/Chromium workers
→ use separate dedicated profile directories
→ open local or project-owned test pages
→ persist worker state
→ restart application
→ recover both workers
→ assign one bounded test task to each worker
→ require human confirmation before submission
→ observe local test evidence
→ read one GitHub PR/check state
→ unlock the next local task
```

## Required worker model

Each worker owns a dedicated profile path:

```text
.runtime/profiles/<session-id>/
```

The normal default Chrome profile must not be automated. The application must never launch two live browser processes against the same profile path.

Suggested record:

```ts
type WorkerStatus =
  | "created"
  | "starting"
  | "ready"
  | "waiting_for_login"
  | "idle"
  | "active"
  | "paused"
  | "waiting_for_human"
  | "blocked"
  | "stopped"
  | "failed";

interface BrowserWorkerRecord {
  id: string;
  projectId: string;
  role: "controller" | "implementation" | "review";
  profilePath: string;
  status: WorkerStatus;
  activeTaskId: string | null;
  lastKnownUrl: string | null;
  processId: number | null;
  lastHeartbeatAt: string | null;
}
```

## Required scenarios

### Scenario A — Persistent isolated profiles

1. Create worker A with profile A.
2. Create worker B with profile B.
3. Open a project-owned page in each worker.
4. Store harmless local test state in each browser profile.
5. Stop both browsers and the Electron app.
6. Restart the app and both workers.
7. Confirm that A restores only A's state and B restores only B's state.

Pass condition:

```text
state survives restart;
profiles remain isolated;
no password, cookie, authorization code, or copied provider token appears in logs or application storage.
```

### Scenario B — Concurrent worker control

1. Launch A and B simultaneously.
2. Focus A, then B from Electron.
3. Pause A while B remains active.
4. Resume A.
5. Stop B without affecting A.

Pass condition:

```text
controls affect only the selected worker;
profile leases remain unique;
worker lifecycle events are idempotent.
```

### Scenario C — Human-approved local task execution

Use a local or project-owned HTML task form.

Required flow:

```text
task prepared
→ exact payload shown in Electron
→ user confirms
→ payload submitted to the authorized local test page
→ local deterministic response observed
→ evidence recorded
→ task moves to waiting_review
```

Restrictions:

```text
no hidden provider API calls
no credential access
no ChatGPT web automation
no programmatic extraction of provider output
no CAPTCHA handling
no anti-bot bypass
no user-agent, fingerprint, TCP, TLS, or protocol impersonation
no background submission without confirmation
```

Pass condition:

```text
both workers execute independent authorized test tasks;
each result is associated with the correct task and worker;
no duplicate submission occurs.
```

### Scenario D — GitHub state unlock

Use a harmless Draft PR or test repository.

```text
Task A waits for a PR/check conclusion.
PASS unlocks Task B.
FAIL creates one bounded repair task.
PENDING leaves the graph unchanged.
Repeated observations do not create duplicate events.
```

The adapter may use supported GitHub APIs or `gh`. Browser scraping is not required.

Pass condition:

```text
one real PR/check transition produces exactly one idempotent scheduler event.
```

### Scenario E — Crash recovery

1. Start a worker and an authorized local task.
2. Terminate Electron before completion.
3. Restart.
4. Inspect browser process, profile lease, and last confirmed checkpoint.
5. Require human confirmation before retrying any uncertain submission.

Pass condition:

```text
no duplicate submission;
no duplicate GitHub write;
profile ownership recovered safely;
uncertain actions become waiting_human rather than completed.
```

## Minimal UI

```text
Project selector
Task list
Worker list
Create worker
Start / stop
Focus
Pause / resume
Open authorized test page
Payload preview
Confirm / reject
Event log
```

No design system, marketplace, analytics dashboard, cloud sync, or multi-user collaboration is required.

## Technical probes

### Electron

```text
current stable Electron
contextIsolation = true
sandbox = true
nodeIntegration = false for remote content
webSecurity = true
```

### Browser control

Preferred:

```ts
playwright.chromium.launchPersistentContext(profilePath, {
  channel: "chrome",
  headless: false,
});
```

Alternatives:

```text
Playwright-managed Chromium persistent context
Chrome/Chromium launched with a dedicated user-data directory plus bounded CDP connection
```

The default personal Chrome profile is out of scope. Electron's Playwright `_electron` API may test the console but must not be the sole product dependency because it is experimental.

### State

Use SQLite or an append-only local event store.

Never store:

```text
raw passwords
session cookies copied from browser storage
OAuth authorization codes
provider access tokens copied from browser storage
password-manager data
```

## Evidence required

```text
operating system
Electron version
Chrome/Chromium version
Playwright version
redacted profile paths
profile isolation result
restart persistence result
concurrent worker result
human confirmation result
local task submission result
GitHub event result
crash recovery result
resource usage snapshot
all provider surfaces contacted
provider-gate status for each contacted surface
```

Screenshots must redact personal and account information.

## Final verdicts

```text
GO
GO WITH ARCHITECTURE CHANGE
NO-GO
```

A technical `GO` does not authorize any provider adapter.

## Future spike PR allowed files

```text
package.json
package-lock.json or pnpm-lock.yaml
src/main/**
src/preload/**
src/renderer/**
src/domain/**
src/adapters/browser/**
src/adapters/github/**
tests/spike/**
test-pages/**
docs/spikes/S0-results.md
```

## Forbidden

```text
ChatGPT web prompt/output automation
automated provider-output extraction
circumvention of pricing, metering, usage limits, rate limits, concurrency limits, or restrictions
cloud database integration
Supabase / Neon production configuration
Vercel / Netlify production deployment
credential import
browser fingerprint or user-agent manipulation
TCP/TLS/protocol impersonation
CAPTCHA or anti-abuse bypass
automatic PR merge
automatic production mutation
payment, settlement, wallet, token, or legal execution
```
