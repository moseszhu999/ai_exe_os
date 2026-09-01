# AIEXE Provider Adapter Plan v1

## Purpose

`provider.adapter.plan.v1` is the pure, network-free bridge between an exact `provider.runtime.route.v1` and a later destination-local transport executor.

It exists to prevent a dangerous category mistake:

> **wire protocol method is not business-effect authority.**

A model generation or MCP tool call may require a request-style transport operation while remaining semantically `draft` or `observe`. Conversely, a domain operation may be an `externalAction` even if its provider-specific wire protocol looks innocuous.

The canonical business-effect classifier therefore remains the provider route's semantic `riskClass` plus the existing AIEXE HumanGate / execution authorization chain. P1 never infers authority from an HTTP verb.

## Relationship to existing S5 Provider Adapters

Existing S5 provider observation remains unchanged and authoritative for its original slice:

- exact approved public HTTPS target;
- `GET` / `HEAD` only;
- response body discarded;
- no credentials;
- read-only observation only.

P1 does **not** widen S5 to `POST`, does not modify `BoundedReadOnlyHttpTransport`, and does not reuse S5's HTTP method as a general risk model.

Instead:

```text
provider.runtime.manifest.v1
  -> exact provider.runtime.route.v1
  -> bounded provider.runtime.request.v1
  -> pure provider.adapter.plan.v1
  -> [future P2 destination-local executor]
  -> runtime receipt / evidence
```

## Supported P1 protocol families

### `openai.responses`

Bounded text-only v1 shape:

- exact allowlisted `modelRef`;
- `inputText`;
- optional `instructions`;
- optional `maxTokens` mapped to `max_output_tokens`.

Provider-side arbitrary tools, URLs, headers, credentials, and endpoint overrides are not part of P1.

### `openai.chat-completions`

Bounded text chat shape:

- exact allowlisted `modelRef`;
- text-only `system | user | assistant` messages;
- optional `maxTokens` mapped to `max_tokens`.

This protocol family can represent providers that expose an OpenAI-compatible Chat Completions surface without creating provider-specific product code.

### `anthropic.messages`

Bounded text Messages shape:

- exact allowlisted `modelRef`;
- text-only `user | assistant` messages;
- optional system text;
- required `maxTokens` mapped to `max_tokens`.

### `mcp`

Bounded MCP tool invocation:

```text
method = tools/call
params.name = exact allowlisted toolName
params.arguments = bounded JSON-safe object
```

P1 does not accept a free-form MCP method, server URL, transport header, credential, task metadata, or arbitrary tool name.

### `http.json`

P1 expresses a **semantic provider operation**, not a free-form HTTP request:

- exact route `providerOperation`;
- exact opaque route `targetRef`;
- bounded JSON-safe `parameters`.

The later provider-specific executor must map that semantic operation to a concrete method/path. The caller cannot inject URL, HTTP method, headers, or credentials.

## Security invariants

1. Provider id and operation id must exactly match the resolved route.
2. Model id must be present in the route's `modelRefs` allowlist.
3. MCP tool name must be present in the route's exact `toolNames` allowlist.
4. Transport stays opaque: `endpoint.*`, `credential.*`, `network.*`, `launcher.*` refs only.
5. Runtime requests reject top-level transport primitives such as arbitrary URL/method/header fields.
6. Bounded JSON arguments reject credential-shaped fields.
7. Protocol-family-specific fields are closed; cross-family field smuggling fails closed.
8. Requests and plans are SHA-256 bound.
9. The plan records `networkPerformed=false`, `credentialResolved=false`, and `externalActionPerformed=false`.
10. P1 creates no execution authorization and no HumanGate decision.

## Why this matters for TrainingOS / TradeOS / Video Operation

### TrainingOS

A course/OJT capability can select an exact model provider route and compile a model draft plan without TrainingOS owning OpenAI/DeepSeek client code or credentials.

### TradeOS

A trade capability can compile a semantic institution/oracle operation while TradeOS keeps the State / Capital / Settlement / Oracle domain protocol. AIEXE still does not accept arbitrary HTTP writes.

### Video Operation / Shared Media

A video AgentSkill can compile exact Shared Media MCP `tools/call` plans. The same MCP server/tool allowlist is shared with the existing CapabilityVersion compilation path.

## P2 gate

No transport executor should run a P1 plan unless the destination execution composition proves, at the same exact request/route version:

- accepted provider contract / freshness;
- canonical Installation + Workspace Grant;
- `execution.authorization.v1` outcome;
- required HumanGate decision;
- exact target/network policy;
- credential resolution through an approved local secret owner;
- immutable request/route/plan evidence.

P2 should create explicit protocol executors rather than weakening S5's read-only transport.

Initial P2 order:

1. OpenAI Responses executor;
2. OpenAI-compatible Chat Completions executor;
3. MCP Streamable HTTP executor;
4. Anthropic Messages executor;
5. provider-specific `http.json` operation executors.

No external write is enabled by this document or P1 implementation.
