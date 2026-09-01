# Provider Execution Attempt and Outcome v1

Status: P3 stacked draft contract.

This contract adds one shared execution-attempt and outcome layer above the already bounded AIEXE model and MCP executors.

Its primary safety invariant is:

> A semantic request is not the same thing as a network execution attempt, and an uncertain attempt must never be silently replayed.

## Why this contract exists

A destination transport can fail after the execution effect port has been entered but before the runtime receives a trustworthy result. In that state the runtime cannot safely claim either:

- the provider definitely did nothing, or
- the provider definitely completed the requested operation.

Treating that failure as an ordinary retryable exception can duplicate an effect. P3 therefore makes uncertainty explicit, immutable and review-bound.

## Schemas

```text
provider.execution.attempt.v1
provider.execution.outcome.v1
```

These are shared across:

- OpenAI Responses
- OpenAI-compatible Chat Completions
- Anthropic Messages
- MCP Streamable HTTP `tools/call`

They do not create a new provider router, authorization owner, HumanGate owner, scheduler or Domain truth owner.

## Request identity vs attempt identity

`requestId` and `requestDigest` identify the semantic provider request compiled by P1.

`attemptRef` identifies one concrete execution attempt.

One semantic request may therefore have more than one attempt only when the later attempt is explicitly represented as a reviewed retry.

A provider execution attempt binds:

```text
requestId
requestDigest
planDigest
attemptId
attemptRef
attemptDigest
idempotencyKeyDigest
priorAttemptRef?
reviewedRetry
createdAt
```

The runtime idempotency key is a local guard identity. It is not automatically forwarded to a provider and must not be confused with a provider-specific idempotency protocol.

## Initial attempt

An initial attempt has:

```text
priorAttemptRef = null
reviewedRetry = false
```

The P3 wrappers can generate an initial attempt automatically for compatibility, or a caller can create one explicitly with `createInitialProviderExecutionAttempt(...)`.

The attempt must bind the exact P1 request and plan digests before any endpoint, credential or network effect work.

## Single effect-port invariant

P3 wraps only the already bounded destination effect ports:

```text
model: transport.invoke(...)
MCP:   mcpTransport.invokeTool(...)
```

The wrapper counts effect-port entry and permits exactly one entry per attempt.

There is no hidden retry loop.

A resolver, authorization or validation failure before effect-port entry is rethrown as a normal fail-closed error and is **not** labeled uncertain.

## Outcome classes

`provider.execution.outcome.v1` has three top-level outcome classes:

```text
success
known_failure
uncertain
```

### success

The bounded executor returned `ok=true` and an immutable provider execution receipt.

### known_failure

The bounded executor returned a trustworthy failure result, for example a model provider non-2xx response or an MCP tool result marked as an error.

P3 records the existing receipt outcome as `knownFailureKind`.

A known provider error is not automatically retried. HTTP status such as 429 or 5xx is not itself authority to replay a request.

### uncertain

P3 emits `uncertain` only when the exact effect port was entered and the execution did not return a trustworthy bounded result.

The uncertainty object is:

```text
classification = transport_exception_after_effect_port_entry
effectMayHaveOccurred = true
reasonCode = TRANSPORT_RESULT_UNKNOWN
```

Raw endpoint, credential, session or transport exception material is not copied into the outcome.

## Retry evidence

Every outcome includes bounded retry evidence:

```text
automaticRetryPerformed = false
reviewedRetryRequired = true only for uncertain
reviewedRetry
priorAttemptRef
idempotencyKeyDigest
```

P3 v1 does not automatically retry:

- transport exceptions
- timeouts
- connection resets
- HTTP 429
- HTTP 5xx
- MCP tool errors
- response-shape/protocol failures after effect-port entry

## Reviewed retry

`createReviewedProviderRetryAttempt(...)` is intentionally narrow.

P3 v1 allows it only when the supplied prior outcome is an exact digest-valid `uncertain` outcome that explicitly requires reviewed retry.

The new attempt must:

- retain the same exact `requestId`
- retain the same exact `requestDigest`
- retain the same exact `planDigest`
- reference the exact prior `attemptRef`
- set `reviewedRetry=true`
- use a new attempt identity
- use a new runtime idempotency key

A known failure cannot be silently converted into an uncertain retry path.

The execution wrapper still calls the canonical executor, so the retry must again pass current `execution.authorization.v1`. Stale authorization fails before the effect port and is not upgraded to uncertainty.

If the provider contract or semantic plan must change, the system should create a new request/plan rather than pretending it is a retry of the exact uncertain attempt.

## Outcome evidence

The outcome binds only bounded, audit-safe metadata:

```text
attemptRef / attemptDigest
requestId / requestDigest / planDigest
providerId / providerContractId
protocolFamily / protocolVersion / protocolOperation
semanticOperationId / riskClass
authorization decision reference/digest
opaque endpoint / credential / network-policy refs
startedAt / completedAt
outcome / knownFailureKind
statusCode? / providerRequestId? / responseDigest?
uncertainty?
retry evidence
outcomeDigest
```

The outcome does not store:

- real endpoint URL
- API key / bearer token
- request headers
- MCP session ID
- raw provider error body
- raw transport exception
- caller-supplied authorization answer

## Compatibility with P2/P2.3/P2.4

P3 is additive. It calls the exact previously validated executors rather than widening them:

```text
P2/P2.4 model executor
  <- P3 single-effect attempt wrapper

P2.3 MCP executor
  <- P3 single-effect attempt wrapper
```

The existing authorization, endpoint/network, credential, protocol, response and receipt boundaries remain authoritative.

Existing direct executor entrypoints remain available for regression compatibility; P3 consumer adoption should use the attempt-aware wrapper entrypoints when auditable uncertainty/retry semantics are required.

## Closed boundaries

P3 does not open any new semantic authority:

```text
internalWrite   CLOSED
externalAction  CLOSED
generic HTTP    CLOSED
generic JSON-RPC CLOSED
automatic retry CLOSED
provider-specific retry policy CLOSED
provider idempotency-header passthrough CLOSED
merge           NO
deploy          NO
```

## Next consumer proof

After exact-head validation, the next stage should prove the shared runtime through real product-owned fixtures:

1. TrainingOS: capability → model draft/observe → receipt/outcome → TrainingOS evidence.
2. TradeOS: bounded provider observe/draft → receipt/outcome → TradeOS evidence, with zero trade writes.
3. Shared Media: exact local MCP observe → receipt/outcome → media evidence.

Live provider credentials and production side effects remain a separate controlled validation gate.
