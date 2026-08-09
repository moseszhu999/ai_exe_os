# M1 Read-only Portfolio Adapters

Date: 2026-08-09  
Parent: `docs/architecture/m0-ai-management-plane-gap-and-migration.md`  
Implementation owner: PR #125 / `agent/group-management-plane-m0`

## Decision

M1 introduces a read-only observation boundary between external project sources and the AIEXE management plane.

It deliberately does **not** equate repository activity with domain health.

```text
GitHub source freshness != Domain OS business status
```

A repository may have a recent commit and active PRs while the business/domain status is blocked, paused, or simply unknown. Therefore the adapter exposes two separate concepts:

1. source freshness — current / stale / unknown;
2. domain status — active / paused / blocked / archived / unknown.

If no authoritative Domain OS status is supplied, M1 emits `domain_status_unknown`; it never guesses `active` from GitHub activity.

## Initial core portfolio registry

| Project | Kind | Read-only source |
|---|---|---|
| AIEXE | platform | `moseszhu999/ai_exe_os` |
| TrainingOS | domain-os | `moseszhu999/training-learning-rails` |
| TradeOS | domain-os | `moseszhu999/chaintrace-app` |
| Video Operation / Shared Media | shared-service | `moseszhu999/global-tool-radar` |

The registry binds a stable project identity to an exact repository and default branch. Repository substitution fails closed.

## Current source capture used to design M1

Observed through the GitHub connector during the 2026-08-09 implementation session:

- AIEXE main: `81dbfcb20e46684213f79fa9e0720c3b6daa395a`.
  - management-plane PR #125 remains Draft;
  - S8 integration owner PR #122 remains Draft and separate.
- TrainingOS main: `987afdbeeb8fe996813fbca7180d2c848c798bb9`.
  - active observed PRs include #545 Course Video / Shared Media and #536 Marketplace→Workspace/Agent integration;
  - #645 is a temporary TradeOS validation carrier, demonstrating why PR presence alone cannot be treated as TrainingOS domain status.
- TradeOS main: `02985010fbd91277df94d97984401af913a7922a`.
  - recent observed work includes #646 BusinessChannel, #644 N1 Data API compatibility, and #642 MarketSharedCaseProposal.
- Video Operation / Shared Media (`global-tool-radar`) main: `26c92df27c674a51c00537e8913862bfd3dc94ce`.
  - no open PR was returned by the observed query at capture time.

These values are a dated research/implementation receipt, not permanent configuration.

## Canonical M1 observation

Schema:

```text
aiexe.project-observation.github.v1
```

Required behavior:

- exact project-to-repository binding;
- exact 40-character main/head SHA;
- observed timestamp;
- explicit freshness classification;
- normalized open PR evidence;
- optional Domain OS owner/milestone/status only when supplied by an authoritative observation source;
- blocker codes as explicit inputs, never LLM-invented facts;
- immutable evidence references;
- `readOnly=true`;
- `writeAuthority=none`.

The resulting M0 `ManagedProjectSnapshot` retains:

```text
managementAuthority = observe-and-propose
domainTruthAuthority = external-source-of-truth
```

## Freshness policy

Default M1 source freshness window:

```text
120 minutes
```

This is an observation-freshness rule, not a business SLA.

- within window -> `current`;
- outside window -> `stale` + `source_stale` attention signal;
- future/incoherent timestamp -> `unknown` + `source_freshness_unknown`.

## Unknown is a first-class state

M1 extends management project status with:

```text
unknown
```

This prevents a dangerous management shortcut:

```text
recent commit -> project active/healthy
```

Unknown projects are automatically surfaced in the M0 attention projection.

## Observed portfolio aggregate

Schema:

```text
aiexe.observed-portfolio.v1
```

The aggregate contains:

- M0 portfolio snapshot;
- source freshness counts;
- exact per-repository source revision;
- `sourceTruthAuthority=external`;
- `readOnly=true`;
- `writeAuthority=none`.

Only canonical read-only observations are accepted into this aggregate.

## Files

```text
src/management/portfolio/index.cjs
src/management/portfolio/read-only-adapters.cjs
tests/m0-portfolio-management-contract.test.cjs
tests/m1-read-only-project-observation.test.cjs
```

## Validation

Local isolated validation before repository write:

```text
node --check src/management/portfolio/index.cjs
node --check src/management/portfolio/read-only-adapters.cjs
node --check tests/m1-read-only-project-observation.test.cjs
node --test tests/m0-portfolio-management-contract.test.cjs tests/m1-read-only-project-observation.test.cjs
```

Observed result:

```text
11 tests
11 pass
0 fail
```

## Boundary

M1 adds no network fetcher and no GitHub token/credential handling inside AIEXE. The connector/provider that gathers a source observation remains outside the canonical management contract.

This is intentional: the management plane consumes bounded observations rather than acquiring hidden provider authority.

M1 performs:

```text
Domain writes = NO
GitHub writes = NO
S8 delegation = NO
Merge = NO
Deploy = NO
Credential handling = NO
```

## Remaining step before M2

The next small slice is a **Domain Controller Receipt adapter** so TrainingOS / TradeOS / Shared Media can provide authoritative owner, milestone, blocker and domain-status facts alongside GitHub repository observations.

That adapter should preserve the same rule:

```text
GitHub says what changed in the repository.
Domain Controller says what the project means and whether it is blocked.
AIEXE combines them; it does not invent either truth.
```
