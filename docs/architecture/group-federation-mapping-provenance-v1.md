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
accepted canonical #140 verified receipt
+ AIEXE-controlled Ed25519 verifier key
→ portable signed provenance attestation
+ provider-internal trusted verifier record
→ local verified | denied | unknown provenance result
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

There are three different objects and they must not collapse into one another.

### Portable signed attestation

`group.federation-mapping-provenance-attestation.v1` may cross a Domain boundary. It contains:

- exact #140 `verificationReceiptRef` and `receiptDigest`;
- verifier/key opaque references;
- SHA-256 fingerprint of the public verification key;
- `issuedAt` and `validUntil`;
- fixed provenance policy;
- Ed25519 signature;
- deterministic attestation digest;
- correlation-only / no-authority flags.

It contains **no public-key PEM, private key, JWT, cookie, bearer token, session, email or phone**.

The signed payload binds the exact:

```text
verificationReceiptRef
receiptDigest
verifierRef
keyRef
publicKeyFingerprintSha256
issuedAt
validUntil
provenancePolicyRef
```

### Provider-internal trusted verifier record

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

### Local derived provenance result

`group.federation-mapping-provenance-result.v1` is produced **after** a provider verifies the portable signed attestation against its own trusted verifier record.

Its deterministic `resultDigest` is a local consistency/integrity mechanism. It is **not** a second authenticity signature.

Therefore:

```text
caller-supplied provenance result + self-consistent resultDigest
!= trusted provenance
```

A downstream Domain must derive the result inside its own trusted verifier boundary instead of accepting a precomputed result from an untrusted caller.

## Why asymmetric signing

A shared HMAC secret would require each provider to possess the signing secret and would blur signer/verifier roles.

Ed25519 keeps the boundary explicit:

```text
AIEXE signer process: private key
Domain provider: trusted public key
caller: neither establishes trust
```

Compromise, rotation, HSM/KMS custody and production key distribution remain separate operational owners.

## Exact receipt binding

Before signing or verifying provenance, the implementation:

1. requires the merged #140 receipt schema;
2. requires the exact complete canonical #140 receipt field set;
3. rejects missing or hidden top-level fields;
4. requires exactly two distinct bounded domain bindings;
5. recomputes SHA-256 over the receipt without `receiptDigest`;
6. requires the recomputed digest to equal `receiptDigest`;
7. requires `decision=verified` and `mappingVerified=true`;
8. requires the existing #140 correlation-only / anti-authority flags.

Therefore a syntactically plausible but tampered or structurally incomplete receipt cannot gain provenance merely by recomputing its digest.

## Attestation semantic identity

`attestationRef` is a deterministic semantic identity, not an arbitrary label.

Its seed binds:

```text
verificationReceiptRef
receiptDigest
verifierRef
keyRef
publicKeyFingerprintSha256
issuedAt
validUntil
```

The full signed validity window is part of identity. In particular:

```text
same receipt/verifier/key/issuedAt
+ different validUntil
→ different attestationRef
```

This prevents two semantically different validity windows from sharing one attestation reference in downstream idempotency, audit, or evidence stores.

The complete attestation payload, including `attestationRef`, policy and anti-authority fields, is then Ed25519-signed and receives an `attestationDigest`.

## Provenance decisions

```text
verified
denied
unknown
```

### `verified`

Requires all of:

- exact canonical #140 receipt;
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

- malformed or tampered canonical receipt;
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

The attestation signature covers the exact `verificationReceiptRef` and `receiptDigest` plus verifier/key identity and validity window.

An attestation for receipt A cannot be replayed against receipt B, even under the same trusted verifier key.

The local provider result also binds:

```text
attestationRef
attestationDigest
verifierRef
keyRef
receipt ref/digest
observation time
verifier status
```

and receives a deterministic `resultDigest` for local result integrity.

Again, `resultDigest` does not make an externally supplied result authentic.

## Caller-controlled trust rejection

The pure verifier accepts exactly:

```text
receipt
attestation
trustedVerifierRecord
observedAt
```

The attestation and trusted verifier record use bounded allowlists and required-field validation.

Fields such as:

```text
trusted
provenanceVerified
accessAllowed
```

are not accepted as trust inputs.

In a future HTTP/provider adapter:

- the signed attestation is the portable provenance evidence;
- `trustedVerifierRecord` must be dependency-injected by the server;
- a precomputed `provenanceResult` must not be accepted as caller authenticity;
- no private signing key belongs in a consumer Domain.

## Authority boundary

Every local provenance result keeps:

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

TrainingOS #713 already merged a fail-closed internal provenance resolver seam. TrainingOS #715 owns the bounded consumer adoption after this AIEXE contract is accepted.

The intended adoption is:

```text
validated canonical #140 receipt
+ portable signed provenance attestation
+ TrainingOS server-internal trusted verifier public-key record
+ current provider-local observation time
→ actual signature/trust verification inside resolver
→ locally derived canonical provenance result
+ current TrainingOS human session
+ current TrainingOS OrganizationMembership
+ complete current-self CapabilityCredential source
→ TrainingOS provider-local decision
```

TrainingOS must not deserialize from caller body:

```text
provenanceResult
provenanceVerified
trusted
trustedVerifierRecord
publicKeyPem
privateKeyPem
verifierKey
accessAllowed
```

Until a real provider-internal trusted verifier record is configured and exercised, TrainingOS must not claim LIVE positive cross-domain provider availability.

This PR does not modify TrainingOS.

## Threat model covered in tests

The provenance test matrix locks:

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
12. all provider-access / authority / execution flags remain false;
13. hidden/missing/malformed #140 receipt structure is rejected even after digest recomputation;
14. changing the signed `validUntil` changes `attestationRef` semantic identity.

Dedicated exact-head CI runs the cryptographic focused suite, malformed-receipt structure contract, and attestation semantic-identity contract explicitly before the full AIEXE suite.

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

## Validation requirements

Merge claims must be bound to an immutable pull-request head. The dedicated workflow:

```text
checks out github.event.pull_request.head.sha
asserts git rev-parse HEAD == TARGET_SHA
runs Node syntax
runs 9-case cryptographic provenance matrix
runs 1-case malformed receipt structure contract
runs 1-case attestation semantic identity contract
runs the full AIEXE unit suite
locks correlation-only / no-authority true-flag absence
```

The repository-generic S0 workflow is compatibility evidence but is not used as immutable-head authority because its generic PR checkout may resolve GitHub's merge ref.

No Production action is authorized by a green source test.