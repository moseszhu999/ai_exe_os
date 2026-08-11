# Provider Runtime Executor v1 — P2 model transport

Status: stacked implementation contract on P0 `provider.runtime.manifest.v1` and P1 `provider.adapter.plan.v1`.

## Purpose

P2 adds the first destination-local provider transport executor without creating a second authorization owner. The executor consumes an exact P1 plan, re-evaluates the already accepted `execution.authorization.v1` request, resolves only opaque endpoint/credential/network references through destination-owned resolvers, performs one bounded HTTPS model request, and returns the model result plus an immutable secret-free receipt.

Initial protocol scope:

- `openai.responses`
- `openai.chat-completions`

The second protocol family intentionally covers OpenAI-compatible providers such as DeepSeek without product-specific client code.

P2 v1 deliberately excludes:

- `internalWrite`
- `externalAction`
- MCP execution
- generic HTTP/domain writes
- arbitrary URLs, methods, headers, credentials, or provider selection
- credential persistence
- authorization creation
- HumanGate creation/decision

## Authority reuse

P2 imports and invokes the existing canonical evaluator:

```text
src/authorization/execution-authorization-v1.cjs
```

The provider executor never accepts a caller-supplied `authorized=true` flag or a fabricated authorization decision object.

Execution order is fail-closed:

```text
exact P1 plan
→ exact semantic authorization action/target binding
→ evaluateExecutionAuthorizationV1(...)
→ decision must be allow and current
→ endpoint/network-policy resolver
→ credential resolver
→ one bounded protocol transport invocation
→ provider.execution.receipt.v1
```

No resolver and no network transport is called before authorization succeeds.

## Canonical authorization binding

P2 derives the execution authorization action from the exact plan:

```text
provider.runtime.<providerId>.<operationId>
```

Authorization target is `semanticOperation.targetRef` when one exists, otherwise the exact `providerContractId`.

This is a destination execution binding convention. It does not alter `execution.authorization.v1` semantics or create a second authority model.

HumanGate requirement is also bound to the P1 plan:

```text
humanGatePolicy = never       -> humanGateRequired = false
humanGatePolicy = task/action -> humanGateRequired = true
```

The existing authorization evaluator decides whether the resolved gate is approved, pending, denied, unknown, or revoked.

## Destination-owned resolution

The P1 plan contains opaque references only:

```text
endpoint.*
credential.*
network.*
```

P2 resolver contracts return runtime-only bindings. The executor verifies exact ref equality before use.

Endpoint requirements:

- status `approved`
- exact `endpointRef`
- exact `networkPolicyRef`
- HTTPS only
- no embedded username/password
- no query string or fragment

Credential requirements in P2 model scope:

- exactly one exact `credentialRef`
- status `ready`
- scheme `bearer`
- secret exists only in the transport call input
- secret is never returned in the result or receipt

## Wire method is still not effect authority

Model creation uses HTTPS POST at the protocol layer. That does not imply `internalWrite` or `externalAction` business authority.

P2 model execution accepts only semantic risk classes `observe` and `draft`.

Any `internalWrite` or `externalAction` plan is rejected before endpoint, credential, or network work. Later domain/MCP write executors require their own bounded contracts behind the same canonical authorization and HumanGate owners.

## Transport contract

The executor passes one request to a destination-owned transport:

```text
providerId
protocolFamily
url              # resolved internally, never supplied by capability/request
method = POST
headers           # internally constructed bearer + content-type only
body              # exact P1 protocol payload
```

P2 does not expose a generic caller-controlled method/header surface.

Transport response is closed to:

```text
statusCode
contentType
bodyText
providerRequestId?
```

Extra response fields such as raw headers are rejected to reduce accidental secret/cookie leakage. Response must be bounded JSON.

## Receipt

`provider.execution.receipt.v1` stores only evidence-safe metadata:

- request ID/digest
- plan digest
- provider ID / contract ID / manifest digest
- protocol family / operation
- semantic operation ID / risk class
- canonical authorization decision ref / evidence digest
- opaque endpoint / credential / network refs
- start/completion time
- outcome / status code / provider request ID
- response digest
- execution flags
- receipt digest / execution ref

The receipt does not store endpoint URL, bearer token/API key, request Authorization header, raw provider error body, or raw response headers.

Successful model JSON is returned separately as the execution result; it is not embedded in the receipt.

## Truth boundary

A successful P2 receipt proves that this executor evaluated the canonical authorization request and received `allow`, bound that request to the exact provider operation/target, resolved matching approved runtime references, invoked the destination-owned transport once, and received bounded JSON that was hashed.

It does not prove the model answer is correct, factually grounded, policy-compliant, or adopted by a Domain OS. Those claims require higher-level evidence/evaluation owners.

## Follow-on

Recommended next sequence:

```text
P2.3  MCP Streamable HTTP observe/draft executor
P2.4  Anthropic Messages model executor
P3    shared immutable error/receipt taxonomy + retry/idempotency semantics
P4    real cross-project fixtures: TrainingOS, TradeOS, Video/Shared Media
```

`internalWrite` and `externalAction` remain closed until separately reviewed write-specific executors prove exact HumanGate, target, idempotency, effect receipt, and recovery boundaries.
