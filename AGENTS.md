# AI Execution OS Agent Context

This file is the canonical repository-level entrypoint for AI agents working in `moseszhu999/ai_exe_os`.

Before material work, read:

- `README.md`
- `docs/architecture/cross-project-ownership-map.md`
- the relevant provider/compliance and execution contract documents for the scope being changed

## Repository role

AI Execution OS (AIEXE) is execution-control infrastructure for bounded, auditable work across allowed browser/session surfaces, GitHub-native delivery workflows, scheduled or long-lived workers, and project-owned tools.

It is not a Domain App and does not become the owner of TrainingOS education truth, TradeOS trade/supplier truth, Shared Media render truth, or AI Native Platform Workspace/Case truth.

## Mandatory startup protocol

Before writing:

1. Fetch current `main` and inspect relevant open PRs / branches / owner scopes.
2. Identify the exact execution surface and confirm the current provider/compliance gate allows the intended automation.
3. If work touches another project, read that repository's `AGENTS.md` / `CLAUDE.md`, current main/open PRs and owner scope first.
4. Do not create a second execution owner, second domain runtime, second Workspace, or duplicate MCP/capability implementation when an accepted owner already exists.
5. Keep parallel windows independent; do not reset/rebase/cherry-pick/force-push/take over another active owner.
6. Preserve explicit human control for merge, production deployment, payment, destructive mutation, credential-sensitive operations and other governed external effects.
7. Preserve evidence truth levels: a browser command, provider acknowledgement, CI pass, deployment and domain result are different facts.
8. Do not bypass provider limits, authentication protections, CAPTCHAs, pricing, rate limits, concurrency limits, or unsupported automation paths.

## Relationship to AI Native Platform Agent Harness

AI Native Platform may own a stable Agent Runtime/Harness abstraction for Agents operating inside the shared Workspace. AIEXE remains a sibling execution-control infrastructure project.

Preferred relationship:

```text
AI Native Platform / Domain App
→ bounded execution request
→ AIEXE executor where appropriate
→ authorized external/local execution
→ evidence / receipt
→ owning Platform or Domain runtime
```

Do not make users leave AI Native Workspace merely because AIEXE executes work in the background/runtime layer.

## Cross-project ownership

Use `docs/architecture/cross-project-ownership-map.md` before changing shared contracts. Integrate by adapters/contracts and evidence handoff rather than copied business logic.

## Tool-specific entrypoints

`AGENTS.md` is canonical for repository-level AI operating context. `CLAUDE.md` and other tool-specific entrypoints should point here instead of duplicating these rules.
