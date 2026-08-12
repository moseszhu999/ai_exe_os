# Agent Selection Observation Batch v1

## Purpose

This contract turns the frozen Agent Discovery Optimization selection fixture into an auditable evidence chain without claiming that AIEXE itself invoked or controlled any external Agent host.

The invariant is:

```text
exact frozen eval fixture
+ exact externally collected observation for every case
+ opaque observation reference + response digest per case
→ deterministic observation-set digest
→ offline selection evaluation
→ surface-specific observation receipt
→ deterministic batch digest
```

A summary metric is never sufficient by itself. The receipt must bind the exact observation set from which the metrics were derived.

## Schemas

```text
ado.selection.eval.fixture.v1
ado.selection.observation.batch.v1
ado.selection.evaluation.v1
ado.selection.observation.receipt.v1
```

The reference fixture remains:

```text
tests/fixtures/trade.verify_supplier.selection-eval.v1.json
resource_id = trade.verify_supplier.v1
case count  = 53
```

## Exact observation evidence

Every fixture case must have exactly one observation:

```json
{
  "id": "E01",
  "observed_behavior": "SELECT_VERIFY_SUPPLIER",
  "observation_ref": "capture:e01:host-trace-v1",
  "response_digest": "sha256:..."
}
```

`observation_ref` is an opaque reference to caller-owned capture evidence. `response_digest` binds the captured host response without placing the raw host response in the AIEXE receipt.

The batch rejects:

- a missing case;
- a duplicate case id;
- an unknown case id;
- a duplicate observation ref;
- an unsupported observed behavior;
- a malformed response digest;
- a fixture whose `resource_id` does not equal the capability under evaluation.

Observations are normalized into frozen fixture order before `observationSetDigest` is calculated. Therefore input ordering cannot be used to create a different semantic observation set.

## Evaluation derivation

`createAgentSelectionObservationBatch(...)` calls the existing `evaluateAgentSelection(...)` itself. Callers do not supply the metrics summary.

The batch therefore binds:

```text
evalFixtureDigest
observationSetDigest
evaluation
receipt.receiptDigest
batchDigest
```

Changing one observed behavior changes the observation-set digest and the receipt/batch identities. If the changed behavior crosses a threshold, the derived acceptance result changes with it.

The first threshold policy remains:

```text
positive selection rate >= 0.90
negative false-selection rate <= 0.05
all fixture cases observed
```

## Surface-specific receipt

The receipt binds the exact capability/resource evaluation to one observed surface:

```text
chatgpt_app
mcp_client
mcp_registry_consumer
llm_web_discovery
internal_eval_host
```

It also binds:

```text
host name
host version/build ref
model ref
UTC observedAt
exact observation count
exact offer digest
exact fixture digest
exact observation-set digest
exact offline-derived evaluation
```

A different host/model/surface or a different observation set produces a different receipt identity.

## Collection boundary

This module does not invoke the external Agent host. It consumes evidence collected by a separate bounded adapter or reviewed manual capture path.

Every batch fixes:

```text
observationCollectionPerformedByThisModule = false
hostInvocationPerformedByThisModule        = false
networkPerformedByThisModule               = false
rawHostResponseStored                      = false
responseDigestBound                        = true
```

The observation receipt also fixes:

```text
rankingClaimCreated            = false
registryPublicationPerformed   = false
appPublicationPerformed        = false
paymentPerformed               = false
domainWritePerformed           = false
executionAuthorized            = false
```

Therefore an accepted observation batch is evidence about one observed selection run. It is not a ranking guarantee, Registry/App publication receipt, payment receipt, TradeOS authorization, provider authorization, Domain write or execution approval.

## Next execution slice

A later host-specific collection adapter may perform the actual 53-case run. It must return only bounded observation evidence into this contract:

```text
case id
classified observed behavior
opaque capture/trace ref
SHA-256 response digest
```

The host adapter must not be allowed to provide a precomputed PASS/FAIL summary. AIEXE recomputes evaluation from the exact observation set.

## Closed boundaries

```text
external host invocation by this module = NO
raw model/host response persistence      = NO
Registry publication                    = NO
ChatGPT App publication                 = NO
payment activation                      = NO
TradeOS Domain write                    = NO
supplier approval                       = NO
Merge                                  = NO in this slice
Deploy                                 = NO
```
