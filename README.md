# AI Execution OS

> A local-first desktop control plane for scheduling persistent browser sessions, human-supervised workers, and GitHub-native software delivery workflows.

AI Execution OS is an experimental open-source project for turning long-lived browser sessions into schedulable execution workers. It explores software-engineering coordination across browsers, GitHub, CI, deployment platforms, and project-owned tools.

## Core idea

```text
Project
→ execution graph
→ bounded tasks
→ persistent browser sessions
→ human-supervised actions
→ GitHub PR / CI / deployment evidence
→ next task
```

The product is not another model API wrapper. Its first design target is a browser-based execution control plane with persistent signed-in sessions, explicit human control, and auditable scheduling.

## Zero-stage decision

The project begins with a feasibility spike, not a full product build.

The current technical architecture decision is:

```text
Electron control plane
+ managed real Chrome / Chromium profiles
+ Playwright or CDP control
+ GitHub-native task state
```

Electron may also host isolated remote web content for selected surfaces, but embedded OAuth is not treated as the primary login path.

The overall product verdict is:

```text
CONDITIONAL GO
```

Technical feasibility and provider permission are separate gates. Every provider adapter must pass the normative terms-and-supported-paths review in:

```text
docs/compliance/000-provider-terms-and-supported-paths-gate.md
```

Unknown provider status means automation is blocked.

## Current ChatGPT boundary

The S0 spike does **not** automate the ChatGPT website, programmatically extract ChatGPT output, or use browser automation to bypass pricing, rate limits, concurrency limits, usage restrictions, or protective measures.

ChatGPT interaction remains manual-only unless an exact, currently supported integration path is documented and approved under the applicable OpenAI terms.

## Permanent boundaries

- No credential scraping or storage of raw passwords, cookies, authorization codes, or copied provider tokens.
- No CAPTCHA bypass, browser fingerprint spoofing, user-agent impersonation, or TCP/TLS/protocol impersonation.
- No circumvention of provider pricing, usage limits, rate limits, concurrency limits, restrictions, or protective measures.
- No automatic or programmatic output extraction where provider terms prohibit it.
- No automatic merge, production deployment, payment, database mutation, or destructive cloud action without an accepted contract and explicit human confirmation.
- No Node.js integration in remote web content.
- No claim that a provider supports automation unless the exact surface has passed the provider gate.

## Docs-first roadmap

1. Zero feasibility contract
2. Provider terms and supported-paths gate
3. Hybrid control-plane architecture
4. Session orchestration spike on local or explicitly authorized test surfaces
5. Task and execution-graph domain model
6. GitHub PR state adapter
7. Electron operator console
8. Multi-session scheduling and recovery

See `docs/` for the current contracts and spike gates.

## Status

```text
Stage: S0 feasibility
Product code: not started
Technical decision: bounded spike approved
Provider decision: per-surface approval required
ChatGPT web automation: blocked
```
