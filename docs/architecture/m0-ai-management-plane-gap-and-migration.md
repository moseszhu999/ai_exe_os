# AIEXE Group Management Plane — AS-IS, GAP, TO-BE and Migration

Date: 2026-08-09  
Repository: `moseszhu999/ai_exe_os`  
Observed main: `81dbfcb20e46684213f79fa9e0720c3b6daa395a`  
Open integration owner: Draft PR #122, `agent/s8-controlled-delegation-integration-v1`, observed head `9f69357eacd5ddee23122a665502a5e914eae53d`

## 1. AS-IS

AIEXE is already much further than its README's S0 wording suggests. The currently observed repository contains an execution/control stack with scheduling, workspace collaboration, sync, capability references, bounded delegation, destination-local authority, HumanGate and evidence/receipt paths.

Important assets already present:

- execution graph and scheduling primitives;
- persistent workspace/application projections;
- HumanGate for consequential actions;
- S7 collaboration/sync and local source identity;
- S8 capability-bound delegation policy and request integrity;
- destination-local delegation admission and execution authority;
- bounded transport, cancellation and receipt handoff;
- evidence-oriented runtime posture;
- explicit boundaries against remote authority escalation.

These are precisely the lower-layer primitives a management plane needs.

## 2. GAP register

| ID | Gap | Consequence | Priority |
|---|---|---|---|
| G1 | No first-class portfolio/project snapshot | AIEXE cannot reason across businesses using a stable management contract | P0 |
| G2 | No management proposal object | Continue/pause/reprioritize decisions remain chat/window state | P0 |
| G3 | No explicit external domain-truth boundary in portfolio model | Risk that a future manager agent becomes an accidental canonical owner | P0 |
| G4 | No cross-project attention queue | Human owner remains the manual coordination bus | P0 |
| G5 | No management authority classes | Read, recommend and bind can be conflated | P0 |
| G6 | No normalized project adapter contract | TrainingOS/TradeOS/Shared Media states cannot be safely aggregated | P1 |
| G7 | No management evaluation harness | Cannot know whether autonomy reduces workload without increasing policy failures | P1 |
| G8 | No portfolio-level resource/capability allocation policy | Scheduling is local rather than strategic across projects | P2 |
| G9 | README/status narrative is stale | Operators cannot easily understand true current maturity | P1 after S8 integration settles |

## 3. TO-BE

```text
Portfolio owner
    |
    v
AIEXE Group Management Plane
    |- Portfolio Registry / Project Observations
    |- Goal + Priority + Policy Envelopes
    |- Attention Queue
    |- Management Proposal Engine
    |- Capability / Resource Allocation
    |- Governance + Authorization
    |- Evidence + Audit + Evaluation
    |
    +--> TrainingOS Controller  (domain truth remains TrainingOS-owned)
    +--> TradeOS Controller     (domain truth remains TradeOS-owned)
    +--> Shared Media Controller
    +--> Research Controller
            |
            v
      Existing AIEXE execution/delegation primitives
```

### Core invariant

> AIEXE may observe, propose, schedule and delegate within explicit authority, but it does not become the canonical owner of Domain OS business truth.

## 4. Migration plan

### M0 — Management contract foundation — IMPLEMENTED IN THIS SLICE

Deliver:

- `ManagedProjectSnapshot` contract;
- portfolio aggregation snapshot;
- explicit attention signals;
- evidence-backed management proposals;
- hardcoded management boundary: `observe-and-propose`;
- forbidden consequential action classes in management proposals;
- contract tests.

Exit gate:

- source syntax passes;
- M0 contract tests pass;
- no S8 files changed;
- no runtime or domain mutation introduced.

### M1 — Read-only portfolio adapters

Deliver:

- adapter interface for repository/project status;
- initial adapters for AIEXE, TrainingOS, TradeOS and Shared Media;
- normalized owner/milestone/open-work/blocker/evidence snapshots;
- freshness/staleness metadata;
- no write path.

Exit gate:

- every displayed management fact carries source + observed time;
- stale sources fail visible, not silently current;
- zero domain writes.

### M2 — Attention queue and management proposals

Deliver:

- deterministic signal rules for owner conflict, blocked milestone, failing validation, stale status, duplicated shared capability;
- LLM synthesis may explain signals but cannot fabricate them;
- proposal queue: continue / pause / reprioritize / escalate;
- owner-facing cockpit.

Exit gate:

- proposal precision measured on a replay dataset;
- false escalations and missed escalations tracked separately.

### M3 — Bounded management execution through existing S8

Deliver:

- A2 authority actions only through canonical capability references and delegation policy;
- task-scoped authorization envelope;
- destination-local revalidation;
- receipt returns to management plane;
- no second orchestration transport.

Examples of initially eligible A2 actions:

- run tests;
- collect read-only status;
- request a domain controller receipt;
- create a non-binding implementation plan;
- schedule already-approved bounded work.

Exit gate:

- all effects trace to policy + capability version + task + receipt;
- unauthorized-effect count = 0.

### M4 — Human-on-the-loop management cockpit

Deliver:

- daily/hourly portfolio cycle;
- "automatic / needs attention / blocked" views;
- decision packets containing evidence and recommended action;
- explicit HumanGate for authority widening or consequential actions.

Exit gate:

- owner no longer needs to inspect every project window for routine state;
- attention queue is materially smaller than raw project event volume.

### M5 — Adaptive management and evaluation

Deliver:

- outcome feedback into allocation/replanning heuristics;
- per-project cost/latency/quality policy;
- management benchmark/replay suite;
- safe autonomy expansion only for decision classes that meet thresholds.

Exit gate:

- improvements are demonstrated across goal completion, constraints, evidence completeness and attention reduction, not only speed.

## 5. Migration rules

1. Do not create a second S8 delegation owner while PR #122 is open.
2. M0/M1 must be additive and independent of S8 integration internals.
3. Domain controllers remain authoritative for their own business semantics.
4. AIEXE management records must distinguish observation, proposal, approval and execution.
5. Management recommendations require evidence references.
6. No inferred "healthy" status when evidence is stale or missing.
7. Merge, deploy, payment, destructive mutation, credential write and production write are outside M0 authority.
8. Expansion from A1 to A2 requires explicit policy and receipt coverage.

## 6. Current implementation receipt

This migration begins with a narrow M0 contract slice:

- `src/management/portfolio/index.cjs`
- `tests/m0-portfolio-management-contract.test.cjs`

The slice intentionally does **not** wire into Electron, S8 or any Domain OS. It establishes the management-plane vocabulary and authority boundary first, so later runtime work has a stable contract to implement against.
