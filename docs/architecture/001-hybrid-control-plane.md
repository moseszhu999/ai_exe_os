# Hybrid Control-Plane Architecture

## One-sentence product definition

AI Execution OS is a local-first desktop control plane that turns persistent browser sessions and GitHub-native delivery states into a human-supervised execution graph for AI software engineering.

## Architecture decision

```text
Electron operator console
        │
        ├── local scheduler and execution graph
        ├── worker/session registry
        ├── confirmation and safety gates
        ├── GitHub delivery-state adapter
        └── browser worker manager
                │
                ├── managed Chrome profile A
                ├── managed Chrome profile B
                ├── managed Chromium profile C
                └── optional isolated Electron WebContentsView
```

Electron owns orchestration. It does not need to be the only browser engine process.

## Core components

### 1. Operator Console

The Electron UI shows:

```text
projects
execution graphs
tasks
persistent sessions
active browser workers
Git branches and PRs
CI / Preview / deployment evidence
human confirmations
errors and recovery actions
```

The console must remain usable even when all browser workers are stopped.

### 2. Execution Graph

A project is represented as a directed graph.

```text
Project
└── ExecutionGraph
    ├── TaskNode
    ├── DependencyEdge
    ├── HumanGate
    ├── EvidenceRequirement
    └── CompletionPolicy
```

Suggested task states:

```text
draft
queued
ready
active
waiting_browser
waiting_human
waiting_external
blocked
failed
completed
cancelled
```

The scheduler moves tasks. It does not silently reinterpret task goals.

### 3. Session Registry

A session is a durable worker identity, not merely a tab.

```text
Session
- id
- projectId
- role
- browserEngine
- profilePath or partition
- targetHosts
- activeTaskId
- status
- lastKnownUrl
- lastHeartbeatAt
- recoveryPolicy
- humanOwner
```

A session may survive many tasks. This is essential to the project's cost and continuity thesis.

### 4. Browser Worker Manager

The manager launches and controls browser processes.

Primary worker type:

```text
ManagedChromeWorker
- real Chrome / Chromium executable
- dedicated persistent user-data directory
- Playwright or CDP control channel
- visible window by default
- user performs authentication directly in browser
```

Optional worker type:

```text
ElectronRemoteViewWorker
- isolated Electron session partition
- remote content only
- no Node integration
- strict navigation allowlist
- not the default Google OAuth path
```

### 5. Human Gate Service

Actions are classified before execution.

```text
READ_ONLY
REVERSIBLE_LOCAL
EXTERNAL_WRITE
SECURITY_SENSITIVE
DESTRUCTIVE
FINANCIAL_OR_LEGAL
```

Default policy:

| Class | Default |
|---|---|
| READ_ONLY | may run automatically inside an approved task |
| REVERSIBLE_LOCAL | may run with task-level permission |
| EXTERNAL_WRITE | explicit confirmation unless pre-approved narrowly |
| SECURITY_SENSITIVE | explicit per-action confirmation |
| DESTRUCTIVE | explicit per-action confirmation plus preview |
| FINANCIAL_OR_LEGAL | out of scope for the first product |

Examples requiring a gate:

```text
send a prompt that will change repository state
submit a PR review
merge or close a PR
trigger a production deployment
change environment variables
run a database migration
alter authentication settings
delete cloud resources
```

### 6. GitHub Delivery-State Adapter

GitHub provides durable coordination evidence:

```text
branch
commit
Draft PR
review thread
status check
Preview link
merge commit
issue comment
```

The adapter converts GitHub state into scheduler events without making GitHub the runtime database for every local browser detail.

Example:

```text
PR exact-head focused check PASS
→ task implementation accepted
→ unlock independent review task

PR merged
→ invalidate stale worker base
→ create refresh task from new main
```

### 7. Local State Store

The first implementation should be local-first.

Suggested first store:

```text
SQLite
```

It stores scheduler metadata, not provider credentials.

```text
projects
graphs
tasks
dependencies
sessions
worker_runs
human_gates
evidence_refs
events
```

Raw passwords, session cookies, access tokens, and browser password-manager contents must not be copied into SQLite.

## Login and identity model

The user authenticates inside the actual browser surface.

```text
AI Execution OS does not ask for the user's Google password.
AI Execution OS does not replay credentials.
AI Execution OS does not export cookies between unrelated profiles.
```

For Google-based sign-in, use a real managed Chrome profile or the operating system browser. Embedded OAuth is not a dependency.

## Browser profile ownership

One profile directory may be owned by only one live worker process.

```text
profile lease
- profileId
- workerId
- acquiredAt
- heartbeatAt
- processId
- releasedAt
```

If the app crashes, the next launch must inspect the process and lock state before recovering the profile.

## Prompt and task model

Prompts are versioned task inputs.

```text
PromptTemplate
- id
- version
- role
- goal
- allowedScope
- forbiddenScope
- stopConditions
- evidenceRequirements
```

A session receives a rendered prompt plus task metadata. The original template and rendered text remain auditable.

The scheduler must not continuously send messages merely because a session exists. It sends only when a task transition authorizes a new action.

## Parallelism model

Parallelism exists at two levels:

```text
between browser sessions
inside one task's agent plan
```

The scheduler prevents conflicting ownership through resource locks:

```text
repository path lock
Git branch lock
browser profile lease
PR metadata lock
deployment target lock
database target lock
```

## Recovery model

Every worker run records a checkpoint:

```text
worker started
browser ready
page ready
input prepared
human confirmation requested
input submitted
response observed
evidence captured
task transition committed
```

After a crash, the scheduler resumes from the last confirmed checkpoint. It never assumes an external action succeeded merely because submission was attempted.

## Provider adapters

Adapters are replaceable.

```text
BrowserAdapter
GitHubAdapter
VercelAdapter
NetlifyAdapter
SupabaseAdapter
NeonAdapter
```

The first spike implements only the minimum BrowserAdapter and a read-only GitHub state adapter.

## Security baseline

Remote browser content is isolated from the Electron main process.

Required:

```text
nodeIntegration: false
contextIsolation: true
sandbox: true
webSecurity: true
strict IPC schema
sender validation
navigation allowlist
new-window allowlist
permission request handler
no arbitrary shell.openExternal
```

## Non-goals for S0/S1

```text
model API routing
credential vault product
headless account farming
CAPTCHA bypass
anti-bot evasion
user-agent spoofing
automatic production mutation
automatic merge
automatic database migration
financial execution
legal execution
```

## First implementation boundary

The first runnable code may implement only:

```text
Electron console shell
local SQLite state
managed Chrome profile launcher
worker readiness detection
manual sign-in checkpoint
pause/resume/focus controls
simple task state machine
read-only GitHub PR status polling
```

Anything beyond this requires a new accepted contract.
