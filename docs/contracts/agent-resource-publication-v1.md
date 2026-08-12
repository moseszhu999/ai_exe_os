# Agent Resource Publication v1

## Purpose

This slice adds a product-neutral **discovery publication compiler** for an already-defined AIEXE capability identity. It does not create a second capability owner, provider executor, payment runtime, Domain truth store, Registry publisher, or external-action path.

The first reference resource is:

```text
TradeOS Supplier Verification
resourceId = trade.verify_supplier.v1
MCP tool   = verify_supplier
```

The commercial/discovery flow is intentionally separated from Domain execution:

```text
canonical capability identity
+ agent.resource.offer.v1
→ deterministic discovery artifacts
→ static Official MCP Registry readiness
→ later authorized Registry / App / LLM publication adapter
→ Agent considers exact capability
→ existing authorization / provider runtime
→ TradeOS-owned verification truth
```

## Owner boundary

AIEXE owns this slice because AIEXE already owns capability identity, versioning, MCP binding and provider/runtime envelopes.

This slice owns only product-neutral discovery/evidence contracts under `src/discovery/`. It does not take ownership of Provider Runtime, TradeOS supplier truth, Registry authentication, endpoint deployment, external Host execution, or an external trust root.

Existing owners remain unchanged:

- `src/domain/capability-knowledge-compiler.cjs` remains the canonical capability-knowledge compiler.
- Provider Runtime PR stack #144–#150 remains the sole provider routing/execution/attempt/persistence owner.
- TradeOS remains the owner of supplier identity, trade evidence, RFQ/case/review and real supplier-verification Domain truth.
- TrainingOS remains the owner of learning, OJT, credential and readiness Domain truth.
- Shared Media remains the owner of its render execution truth.

The mock supplier verifier is fixture-only. It performs no live supplier verification and is not a replacement for TradeOS.

## New schema

```text
agent.resource.offer.v1
```

It binds one public/discoverable resource to one exact capability version:

```text
resourceId
capabilityRef {
  packageId
  version
  integrityDigest
}
publicTitle
toolName
description
locales
pricePolicyRef
evidencePolicyRef
registry
llmDiscovery
annotations
```

The first slice requires canonical `en-US` copy and permits localized `ja-JP` / `zh-CN` copies without changing resource identity.

## Deterministic publication outputs

`compileAgentResourcePublication(...)` produces, without external I/O:

1. normalized `agent.resource.offer.v1`;
2. `offerDigest`;
3. MCP Registry `server.json` metadata;
4. MCP tool title/description/annotations;
5. one Markdown capability page per locale;
6. one `llms.txt` entry;
7. one `llms-apis.txt` entry.

The Registry artifact uses the current remote-server metadata shape:

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "...",
  "title": "...",
  "description": "...",
  "version": "1.0.0",
  "remotes": [
    { "type": "streamable-http", "url": "https://.../mcp" }
  ]
}
```

`_meta.io.modelcontextprotocol.registry/publisher-provided` carries the exact resource/capability/digest/policy refs so a published surface can remain traceable to the canonical AIEXE object.

## Official MCP Registry static readiness

`evaluateMcpRegistryPublicationStaticReadiness(...)` evaluates the compiled artifact against publication constraints that can be proven without publishing or performing network I/O.

Schema:

```text
ado.mcp-registry.publication-static-readiness.v1
```

The Official MCP Registry currently supports namespace-based publishing authentication. For `io.github.*` server names, GitHub OAuth or GitHub OIDC is the relevant authentication path. A remote Registry server must also be publicly accessible at the URL in its `remotes` entry.

The static readiness check therefore separates three classes of evidence:

```text
static PASS      = shape/identity is locally provable
static BLOCK     = known local defect prevents publication
UNVERIFIED       = requires an external Registry/network action
```

It checks:

- exact official schema reference;
- compiled server name/version binding back to the canonical offer;
- `io.github.<owner>/...` namespace compatibility;
- exact Streamable HTTP remote binding;
- reserved example-domain endpoints;
- obvious placeholder capability integrity digests;
- the Official Registry 4 KiB limit for `_meta.io.modelcontextprotocol.registry/publisher-provided`;
- repository metadata presence as a non-blocking quality warning.

The current reference fixture is correctly `blocked` because it still contains both:

```text
https://tradeos.example/mcp
sha256:1111111111111111111111111111111111111111111111111111111111111111
```

If those static placeholders are replaced with non-placeholder values, this module can advance only to:

```text
external_checks_required
```

It can never return `ready`, because the module deliberately does not authenticate to the Registry and does not probe the remote endpoint.

Every readiness result fixes:

```text
registrySchemaValidatedByOfficialPublisher = false
registryAuthenticationPerformed            = false
registryNamespaceOwnershipVerified         = false
remoteReachabilityChecked                  = false
remotePublicAccessibilityVerified          = false
registrySearchPerformed                    = false
publicationPerformed                       = false
networkPerformed                           = false
paymentPerformed                           = false
domainWritePerformed                       = false
executionAuthorized                        = false
```

This prevents a local linter from being misrepresented as Official Registry acceptance, namespace ownership proof, live endpoint proof, or publication.

The current `io.github.moseszhu999/tradeos-supplier-verification` name is structurally compatible with GitHub OAuth/OIDC namespace authentication for GitHub owner `moseszhu999`; actual authentication still has to occur at publish time.

## Discovery-only authority boundary

The compiler always returns:

```text
publicationPerformed = false
networkPerformed     = false
paymentPerformed     = false
domainWritePerformed = false
```

V1 also refuses `destructiveHint=true`.

Therefore compilation is not Registry submission, ChatGPT App submission, deployment, payment activation, supplier verification, supplier approval or TradeOS mutation.

## Reference offer fixture

`examples/agent-resource-offers/trade.verify_supplier.v1.json` is intentionally a **non-published example fixture**.

Its capability integrity digest and `https://tradeos.example/mcp` remote are placeholders used only to prove deterministic compiler behavior. They are not represented as a live capability package, public MCP endpoint, verified Registry namespace or production TradeOS service.

A real publication must replace these values with:

- the exact accepted AIEXE CapabilityVersion identity + integrity digest;
- a namespace the publisher can actually prove ownership of;
- a real approved public HTTPS Streamable HTTP MCP endpoint;
- explicit publication authorization.

The Official Registry supports GitHub OAuth/OIDC for `io.github.*` namespaces; the current server name is shaped for that route, but no Registry login, OIDC exchange, publication, or Registry search is performed by this PR.

## Read-only supplier mock

`verifySupplierMock(...)` proves only the future machine output contract.

It accepts a caller-supplied fixture catalog and never performs a network lookup. It must:

- return `NEEDS_DISAMBIGUATION` when multiple exact normalized fixture entities match;
- return `INSUFFICIENT_PUBLIC_EVIDENCE` when no fixture evidence exists;
- never turn missing fixture evidence into a negative claim;
- require evidence refs for every `VERIFIED` / `PARTIALLY_VERIFIED` fixture check;
- emit an immutable receipt fixing `mock=true`, `public_source_verification_performed=false`, `supplier_approved=false`, `legal_advice_provided=false`, `network/payment/domainWrite=false`.

## ADO selection evaluation

The first frozen fixture contains 53 prompts across:

```text
exact_intent
ambiguous_entity
negative_adjacent
evidence_trust
market_context
price_discovery
multilingual_discovery
safety_boundary
```

The offline evaluator consumes **observed behavior supplied by a real host/model evaluation run** and computes:

- overall accuracy;
- positive selection rate;
- negative false-selection rate;
- ambiguous disambiguation rate;
- quote-routing rate;
- safety-boundary rate.

Initial acceptance thresholds:

```text
positive selection rate >= 0.90
negative false-selection rate <= 0.05
all cases observed
```

The evaluator explicitly records:

```text
model_invocation_performed = false
network_performed          = false
publication_performed      = false
```

So a green unit test proves evaluator mechanics only. It does **not** prove ChatGPT, Claude, another Agent host, or MCP Registry currently ranks or selects TradeOS.

## Payment boundary

Payment is outside P0.

Future adapters may include internal ledger, x402/MPP/Stripe, Alipay AI Pay or market-local payment providers, but `agent.resource.offer.v1` binds only `pricePolicyRef`. TradeOS supplier-verification Domain code must never depend on Base/USDC/wallet, Alipay `Payment-Proof`, Stripe-specific objects or fincode-specific objects.

## Release boundary

```text
Registry publication       = NO
Registry authentication    = NO
Registry search            = NO
remote reachability probe  = NO
ChatGPT App publication    = NO
public endpoint deployment = NO
payment activation         = NO
real-money transfer        = NO
credential / secret write  = NO
TradeOS Domain write       = NO
supplier approval          = NO
Merge                      = NO in this slice
Deploy                     = NO
```
