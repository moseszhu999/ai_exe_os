# AI Execution OS

> A local-first desktop control plane for scheduling persistent browser sessions, human-supervised AI workers, and GitHub-native software delivery workflows.

AI Execution OS is an experimental open-source project for turning long-lived browser sessions into schedulable execution workers. The first target is software engineering work coordinated across ChatGPT, GitHub, Vercel, Netlify, Supabase, Neon, and related web tools.

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

The product is not another model API wrapper. Its first design target is the browser product path: persistent signed-in sessions, explicit human control, and a scheduling layer above normal Chromium-based workflows.

## Zero-stage decision

The project begins with a feasibility spike, not a full product build.

The current architecture decision is:

```text
Electron control plane
+ managed real Chrome / Chromium profiles
+ Playwright or CDP control
+ GitHub-native task state
```

Electron may also host isolated remote web content for selected surfaces, but embedded OAuth is not treated as the primary login path.

## Permanent boundaries

- No credential scraping or storage of raw passwords.
- No CAPTCHA bypass, browser fingerprint spoofing, or user-agent impersonation.
- No automatic merge, production deployment, payment, database mutation, or destructive cloud action without explicit human confirmation.
- No Node.js integration in remote web content.
- No claim that a provider supports automation unless it is proven in the current spike.

## Docs-first roadmap

1. Zero feasibility contract
2. Hybrid control-plane architecture
3. Session orchestration spike
4. Task and execution-graph domain model
5. GitHub PR state adapter
6. Electron operator console
7. Multi-session scheduling and recovery

See `docs/` for the current contracts and spike gates.

## Status

```text
Stage: S0 feasibility
Product code: not started
Decision: validate first, then build
```
