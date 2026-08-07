# S2 Acceptance Matrix

Status: **Normative draft**

Parent: #29

Final verdicts:

```text
GO
GO WITH ARCHITECTURE CHANGE
NO-GO
```

No `GO` is allowed while a critical transaction, Workspace isolation, exact-once, pause/cancel/recovery, handoff, Human Gate, provider or integrated UI row is unexecuted.

## A. Source / ownership

- exact head recorded and frozen;
- changed files match declared owner scope;
- no sibling branch dependency;
- full source/unit tests pass;
- permanent provider boundary scan passes.

## B. Mission / revision domain

- create Mission in Workspace A;
- create second Mission in Workspace B and prove query isolation;
- freeze MissionRevision on first run;
- changed semantic content creates a new revision rather than mutating frozen revision;
- same idempotency key + different intent is rejected.

## C. Plan validation

Use a minimum three-step plan:

```text
step-a ─┐
        ├→ step-c
step-b ─┘
```

- step-a and step-b initially independent;
- step-c requires both upstream outputs/evidence;
- cycle rejected;
- unknown dependency rejected;
- cross-Workspace Agent/install/grant binding rejected;
- undeclared input rejected;
- unreachable terminal step rejected.

## D. Ready-set / concurrency

- independent non-conflicting step-a and step-b can be ready concurrently;
- conflicting resource blocks only conflicting attempt;
- unrelated ready attempt remains runnable;
- mission pause prevents creation/start of new attempts;
- resume reevaluates only currently-ready work.

## E. Human Gate and exact-once

For an external-effect step:

```text
reject: submission count N → N
approve: submission count N → N+1
repeat approve: N+1 → N+1
restart after completed approval: N+1 → N+1
```

Human Gate decision must be persisted before runtime effect.

## F. Handoff / output

- completed step records immutable StepOutput;
- output includes declared schema digest and evidence references;
- downstream step receives only declared AgentHandoffs;
- changing an already-recorded completed output is rejected;
- missing output blocks dependent step;
- output from another Workspace is rejected.

## G. Pause / cancel

- pause prevents new external starts;
- current already-active execution is not falsely represented as stopped;
- resume starts only ready non-terminal work;
- cancel prevents future starts;
- completed outputs/evidence remain visible after cancel;
- cancel does not fabricate success for incomplete terminal steps.

## H. Restart / crash recovery

Graceful restart:

- MissionRevision, Plan, MissionRun, attempts, outputs, handoffs and checkpoints rehydrate;
- ready-set after restart equals pre-restart ready-set for same canonical event state;
- no completed external effect is replayed.

Forced termination during active external attempt:

- active/uncertain StepAttempt becomes `recovery_required` or `waiting_human`;
- direct repeat approval cannot reuse the uncertain attempt;
- submission count remains unchanged after restart;
- explicit retry creates a new StepAttempt identity only after human review.

## I. Checkpoint / projection integrity

- checkpoint records canonical sequence + projection digest;
- projection rebuild from canonical SQLite events yields same digest;
- corrupted/mismatched checkpoint is detected, not trusted;
- checkpoint never becomes an alternate event authority.

## J. Completion semantics

- MissionRun does not complete while a terminal dependency/output/evidence requirement is unsatisfied;
- all terminal steps + declared evidence satisfied → exactly one mission completion event;
- repeat completion evaluation is idempotent.

## K. Integrated Electron UI

Required visible surfaces:

```text
Missions
Mission Builder
Execution Plan graph
Step binding/details
Agent Handoffs
Human Gates
Checkpoints
Run Timeline
Evidence / Recovery
```

UI must show:

- active Workspace;
- revision/version identity;
- ready/running/blocked/waiting/recovery state per step;
- exact blocker reason;
- gate preview and distinct approve/reject controls;
- handoff lineage from upstream output to downstream input;
- pause/resume/cancel state;
- immutable evidence links.

No raw profile path, credential, cookie, token or process-local data may render.

## L. Native workstation acceptance

Final carrier must freeze product exact head and run on native Apple Silicon:

- Node arm64, no Rosetta;
- installed Chrome and Playwright Chromium where browser execution is required;
- project-owned bounded local test surfaces only;
- renderer page errors 0;
- console errors 0;
- tracked tree clean;
- scoped residual process count 0;
- evidence artifact contains machine-readable verdict, screenshots, canonical event export, projection/checkpoint digests and SHA-256 manifest;
- artifact excludes ephemeral browser profiles and forbidden credential/process fields.