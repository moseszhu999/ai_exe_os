# Docs-First Delivery Roadmap

## Product principle

AI Execution OS should be built as an execution-control product, not as a collection of browser scripts.

The browser is the worker substrate. The durable product assets are:

```text
task model
execution graph
session model
resource ownership
human gates
evidence and recovery
provider adapters
```

## Stage map

### S0 — Feasibility

Goal:

```text
prove Electron control plane + persistent real-browser workers
```

Deliverables:

```text
zero-stage decision
hybrid architecture
session orchestration spike
spike result report
GO / GO WITH ARCHITECTURE CHANGE / NO-GO verdict
```

No formal product implementation begins before the verdict.

### S1 — Local execution kernel

Goal:

```text
reliable local task and worker lifecycle
```

Deliverables:

```text
SQLite event store
Project model
Task model
ExecutionGraph model
BrowserSession model
profile lease manager
worker process manager
human confirmation gate
recovery checkpoints
```

Acceptance:

```text
restart-safe
idempotent transitions
no duplicate external action
no credential storage
```

### S2 — GitHub-native engineering workflow

Goal:

```text
turn branches, PRs, reviews, checks, and merge commits into scheduler evidence
```

Deliverables:

```text
repository registry
branch ownership
PR task binding
status-check watcher
review-thread watcher
stale-base invalidation
merge-order constraints
bounded repair-task generation
```

Acceptance:

```text
one PR event produces one scheduler event
stale branches cannot silently continue
conflicting path ownership is blocked
```

### S3 — Multi-session operator console

Goal:

```text
make parallel work understandable and controllable
```

Deliverables:

```text
project cockpit
execution graph view
worker/session view
prompt preview
human gate inbox
blocker view
PR/CI evidence view
recovery view
```

Acceptance:

```text
operator can explain what every worker is doing
operator can stop one worker without affecting others
operator can see why a task is blocked
```

### S4 — Provider adapters

Goal:

```text
observe delivery platforms without coupling the scheduler to one vendor
```

Possible adapters:

```text
GitHub
Vercel
Netlify
Supabase
Neon
```

The first version of each adapter is read-only unless a separate write contract is accepted.

### S5 — Scheduling policy

Goal:

```text
optimize long-lived session output under bounded concurrency
```

Deliverables:

```text
priority policy
resource locks
session reuse policy
cost/throughput metrics
retry policy
waiting-human policy
worker health scoring
```

No scheduler may invent a task or expand scope merely to keep a session busy.

### S6 — Optional collaboration and sync

Goal:

```text
support multiple devices or operators only after local correctness is proven
```

Possible future work:

```text
cloud event replication
team roles
shared project state
remote worker inventory
organization policies
```

Supabase, Neon, or another online database may be evaluated here. They are not required for S0–S3.

## First PR sequence

```text
PR-0  zero feasibility and architecture docs
PR-1  Electron + Chrome session spike
PR-2  S0 result report and architecture lock
PR-3  execution-graph domain model
PR-4  session registry and profile lease
PR-5  human gate and event log
PR-6  read-only GitHub adapter
PR-7  operator console vertical slice
```

## Parallelism rules

Before a task starts, the scheduler must reserve:

```text
repository
branch
allowed file paths
browser profile
PR metadata target
cloud target when applicable
```

Two workers may run in parallel only when their write sets do not overlap.

## Documentation required before each implementation wave

Every implementation wave needs:

```text
goal
allowed files
forbidden files
state transitions
human gates
failure behavior
acceptance evidence
stop conditions
```

## Permanent product boundaries

```text
No model API is required for the core browser-path thesis.
No credential scraping.
No identity-control bypass.
No hidden external writes.
No automatic production deployment or database migration by default.
No financial, payment, wallet, token, settlement, or legal execution in the initial product.
```

## Current next action

Implement only PR-1 after PR-0 is independently reviewed and merged.
