# M3 Bounded Management Execution — Readiness Gate

Date: 2026-08-10  
Management-plane owner: PR #125 / `agent/group-management-plane-m0`  
Accepted authorization baseline: A7 merged by PR #139  
Authority: observe-and-propose

## Current verdict

```text
G1 final S8-F controlled-delegation runtime acceptance   PASS
G2 broader real replay / evaluation                      PASS
G3 recurring real structured Controller attestations     PARTIAL
G4 A2 policy through accepted execution path              PARTIAL
G5 recurring provider-backed read-only ingestion          PASS

M3 = BLOCKED on G3 + G4
A2 execution = UNAUTHORIZED
```

M3 starts only after every required gate independently reaches `PASS`. Controller adoption, recurrence evidence, policy eligibility, provider ingestion, an authorization-core `allow`, S8 request construction, or source-side transport acknowledgement never grants destination execution authority by implication.

---

## G1 — accepted S8 controlled-delegation runtime baseline

Frozen accepted S8 product head:

```text
7fdf410e009ea5a1f25bc03dea3b2e54a83c9d48
```

S8 proves bounded delegation and destination-local authority. Source-side management authorization cannot replace destination-local admission, HumanGate, or effect control.

```text
G1 = PASS
```

---

## G2 — broader real replay / evaluation

Accepted evidence remains:

```text
historical project-level real replay     6 labelled cases
real workstream replay                    3 project scenarios
M2.12 real transition replay             10 cases
SIMULATED adversarial replay              11 cases
```

The M2.12 transition replay remains exact with zero false escalations and zero missed escalations. Simulated cases are not counted as real operating history.

```text
G2 = PASS
```

---

## G3 — recurring real structured Controller attestations

External Domain truth is accepted only through a structured Domain-owned source revalidated against an independently observed current provider head.

```text
Controller source
-> canonical marked attestation
-> exact repository binding
-> independent provider-head revalidation
-> current structured adoption
-> native producer topology
-> structured producer contract
-> canonical recurrence proof
-> fixed three-Domain G3 gate
```

A previously accepted attestation becomes stale when its repository main moves. Historical recurrence remains evidence of history; it is not current Domain truth.

### M2.21 live revalidation snapshot

Read-only audit at `2026-08-10T12:03:00Z`:

```text
TrainingOS
  latest canonical attestation   8f0d38dca4dcd28883359c427e133d0c1a9eebb8
  current provider main          ca0491ed5166e8f00b8e96f3f4665963a004c860
  compare                        provider ahead by 1
  current adoption               STALE
  native producer                enabled
  observed schedule              hourly / minute 0
  structured producer contract   not proved

TradeOS
  latest canonical attestation   6958c3b5fb3a8d8b6b70b7a614910b0e1ea9202b
  current provider main          934b4c76cdf523a9337892860bb1c0e0b8b4467d
  compare                        provider ahead by 21
  current adoption               STALE
  native producer                disabled
  structured producer contract   not proved

Video / Shared Media
  latest canonical attestation   23d92ffc4674f1581c4191e595d279a20008be53
  current provider main          23d92ffc4674f1581c4191e595d279a20008be53
  compare                        identical
  current adoption               CURRENT
  independent canonical cycles   2
  native producer                enabled
  observed schedule              hourly / minute 36
  structured producer contract   not proved
```

Canonical local evidence:

```text
fixtures/management/m2-21-current-domain-producer-revalidation-2026-08-10.json
tests/m2-21-current-domain-producer-revalidation.test.cjs
src/management/portfolio/controller-adoption-readiness.cjs
```

Current fixed-scope result:

```text
required Domains                       3
current structured adoption            1 / 3
stale structured attestations          2 / 3
enabled native producers               2 / 3
disabled native producers              1 / 3
structured producer contracts proved   0 / 3
out-of-band persistence observed       3 / 3
current recurring structured producer  0 / 3

G3 = PARTIAL
```

The current `1 / 3` result is a truth-quality property: AIEXE stops carrying a Domain report forward when that Domain's repository moves.

### Current shortest G3 path

```text
1. TrainingOS emits a fresh canonical structured Controller attestation at current main
2. TradeOS emits a fresh canonical structured Controller attestation at current main
3. every Domain-owned native producer proves the canonical structured producer contract
4. TradeOS has a current enabled Domain-owned producer
5. AIEXE independently revalidates all three provider heads
6. fixed-scope G3 recomputes 3 / 3 current recurring structured producers
```

Video already has two accepted source cycles; its remaining G3 blocker is producer-contract proof. AIEXE does not fabricate missing Domain sources and does not mutate external scheduler configuration to make this gate pass.

---

## G4 — A2 policy through accepted execution path

### Accepted source chain through M2.22

The source side now composes through the single accepted authorization and S8 owners:

```text
A2 management policy eligibility
-> A5/A6 no-self-authorization boundaries
-> A7 execution.authorization.v1 pure decision core
-> M2.20 exact A2 -> authorization binding
-> M2.21 canonical S8 DelegationRequest construction
-> M2.22 canonical S8 source persistence + bounded transport submission
```

Still-separated authority states:

```text
policy eligible != authorization allow
authorization allow != S8 request construction
S8 request constructed != source transport submission
source transport acknowledged != destination admission
destination admission != HumanGate approval
HumanGate approval != completed execution effect
```

Consequential actions remain outside A2, including merge, deploy, payment/settlement/wallet/token, credential write, policy widening, Domain truth mutation, Production mutation, remote Worker control, and HumanGate decisions.

### M2.21 — authorization allow -> canonical S8 request

Evidence:

```text
src/management/policy/a2-s8-delegation-request-entry.cjs
tests/m2-a2-s8-delegation-request-entry.test.cjs
```

M2.21 prevents the caller from substituting `action`, `target`, `capabilityVersionId`, or arbitrary `payload`. Those values are derived from the already-bound A2 + A7 chain.

### M2.22 — canonical S8 request -> single S8 source owner -> bounded transport

PR #125 now adds:

```text
src/management/policy/a2-s8-source-submission.cjs
tests/m2-a2-s8-source-submission.test.cjs
```

Schema:

```text
aiexe.a2-s8-source-submission.v1
```

M2.22 does not import or recreate S8 transport/application ownership. It receives the canonical S8 service and uses only the accepted public source-side methods:

```text
queryDelegationState(workspaceId)
createDelegationRequest(...)
pushDelegationRequest(...)
```

Before local persistence or network submission, M2.22 verifies current S8 source state:

```text
source workspace exists
configured S8 endpoint exists
local source instance matches request
active exact peer binding matches source/destination/workspaces
request id has no conflicting persisted digest
requestSequence is the exact next sequence
previousRequestDigest equals the exact current predecessor digest
```

It then asks the canonical S8 owner to persist the request and verifies:

```text
persisted request id == M2.21 canonical request id
persisted requestDigest == M2.21 canonical requestDigest
```

Only after that exact digest check does it call the canonical S8 owner's `pushDelegationRequest()`.

### Exact-once / uncertainty containment

M2.22 explicitly refuses source-side automatic replay:

```text
exact request already acknowledged
  -> no-op; zero second transport submission

exact request exists but is not safely acknowledged
  -> review-needed no-op; zero automatic replay

transport throws / outcome uncertain
  -> transport_submission_outcome_uncertain
  -> automaticReplayAllowed = false
  -> later exact repeat does not POST again
```

This prevents an ambiguous source transport failure from creating a duplicate downstream effect by blind retry.

### What M2.22 proves — and what it does not

The passing integration test uses the real `S8ApplicationService` and in-memory SQLite with an isolated test `SourceExchange`. It proves composition into the accepted S8 source owner without making a production or external Domain network request.

After successful source acknowledgement:

```text
s8OwnerPreflightPerformed = true
s8OwnerPreflightPassed = true
s8RequestPersistencePerformed = true
s8InvocationPerformed = true
transportSubmissionAttempted = true
transportSubmissionObserved = true
transportSubmissionPerformed = true
sourceSubmissionAccepted = true

automaticReplayAllowed = false
delegationCreated = false
destinationAdmissionPerformed = false
destinationHumanGateDecisionCreated = false
destinationExecutionPerformed = false
executionAuthorized = false
domainWritePerformed = false
binding = false
authority = s8-source-submission-proof-only
```

Therefore M2.22 proves **authorized management instruction -> canonical S8 source persistence -> bounded S8 transport submission**, not destination authority or execution.

### M2.22 first code-head validation

```text
PR code head   8704ac91e45e88851eb3d5b052cba9a4c1a26989
main            eb22e91d8bca1378fa87bfcf360c8b4a97574f82
PR merge ref    c28ec9822e771b84783a4c0ec118f7b3bf0b1711
workflow run    31388088047  SUCCESS
job             93453047972  SUCCESS
source syntax   PASS
tests           589 / 589 PASS
M2.22 focused   8 / 8 PASS
provider scan   PASS
```

The workflow checked out:

```text
c28ec9822e771b84783a4c0ec118f7b3bf0b1711
= merge(8704ac91e45e88851eb3d5b052cba9a4c1a26989
        into eb22e91d8bca1378fa87bfcf360c8b4a97574f82)
```

This is head-bound **PR merge-ref validation**, not standalone branch-head checkout validation.

### What still blocks G4

The remaining G4 proof is now destination-side and receipt-side:

```text
already proved
A2 -> A7 -> canonical S8 request -> canonical S8 source persist/push

still required
-> destination-local pull / receive
-> destination-local admission + fresh authority/policy/capability/resource revalidation
-> destination-local HumanGate when required
-> exactly one explicitly bounded approved effect
-> destination execution receipt
-> source receipt pull + explicit receipt consumption
-> management evidence ingestion bound to the same request/effect
```

Required invariants:

```text
unauthorized effects = 0
management layer cannot manufacture AuthorityGrant
management layer cannot make HumanGate decision
source authorization cannot bypass destination-local admission
source transport acknowledgement is not execution authority
request identity binds policy + authorization + capability + target + evidence
receipt identity binds back to the exact accepted request/effect
uncertain source transport outcome never auto-replays
uncertain destination effect never auto-replays
```

Until that end-to-end path is proven:

```text
G4 = PARTIAL / BLOCKED FOR M3
A2 execution = UNAUTHORIZED
```

---

## G5 — recurring provider-backed read-only ingestion

The existing native AIEXE hourly scheduler remains the single AIEXE ingestion scheduler. Distinct spaced successful scheduled captures already established recurring read-only provider ingestion.

```text
G5 = PASS
```

---

## M3 entry package

```text
G1  PASS
G2  PASS
G3  PARTIAL
G4  PARTIAL
G5  PASS

M3                  BLOCKED
managementAuthority observe-and-propose
A2 execution         blocked
```

## Authority principles

```text
GitHubActivity != DomainStatus
HistoricalAttestation != CurrentExactHeadTruth
AttestedHead != IndependentProviderHead
HistoricalRecurrence != CurrentProducerReadiness
SchedulerEnabled != StructuredProducerContract
PersistenceObserved != StructuredProducerContract
ManagementProposal != ExecutionAuthority
A2 eligibility != execution.authorization.v1 allow
AuthorizationAllow != S8 request construction
S8 request construction != source transport acknowledgement
SourceTransportAck != DestinationAdmission
DestinationAdmission != HumanGate approval
HumanGate status != AIEXE permission to decide it
AuthorizationDecision != execution effect
TransportUncertain != RetryPermission
G3 PASS != G4 PASS
```

## Allowed work before M3

1. continue read-only observation of Domain Controller channels and independent provider heads;
2. ingest later Domain-owned canonical cycles through the existing protocol only;
3. observe producer topology without mutating external scheduler configuration;
4. revalidate currentness on every head movement;
5. continue authorized recurring read-only provider ingestion;
6. keep A7 as the single accepted authorization owner and S8 as the single delegation/transport owner;
7. advance G4 only through destination-local S8 admission, HumanGate, bounded effect, and canonical receipts;
8. keep ambiguous transport/effect outcomes fail-closed with no automatic replay;
9. keep the owner cockpit fail-closed on unknown or stale Domain truth.

## Boundary

```text
second authorization owner = NO
second S8 owner = NO
A2 execution enabled = NO
production/external S8 submission in M2.22 work = NO
destination admission performed by management layer = NO
HumanGate decision by management layer = NO
external Domain repository mutation = NO
external Domain scheduler mutation = NO
LLM prose-to-truth extraction = NO
cross-repository credentials added = NO
Domain writes = NO
Merge PR #125 = NO while gated
Deploy = NO
Production mutation = NO
Payment / settlement / wallet / token action = NO
remote Worker control = NO
```
