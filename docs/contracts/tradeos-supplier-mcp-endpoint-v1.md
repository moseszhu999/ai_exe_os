# TradeOS Supplier Verification MCP Endpoint v1

Status: bounded runtime contract; no deployment or Registry publication.

## Purpose

Expose the already-merged canonical discovery capability `trade.verify_supplier.v1` through a production-shaped MCP Streamable HTTP handler without making AIEXE the owner of supplier-verification truth, payment settlement, credentials, network listener lifecycle, or public deployment.

```text
Agent / MCP Host
→ POST /mcp
→ MCP 2026-07-28 createMcpHandler
→ TradeOS Supplier Verification tools
→ explicitly injected verificationProvider
→ structured result + evidence receipt
```

The module never calls `.listen()` and never chooses a production hostname. A deployment owner must mount the returned handler and supply the real verifier.

## SDK baseline

Pinned exact runtime dependencies:

```text
@modelcontextprotocol/server = 2.0.0
@modelcontextprotocol/node   = 2.0.0
```

The endpoint uses the v2 `createMcpHandler(factory)` entry for the 2026-07-28 stateless protocol and the SDK's stateless legacy fallback. Plain Node mounts use `toNodeHandler(...)` plus explicit Host and Origin allowlists.

## Tools

### get_supplier_verification_quote

Read-only price metadata only.

Current launch metadata:

```text
resource             trade.verify_supplier.v1
quote tool price     0.00 USD
verification price   1.00 USD / call
price policy         price.trade.verify_supplier.v1
payment activation   false
payment performed    false
production execution false
```

This tool does not charge, settle, activate x402, Stripe, Alipay, fincode or any other payment rail.

### verify_supplier

Canonical input:

```text
company_name                 required
country                      optional
website                      optional
registration_id              optional
product_requirement          optional
buyer_country                optional
required_certifications[]    optional
```

The MCP server does not own the real supplier-verification engine. `verificationProvider` is mandatory and must be injected by the deployment/runtime owner.

The output contract is evidence-first and machine-readable:

```text
status
subject
confidence
checks[]
evidence[]
limitations[]
recommended_next_action
receipt
```

The endpoint rejects provider results that claim any of:

```text
payment_performed       = true
domain_write_performed  = true
supplier_approved       = true
legal_advice_provided   = true
```

This keeps the first public resource read-only even if a future injected provider attempts to widen authority.

## Runtime security boundary

`createTradeosSupplierMcpNodeHandler(...)` requires explicit non-empty:

```text
allowedHostnames
allowedOriginHostnames
```

The v1 path is fixed to:

```text
/mcp
```

The module does not accept an arbitrary mount path or production URL.

Current runtime boundary is fixed:

```text
verificationProviderRequired                 true
listenerCreatedByThisModule                  false
deploymentPerformed                          false
registryPublicationPerformed                 false
registryAuthenticationPerformed              false
credentialOwnedByThisModule                  false
paymentPerformedByThisModule                 false
domainWritePerformedByThisModule             false
supplierApprovalPerformedByThisModule        false
verificationProviderTruthOwnedByThisModule   false
```

## Registry relationship

This slice deliberately does not replace the intentional placeholders in the merged Registry fixture:

```text
https://tradeos.example/mcp
sha256:1111...1111
```

Therefore Registry static readiness remains BLOCKED until a separate authorized deployment supplies:

1. a real public HTTPS MCP endpoint;
2. an accepted capability integrity digest;
3. Registry authentication / namespace proof;
4. public reachability verification;
5. explicit publication authorization.

Implementing the handler is not deployment and is not Registry publication.

## Test contract

The focused suite proves:

- verificationProvider is mandatory;
- 2026-07-28 `server/discover` works without session state;
- deterministic `tools/list` exposes exactly quote + verify tools;
- input schema remains closed and requires `company_name`;
- quote is free and does not activate payment;
- verify calls the injected provider exactly once;
- fixture results remain structured/read-only;
- authority-widening provider results fail closed;
- Node mount requires Host/Origin allowlists and exact `/mcp` path;
- protocol-header/body mismatch is rejected before provider invocation.

Full AIEXE unit tests remain required on the same immutable PR head.

## Non-goals

```text
real supplier lookup       NO in this slice
public network listener    NO
public domain binding      NO
Registry publish           NO
ChatGPT Plugin publish     NO
credential / secret write  NO
payment activation         NO
real-money payment         NO
TradeOS Domain write       NO
supplier approval          NO
legal advice               NO
production deploy          NO
```
