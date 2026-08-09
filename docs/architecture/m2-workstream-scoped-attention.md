# M2.3 Workstream-Scoped Management Attention

Date: 2026-08-09  
Parent: `docs/architecture/m2-deterministic-attention-queue.md`  
Owner: AIEXE PR #125 only

## Problem discovered from real portfolio evidence

The original M2 Attention Queue evaluates one project as one management unit.

That is safe for a small portfolio, but current TrainingOS, TradeOS and Video Operation evidence shows a false-pause risk:

```text
one workstream blocked
!=
whole project blocked
```

Examples observed on 2026-08-09:

- TrainingOS Course Video requires latest-main exact-head revalidation, while bounded Shared Media Mac smoke evidence is already complete and other owner-safe work exists.
- TrainingOS Marketplace still lacks final browser acceptance; this does not mechanically mean every TrainingOS line must stop.
- TradeOS N2 `MarketSharedCaseProposal` is held on authentic runtime acceptance, while BusinessChannel contract work and P2 planning remain independent.
- Video Operation is different: the current earliest business milestone is M10 full human review and M11 publication is downstream of that gate, so the observed critical path is genuinely held.

A project-only policy would tend to over-escalate the first two projects.

## Design principle

```text
WorkstreamPause != ProjectPause
```

AIEXE therefore introduces a read-only workstream projection beneath the project snapshot.

The new contracts are:

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

| Workstream truth | Bucket | Proposal |
|---|---|---|
| active / complete, no blocker | automatic | continue |
| unknown | needs_attention | escalate |
| blocked / paused / explicit blocker | blocked | pause |

A workstream `pause` has:

```text
projectWideAuthority = false
```

It is an advisory containment decision for that workstream only.

## Project rollup policy

The rollup is deterministic.

### Explicit project status dominates

If the authoritative project-level Domain Controller says:

```text
project.status = blocked | paused
```

then project-wide pause is allowed as a proposal.

### Unknown workstream truth

If any observed workstream is `unknown`, the project is sent to `needs_attention / escalate` instead of treating the missing workstream as safe.

### Partial critical block

If at least one critical workstream is blocked but at least one independent safe workstream remains:

```text
bucket = needs_attention
proposal = reprioritize
projectWidePause = false
```

The purpose is to contain the blocker and move capacity to already-authorized safe work, not to create new work or override Domain ownership.

### All observed critical work held

If critical workstreams are held and no safe observed workstream remains:

```text
bucket = blocked
proposal = pause
projectWidePause = true
```

Video Operation M10/M11 is the current real example.

## Real replay fixture

`fixtures/management/m2-real-workstream-replay-2026-08-09.json` records three current cross-project cases.

### TrainingOS

Observed result:

```text
Course Video                 BLOCKED
Marketplace browser proof    BLOCKED
Shared Media Mac smoke       COMPLETE
-------------------------------------
project rollup               REPRIORITIZE
projectWidePause             false
```

### TradeOS

Observed result:

```text
N2 MarketSharedCaseProposal  BLOCKED
BusinessChannel core         ACTIVE
P2 cockpit plan              COMPLETE
-------------------------------------
project rollup               REPRIORITIZE
projectWidePause             false
```

### Video Operation / Shared Media

Observed result:

```text
M10 human full review        BLOCKED
M11 publication              BLOCKED by M10
-------------------------------------
project rollup               PAUSE
projectWidePause             true
```

This is not a claim that the three cases prove general management quality. It proves that project-only attention is insufficient for the current portfolio and that the scoped policy can reproduce these explicit labels.

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

This is deliberate. A still-semantically-correct old status is not automatically promoted to current truth.

## Management behavior after M2.3

The group-management loop should become:

```text
exact repository observations
+ exact-head project Controller attestation
+ explicit workstream attestations / canonical workstream facts
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
        +--> continue safe existing work
        +--> reprioritize around contained blockers
        +--> escalate unknown truth
        +--> pause only when project-wide evidence supports it
```

## Authority boundary

M2.3 remains management observation/proposal only.

```text
reprioritize != schedule
reprioritize != delegate
workstream continue != execution authority
workstream pause != provider cancellation
project pause proposal != runtime stop
```

M2.3 does not:

- touch S8 integration files;
- start a Worker or Mission;
- run CI;
- merge or deploy;
- mutate Domain truth;
- create or widen a capability grant;
- make a HumanGate decision;
- contact an external party;
- modify TrainingOS, TradeOS or Video Operation repositories.

## G2 / G3 effect

This slice improves, but does not close, the M3 evidence gates.

```text
G2 broader management replay evidence      PARTIAL
G3 real Controller attestation evidence     PARTIAL
```

Why G2 is still partial:

- the original historical project corpus remains small;
- the new workstream corpus covers only three projects and a limited set of blocker patterns;
- ambiguous/conflicting-controller, owner-conflict, recovery and false-positive cases still need broader replay.

Why G3 is still partial:

- one real Video handoff temporal sample is now executable evidence;
- recurring exact-head structured attestations from all managed project controllers are not yet proven.

## M3 boundary

M3 A2 execution remains BLOCKED.

The correct next evidence work is:

1. broaden workstream replay across more historical controller decisions;
2. standardize recurring controller outputs so each project can supply explicit structured attestation fields;
3. measure false project-wide pause, false escalation and missed escalation;
4. only after the existing S8 integration owner is accepted, prove that A2 policy eligibility can enter the canonical execution path without bypassing destination-local authority.

```text
S8 files changed = NO
A2 execution enabled = NO
Domain OS changes = NO
Merge = NO
Deploy = NO
Production mutation = NO
```
