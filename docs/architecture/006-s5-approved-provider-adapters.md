# Architecture 006 — S5 Approved Provider Adapters

Status: **NORMATIVE — S5 GATE 0**

Parent: #73

## 1. Decision

S5 introduces one reusable provider-adapter seam for approved external observations while keeping all authorization, execution, persistence and Human-Gate authority in the already accepted S1–S4 layers.

The initial architecture is read-only and body-free:

```text
S1 provider-use authority
        │
        ▼
ProviderTargetBinding ── exact target / provider / action / contract
        │
        ▼
ProviderAdapterRegistry
        │
        ├── Vercel public deployment normalizer
        └── Netlify public deployment normalizer
        │
        ▼
BoundedReadOnlyTransport
  HTTPS + GET/HEAD + redirect/private-target policy
        │
        ▼
ProviderObservation
        │
        ▼
existing SQLite execution_events/projections
        │
        ▼
S4 Operator Cockpit derived explanation
```

No S5 provider writer exists in this architecture.

## 2. Why this layer exists

S0–S4 already prove local execution, authorization, Mission orchestration, GitHub read-only delivery evidence and operator control. The missing reusable seam is a provider-specific adapter boundary that can answer:

```text
which provider surface is this?
which immutable adapter version handles it?
which action is allowed by the reviewed contract?
which exact target is approved?
what bounded network method may run?
what provider-specific metadata is safe to normalize?
what evidence is persisted without credentials/body harvesting?
```

Without this layer, each future external provider would tend to embed bespoke URL validation, network policy and evidence semantics in application code.

## 3. Non-goals

S5 v1 does not implement:

```text
a generic arbitrary HTTP fetcher
provider login/token acquisition
browser-cookie reuse
provider SDK writes
deploy/promote/rollback
GitHub writes
SQL/database mutation
secret management
provider quota bypass
third-party AI output extraction
```

## 4. Layer responsibilities

### 4.1 Existing provider-use authority

The accepted provider snapshot / contract remains the authorization truth.

S5 validates against it but cannot edit or override it.

### 4.2 Provider adapter domain

Pure domain code owns:

```text
adapter identity/version
provider/action identity
exact target binding semantics
semantic-key collision rules
contract/action/target validation
safe normalized observation shape
```

It performs no network access.

### 4.3 Bounded read-only transport

Transport owns only bounded external HTTP mechanics:

```text
HTTPS requirement
GET/HEAD method allow-list
exact approved target/origin comparison
credential-in-URL rejection
private/loopback/link-local IP literal rejection
bounded timeout
bounded redirect count
redirect target revalidation
no write-method upgrade
safe-header extraction
body cancellation/omission
method audit
```

Transport does not know Workspace grants or Mission semantics.

### 4.4 Provider-specific normalizers

Provider modules classify and normalize safe provider-specific metadata from the bounded transport result.

Initial modules:

```text
vercel-public-deployment
netlify-public-deployment
```

They are pure transformations and do not issue HTTP requests directly.

### 4.5 Application integration

Only S5-I composes:

```text
Workspace + Agent/capability/provider contract
ProviderTargetBinding
registry
transport
provider normalizer
SQLite event/projection
IPC
S4 cockpit
```

This prevents B/C/D/E sibling branches from creating competing root composition.

## 5. Registry contract

The registry resolves by exact immutable identity, not by heuristic URL guessing alone.

Conceptually:

```js
registry.resolve({ adapterId, version, provider, action })
```

Resolution fails closed when:

```text
adapter unknown
version unknown
adapter blocked/deprecated for new binding
provider mismatch
action mismatch
```

A provider hostname classifier may validate a selected adapter but never grants authority by itself.

## 6. Exact-target policy

The target binding is the authority boundary for network destination.

An observation command references a binding ID, not an arbitrary URL.

Application flow:

```text
command(bindingId, method)
→ load binding in same Workspace
→ load accepted provider contract
→ resolve immutable adapter
→ validate requested method/action
→ pass binding.exactTarget + approved redirect policy to transport
```

Renderer never supplies a free-form destination to the transport.

## 7. SSRF boundary

S5 v1 rejects before network access:

```text
non-HTTPS external URLs
URL username/password components
IP literals in loopback/private/link-local/unspecified/multicast ranges
localhost-style external aliases in provider adapter path
unapproved ports/origins
provider classification mismatch
```

Redirect destinations receive the same validation and must remain within approved origin policy.

The initial contract intentionally uses public provider-hosted deployment surfaces and does not claim to solve every DNS-rebinding class. If future authenticated/control-plane APIs require stronger DNS pinning or egress policy, that must be added before those surfaces are accepted.

## 8. Response-body boundary

S5 v1 sets response-body persistence policy to `none`.

Transport may terminate/cancel the response body once bounded metadata is available. It persists no unrestricted HTML/JSON/body content.

This keeps S5 focused on deployment/provider observation and avoids turning the adapter layer into a content scraper.

## 9. Safe headers

A minimal allow-list may include:

```text
content-type
etag
last-modified
cache-control
content-length
server only if reviewed as non-sensitive provider evidence
```

Never persist:

```text
set-cookie
www-authenticate if it contains provider detail considered sensitive
authorization
proxy-authorization
x-* headers by default
```

Provider-specific additions require an explicit safe-header contract change.

## 10. Evidence digest

`ProviderObservation.evidenceDigest` is deterministic over a canonical safe observation object such as:

```text
workspaceId
bindingId
adapter id/version
provider
action
method
exact target
status/failure code
status code
normalized safe headers
bounded redirect metadata
```

No credential or unrestricted body bytes participate in persisted evidence.

## 11. Canonical events and projections

S5 persists through the existing SQLite authority.

Recommended projections:

```text
providerTargetBinding
providerObservation
```

Recommended semantic events:

```text
provider.target_bound
provider.target_disabled
provider.observation_requested
provider.observation_blocked
provider.observation_recorded
```

`provider.observation_requested` does not imply a network effect occurred. Evidence must distinguish pre-network validation failure from an actual provider request/result.

Restart rehydrates projections without issuing HTTP.

## 12. Idempotency and replay

Observation command identity is semantic.

Replaying the same completed command identity returns existing canonical observation/evidence and must not issue a second network request.

Reusing an identity with changed binding/method/action fails collision validation.

A new live observation requires an explicit new attempt/observation identity.

Failure/timeout never grants automatic retry.

## 13. Workspace and Agent integration

Workspace remains the visibility boundary.

When an observation is invoked from a Task/Mission execution path, existing same-Workspace installation/grant/provider-use checks remain mandatory.

A direct operator read-only observation command, if exposed in S5-I, must still reference an active Workspace-scoped ProviderTargetBinding and accepted provider contract; it cannot bypass binding/contract authority merely because the action is read-only.

## 14. Human Gate policy

The first S5 vertical slice is `READ_ONLY`; no new Human Gate is required solely for GET/HEAD observation unless an existing capability contract explicitly requires one.

This does not create a precedent for writes.

Any future provider write action is a different action class and must have a separately accepted contract plus Human-Gate behavior before implementation.

## 15. S4 cockpit integration

S5 adds provider explanation to S4 without making S4 authoritative.

Expected derived information:

```text
adapter/provider/action
exact target
contract accepted/blocked status
latest observation status
status code / bounded failure code
last observed time
evidence digest / canonical event link
```

No provider write buttons appear in S5 v1.

## 16. IPC design

S5-I should expose a small explicit namespace, conceptually:

```text
s5.provider.query(workspaceId)
s5.provider.bindTarget(input)
s5.provider.observe(input)
```

If binding creation is treated as local canonical configuration, it remains a local write only; it is not a provider write. Inputs are strongly validated and cannot include secret values.

There is no `request(url, method, headers)` IPC.

## 17. Live acceptance architecture

S5-F runs only against a frozen product head.

Required evidence classes:

```text
exact-source validation
transport safety matrix
provider-specific deterministic normalizer matrix
native arm64 real Electron matrix
live Vercel public target observation
live Netlify public target observation
method audit
SQLite/restart/no-replay evidence
privacy scan
screenshots
portable SHA256SUMS
```

Live target URLs must be explicit acceptance configuration and are recorded as approved targets. They may not be discovered by crawling or inferred from arbitrary user content.

If an explicitly approved live target is unavailable, acceptance reports the row blocked/failed; it may not silently substitute an unrelated target and still claim GO.

## 18. Ownership

After S5-A merges:

- S5-B owns `src/provider-adapters/domain/**` and domain tests;
- S5-C owns `src/provider-adapters/transport/**` and transport tests;
- S5-D owns `src/provider-adapters/providers/**` and normalizer tests;
- S5-E owns component UI/bridge-contract files only;
- S5-I is the only owner allowed to wire SQLite/application/main/root preload/root renderer;
- S5-F is read-only against the frozen product head and writes only acceptance/result artifacts.

## 19. Stop conditions

Repair-before-GO or NO-GO if any occurs:

```text
arbitrary URL fetch becomes reachable from renderer/application caller
POST/PUT/PATCH/DELETE appears in initial adapter transport
redirect escapes approved policy
private/loopback target is reachable through external adapter path
Workspace data leaks
provider contract can be overridden by S5/S4 UI
response body is harvested contrary to contract
credential/cookie/token/profile/process-local value reaches persistence/renderer/artifact
restart replays a provider request
provider-specific adapter is simulated but represented as live
```
