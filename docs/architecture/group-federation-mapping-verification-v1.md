# Group Federation Mapping Verification v1

## Purpose

This contract closes the product-neutral mapping-verification gap tracked by issue #137 without turning AIEXE into a login, membership, credential, authorization, or Domain-truth authority.

The verifier accepts the already-merged federation link contracts from #134 plus exact Domain-owned privacy-safe refs and emits a deterministic **correlation-only** verification receipt.

```text
immutable group.subject-link.v1
+ immutable group.organization-link.v1
+ fresh group.federation-link.status.v1 projections
+ optional group.role-context-link.v1
+ exact Domain-owned subject/org[/role] refs
+ explicit evidence + fixed verification policy
→ group.federation-mapping-verification.receipt.v1
```

A verified receipt means only that the supplied opaque Domain refs correspond exactly to the current federation contract evidence. It does not grant cross-domain access and cannot replace the provider's own Domain-local authorization.

## Owner boundary

This slice is intentionally separate from Draft PR #125 Group Management Plane work.

- #125 owns management-plane observation/proposal/readiness paths under `src/management/portfolio`.
- This verifier owns a new `src/group-fabric/federation-mapping-verifier.cjs` contract only.
- TrainingOS remains owner of TrainingOS auth, Organization/Membership, CapabilityCredential, and provider authorization truth.
- TradeOS remains owner of TradeOS account/organization/membership/role/provider authorization truth.
- AIEXE hosts the product-neutral correlation contract but creates no third writable identity store.

## Schemas

```text
group.federation-mapping-verification.request.v1
group.federation-mapping-verification.receipt.v1
```

The first-slice policy is fixed to:

```text
group:federation-verification-policy:explicit-domain-pair-v1
```

Status freshness is fixed to 300 seconds. A valid-but-older status is `unknown`, never silently accepted.

## Request invariants

The verifier requires exactly two distinct federation domains in v1.

For each domain the request supplies exact privacy-safe refs:

```text
domain
subjectRef
organizationRef
roleRef?        # only when role-context verification is requested
```

It also supplies:

- the immutable subject link and its projected status;
- the immutable organization link and its projected status;
- lifecycle events used to reconstruct those statuses;
- an optional immutable role-context link;
- one fixed verification policy ref;
- one or more evidence refs;
- a UTC verification observation time.

The caller cannot supply an authorization answer, membership assertion, role-equivalence assertion, CapabilityCredential, AuthorityGrant, HumanGate result, execution approval, or external-action instruction.

## Integrity and freshness

The verifier independently reconstructs subject and organization status from the supplied immutable link plus lifecycle event set. A tampered status is rejected as invalid input.

The request digest and receipt bind:

- subject link ref + digest;
- subject status digest;
- exact subject lifecycle-event digest;
- organization link ref + digest;
- organization status digest;
- exact organization lifecycle-event digest;
- optional role-context ref + digest;
- normalized exact Domain bindings;
- policy ref;
- evidence refs;
- observation time;
- fixed 300-second freshness rule.

This prevents two different lifecycle evidence sets from collapsing into the same auditable receipt merely because they project to the same status code.

## Decision semantics

```text
verified
  exact Domain pair
  exact subject refs
  exact organization refs
  optional role refs exactly match role context
  subject status valid + fresh
  organization status valid + fresh

denied
  cross-subject mismatch
  cross-organization mismatch
  Domain-pair mismatch
  role-context mismatch
  expired link
  revoked link

unknown
  status before validity window
  otherwise valid status older than 300 seconds
```

Malformed, tampered, PII-shaped, and secret-shaped inputs are rejected before a receipt is created.

`denied` takes precedence over `unknown`, but the receipt preserves all detected denial and unknown reason codes so stale evidence is not hidden by a simultaneous hard mismatch.

## Privacy

Opaque references reject email-like PII and bearer/password/token/API-key/cookie/session/JWT-shaped material. The receipt contains only privacy-safe refs and digests; no raw email, phone, JWT, cookie, session, secret, learner payload, trade payload, assessment answer, teacher note, or raw score is accepted.

## Fixed truth boundary

Every receipt fixes:

```text
mappingVerificationReceipt=true
correlationOnly=true
loginCredential=false
sessionCreated=false
membershipCreated=false
organizationMembershipInferred=false
roleEquivalenceAsserted=false
capabilityCredentialCreated=false
authorityGrantCreated=false
authorizationDecisionCreated=false
humanGateDecisionCreated=false
delegationCreated=false
executionAuthorized=false
crossDomainAccessGranted=false
domainWritePerformed=false
externalActionPerformed=false
```

Therefore:

```text
verified mapping != login/session
verified organization mapping != membership
verified role context != role equivalence
verified mapping != CapabilityCredential
verified mapping != AuthorityGrant
verified mapping != provider authorization
verified mapping != HumanGate/delegation/execution authorization
verified mapping != cross-domain access grant
```

## Provider use

A Domain provider may consume a `verified` receipt only as an input to correlation. The provider still must independently authenticate its local actor and evaluate its own Organization/Membership/credential/freshness/policy rules.

For TrainingOS #680 specifically, a future bounded provider may combine:

```text
verified federation mapping receipt
+ authenticated TrainingOS current actor
+ TrainingOS current Organization/Membership truth
+ TrainingOS current-self CapabilityCredential read
+ provider-local policy
→ provider-local access decision
```

The mapping receipt itself must never flip `accessDecision=allowed`.

## First-slice acceptance coverage

`tests/group-federation-mapping-verifier.test.cjs` covers:

1. valid fresh TrainingOS↔TradeOS subject + organization + role-context mapping;
2. deterministic digest independent of binding input order;
3. cross-subject denial;
4. cross-organization denial;
5. stale valid status → unknown;
6. expired link denial;
7. revoked link denial;
8. before-window status → unknown;
9. role-context mismatch denial;
10. role-bound request without role context denial;
11. email/secret-shaped ref rejection;
12. tampered status rejection;
13. subject/organization Domain-pair mismatch denial;
14. exact lifecycle evidence set changes the receipt digest even when projected status is unchanged;
15. all authority/access/execution/external-action flags remain false.

## Release boundary

```text
Database/API/UI/SSO = NO
Domain write = NO
Domain membership write = NO
Credential issuance = NO
AuthorityGrant = NO
HumanGate = NO
Delegation/execution = NO
Cross-domain data access = NO
Production mutation/deploy = NO
Payment/settlement/wallet/token = NO
```
