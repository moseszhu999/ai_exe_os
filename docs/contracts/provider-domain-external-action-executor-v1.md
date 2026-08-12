# Provider Domain ExternalAction Executor v1 — P5

Status: stacked Draft implementation contract on P0–P3.1.

## Purpose

P5 adds the first bounded AIEXE executor for consequential `domain_api/http.json` actions while preserving the existing authorization, provider-plan, uncertainty and persistent-claim owners.

P5 is **fixture/mock-only** in this branch. It does not prove a live bank, financing, payment, settlement or other production provider integration.

## Exact semantic scope

P5 accepts only an exact P1 `provider.adapter.plan.v1` with:

```text
providerKind = domain_api
protocolFamily = http.json
riskClass = externalAction
humanGatePolicy = action
transport.mode = https
```

The executor rejects model, MCP, generic HTTP, generic JSON-RPC, observe/draft/internalWrite plans and any externalAction plan without an action-level HumanGate policy.

## Execution order

```text
exact P1 plan + planDigest
→ exact externalAction/action-gate scope
→ exact canonical authorization action + target binding
→ execution.authorization.v1 must return current allow
→ exact endpoint/network resolution
→ exact credential resolution
→ exact destination-owned domain adapter metadata
→ P3.1 persistent pre-effect claim
→ exactly one adapter.invokeOperation(...)
→ bounded response classification
→ provider.execution.receipt.v1
→ provider.domain-external-action.evidence.v1
→ provider.execution.outcome.v1
→ persisted P3.1 terminal/uncertain claim
```

No endpoint, credential, claim or effect port is entered before canonical authorization succeeds.

## Canonical authorization and HumanGate

P5 reuses the existing `execution.authorization.v1` evaluator. It does not accept a caller-supplied `allow`, authorization decision, bypass flag or HumanGate result.

Authorization is bound to the exact P1 plan through the established convention:

```text
action = provider.runtime.<providerId>.<operationId>
target = semanticOperation.targetRef
```

P5 additionally requires:

```text
requirements.humanGateRequired = true
humanGatePolicy = action
```

The authorization observation must remain within the existing bounded execution skew and must not be expired at effect time.

## No generic transport surface

The P1 request can provide only semantic `parameters`. Existing P1 blocks URL/method/header/credential smuggling. P5 adds a second execution-boundary guard that also rejects caller-controlled `idempotencyKey` data.

P5 resolves the exact endpoint internally and requires:

```text
providerId       = exact plan provider
operationId      = exact semantic operation
providerOperation= exact provider operation
targetRef        = exact semantic target
endpointRef      = exact opaque endpoint ref
networkPolicyRef = exact opaque network ref
status           = approved
scheme           = HTTPS
query/fragment   = absent
embedded creds   = absent
```

Exactly one opaque credential ref is resolved. v1 requires `ready + bearer`, with the secret held only in the process-local adapter invocation input.

## Exact domain adapter

P5 does not expose `fetch`, arbitrary method/header selection or a generic provider client.

A destination-owned adapter must declare the exact immutable operation binding:

```text
adapterRef
providerId
providerContractId
protocolFamily = http.json
operationId
providerOperation
targetRef
wireMethod = POST
credentialScheme = bearer
providerSideIdempotency = not_proven
automaticRetry = false
businessOutcomeAuthority = false
invokeOperation(...)
```

Any extra generic invocation primitive or any widening of those flags fails closed before the persistent claim/effect port.

The adapter receives internally resolved runtime material:

```text
providerId
providerContractId
adapterRef
operationId
providerOperation
targetRef
url          # internally resolved
bearerToken  # internally resolved, never persisted
parameters   # exact bounded P1 semantic parameters
```

It does **not** receive a caller-chosen HTTP method/header set or the AIEXE runtime idempotency key.

## Provider-side idempotency boundary

P3/P3.1 runtime idempotency is not provider-side idempotency.

P5 v1 deliberately fixes:

```text
providerSideIdempotency = not_proven
providerSideIdempotencyApplied = false
automaticRetry = false
automaticRetryPerformed = false
```

The P3 runtime idempotency key is used only to identify the local AIEXE attempt and is never forwarded to the domain adapter/provider in v1.

### Reviewed retry is CLOSED in P5 v1

Even when a prior externalAction attempt is persisted as `uncertain`, P5 v1 refuses `reviewedRetry=true` attempts.

Reason: without an exact provider contract proving safe provider-side idempotency or an equally strong operation-specific replay contract, a second consequential action could duplicate a payment/submission/settlement effect.

Future retry support must be provider/operation-specific and separately reviewed.

## Persistent claim and crash boundary

P5 reuses the P3.1 `ProviderExecutionAttemptClaimGate`; it creates no second persistence owner.

The persistent claim is acquired immediately before the exact adapter effect port. Therefore:

- exact duplicate initial claims perform zero second effect;
- changing only attempt ID cannot replay the same canonical request within one SQLite coordination domain;
- a trustworthy known response persists a terminal success/known-failure claim;
- an exception or untrustworthy response after effect-port entry persists `uncertain` with `effectMayHaveOccurred=true`;
- no automatic replay is performed.

This remains a **same-SQLite coordination guarantee**, not distributed/global exactly-once and not provider-side exactly-once.

## Response boundary

The destination adapter may return only:

```text
statusCode
contentType
bodyText
providerRequestId?
```

P5 requires bounded JSON and rejects:

- extra response headers/fields;
- non-JSON bodies;
- oversized payloads;
- secret/token/session/private-key shaped response fields or values;
- secret-shaped `providerRequestId` values.

If the adapter effect port has already been entered but the returned material cannot be trusted as a bounded response, the result is `uncertain`, not a fabricated known failure.

## Receipt schema compatibility

P5 intentionally preserves the established `provider.execution.receipt.v1` field set.

It does **not** add a `domainAction` field to that receipt. The receipt remains the common provider execution evidence shape and records:

```text
riskClass = externalAction
flags.externalActionPerformed = true
```

only when the exact domain adapter effect port produced a trustworthy bounded response.

The P5 focused suite hard-locks the receipt key set against the existing v1 schema shape.

### P5 sibling evidence

ExternalAction-specific metadata lives in a separate immutable object:

```text
schema = provider.domain-external-action.evidence.v1
executorVersion
attemptRef
executionRef
receiptDigest
providerId
providerContractId
operationId
providerOperation
targetRef
adapterRef
wireMethod = POST
externalActionPerformed = true
providerSideIdempotencyApplied = false
automaticRetryPerformed = false
businessOutcomeInferred = false
evidenceDigest
```

This evidence binds to the base receipt through `executionRef + receiptDigest` and to the P3 attempt through `attemptRef`.

An exact persistent duplicate/no-op emits neither a new receipt nor a new domain-action evidence object.

An `uncertain` result does not fabricate a completed `provider.domain-external-action.evidence.v1`; uncertainty is expressed only through `provider.execution.outcome.v1` and the persistent claim.

## Business truth boundary

`externalActionPerformed=true` means only that the exact destination-owned externalAction effect port was entered and a trustworthy bounded provider response was received.

It does **not** mean:

```text
financing approved = true
financing disbursed = true
payment completed = true
funds moved = true
settlement completed = true
provider business outcome accepted = true
```

Those are Domain OS truths and require the owning Domain OS/provider-observation contracts to establish them.

For TradeOS specifically, a future AIEXE P5 action attempt may support later P24/P25 observation linkage, but it does not replace P24 dispatch observation or P25 provider acknowledgement by itself.

## Focused validation scope

The P5 suite covers:

1. authorized action-gated success and persistent claim;
2. exact `provider.execution.receipt.v1` key compatibility plus separate action evidence;
3. authorization denial/HumanGate rejection before all effect work;
4. exact action/target/HumanGate/freshness binding;
5. exact domain/http.json/externalAction/action-gate scope;
6. exact endpoint/network/HTTPS boundary;
7. exact ready bearer credential boundary;
8. exact operation-only adapter metadata and no generic invoke;
9. P1 transport/credential smuggling plus P5 caller-idempotency guard;
10. trusted non-2xx → known terminal failure without provider body return;
11. adapter exception → persisted uncertain, zero automatic retry;
12. malformed/sensitive response → uncertain after one effect entry;
13. exact duplicate persistent claim → zero second action;
14. reviewed externalAction retry refused;
15. provider-request/result secret material rejected.

## Closed boundaries

```text
generic HTTP executor = NO
generic JSON-RPC executor = NO
caller-controlled URL/method/header = NO
caller-controlled provider idempotency = NO
provider-side idempotency assumption = NO
automatic retry = NO
reviewed externalAction retry = NO
business outcome inference = NO
second authorization owner = NO
second persistence owner = NO
live bank/provider call = NO
production credential = NO
financing approval/disbursement claim = NO
payment/funds-movement claim = NO
settlement-completion claim = NO
merge = NO
deploy = NO
```
