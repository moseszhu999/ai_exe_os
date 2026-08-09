# Group Identity Federation Links v1

Status: bounded P0 product-neutral contract core.

Refs: #133, Group Work Entry control plan, AIEXE management-plane #125.

## Decision

The group does **not** create a third writable identity, organization, membership or role authority.

Current canonical ownership remains:

```text
TradeOS
→ Neon Auth / neon_auth account, organization, membership and role context
→ TradeOS business authorization composes managed actor + explicit target organization + canonical membership role

TrainingOS
→ TrainingOS Supabase Auth user + profile + class / membership / enterprise / class-operations access projections
→ TrainingOS decides its own authorized perspectives and class scope

AIEXE
→ observe-and-propose group management plane
→ Domain truth remains external-source-of-truth
```

The group layer owns only bounded **mapping receipts** that can say two Domain-owned references have been explicitly verified as referring to one group subject or organization for stated purposes.

## Contracts

```text
group.subject-link.v1
group.organization-link.v1
group.role-context-link.v1
group.federation-link.status.v1
```

### Subject link

```text
group:subject:* opaque group reference
+ exactly two distinct Domain-owned subject refs
+ verification receipt/policy refs
+ evidence refs
+ purpose codes
+ validity window
→ immutable mapping receipt
```

### Organization link

Same structure, but links two Domain-owned organization refs to one opaque `group:organization:*` reference.

An organization link never implies membership in either Domain.

### Role context link

A role-context link binds **observed role facts** from domains already covered by both an accepted subject link and organization link.

It does not say `TrainingOS teacher == TradeOS reviewer`; it only records that the same explicitly linked group subject had those separate Domain-owned role observations in the linked organization context.

## Fixed anti-collapse rules

```text
identity link != login credential
identity link != login session
organization link != membership
role context != role equivalence
role != CapabilityCredential
role != AuthorityGrant
CapabilityCredential != AuthorityGrant
mapping receipt != cross-domain data access
mapping receipt != execution authorization
```

Subject/organization links hard-fix:

```text
mappingReceipt=true
loginCredential=false
sessionCreated=false
membershipCreated=false
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

Role-context links additionally hard-fix:

```text
roleContextOnly=true
roleEquivalenceAsserted=false
organizationMembershipInferred=false
```

## Privacy and credential boundary

Federation refs reject email-like PII and secret/session-shaped values such as passwords, bearer material, cookies, API keys and raw session identifiers.

The contract deliberately carries only opaque refs and evidence/provenance refs. It does not contain:

- email;
- phone;
- password;
- bearer token;
- cookie;
- session token;
- OAuth authorization code;
- raw JWT;
- database credentials;
- private learner or trade payloads.

## Verification and status

A link requires:

```text
verificationReceiptRef
evidenceRefs[]
verificationPolicyRef
verifiedAt
validFrom
validUntil
```

The v1 status projection is:

```text
before validFrom → unknown
inside validity window → valid
at/after validUntil → expired
accepted revocation effective before observation → revoked
```

A valid link still grants no access. A consumer must separately obtain current Domain authorization for the requested action/data.

## Why AIEXE hosts the first package

AIEXE is currently the group-level platform repository and already owns the observe/propose Group Management Plane. Hosting this product-neutral contract there avoids creating a fifth repository.

This code placement does **not** make AIEXE an authentication provider or Domain identity authority. If a dedicated Group Shared Platform Fabric package is later justified, movement must be explicit and preserve the same ownership boundaries.

## Intended adoption sequence

```text
Domain-owned authenticated context
→ Domain emits privacy-safe identity/organization refs + current evidence
→ explicit mapping verification process (future owner, not implemented here)
→ group subject / organization link
→ optional role-context observation
→ Work Entry may correlate items under one user-facing context
→ each data/action request still passes the source Domain's own authorization
```

## First-slice boundaries

Implemented now:

- deterministic pure contract creation;
- exact-field validation;
- two-domain v1 mapping;
- SHA-256 digests;
- link validity/revocation status projection;
- bounded role-context linking;
- privacy/secret-shaped ref rejection;
- negative tests for false role/authority/access inference.

Not implemented:

- database persistence;
- SSO;
- OAuth exchange;
- JWT minting;
- account merge;
- email matching;
- automatic mapping discovery;
- Domain adapters;
- cross-OS data access;
- AuthorityGrant;
- HumanGate decision;
- Agent delegation/execution;
- Production mutation;
- payment, settlement, wallet or token action.
