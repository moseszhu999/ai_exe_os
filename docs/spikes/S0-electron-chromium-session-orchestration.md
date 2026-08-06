# S0 Electron + Chromium Session Orchestration Spike

## Purpose

Prove or disprove the core product assumption before building the full scheduler.

The spike validates whether an Electron control plane can create, observe, pause, resume, and recover multiple persistent real-browser workers while preserving user-controlled sign-in state.

## Time-boxed scope

The spike implements one narrow vertical slice:

```text
Electron operator console
→ create two managed Chrome workers
→ user signs in manually
→ persist profile state
→ restart application
→ recover both workers
→ assign one bounded task to each worker
→ observe completion evidence
→ read one GitHub PR state
→ unlock the next local task
```

## Required worker model

Each worker uses a dedicated profile path.

```text
.runtime/profiles/<session-id>/
```

The application must never launch two live browser processes against the same profile path.

Suggested worker record:

```ts
type WorkerStatus =
  | "created"
  | "starting"
  | "ready"
  | "waiting_for_login"
  | "idle"
  | "active"
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

### Scenario A — Persistent manual login

1. Create worker A.
2. Open a visible Chrome window.
3. User signs in manually to the target service.
4. Record only a `login_confirmed` checkpoint; do not store credentials or cookies separately.
5. Stop the browser and Electron app.
6. Restart the app and worker.
7. Confirm the browser profile remains signed in.

Repeat for worker B with a different profile.

Pass condition:

```text
A and B retain their own session state after restart;
A cannot see B's profile data;
no password, cookie, OAuth code, or token appears in logs or SQLite.
```

### Scenario B — Concurrent isolation

1. Launch workers A and B at the same time.
2. Navigate them to different approved target pages.
3. Focus A, then focus B from Electron.
4. Pause A while B remains active.
5. Resume A.

Pass condition:

```text
worker controls affect only the selected worker;
profile leases remain unique;
no browser is killed by an unrelated task transition.
```

### Scenario C — User-approved prompt execution

The spike may perform one harmless, user-approved prompt in each signed-in AI session.

Required flow:

```text
task prepared
→ exact rendered prompt shown in Electron
→ user confirms
→ prompt inserted and submitted through normal visible browser interaction
→ response-presence evidence observed
→ task marked waiting_review
```

Restrictions:

```text
no hidden API calls
no credential access
no CAPTCHA handling
no anti-bot bypass
no user-agent spoofing
no background submission without confirmation
no claim that the answer is correct merely because a response appeared
```

Pass condition:

```text
both workers can execute independent approved prompts;
the scheduler associates each response evidence item with the correct task and session.
```

### Scenario D — GitHub state unlock

Use one public test repository or a harmless Draft PR.

Example:

```text
Task A waits for PR check conclusion.
GitHub adapter reads the PR state.
PASS unlocks Task B.
FAIL creates a bounded repair task.
PENDING leaves the graph unchanged.
```

The first adapter may use `gh` or the GitHub API. Browser scraping is not required for this step.

Pass condition:

```text
one real PR/check transition produces exactly one idempotent scheduler event.
```

### Scenario E — Crash recovery

1. Start a worker and task.
2. Kill the Electron process before task completion.
3. Restart.
4. Inspect the browser process, profile lease, and last checkpoint.
5. Require human confirmation before resubmitting any uncertain external action.

Pass condition:

```text
no duplicate prompt submission;
no duplicate GitHub write;
profile ownership recovered safely;
uncertain actions become waiting_human rather than completed.
```

## Minimal UI

The spike UI contains only:

```text
Project selector
Task list
Worker list
Create worker
Start / stop
Focus
Pause / resume
Open login window
Rendered prompt preview
Confirm / reject
Event log
```

No design system, marketplace, analytics dashboard, cloud sync, or multi-user collaboration is required.

## Technical choices to validate

### Electron

```text
current stable Electron
contextIsolation = true
sandbox = true
nodeIntegration = false for remote content
```

### Browser control

Preferred first probe:

```text
playwright.chromium.launchPersistentContext(profilePath, {
  channel: "chrome",
  headless: false
})
```

Fallback probes:

```text
Chromium persistent context
Chrome launched with a dedicated user-data directory plus CDP
```

Electron's Playwright `_electron` API may be used for application tests, but the product architecture must not depend solely on an experimental API.

### Storage

Use SQLite or a simple append-only JSON event store for the spike.

Never store:

```text
raw passwords
session cookies
OAuth authorization codes
provider access tokens copied from browser storage
password-manager data
```

## Evidence required

The spike report must include:

```text
operating system
Electron version
Chrome / Chromium version
Playwright version
worker profile paths with sensitive user path removed
session isolation result
restart persistence result
concurrent worker result
prompt confirmation result
GitHub event result
crash recovery result
resource usage snapshot
known provider-specific failures
```

Screenshots must redact personal account information.

## Verdicts

Only these final verdicts are allowed:

```text
GO
GO WITH ARCHITECTURE CHANGE
NO-GO
```

### GO

All required scenarios pass without bypassing provider security controls.

### GO WITH ARCHITECTURE CHANGE

The orchestration model works, but the browser substrate or login path must change. The exact change must be recorded.

### NO-GO

The core signed-in persistent-session workflow cannot be achieved safely or reliably under the permanent boundaries.

## Files allowed in the future spike PR

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
docs/spikes/S0-results.md
```

## Forbidden in the future spike PR

```text
cloud database integration
Supabase / Neon production configuration
Vercel / Netlify production deployment
credential import
browser fingerprint manipulation
provider-specific anti-abuse bypass
automatic PR merge
automatic production mutation
payment, settlement, wallet, token, or legal execution
```
