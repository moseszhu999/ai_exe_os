# M2.29 — Management CEO Portfolio Cockpit Composition

## Purpose

M2.29 is the smallest owner-facing follow-on to M2.28. It composes the already-defined `aiexe.management-ceo-portfolio-view.v1` into the existing S4 Operator Cockpit as a **display-only Group management read surface**.

It does not create another Management Plane, another CEO portfolio aggregator, another decision engine, or another source-of-truth owner.

The source path remains:

```text
Group Fabric W4: group.ceo-portfolio-brief.v1
  -> M2.28 createManagementCeoPortfolioView(...)
  -> aiexe.management-ceo-portfolio-view.v1
  -> M2.29 owner-scoped S4 cockpit display
```

## Ownership boundary

- Group Fabric W4 remains the producer of `group.ceo-portfolio-brief.v1`.
- M2.28 remains the validating owner-safe adapter.
- Existing AIEXE S4 Operator Cockpit remains the UI/read-model owner.
- M2.29 adds no management mutation path.

The application accepts an optional `groupCeoPortfolioBriefReader` only through constructor dependency injection. The reader is invoked only when the queried Workspace exactly matches the configured `groupManagementWorkspaceId`.

A different Workspace receives no Group portfolio object and the reader is not invoked. This prevents a Group-wide CEO portfolio from silently crossing an ordinary Workspace visibility boundary.

## Failure isolation

The Group portfolio surface is optional. Existing S4 behavior is unchanged when no reader is configured.

For the exact Group management Workspace:

- missing source -> `source_unavailable`
- reader failure -> `source_read_failed`
- async reader -> `source_async_unsupported`
- digest/schema/boundary validation failure -> `source_invalid`
- M2.28 validation success -> `source_validated`

Failure details are not copied into the cockpit. The existing Operator Cockpit remains usable; M2.29 does not infer replacement Domain truth.

## Display contract

When valid, S4 can display:

- portfolio health and bounded counts
- existing Management Plane project identities
- owner-attention cards
- real CEO decision proposals, visibly marked `proposal-only`
- observed/source authority metadata

The existing S4 surface list remains unchanged; the CEO portfolio is part of `Cockpit / Overview` rather than a new control surface.

## Authority invariants

M2.29 is intentionally incapable of widening authority:

```text
managementAuthority = observe-and-propose
readOnly = true
writeAuthority = none
managementProposalCreated = false
decisionTruthCreated = false
humanGateDecisionCreated = false
authorizationDecisionCreated = false
delegationCreated = false
externalActionPerformed = false
```

The renderer adds no CEO approve/reject/execute/authorize/delegate controls. Existing Worker controls remain owned by the pre-existing S4 Worker control surface and are unrelated to the CEO portfolio projection.

## Scope

This slice changes only:

1. `src/operator-console/read-model/management-ceo-portfolio.cjs`
2. `src/application/s4-index.cjs`
3. `src/renderer/s4/view-model.cjs`
4. `src/renderer/s4/render.cjs`
5. `tests/m2-29-management-ceo-portfolio-cockpit.test.cjs`
6. `docs/architecture/m2-29-management-ceo-portfolio-cockpit.md`
7. `.github/workflows/m2-29-management-ceo-portfolio-cockpit.yml`

No IPC method is added. No database migration is added. No provider transport is added. No scheduler, HumanGate, authorization, delegation, payment, deployment, or Domain write path is added.

## Acceptance

M2.29 is acceptable only if:

- the focused M2.29 contracts pass;
- the full AIEXE unit suite passes;
- exact PR-head and seven-file scope are proven in CI;
- Group portfolio visibility is exact-Workspace scoped;
- a tampered W4 brief fails closed through the M2.28 validator;
- reader errors remain bounded and do not leak raw error details;
- querying the cockpit creates no Mission execution state;
- the renderer remains DOM-safe and contains no CEO decision/execution controls.

## Follow-on

M2.29 deliberately stops before supplying a production Group Fabric transport or persistent source reader. A later owner-approved slice may bind a proven read-only transport to `groupCeoPortfolioBriefReader`, but that transport must preserve the exact Group management Workspace boundary and must not create a second source-of-truth, write path, or implicit CEO decision authority.
