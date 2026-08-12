# M1.1 Domain Controller Receipt

Date: 2026-08-09  
Parent: `docs/architecture/m1-read-only-portfolio-adapters.md`

## Why this exists

GitHub can prove repository facts such as main/head SHA, PR heads and timestamps. It cannot, by itself, authoritatively prove the business meaning of a project state.

Therefore AIEXE needs a second read-only evidence source:

```text
Domain Controller Receipt
```

The receipt is an attestation from the project-owned controller about owner, milestone, blockers and domain status at one exact repository head.

## Canonical schema

```text
aiexe.domain-controller-receipt.v1
```

Required fields:

- project identity;
- controller identity;
- exact registered repository;
- exact 40-character head SHA;
- authoritative non-unknown domain status;
- owner;
- milestone;
- explicit blocker codes;
- evidence references;
- observed timestamp.

Permanent properties:

```text
readOnly = true
binding = false
writeAuthority = none
authority = domain-status-attestation
```

The receipt cannot merge, deploy, mutate a Domain OS, grant credentials or widen policy.

## Exact-head acceptance

A Domain Controller Receipt is projected into the AIEXE management snapshot only when both conditions hold:

```text
receipt.exactHeadSha == githubObservation.source.headSha
receipt freshness == current
```

If the head differs, AIEXE does **not** carry the receipt's owner/milestone/status onto the new head. It returns:

```text
domainReceipt.accepted = false
reason = exact_head_mismatch
snapshot.status = unknown
attention += domain_receipt_head_mismatch
```

If the receipt is stale:

```text
domainReceipt.accepted = false
reason = receipt_stale
snapshot.status = unknown
attention += domain_receipt_stale
```

This is a deliberate truth-boundary rule. A previously correct management statement cannot silently remain true after the underlying project head changes.

## Composition model

```text
GitHub read-only observation
        +
Domain Controller Receipt
        |
        v
Enriched Project Observation
        |
        v
Observed Portfolio
```

The enriched observation remains:

```text
readOnly = true
writeAuthority = none
```

It can be consumed by the same Portfolio aggregation path as a plain GitHub observation.

## Important separation of authority

```text
GitHub source
  -> repository/change truth

Domain Controller
  -> project meaning/status truth

AIEXE
  -> validation, combination, attention and management proposal
```

AIEXE is not allowed to fabricate either source.

## Files

```text
src/management/portfolio/domain-controller-receipt.cjs
tests/m1-domain-controller-receipt.test.cjs
```

`src/management/portfolio/read-only-adapters.cjs` is also extended so an exact-head enriched read-only observation remains composable in `aiexe.observed-portfolio.v1`.

## Validation

Combined local isolated suite:

```text
M0 management contracts
M1 GitHub read-only observation
M1.1 Domain Controller Receipt
```

Result:

```text
17 tests
17 pass
0 fail
```

Coverage includes:

- exact-head current receipt accepted;
- head mismatch rejected visibly;
- stale receipt rejected visibly;
- receipt requires evidence;
- write-shaped fields rejected;
- `unknown` cannot be presented as an authoritative controller status;
- enriched observations remain composable in the read-only portfolio.

## Boundary

```text
Domain writes = NO
GitHub writes = NO
Credential handling = NO
S8 delegation = NO
Merge = NO
Deploy = NO
```

This closes the M1 truth-composition gap. M2 can now build deterministic attention rules on top of explicit GitHub facts plus exact-head Domain Controller facts instead of asking an LLM to infer management truth from prose.
