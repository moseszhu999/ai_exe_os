# S2 Durable Mission Orchestration Roadmap

Status: **Contract-stage roadmap**

Canonical issue: #29

Exact baseline: `4d724bd4cc225fb33c3262980bfba146de1fb7c2`

## Waterfall sequence

```text
Gate 0 — S2-A contract accepted
Gate 1 — S2-B domain + plan/handoff accepted
Gate 2 — S2-C durable orchestration/checkpoint accepted
Gate 3 — S2-D component UI accepted
Gate 4 — S2-I integrated Electron product accepted
Gate 5 — S2-F exact-head/native-Mac acceptance
Gate 6 — S2 results documented and Issue #29 closed
```

S2-B/C/D may execute in parallel only after Gate 0 because their contracts and write scopes are disjoint. S2-I starts only after accepted B/C/D outputs are merged to `main`.

## Owner scopes

### S2-A — Contract

Branch:

```text
agent/s2-mission-orchestration-contract-v1
```

Writes only S2 docs/contracts/architecture/testing/roadmap. No product code.

### S2-B — Mission / Plan / Handoff Domain

Suggested branch:

```text
agent/s2-mission-plan-domain-v1
```

Exclusive write scope:

```text
src/domain/mission*.cjs
src/domain/plan*.cjs
src/domain/step-output*.cjs
src/domain/agent-handoff*.cjs
tests/s2-domain-*.test.cjs
```

Must remain storage/scheduler/UI independent.

### S2-C — Durable Orchestration / Checkpoint

Suggested branch:

```text
agent/s2-durable-orchestrator-v1
```

Exclusive write scope:

```text
src/orchestration/**
src/checkpoint/**
tests/s2-orchestration-*.test.cjs
```

Uses interfaces/test doubles for S1 services and S2 domain until integration. Does not edit root Electron composition or S1 scheduler internals.

### S2-D — Mission Component UI

Suggested branch:

```text
agent/s2-mission-ui-v1
```

Exclusive write scope:

```text
src/renderer/s2/**
src/preload/s2*.cjs
tests/s2-ui-*.test.cjs
```

No direct DB/runtime access. Root renderer/preload files remain read-only.

### S2-I — Final Integration

Suggested branch:

```text
agent/s2-application-integration-v1
```

Starts only after B/C/D merge to `main`.

Exclusive shared-composition ownership:

```text
src/application/** (S2 integration additions)
src/main/main.cjs
src/preload/index.cjs
src/renderer/index.html
src/renderer/app.js
src/renderer/styles.css
tests/s2-integration-*.test.cjs
```

S2-I may wire accepted component interfaces but should not rewrite accepted B/C/D internals except for independently reviewed integration defects.

### S2-F — Independent Acceptance

Read-only product owner. May write only acceptance carrier/scripts/results:

```text
scripts/s2-acceptance-*.cjs
.github/workflows/s2-*-acceptance.yml
docs/results/S2-results.md
```

Acceptance carrier is non-merge and freezes the S2 product exact head.

## Stop conditions

Stop an owner immediately if:

- another open owner already controls the same file;
- implementation requires an unmerged sibling branch;
- a second canonical event store or scheduler authority is introduced;
- an uncertain external action would be automatically retried;
- Workspace isolation requires bypassing S1 authorization;
- raw credentials/cookies/tokens/browser profiles/process data would be stored or rendered;
- root Electron composition is modified by B/C/D rather than S2-I.

## Definition of S2 done

S2 is complete only when:

```text
contract: merged
B/C/D: merged with exact-head CI
I: integrated product merged
F: native exact-head matrix GO
portable privacy-safe artifact: independently verified
S2-results.md: merged to main
Issue #29: closed completed
open S2 owner issues: 0
```