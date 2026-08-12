# Agent Selection Observation Batch v1

## Purpose

This contract turns the frozen Agent Discovery Optimization selection fixture into an auditable evidence chain without claiming that AIEXE itself controls or proves the provenance of any external Agent host.

The invariant is:

```text
exact frozen eval fixture
+ exact host capture for every case
+ bounded collector classification
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
ado.selection.host-observation.collection.v1
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

## Injected host collector

`collectAgentSelectionHostObservations(...)` is the bounded bridge between a future host-specific adapter and the existing batch contract.

The collector accepts two injected functions:

```text
invokeHost(case input)        → observation_ref + response_text
classifyResponse(response)    → one allowed observed behavior
```

The collector itself contains no provider URL, credential, token, provider SDK, HTTP client, Registry publisher or payment path.

The host invocation input deliberately excludes `expected_behavior`. The classifier input also excludes `expected_behavior`. Therefore the frozen answer key is not supplied to either injected dependency through this contract.

Only these case fields are exposed to the host adapter:

```text
case_id
category
prompt
resource_id
```

Only these response capture fields are accepted back:

```text
observation_ref
response_text
```

Unknown capture fields fail closed. This prevents transport credentials, headers or arbitrary provider metadata from being smuggled into the collector output.

Raw response text is bounded to 256 KiB, classified in memory, SHA-256 hashed, and discarded from the returned collection object. The output observation contains only:

```text
case id
classified observed behavior
opaque observation reference
SHA-256 response digest
```

The collector does not own acceptance thresholds or evaluation policy. It also does not claim that the injected adapter truly represented a public external Agent host. External-host provenance remains a separate evidence problem.

Every collection fixes:

```text
evaluationPolicyOwnedByCollector          = false
acceptanceThresholdsOwnedByCollector      = false
rankingClaimCreated                       = false
registryPublicationPerformed              = false
paymentPerformed                          = false
domainWritePerformed                      = false
rawHostResponseStored                     = false
responseDigestBound                       = true
externalHostProvenanceVerifiedByThisModule = false
transportCredentialsOwnedByThisModule     = false
arbitraryUrlAcceptedByThisModule          = false
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

## Batch collection boundary

The batch module does not invoke an external Agent host. It consumes bounded observations produced elsewhere, including by the injected collector above.

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

Therefore an accepted observation batch is evidence about one supplied selection run. It is not a ranking guarantee, Registry/App publication receipt, payment receipt, TradeOS authorization, provider authorization, Domain write or execution approval.

## Next execution slice

The remaining step is a host-specific adapter outside this product-neutral collector contract. It must provide a real capture/trace reference and raw response text to the injected collector, while keeping credentials and transport configuration in the owning host adapter.

That adapter must not provide a precomputed PASS/FAIL summary and must not receive the fixture `expected_behavior` through this contract. AIEXE recomputes evaluation from the exact observation set.

## Closed boundaries

```text
external host provenance verification     = NO
raw model/host response persistence       = NO
Registry publication                      = NO
ChatGPT App publication                   = NO
payment activation                        = NO
TradeOS Domain write                      = NO
supplier approval                         = NO
Merge                                     = NO in this slice
Deploy                                    = NO
```
