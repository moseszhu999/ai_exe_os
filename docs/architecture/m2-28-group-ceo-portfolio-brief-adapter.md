# M2.28 — Group CEO Portfolio Brief → Management Plane Adapter

## Purpose

M2.28 defines the smallest owner-safe seam by which the existing AIEXE Management Plane can consume the Group-level CEO portfolio read model without creating a second management owner and without importing unmerged producer code.

Producer contract:

```text
group.ceo-portfolio-brief.v1
```

Consumer projection:

```text
aiexe.management-ceo-portfolio-view.v1
```

The current producer proposal is the W4 Group Fabric slice. M2.28 deliberately depends on the producer **schema + exact digest + closed truth boundary**, not on a direct JavaScript import from the W4 branch. This keeps the Management Plane owner independent while both PRs remain Draft.

## Ownership

Canonical ownership remains:

```text
Domain OS owners
  → domain truth

Group Fabric W4
  → deterministic cross-domain portfolio aggregation

AIEXE Management Plane (#125 lineage)
  → management read surface / observe-and-propose semantics
```

M2.28 does not:

```text
re-run W4 aggregation
reinterpret Domain truth
create a second portfolio truth owner
create a ManagementProposal
choose a CEO decision
approve / reject a HumanGate
create authorization
create delegation
write Domain state
perform external action
publish content
pay / settle
merge or deploy
```

## Existing Management Plane identity mapping

W4 owner-domain identifiers are mapped to the already-existing core Management Plane project identifiers:

```text
aiexe        → aiexe
tradeos      → tradeos
trainingos   → trainingos
shared-media → video-operation-shared-media
```

Unsupported owner domains fail closed.

## Exact source contract validation

Before any projection, the adapter requires:

```text
schema == group.ceo-portfolio-brief.v1
briefDigest == SHA256(canonical unsigned brief)
readModelOnly == true
digestTraceHiddenFromPrimaryCards == true
all no-authority flags == false
```

The adapter also validates:

```text
card / detailIndex one-to-one coverage
card-kind / health / freshness enums
stale card fail-closed semantics
count consistency
decision queue 3–10 target semantics
critical → high → normal deterministic decision ordering
proposalOnly == true
ownerDecisionRecorded == false
HumanGate / authorization / external-action decision flags == false
business performance remains evidence-only
autonomyPromoted == false
productionReadinessGranted == false
PII / secret-shaped reference rejection
future provenance rejection
```

The source brief digest binds both the human-readable primary cards and the detailed SHA/evidence index. M2.28 therefore does not recompute individual W4 card digests from data that is intentionally hidden from the primary card surface.

## Primary management view

The projected management view contains:

```text
portfolioHealth
counts
grouped Management Plane projects
compact cards
ownerAttention
decision queue
measured business performance
detailIndex provenance
```

The primary cards still hide digest/evidence trace. Exact provenance stays in `detailIndex` for engineering and audit drill-down.

`ownerAttention` is display-only. It is not an `aiexe.management-proposal` object and does not call the existing `createManagementProposal()` path.

This distinction is deliberate:

```text
W4 says: "the owner should decide / review this"
M2.28 says: "show that bounded proposal in the Management Plane"

M2.28 does NOT say: "the owner decided it"
```

## Decision semantics

The producer may classify a decision proposal as:

```text
review
approve
reject
choose
```

These are question/action categories only. The consumer preserves:

```text
proposalOnly = true
ownerDecisionRecorded = false
humanGateDecisionCreated = false
authorizationDecisionCreated = false
externalActionPerformed = false
```

No category can become a chosen outcome in M2.28.

## Business performance

Canonical W2-derived measured business performance may be displayed in the Management Plane, including:

```text
trial count
success / failure / unknown rate
human takeover rate
mean human minutes
mean cycle time
mean cost
error / reversal rate
downstream metric
```

The adapter re-checks:

```text
businessEvidenceOnly = true
autonomyPromoted = false
productionReadinessGranted = false
```

A favorable metric is never a policy change or Production authority.

## Read-only authority boundary

The output fixes:

```text
managementAuthority = observe-and-propose
sourceTruthAuthority = external
readOnly = true
writeAuthority = none
sourceSemanticsReinterpreted = false
managementProposalCreated = false
```

And every Group no-authority flag remains false:

```text
sourceSemanticsVerifiedByThisModule
llmFactGenerationAllowed
managementPlaneMutationPerformed
decisionTruthCreated
authorizationDecisionCreated
authorityGrantCreated
humanGateDecisionCreated
delegationCreated
executionAuthorized
domainTruthCreated
domainWritePerformed
externalActionPerformed
paymentPerformed
productionDeploymentPerformed
```

## Scope

M2.28 is stacked on the current Management Plane PR #125 head and changes exactly four files:

```text
src/management/portfolio/group-ceo-portfolio-brief-adapter.cjs
tests/m2-28-group-ceo-portfolio-brief-adapter.test.cjs
docs/architecture/m2-28-group-ceo-portfolio-brief-adapter.md
.github/workflows/m2-28-group-ceo-portfolio-brief-adapter.yml
```

No existing Management Plane owner path is replaced. No W4 producer code is copied into `src/management/**`.

## Follow-on

After both producer and consumer contracts are independently green, the next smallest slice is UI/read-model composition only:

```text
existing Management Plane cockpit
+ aiexe.management-ceo-portfolio-view.v1
→ owner-facing daily portfolio surface
```

That follow-on must still avoid HumanGate decisions, authorization creation, Domain writes, external actions, deployment, payment, and publication.

Merge = NO. Deploy = NO. External action = NO.
