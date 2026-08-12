# Group AI Operating System W0

Status: contract-only implementation slice for issue #151.

## Decision

The group operating model uses departments as **responsibility and policy domains**, not as a requirement to create one autonomous agent per department.

The initial production shape is:

```text
CEO / Owner
  -> Unified Work Entry / Chief of Staff
  -> AIEXE Group Control Plane
  -> Domain Controllers
  -> shared models / skills / MCP / APIs
  -> evidence + technical evals + business evals
  -> HumanGate for consequential actions
```

W0 adds only pure contracts. It does not create another scheduler, authorization owner, HumanGate owner, provider runtime, Domain truth store, or management execution path.

## Contracts

### `group.autonomy-policy.v1`

Binds one semantic action to:

- owner Domain;
- autonomy level;
- reversibility class;
- HumanGate requirement;
- retry class and maximum attempts;
- cost and action bounds;
- evidence contract;
- policy validity window.

Autonomy levels are fixed:

| Level | Meaning | Reversibility |
|---|---|---|
| L0 | Observe | `read_only` |
| L1 | Draft | `draft_only` |
| L2 | Internal reversible write | `internal_reversible` |
| L3 | External reversible action | `external_reversible` |
| L4 | External consequential action | `external_consequential` |

L4 always requires a HumanGate, cannot use automatic `safe_idempotent` retry, and is limited to one attempt in this contract.

A policy is not an authorization decision and cannot promote its own autonomy level.

### `group.work-entry.v1`

Represents one unified group intake item. It carries the user's objective, semantic action request, target, optional requested Domain, source and evidence.

The work entry is explicitly **routing input only**:

- it cannot mint Domain truth;
- it cannot create AuthorityGrant or HumanGate decisions;
- it cannot authorize execution;
- the requested Domain cannot override the policy-owned Domain.

### `group.decision-escalation.v1`

Binds an exact Work Entry to an exact Autonomy Policy and a deterministic routing observation.

Outcomes:

- `ready_for_bounded_processing`
- `needs_human_review`
- `blocked`

Even `ready_for_bounded_processing` is not execution authorization. It only says the work item has a matching owner/policy and may continue into later bounded control-plane logic.

### `group.business-eval.v1`

Binds business measurements back to the exact Work Entry, policy and decision-escalation artifact.

Initial metrics include:

- trial count;
- success / failure / unknown rate;
- human takeover rate;
- human minutes;
- cycle time;
- cost;
- errors and reversals;
- optional downstream business metric;
- technical and business evidence refs.

The eval never automatically promotes autonomy or grants production readiness. Promotion remains a later explicit policy decision.

## Why this slice is deliberately small

The existing AIEXE Group Management Plane (#125) already owns management/portfolio and controlled execution integration, while `execution.authorization.v1` already owns authorization truth. W0 therefore lives in `src/group-fabric/` and is pure data-in/data-out.

The intended sequence after W0 is:

1. W1: one CEO Work Entry consumer that uses these contracts and reuses the existing Management Plane;
2. W2: business eval aggregation and thresholds beside existing technical evidence;
3. W3: three real low-risk loops, starting at L0/L1 and graduating only after observed evidence;
4. W4: Portfolio Cockpit that shows outcomes, exceptions and decisions-needed rather than raw technical receipts.

## Closed boundaries

```text
network = NO
provider call = NO
Domain write = NO
second scheduler = NO
second authorization owner = NO
HumanGate decision = NO
execution authorization = NO
external action = NO
payment/funds movement = NO
contract signature = NO
production deploy = NO
autonomy auto-promotion = NO
```
