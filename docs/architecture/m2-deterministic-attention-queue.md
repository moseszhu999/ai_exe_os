# M2 Deterministic Attention Queue and Management Cockpit

Date: 2026-08-09  
Parent: `docs/architecture/m1-domain-controller-receipt.md`  
Implementation owner: PR #125 / `agent/group-management-plane-m0`

## Decision

M2 turns read-only portfolio truth into a management attention queue using deterministic, inspectable rules.

The key boundary is:

```text
LLM may explain management facts.
LLM may not invent management facts.
```

Signals must come from the canonical M0/M1/M1.1 observations, Domain Controller receipts, explicit blocker codes, source freshness and exact-head checks.

## Why deterministic first

Current AI manager research shows that goal completion, constraint adherence and runtime optimization are separate objectives. A free-form LLM manager can easily over-optimize one while silently degrading another.

M2 therefore separates:

1. **fact production** — external sources and Domain Controllers;
2. **signal classification** — deterministic policy;
3. **management proposal** — explicit, evidence-backed, non-binding record;
4. **LLM explanation** — optional presentation layer only.

## Canonical schemas

```text
aiexe.management-attention.v1
aiexe.management-cockpit.v1
```

Every attention packet contains:

- project ID;
- deterministic bucket;
- primary reason;
- exact source signals;
- current project status;
- non-binding `ManagementProposal`;
- `llmFactGenerationAllowed=false`.

## Buckets

### automatic

Used only when no explicit blocking/escalation signal is present.

Current action:

```text
continue
```

This remains advisory. It does not authorize execution, merge, deploy or Domain writes.

### needs_attention

Used when truth is incomplete, stale or mismatched.

Examples:

```text
domain_status_unknown
owner_unknown
source_stale
source_freshness_unknown
domain_receipt_head_mismatch
domain_receipt_stale
domain_receipt_freshness_unknown
```

Current action:

```text
escalate
```

### blocked

Used when an explicit blocker exists or the project status is blocked.

Known blocker policy:

```text
blocker:owner_conflict                -> pause / critical
blocker:validation_failed             -> pause / high
blocker:duplicate_shared_capability   -> pause / high
blocker:policy_blocked                -> pause / critical
```

Unknown future `blocker:*` values fail conservative into:

```text
pause / high / blocked
```

This avoids an unsafe default where a new blocker taxonomy would accidentally be treated as harmless.

## Management cockpit

`buildManagementCockpit()` groups packets into:

```text
automatic
needsAttention
blocked
```

The cockpit remains:

```text
readOnly = true
writeAuthority = none
```

Its current job is to reduce operator attention, not to bind the organization.

## Management proposal boundary

All M2 proposals reuse the M0 `ManagementProposal` contract.

Permanent M0 restrictions still apply:

```text
binding = false
allowedEffect = proposal-only
forbidden:
  domain_mutation
  merge
  deploy
  payment
  credential_write
  production_write
```

M2 therefore cannot become a hidden second execution system.

## Replay evaluation

M2 includes `scoreDecisionReplay()` so management behavior can be tested independently of a live runtime.

Metrics exposed now:

```text
total
exactMatches
exactRate
falseEscalations
missedEscalations
```

False and missed escalations are separate because they create different organizational costs:

- false escalation -> unnecessary owner interruption;
- missed escalation -> silent management risk.

A later acceptance dataset should be built from real historical controller incidents rather than synthetic success claims.

## Current implementation files

```text
src/management/portfolio/attention-engine.cjs
tests/m2-attention-engine.test.cjs
```

M2 composes with:

```text
src/management/portfolio/index.cjs
src/management/portfolio/read-only-adapters.cjs
src/management/portfolio/domain-controller-receipt.cjs
```

## Combined local validation

The complete management-plane contract slice was run together:

```text
M0  management object contracts
M1  GitHub read-only observations
M1.1 exact-head Domain Controller receipts
M2  deterministic attention queue/cockpit/replay scoring
```

Observed result before repository publication:

```text
23 tests
23 pass
0 fail
```

## Current completion boundary

M2 engine implementation is present, but **real historical replay acceptance is not yet claimed**.

The next evidence task is to construct a bounded replay corpus from real prior events such as:

- owner conflicts;
- stale exact-head claims;
- validation failures;
- policy blocks;
- duplicated shared-capability implementations;
- clean, evidence-backed continue cases.

The replay corpus must preserve the historical evidence that existed at decision time; it must not label cases using hindsight-only facts.

## Path to M3

M3 must not create a new orchestration or delegation runtime.

Once M2 decision quality is measured, eligible A2 bounded actions should flow only through the existing S8 chain:

```text
M2 management proposal
→ approved policy envelope
→ canonical capability reference
→ S8 delegation
→ destination-local revalidation
→ bounded execution
→ receipt/evidence
→ management observation
```

This keeps management authority and execution authority separate.

## Boundary

```text
Domain writes = NO
GitHub writes from runtime = NO
Credential handling = NO
S8 runtime wiring = NO in this slice
Merge = NO
Deploy = NO
Production mutation = NO
```
