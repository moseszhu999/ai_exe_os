# M2.2 A2 Management Action Eligibility Policy

Date: 2026-08-09  
Parent: `docs/architecture/m2-external-controller-attestation-cycle.md`  
Implementation owner: AIEXE PR #125 only

## Purpose

Define which low-consequence management actions may **eventually** be eligible for A2 bounded execution after the remaining M3 gates close.

This policy does not execute anything.

The central invariant is:

```text
policy eligible != execution authorized
```

## Schemas

```text
aiexe.a2-management-action-policy.v1
aiexe.a2-management-action-eligibility.v1
```

## Initial A2 allow-set

```text
collect_project_status
prepare_non_binding_plan
request_controller_attestation
request_existing_ci_validation
run_approved_test_profile
schedule_preapproved_bounded_work
```

These are intentionally narrow management/verification actions.

### Capability requirement

Actions that would eventually cause a runtime/tool call require a canonical capability reference:

```text
package@semver
```

Examples:

```text
training.test@1.0.0
work.schedule@1.0.0
```

`prepare_non_binding_plan` is the only initial action that can be policy-eligible without an execution capability because its result remains a proposal artifact.

### Preapproved work requirement

`schedule_preapproved_bounded_work` additionally requires an explicit existing work approval reference.

The management layer may not turn its own recommendation into the approval that it later consumes.

## Consequential A3 deny-set

The following actions are mechanically outside A2:

```text
credential_grant_or_write
deploy
domain_truth_mutation
external_contractual_commitment
human_impersonation
merge
payment
policy_widening
production_mutation
```

An A2 evaluator returns them as:

```text
policyEligible = false
reason = forbidden_consequential_action
executionAuthorized = false
```

## Eligibility requirements

An allowed action still requires:

```text
explicit policyRef
policyPreapproved = true
non-empty evidenceRefs
canonical capabilityRef where applicable
preapproved work ref where applicable
```

If a requirement is missing, the action is not eligible.

## What an eligible result means

A positive result means only:

> This action class and request shape satisfy the current management-policy preconditions for a future bounded execution path.

It explicitly does **not** mean:

```text
executionAuthorized = true
DelegationPolicy created
HumanGate approved
Capability granted
Domain write allowed
```

Every result therefore fixes:

```text
binding = false
executionAuthorized = false
delegationCreated = false
humanGateDecisionCreated = false
domainWritePerformed = false
```

## Relationship to S8

For any eligible action other than `prepare_non_binding_plan`, future execution must reuse the accepted S8 path:

```text
A2 eligibility
-> canonical capability package@version
-> existing S8 delegation policy
-> destination-local admission
-> HumanGate if required by the action
-> bounded execution
-> receipt/evidence
```

M2.2 does not import or modify S8 code.

## M3 Gate 4 impact

The **design and executable policy contract** portion of Gate 4 is now implemented.

Gate 4 is still not fully PASS because:

- the policy has not yet been wired to an accepted S8 baseline;
- broader replay/eval evidence has not proven safe classification at scale;
- there is no live execution receipt proving the allow-set behaves safely end-to-end.

Therefore:

```text
Gate 4 = PARTIAL / BLOCKED FOR M3
```

## Files

```text
src/management/policy/a2-action-policy.cjs
tests/m2-a2-action-policy.test.cjs
```

## Boundary

```text
A2 execution enabled = NO
S8 files changed = NO
Delegation created = NO
HumanGate decision created = NO
Domain write = NO
Merge = NO
Deploy = NO
Production mutation = NO
```
