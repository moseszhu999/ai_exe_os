# M2.4 Workstream-Scoped Management Attention

Date: 2026-08-09  
Parent: `docs/architecture/m2-deterministic-attention-queue.md`  
Owner: AIEXE PR #125 only

## Problem discovered from real portfolio evidence

The original M2 Attention Queue evaluates one project as one management unit.

That is safe for a small portfolio, but current TrainingOS, TradeOS and Video Operation evidence shows two distinct false-decision risks:

```text
one workstream blocked != whole project blocked
completed workstream != active safe capacity
```

A third boundary follows from the same evidence:

```text
observed workstreams != complete decision scope
```

unless completeness is explicitly asserted.

Examples observed on 2026-08-09:

- TrainingOS Course Video requires exact-head revalidation and Marketplace lacks final browser acceptance. A Shared Media Mac smoke is complete, but completion does not mean there is still runnable safe work, and the three recorded rows are not a complete inventory of TrainingOS workstreams.
- TradeOS N2 `MarketSharedCaseProposal` is held on authentic runtime acceptance, while BusinessChannel contract work is still active. P2 planning is complete and therefore is evidence, not remaining execution capacity.
- Video Operation is different: the current decision scope is explicitly the M10 full-human-review → M11 publication critical path. Both rows are held and the decision scope is declared complete for that milestone.

## Design principles

```text
WorkstreamPause != ProjectPause
Complete != Active
Observed != CompleteScope
```

AIEXE therefore uses a read-only workstream projection beneath the project snapshot and requires explicit decision-scope completeness before inferring project-wide pause from workstream coverage alone.

The contracts remain:

```text
aiexe.managed-workstream.v1
aiexe.workstream-attention.v1
aiexe.project-workstream-rollup.v1
```

They do not modify Domain OS repositories and do not acquire Domain truth authority.

## Managed workstream

A workstream contains explicit project-owned facts only:

```text
projectId
workstreamId
name
status
owner
milestone
critical
blockerCodes
evidenceRefs
observedAt
```

Allowed status values:

```text
active
blocked
paused
complete
unknown
```

Missing or ambiguous workstream truth is `unknown`; it is never guessed healthy.

## Workstream attention

Each workstream is evaluated independently:

| Workstream truth | Bucket | Proposal | Project continuation capacity |
|---|---|---|---|
| active, no blocker | automatic | continue | yes |
| complete, no blocker | automatic | continue | no; already finished |
| unknown | needs_attention | escalate | unknown |
| blocked / paused / explicit blocker | blocked | pause | no |

A workstream `pause` has:

```text
projectWideAuthority = false
```

It is an advisory containment decision for that workstream only.

## Decision-scope completeness

Project rollup accepts an explicit boolean:

```text
decisionScopeComplete
```

Meaning:

```text
true  = the supplied workstreams are complete for the management decision scope being evaluated
false = other project work may exist outside the observed set
```

This is deliberately not inferred from list length, project activity, repository state or LLM judgment.

If the field is omitted it behaves as `false`.

## Project rollup policy

The rollup is deterministic.

### Explicit project status dominates

If the authoritative project-level Domain Controller says:

```text
project.status = blocked | paused
```

then project-wide pause is allowed as a proposal regardless of workstream inventory completeness.

### Unknown workstream truth

If any observed workstream is `unknown`, the project is sent to `needs_attention / escalate` instead of treating missing truth as safe.

### Partial block with active safe work

If at least one workstream is held but at least one independent `active` workstream remains:

```text
bucket = needs_attention
proposal = reprioritize
projectWidePause = false
```

Completed work does not satisfy this condition.

### Held work with no active safe work and incomplete decision scope

If held work exists, no observed active work remains, and:

```text
decisionScopeComplete = false
```

then:

```text
bucket = needs_attention
proposal = escalate
primaryReason = decision_scope_incomplete
projectWidePause = false
```

This is the fail-closed truth boundary. AIEXE may not infer project-wide pause merely because the observed subset contains no runnable work.

### Held work with complete decision scope

If held work exists, no active safe work remains, and:

```text
decisionScopeComplete = true
```

then a project-wide pause proposal is allowed for that decision scope.

Critical held work produces high priority; noncritical-only held work produces normal priority.

## Rollup outputs

The rollup now distinguishes:

```text
continueEligibleWorkstreamIds = active work only
completedWorkstreamIds        = already-finished work
heldWorkstreamIds             = blocked / paused work
unresolvedWorkstreamIds       = unknown work
decisionScopeComplete         = explicit input echoed into evidence
```

Counts expose both `active` and `complete` while retaining the existing aggregate `automatic` count for compatibility.

## Real replay fixture

`fixtures/management/m2-real-workstream-replay-2026-08-09.json` records three current cross-project cases.

### TrainingOS

Observed decision scope:

```text
Course Video                 BLOCKED
Marketplace browser proof    BLOCKED
Shared Media Mac smoke       COMPLETE
decisionScopeComplete        false
-------------------------------------
project rollup               ESCALATE
projectWidePause             false
continueEligible             []
completed                    [Shared Media Mac smoke]
```

The prior M2.3 label incorrectly treated the completed smoke as remaining safe work and returned `reprioritize`. M2.4 corrects that overclaim without replacing it with an unsupported project-wide pause.

### TradeOS

Observed decision scope:

```text
N2 MarketSharedCaseProposal  BLOCKED
BusinessChannel core         ACTIVE
P2 cockpit plan              COMPLETE
decisionScopeComplete        false
-------------------------------------
project rollup               REPRIORITIZE
projectWidePause             false
continueEligible             [BusinessChannel core]
completed                    [P2 cockpit plan]
```

### Video Operation / Shared Media

Observed current critical-path decision scope:

```text
M10 human full review        BLOCKED
M11 publication              BLOCKED by M10
decisionScopeComplete        true
-------------------------------------
project rollup               PAUSE
projectWidePause             true
```

The same two held rows with `decisionScopeComplete=false` must produce `escalate`, not project-wide pause.

This is not a claim that the three cases prove general management quality. It proves the scoped policy can preserve three separate truths: workstream containment, active capacity, and decision-scope completeness.

## Real Controller Attestation temporal test

`fixtures/management/m2-real-controller-attestation-samples-v1.json` captures a second important behavior using the Video Operation handoff.

At the head explicitly recorded by the handoff:

```text
main = 0eb4a4ee1bdf27567edc4e2c6cf2dd6a5daa3a42
M10 human review = blocked
```

the attestation is accepted.

After later source commits advance main to:

```text
e4728a0b1694bb9e89bd17f7f03bc3d3746e61e8
```

the same attestation must become:

```text
accepted = false
reason = exact_head_mismatch
project status = unknown
```

A still-semantically-correct old status is not automatically promoted to current truth.

## Management behavior after M2.4

The group-management loop is:

```text
exact repository observations
+ exact-head project Controller attestation
+ explicit workstream facts
+ explicit decision-scope completeness
        |
        v
project + workstream truth reconciliation
        |
        v
workstream attention
        |
        v
project rollup
        |
        +--> continue active safe existing work
        +--> reprioritize around contained blockers
        +--> escalate unknown or incomplete decision scope
        +--> pause only when project-wide evidence supports it
```

## Authority boundary

M2.4 remains management observation/proposal only.

```text
reprioritize != schedule
reprioritize != delegate
workstream continue != execution authority
workstream pause != provider cancellation
project pause proposal != runtime stop
```

M2.4 does not:

- touch S8 integration files;
- start a Worker or Mission;
- run CI directly;
- merge or deploy;
- mutate Domain truth;
- create or widen a capability grant;
- make a HumanGate decision;
- contact an external party;
- modify TrainingOS, TradeOS or Video Operation repositories.

## G2 / G3 effect

This correction strengthens G2 evidence quality but does not close M3 readiness.

```text
G2 broader management replay evidence      PARTIAL
G3 real Controller attestation evidence     PARTIAL
```

Why G2 is still partial:

- the original historical project corpus remains small;
- the workstream corpus still covers only three projects and limited blocker patterns;
- explicit scope-completeness provenance needs broader examples;
- ambiguous/conflicting-controller, owner-conflict, recovery and false-positive cases still need replay.

Why G3 is still partial:

- one real Video handoff temporal sample is executable evidence;
- recurring exact-head structured attestations from all managed project controllers are not yet proven.

## M3 boundary

M3 A2 execution remains BLOCKED.

The next evidence work remains:

1. broaden project/workstream replay with explicit decision-scope coverage;
2. standardize recurring Controller outputs so each project can supply structured attestation fields;
3. measure false project-wide pause, false escalation and missed escalation;
4. only after the existing S8 integration owner is accepted, prove that A2 policy eligibility can enter the canonical execution path without bypassing destination-local authority.

```text
S8 files changed = NO
A2 execution enabled = NO
Domain OS changes = NO
Deploy = NO
Production mutation = NO
```
