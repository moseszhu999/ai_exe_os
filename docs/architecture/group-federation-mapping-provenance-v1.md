# Group Federation Mapping Provenance v1

Issue owner: #141. Depends on merged #140 and the canonical Group federation links from #134.

## Purpose

Close the specific provenance gap discovered by the TrainingOS Group Work provider without turning AIEXE into a shared identity database or a Domain authorization authority.

Merged #140 produces a deterministic:

```text
group.federation-mapping-verification.receipt.v1
```

A receipt digest proves that the supplied receipt is internally unchanged. It does **not** prove who created it. A caller can construct a self-consistent receipt and SHA-256 digest locally.

This slice adds a provider-verifiable provenance layer:

```text
accepted #140 verified receipt
+ AIEXE-controlled Ed25519 verifier key
→ signed provenance attestation
+ provider-internal trusted verifier record
→ verified | denied | unknown provenance result
```

The signed attestation binds the exact:

```text
verificationReceiptRef
receiptDigest
verifierRef
keyRef
publicKeyFingerprintSha256
issuedAt
validUntil
policy
```

No caller-controlled boolean can establish trust.

## Contracts

```text
group.federation-mapping-provenance-attestation.v1
group.federation-mapping-provenance-result.v1
```

Fixed policy:

```text
group:federation-provenance-policy:ed25519-provider-verifiable-v1
```

Signature algorithm:

```text
Ed25519
```

The implementation uses Node's built-in `crypto` module only.

## Trust model

There are two different objects and they must not collapse into one another.

### Attestation

The attestation may cross a Domain boundary. It contains:

- the exact #140 receipt reference and digest;
- verifier/key opaque references;
- the SHA-256 fingerprint of the public verification key;
- issue/expiry timestamps;
- Ed25519 signature;
- deterministic attestation digest;
- correlation-only / no-authority flags.

It contains **no public-key PEM, private key, JWT, cookie, bearer token, session, email or phone**.

### Trusted verifier record

`trustedVerifierRecord` is provider-internal configuration/evidence. It is not an HTTP request field and must not be populated from caller JSON.

It contains:

```text
verifierRef
keyRef
publicKeyPem
status = active | revoked | unknown
observedAt
validUntil
```

The verifier re-derives the public-key fingerprint from this record and compares it to the signed attestation.

A provider must source this record from its own trusted configuration/registry boundary. This pure first slice does not create that registry, persist keys, distribute keys, rotate keys, or expose a network endpoint.

## Why asymmetric signing

A shared HMAC secret would require each provider to possess the signing secret and would blur signer/verifier roles.

Ed25519 keeps the boundary explicit:

```text
AIEXE verifier process: private key
Domain provider: trusted public key
caller: neither establishes trust
```

Compromise, rotation, HSM/KMS custody and production key distribution remain separate operational owners.

## Exact receipt binding

Before signing or verifying provenance, the implementation:

1. requires the merged #140 receipt schema;
2. recomputes SHA-256 over the receipt without `receiptDigest`;
3. requires the recomputed digest to equal `receiptDigest`;
4. requires `decision=verified` and `mappingVerified=true`;
5. requires the existing #140 correlation-only / anti-authority flags.

Therefore a syntactically plausible but tampered receipt cannot gain provenance.

## Provenance decisions

```text
verified
denied
unknown
```

### `verified`

Requires all of:

- exact receipt ref/digest binding;
- exact trusted verifier ref;
- exact trusted key ref;
- exact public-key fingerprint;
- valid Ed25519 signature;
- active trusted verifier status;
- fresh trusted verifier observation;
- trusted verifier validity window current;
- attestation issue/expiry window current.

Even a verified provenance result means only:

```text
a trusted configured verifier signed this exact accepted #140 receipt
```

It does not mean provider access is allowed.

### `denied`

Examples:

- wrong verifier ref;
- wrong key ref;
- wrong public key fingerprint;
- invalid signature;
- cross-receipt substitution;
- expired attestation;
- expired trusted verifier record;
- revoked verifier.

### `unknown`

Examples:

- stale trusted verifier observation;
- verifier status unknown;
- verifier observation from the future;
- attestation not yet valid.

Unknown never upgrades to verified.

## Replay / substitution boundary

The attestation signature covers the exact `verificationReceiptRef` and `receiptDigest`.

An attestation for receipt A cannot be replayed against receipt B, even under the same verifier key.

The provider result also binds:

```text
attestationRef
attestationDigest
verifierRef
keyRef
receipt ref/digest
observation time
verifier status
```

and receives a deterministic `resultDigest`.

## Caller-controlled trust rejection

The pure verifier accepts exactly:

```text
receipt
attestation
trustedVerifierRecord
observedAt
```

The attestation and trusted verifier record use exact allowlists.

Fields such as:

```text
trusted
provenanceVerified
accessAllowed
```

are not accepted as trust inputs.

In a future HTTP/provider adapter, `trustedVerifierRecord` must be dependency-injected by the server and must never be deserialized from the caller request body.

## Authority boundary

Every provenance result keeps:

```text
correlationOnly=true
loginCredentialCreated=false
sessionCreated=false
membershipCreated=false
organizationMembershipInferred=false
roleEquivalenceAsserted=false
capabilityCredentialCreated=false
authorityGrantCreated=false
authorizationDecisionCreated=false
providerAccessGranted=false
humanGateDecisionCreated=false
delegationCreated=false
executionAuthorized=false
crossDomainAccessGranted=false
domainWritePerformed=false
externalActionPerformed=false
```

Therefore:

```text
signed mapping provenance != login/session
signed mapping provenance != OrganizationMembership
signed mapping provenance != CapabilityCredential
signed mapping provenance != AuthorityGrant
signed mapping provenance != provider access
signed mapping provenance != HumanGate/delegation/execution
```

A Domain provider must still run its own current authentication, membership, credential and authorization policy.

## TrainingOS adoption

TrainingOS #713 already merged a fail-closed internal provenance resolver seam.

The intended later adoption is:

```text
caller-supplied #140 receipt
→ exact receipt validation
+ server-internal trusted verifier record / AIEXE provenance verification
→ provenance verified
+ current TrainingOS human session
+ current TrainingOS OrganizationMembership
+ complete current-self CapabilityCredential source
→ TrainingOS provider-local decision
```

Until a real provider-internal trusted verifier record is configured and exercised, TrainingOS must not claim LIVE positive cross-domain provider availability.

This PR does not modify TrainingOS.

## Threat model covered in focused tests

Focused tests lock:

1. deterministic positive Ed25519 attestation and provider verification;
2. caller-self-generated receipt + attacker key is denied;
3. wrong verifier reference is denied;
4. wrong key reference is denied;
5. stale verifier provenance becomes unknown;
6. revoked provenance is denied;
7. unknown verifier provenance stays unknown;
8. cross-receipt substitution is denied;
9. receipt/attestation tampering fails closed;
10. caller-controlled `trusted=true` is rejected;
11. expired attestation is denied;
12. all provider-access / authority / execution flags remain false.

The current focused test file contains 9 top-level test cases covering the matrix above.

## First-slice boundaries

```text
database/persistence = NO
shared identity/org truth store = NO
HTTP/API = NO
provider network call = NO
key registry persistence = NO
private key distribution = NO
HSM/KMS integration = NO
Domain membership write = NO
TrainingOS write = NO
TradeOS write = NO
AuthorityGrant = NO
HumanGate = NO
delegation/execution = NO
external action = NO
Production mutation/deploy = NO
payment/settlement/wallet/token = NO
```

This is a pure cryptographic provenance contract and verifier core only.

## Validation

Before repository publication, the exact authored source was exercised in an isolated local harness with a stub exposing the merged #140 receipt schema:

```text
node --check federation-mapping-provenance.cjs: PASS
focused Node tests: 9 / 9 PASS
failures: 0
```

Repository-native source validation and the full AIEXE test suite remain required on the published exact head before any merge claim.

No Production action is authorized by a green source test.
