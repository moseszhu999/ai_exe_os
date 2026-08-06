# Docs-First Delivery Roadmap

## Product principle

AI Execution OS is an execution-control product, not a collection of browser scripts.

Durable product assets:

```text
Workspace authorization boundary
Marketplace capability contracts
Agent grants
Task and ExecutionGraph model
worker/session lifecycle
resource ownership
Human Gates
evidence and recovery
provider-use contracts
provider adapters
```

Technical feasibility and provider-authorized use remain separate gates.

## Current status

```text
S0 real-workstation verdict: GO
S0 implementation and final evidence: merged to main
current stage: S1 Local Execution Kernel
canonical S1 issue: #10
```

S0 proved:

```text
Electron operator control plane
persistent Chrome / Chromium Workers
profile lease exclusivity
renderer → preload → IPC → browser → event-store path
stable loopback origin
cross-restart localStorage
unexpected-close reconciliation
forced-crash recovery
no automatic duplicate submission
native Apple Silicon workstation operation
```

## Stage map

### S0 — Technical feasibility and provider boundary

Status: **COMPLETED — GO**

Accepted architecture:

```text
Electron control plane
+ dedicated visible browser profiles
+ bounded Playwright control
+ append-only recovery evidence
+ Human Gate before local execution
```

Allowed validation targets:

```text
local test pages
project-owned services
explicitly authorized test surfaces
read-only GitHub state
```

ChatGPT website automation and programmatic third-party AI output extraction were not and are not S0 evidence paths.

### S1 — Local Execution Kernel and Workspace Interconnect

Goal:

```text
Marketplace capability
→ install into Workspace
→ authorize for Agent
→ bind to Task / ExecutionGraph
→ reserve Worker/resources
→ persisted Human Gate
→ execute
→ store evidence and recover safely
```

Deliverables:

```text
local SQLite canonical events and projections
bounded S0 JSONL import
Project and Workspace model
CapabilityPackage / Version / Installation
Agent and AgentCapabilityGrant
TaskNode / DependencyEdge / ExecutionGraph
ResourceLock
persisted HumanGate
ExecutionRun / ExecutionEvent
integrated Electron UI
```

Acceptance:

```text
Workspace isolation
Agent grant enforcement
idempotent transactional transitions
rebuildable projections
no duplicate external action
no credential or cookie storage
provider gate enforced before navigation/submission
one integrated real-workstation user story
```

Normative S1 documents:

```text
docs/contracts/S1-workspace-marketplace-agent-interconnect.md
docs/architecture/002-s1-local-execution-kernel.md
docs/testing/S1-acceptance-matrix.md
```

### S2 — GitHub-native engineering workflow

Goal:

```text
turn supported GitHub branches, PRs, reviews, checks, and merge commits into scheduler evidence
```

Deliverables:

```text
repository registry
branch and path ownership
PR task binding
status-check watcher
review-thread watcher
stale-base invalidation
merge-order constraints
bounded repair-task generation
```

Acceptance:

```text
one PR observation produces one scheduler event
stale branches cannot silently continue
conflicting ownership is blocked
write actions remain separately Human-Gated
```

### S3 — Multi-session operator console

Goal:

```text
make parallel execution understandable and controllable
```

Deliverables:

```text
project/workspace cockpit
Marketplace and Agent views
ExecutionGraph view
Worker/session inventory
Task payload preview
provider-use status
Human Gate inbox
blocker and recovery views
PR/CI evidence view
```

Acceptance:

```text
operator can explain every active Worker
operator can stop one Worker without affecting others
operator can see every authorization and blocker reason
```

### S4 — Approved provider adapters

Goal:

```text
observe or act on external delivery surfaces only through accepted paths
```

Possible adapters:

```text
GitHub
Vercel
Netlify
Supabase
Neon
other explicitly approved surfaces
```

The first version of every adapter is read-only unless a separate write contract is accepted.

No ChatGPT website adapter may be created while the provider gate remains blocked.

### S5 — Scheduling policy

Goal:

```text
optimize long-lived Worker utilization under bounded concurrency and provider rules
```

Deliverables:

```text
priority policy
resource locks
session reuse policy
local cost and throughput metrics
retry policy
waiting-human policy
Worker health scoring
provider quota awareness
```

The scheduler must not invent work, expand task scope, or circumvent pricing, metering, usage, rate, concurrency, or product restrictions.

### S6 — Optional collaboration and sync

Goal:

```text
support multiple devices/operators only after local correctness is proven
```

Possible future work:

```text
cloud event replication
team roles
shared Project/Workspace state
remote Worker inventory
organization policy
```

Online databases are not required for S0–S3.

## S1 implementation sequence

### Contract gate

```text
S1-C0 docs-only domain / architecture / acceptance contract
```

### Parallel implementation owners

After S1-C0 is accepted and merged, start each owner from the latest independent `main`:

```text
S1-B storage owner
  src/storage/**
  migrations/**
  tests/storage/**

S1-C Workspace / Marketplace / Agent owner
  src/domain/workspace*.cjs
  src/domain/capability*.cjs
  src/domain/agent*.cjs
  tests/domain/**

S1-D scheduler / resource locks / Human Gate owner
  src/main/scheduler/**
  src/main/human-gate/**
  tests/scheduler/**

S1-E integrated UI owner
  src/renderer/s1/**
  src/preload/s1*.cjs
  tests/ui-contract/**

S1-F independent exact-head and real-Mac acceptance owner
  read-only product review
  test/evidence tooling only
```

Sibling implementation owners may not import unmerged sibling branches.

## Parallelism rules

Before execution, reserve:

```text
Workspace
repository
branch
allowed file paths
browser profile
provider surface
PR metadata target
local/cloud target when applicable
```

Two Workers may run concurrently only when their write sets and exclusive resources do not overlap.

## Documentation required before each implementation wave

```text
goal
allowed files
forbidden files
state transitions
provider-use status
Human Gates
failure and recovery behavior
acceptance evidence
stop conditions
```

## Permanent product boundaries

```text
No credential, cookie, password, authorization-code, or copied-token replication.
No CAPTCHA, identity-control, anti-abuse, fingerprint, user-agent, TCP, TLS, or protocol evasion.
No automated third-party AI output extraction where terms prohibit it.
No circumvention of pricing, metering, usage, rate, concurrency, or restrictions.
No hidden external writes.
No automatic production deployment or production database migration by default.
No financial, payment, wallet, token, settlement, or legal execution in the initial product.
```

## Current next action

```text
review and merge S1-C0 docs-only contract
→ launch disjoint S1-B / S1-C / S1-D implementation owners from latest main
→ integrate after independent exact-head validation
→ build S1-E unified Electron UI
→ execute S1-F real-workstation acceptance matrix
→ issue GO / GO WITH ARCHITECTURE CHANGE / NO-GO
```