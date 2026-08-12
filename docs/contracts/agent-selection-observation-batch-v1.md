# Agent Selection Observation Batch v1

## Purpose

This contract turns the frozen Agent Discovery Optimization selection fixture into an auditable evidence chain without claiming that AIEXE itself controls or proves the provenance of any external Agent host.

The invariant is:

```text
exact frozen eval fixture
+ exact host capture for every case
+ bounded collector classification
+ opaque observation reference + response digest per case
→ deterministic host collection
→ unverified host provenance envelope
→ deterministic observation-set digest
→ offline selection evaluation
→ surface-specific observation receipt
→ deterministic batch digest
```

A summary metric is never sufficient by itself. Integrity evidence and external-host authenticity are also separate concerns: a self-consistent capture set does not prove that a public Agent host produced it.

## Schemas

```text
ado.selection.eval.fixture.v1
ado.selection.host-observation.collection.v1
ado.selection.host-provenance-envelope.v1
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
evaluationPolicyOwnedByCollector           = false
acceptanceThresholdsOwnedByCollector       = false
rankingClaimCreated                        = false
registryPublicationPerformed               = false
paymentPerformed                           = false
domainWritePerformed                       = false
rawHostResponseStored                      = false
responseDigestBound                        = true
externalHostProvenanceVerifiedByThisModule = false
transportCredentialsOwnedByThisModule      = false
arbitraryUrlAcceptedByThisModule           = false
```

## Unverified Host provenance envelope

`createAgentSelectionHostProvenanceEnvelope(...)` binds a structurally valid exact host collection to the Host identity that a capture owner says produced it.

The envelope binds:

```text
collection schema / collector id / collection digest
fixture digest / observation count
surface
host name
host version/build reference
model name/reference
UTC observedAt
capture-set reference
optional external attestation metadata
```

Before envelope creation, AIEXE recomputes the supplied `collectionDigest`. Therefore the envelope cannot bind a tampered collection while preserving the old collection identity.

The optional external attestation may carry:

```text
attestation_ref
verifier_ref
key_ref
signature_algorithm
signature
issued_at
valid_until
```

This first envelope does **not** verify that signature and does not configure a trust root. An attached signature is therefore evidence material only, not authenticity proof.

The envelope always fixes:

```text
provenanceStatus = unverified
collectionIntegrityVerifiedByThisModule      = true
externalSignatureVerificationPerformedByThisModule = false
externalTrustRootConfiguredByThisModule      = false
externalHostProvenanceVerified                = false
rankingClaimCreated                           = false
registryPublicationPerformed                  = false
paymentPerformed                              = false
domainWritePerformed                          = false
executionAuthorized                           = false
```

Caller-supplied `provenanceStatus`, `trusted`, authorization material or other undeclared fields are rejected. A caller therefore cannot convert an opaque trace into a verified real-host claim by adding a boolean.

This follows the same architectural rule as the separate federation provenance work: deterministic integrity and portable evidence are not themselves a provider-local trust decision. Positive provenance requires a separately owned trusted verifier/trust-root path.

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

The remaining real-world step is a host-specific adapter plus a separately owned verifier/trust-root integration.

The Host adapter must provide a real capture/trace reference and raw response text to the injected collector while keeping credentials and transport configuration in the owning adapter. It must not receive the fixture `expected_behavior` through this contract and must not provide a precomputed PASS/FAIL summary.

If the Host or capture system supplies signed attestation material, a future verifier can consume the unverified provenance envelope together with a provider-local trusted verifier record. Until that verification exists and succeeds, the envelope remains `unverified` by construction.

## Closed boundaries

```text
external host provenance verification     = NO
external trust-root configuration          = NO
raw model/host response persistence       = NO
Registry publication                      = NO
ChatGPT App publication                   = NO
payment activation                        = NO
TradeOS Domain write                      = NO
supplier approval                         = NO
Merge                                     = NO in this slice
Deploy                                    = NO
```
