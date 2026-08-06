# Docs-First Delivery Roadmap

## Product principle

AI Execution OS should be built as an execution-control product, not as a collection of browser scripts.

The durable assets are:

```text
task model
execution graph
session model
resource ownership
human gates
evidence and recovery
provider-use contracts
provider adapters
```

Technical browser control and provider-authorized use are separate gates.

## Stage map

### S0A — Technical feasibility

Goal:

```text
prove Electron control plane + persistent dedicated browser workers
```

Deliverables:

```text
zero-stage decision
hybrid architecture
provider-safe session orchestration spike
spike result report
GO / GO WITH ARCHITECTURE CHANGE / NO-GO verdict
```

Allowed targets:

```text
local test pages
project-owned test services
explicitly authorized test surfaces
read-only GitHub state
```

ChatGPT web automation and programmatic ChatGPT output extraction are not S0 evidence paths.

### S0B — Provider terms and supported-paths gate

Goal:

```text
approve or block each exact provider surface before adapter implementation
```

Every provider contract records:

```text
governing terms
supported mechanism
permitted actions
prohibited actions
rate and concurrency limits
authentication path
human confirmation policy
evidence sources
review date
status
```

Default:

```text
unknown → blocked for automation
```

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
provider gate enforced before navigation or submission
```

### S2 — GitHub-native engineering workflow

Goal:

```text
turn supported GitHub branches, PRs, reviews, checks, and merge commits into scheduler evidence
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
write actions remain separately human-gated
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
task payload preview
provider-use status
human gate inbox
blocker view
PR/CI evidence view
recovery view
```

Acceptance:

```text
operator can explain what every worker is doing
operator can stop one worker without affecting others
operator can see why a task or provider is blocked
```

### S4 — Approved provider adapters

Goal:

```text
observe or act on delivery platforms only through accepted paths
```

Possible future adapters:

```text
GitHub
Vercel
Netlify
Supabase
Neon
other explicitly approved surfaces
```

The first version of every adapter is read-only unless a separate write contract is accepted.

No ChatGPT web adapter may be created while the current provider gate remains blocked.

### S5 — Scheduling policy

Goal:

```text
optimize long-lived session utilization under bounded concurrency and provider rules
```

Deliverables:

```text
priority policy
resource locks
session reuse policy
local cost and throughput metrics
retry policy
waiting-human policy
worker health scoring
provider quota awareness
```

The scheduler must not:

```text
invent work merely to keep a session busy
expand a task beyond its accepted scope
circumvent pricing, metering, rate limits, concurrency limits, or restrictions
```

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
PR-0  zero feasibility, provider gate, and architecture docs
PR-1  provider-safe Electron + Chrome session spike
PR-2  S0 result report and architecture lock
PR-3  execution-graph domain model
PR-4  session registry and profile lease
PR-5  human gate and event log
PR-6  read-only GitHub adapter
PR-7  operator console vertical slice
PR-N  one independently approved provider adapter
```

## Parallelism rules

Before a task starts, the scheduler reserves:

```text
repository
branch
allowed file paths
browser profile
provider surface
PR metadata target
cloud target when applicable
```

Two workers may run in parallel only when their write sets and exclusive resources do not overlap.

## Documentation required before each implementation wave

```text
goal
allowed files
forbidden files
state transitions
provider-use status
human gates
failure behavior
acceptance evidence
stop conditions
```

## Permanent product boundaries

```text
No credential scraping.
No identity-control, CAPTCHA, or anti-abuse bypass.
No browser fingerprint, user-agent, TCP, TLS, or protocol impersonation.
No automated output extraction where provider terms prohibit it.
No circumvention of pricing, metering, usage limits, rate limits, concurrency limits, or restrictions.
No hidden external writes.
No automatic production deployment or database migration by default.
No financial, payment, wallet, token, settlement, or legal execution in the initial product.
```

## Current next action

```text
independently review and merge PR-0
→ implement only the provider-safe S0 technical spike
→ record GO / GO WITH ARCHITECTURE CHANGE / NO-GO
```
