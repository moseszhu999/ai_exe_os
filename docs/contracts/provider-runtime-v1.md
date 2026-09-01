# AIEXE Unified Provider Runtime v1

## Purpose

Create one provider-neutral registration and routing contract for model APIs, MCP servers, and domain APIs so TrainingOS, TradeOS, Video Operation / Shared Media, and future Domain OS products do not each create their own runtime integration layer.

This P0 slice is deliberately **contract + catalog + exact route resolution only**. It does not create a second authorization owner, scheduler, secret store, network executor, MCP task model, or Domain truth owner.

## Canonical ownership

```text
Domain OS / product UX
  -> AIEXE CapabilityPackage / immutable CapabilityVersion
  -> AIEXE installation + Workspace grant + HumanGate + execution authorization
  -> provider.runtime.manifest.v1 catalog
  -> provider.runtime.route.v1 exact binding
  -> transport adapter / execution owner (later bounded slice)
  -> provider result + runtime evidence
```

Existing owners remain authoritative:

- TrainingOS owns learning/OJT, competency and user-facing learning/composition flows.
- TradeOS owns trade-domain protocols, institution/provider manifests and trade truth.
- Video Operation owns social/video AgentSkill behavior.
- Shared Media owns `media.render.v1`, media jobs and media evidence.
- AIEXE owns CapabilityPackage/CapabilityVersion, installation/grant, HumanGate and execution authorization.

## Schema

`provider.runtime.manifest.v1` is closed and immutable after compilation.

### Provider kinds

- `model_api`
- `mcp_server`
- `domain_api`

### Protocol families

- `openai.responses`
- `openai.chat-completions`
- `anthropic.messages`
- `mcp`
- `http.json`

The protocol family is intentionally separate from provider identity. Multiple providers may implement the same protocol family without product-specific code.

### Transport modes

- `https`
- `mcp_streamable_http`
- `registered_local_launcher`

Transport configuration only contains opaque references:

- `endpoint.*`
- `credential.*`
- `network.*`
- `launcher.*`

Inline URLs, API keys, shell commands, argv and environment blocks are not part of the contract.

### Operation classes

Every provider operation is classified as exactly one of:

- `observe`
- `draft`
- `internalWrite`
- `externalAction`

HumanGate invariants are fail-closed:

- `internalWrite` cannot use `humanGatePolicy=never`.
- `externalAction` requires `humanGatePolicy=action`.

The provider manifest does not grant authority. It only declares the maximum eligible operation surface. Canonical AIEXE authorization still decides whether a concrete execution is allowed.

## Exact route binding

`resolveProviderRuntimeRoute()` returns an immutable `provider.runtime.route.v1` carrying:

- provider id
- provider contract id
- provider manifest SHA-256 digest
- provider kind
- protocol family
- opaque transport refs
- exact operation
- freshness evidence window

Unknown, degraded, disabled, stale or not-yet-valid providers fail closed.

## Capability compiler bridge

The runtime catalog exposes two bounded bridges to the existing capability model:

1. `providerContractId` values (`prv.<providerId>`) can be used by `CapabilityVersion.providerContractIds`.
2. MCP manifests project an exact `Map<serverId, Set<toolName>>` compatible with the existing `capability.knowledge.manifest.v1` compiler's `mcpCatalog` validation.

For MCP providers, `providerId` is the canonical MCP `serverId` used by the capability manifest.

## Product adoption mapping

### TrainingOS

TrainingOS should continue to mirror only exact AIEXE capability identity (`packageId@semver + integrityDigest`) for runtime use. It should not own provider credentials or runtime adapters.

### TradeOS

TradeOS keeps State / Capital / Settlement / Oracle and institution-specific manifests. Those domain manifests bind to an AIEXE provider runtime contract rather than becoming a second generic runtime.

### Video Operation / Shared Media

Shared Media keeps its bounded MCP tool surface and `media.render.v1`. AIEXE registers that MCP server as a provider runtime manifest and projects the exact tool allowlist into CapabilityVersion compilation.

## P0 non-goals

- no network call
- no secret retrieval
- no OAuth flow
- no arbitrary local command execution
- no provider ranking / automatic provider selection
- no new HumanGate decision owner
- no new scheduler
- no new MCP job/task identity
- no Domain data mutation
- no merge or deployment

## Next bounded slices

### P1 — adapter plan compiler

Compile `provider.runtime.route.v1 + bounded request` into protocol-specific adapter plans without performing effects.

### P2 — destination-local transport executors

Add injected, provider-specific transport executors behind existing AIEXE authorization and HumanGate. Start with:

1. `openai.responses`
2. `openai.chat-completions`
3. `mcp` streamable HTTP

### P3 — immutable execution receipt

Bind request digest, route digest, provider response metadata, timestamps, error class and evidence to one canonical runtime receipt.

### P4 — first cross-project fixtures

Prove the same runtime catalog with three real consumers:

1. TrainingOS capability -> model + Shared Media MCP
2. TradeOS read-only provider call
3. Video Operation / Shared Media MCP call

No external write should be enabled until exact-head authorization, HumanGate and receipt evidence pass together.
