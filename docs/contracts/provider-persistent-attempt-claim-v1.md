# Provider Persistent Attempt Claim Gate v1

Status: P3.1 stacked draft contract.

This contract adds a destination-local persistent claim gate in front of the exact P3 provider effect ports.

The purpose is to prevent a canonical P1 request from being replayed merely by changing an in-memory attempt identity or restarting another AIEXE process that points at the same canonical SQLite state.

## Safety statement

P3.1 provides:

- one persistent **initial claim** per exact canonical P1 `requestDigest` inside one shared SQLite coordination domain;
- one persistent **direct reviewed-retry successor claim** per exact `priorAttemptRef`;
- zero automatic replay after restart;
- explicit recovery containment for a crash window in which a claim exists but no terminal outcome was persisted.

P3.1 does **not** provide:

- distributed/global exactly-once across unrelated databases or devices;
- provider-side idempotency guarantees;
- proof that a provider definitely did or did not execute after a process crash;
- a generic provider idempotency-header passthrough.

## Reused persistence owner

P3.1 does not create a second database or migration framework.

It reuses the existing canonical `S1SqliteEventStore` used by the S1/S2 application stack. That store already provides:

- SQLite WAL;
- `BEGIN IMMEDIATE` transactions;
- canonical `execution_events` idempotency keys;
- event/projection transaction support;
- projection version collision checks;
- privacy/secret rejection.

The persistent claim gate calls `store.appendWithProjection(...)` directly when acquiring a claim. It does not use an in-memory repository as the claim authority.

## Schema

```text
provider.execution.claim.v1
```

Projection type:

```text
providerExecutionClaim
```

The projection stores only bounded evidence:

```text
attemptRef
attemptDigest
attemptId
requestId
requestDigest
planDigest
idempotencyKeyDigest
priorAttemptRef?
reviewedRetry
claimSemanticKey
status
claimedAt
outcomeClass?
outcomeDigest?
completedAt?
recoveryReason?
effectMayHaveOccurred?
reviewedRetryRequired
```

It never stores endpoint URL, API key, bearer token, request headers, MCP session ID, raw provider response body or raw transport exception.

## Initial claim key

An initial P3 attempt uses:

```text
provider-initial-request:<requestDigest>
```

as the canonical SQLite event idempotency key.

This is intentionally **not** keyed by `attemptRef`.

The P1 `requestDigest` already binds the canonical request identity, including `requestId`, provider, operation, protocol family and exact compiled protocol call. A caller cannot replay the same canonical P1 request by changing only `attemptId` or the local runtime idempotency key.

If the same exact attempt is observed again, acquisition returns a duplicate/no-op result and performs no provider effect.

If a different attempt tries to claim the same exact request digest, the persisted event payload differs under the same idempotency key and the store fails closed with a semantic claim collision.

A deliberately new P1 `requestId` is a new canonical request identity. P3.1 is not a business-level duplicate detector across distinct requests.

## Reviewed retry claim key

A reviewed retry uses:

```text
provider-reviewed-retry:<priorAttemptRef>
```

as the canonical claim key.

Therefore one exact uncertain attempt can have only one direct persistent successor retry claim.

The underlying P3 reviewed-retry rules still apply:

- prior outcome must be exact, digest-valid and uncertain;
- retry must retain the exact request/plan identity;
- retry uses a new attempt identity;
- retry uses a new runtime idempotency key;
- canonical `execution.authorization.v1` is evaluated again.

A second different retry attempt under the same prior attempt reference is a persistent collision and cannot reach the provider effect port.

## Claim placement

The persistent claim is acquired **after** canonical authorization and endpoint/credential resolution, but **immediately before** the already bounded provider effect port:

```text
P1 exact plan
-> canonical execution.authorization.v1
-> exact endpoint/network resolution
-> exact credential resolution
-> P3.1 persistent claim
-> P3 single-effect guard marks effect started
-> destination transport.invoke / mcpTransport.invokeTool
```

P3 was extended with an optional `effectClaim` hook that runs before `state.started=true`.

This ordering matters. If persistent claim acquisition rejects a duplicate or collision, no real network effect has started and P3 must not misclassify that rejection as `uncertain`.

The effect-claim hook receives only the exact P3 attempt and P1 plan. It does not receive resolved URL, secret, headers or MCP session material.

## Persistent execution entrypoints

```text
executePersistedModelProviderAttempt(...)
executePersistedMcpProviderAttempt(...)
```

Persistent execution requires an explicit `executionAttempt`. The entrypoint does not generate an ephemeral attempt implicitly because crash/recovery evidence must retain one exact attempt identity.

On first acquisition:

```text
claim status = claimed
-> exactly one P3 effect attempt
-> terminal P3 outcome
-> claim projection updated to success | known_failure | uncertain
```

On exact duplicate acquisition:

```text
persistentDuplicate = true
provider network effect = 0
```

The duplicate path returns persisted claim evidence but does not invent a provider result or receipt that is no longer available in memory.

## Outcome persistence

P3.1 records the exact digest-valid `provider.execution.outcome.v1` into the claim projection.

Terminal statuses are:

```text
success
known_failure
uncertain
```

Once a claim has a terminal outcome, a different terminal outcome cannot replace it.

Exact duplicate outcome recording is idempotent.

## Crash/restart recovery

A process can crash after the persistent claim transaction commits but before a terminal provider outcome is persisted.

On restart, `recoverUnfinishedClaims(...)` converts any remaining:

```text
status = claimed
```

into:

```text
status = recovery_required
outcomeClass = uncertain
effectMayHaveOccurred = true
reviewedRetryRequired = true
recoveryReason = PROCESS_RESTART_WITH_UNFINISHED_PROVIDER_CLAIM
```

This is intentionally conservative. The process may have crashed before or after the actual network send; the persisted evidence does not pretend to know.

The recovered claim is not automatically replayed. An exact duplicate execution attempt is a zero-network no-op.

P3.1 v1 does not automatically synthesize a normal P3 `provider.execution.outcome.v1` from this restart-recovery record because canonical authorization/provider response evidence may be incomplete. Human/operator reconciliation remains required before creating a new business decision or replacement request.

## Same-SQLite coordination boundary

Multiple AIEXE processes/connections using the exact same SQLite database coordinate through the same event idempotency key and `BEGIN IMMEDIATE` transaction boundary.

This provides a persistent single claim owner in that database domain.

It does not coordinate two different local databases, two devices with independent state, or a remote provider's internal request ledger.

## Closed boundaries

```text
internalWrite                 CLOSED
externalAction                CLOSED
automatic retry               CLOSED
generic provider idempotency  CLOSED
provider-specific retry policy CLOSED
generic HTTP                  CLOSED
generic JSON-RPC              CLOSED
second persistence owner      NO
second authorization owner    NO
merge                         NO
deploy                        NO
live production credentials   NO
```

## Consumer adoption after exact-head proof

After P3.1 passes exact-head validation, real cross-project consumer fixtures can adopt the persistent entrypoints:

1. TrainingOS: model observe/draft -> persistent claim -> receipt/outcome -> TrainingOS evidence.
2. TradeOS: bounded observe/draft -> persistent claim -> receipt/outcome -> TradeOS evidence; zero trade writes.
3. Shared Media: exact local MCP observe -> persistent claim -> MCP receipt/outcome -> media evidence.

Production provider credentials and any write-capable semantic risk remain separate controlled gates.
