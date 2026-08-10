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

M3 starts only after every required gate independently reaches `PASS`. Controller adoption, recurrence evidence, policy eligibility, provider ingestion, an authorization-core `allow`, or construction of an S8 request never grants execution authority by implication.

---

## G1 — accepted S8 controlled-delegation runtime baseline

Frozen accepted S8 product head:

```text
7fdf410e009ea5a1f25bc03dea3b2e54a83c9d48
```

S8 proves bounded delegation and destination-local authority. It does not turn a management proposal or source-side authorization result into destination execution authority.

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

### Canonical truth rule

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

A new read-only audit at `2026-08-10T12:03:00Z` re-fetched the latest canonical Controller sources, current provider heads, and native producer topology.

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

The current `1 / 3` result is not a regression in truth quality. It is evidence that the management plane stops carrying a department report forward once the department repository changes.

### Current shortest G3 path

```text
1. TrainingOS emits a fresh canonical structured Controller attestation at current main
2. TradeOS emits a fresh canonical structured Controller attestation at current main
3. every Domain-owned native producer proves the canonical structured producer contract
4. TradeOS has a current enabled Domain-owned producer
5. AIEXE independently revalidates all three provider heads
6. fixed-scope G3 recomputes 3 / 3 current recurring structured producers
```

Video no longer needs another source cycle solely to prove two-cycle source recurrence. Its remaining G3 blocker is producer-contract proof.

AIEXE does not fabricate the missing Domain sources and does not mutate external scheduler configuration to make this gate pass.

---

## G4 — A2 policy through accepted execution path

### Authority chain already accepted

The chain now has four independently bounded source-side stages:

```text
A2 management policy eligibility                  accepted
A5/A6 no-self-authorization entry boundaries      accepted
A7 execution.authorization.v1 pure decision core  accepted on main
M2.20 A2 -> A7 composition                         proved in PR #125
```

A2 still separates policy eligibility from execution:

```text
policy eligible != authorization allow
authorization allow != S8 request submission
S8 request constructed != destination admission
destination admission != HumanGate approval
HumanGate approval != completed execution effect
```

Consequential actions remain outside A2, including merge, deploy, payment/settlement/wallet/token, credential write, policy widening, Domain truth mutation, Production mutation, remote Worker control, and HumanGate decisions.

### M2.21 — authorization allow -> canonical S8 DelegationRequest construction

PR #125 now adds:

```text
src/management/policy/a2-s8-delegation-request-entry.cjs
tests/m2-a2-s8-delegation-request-entry.test.cjs
```

Schema:

```text
aiexe.a2-s8-delegation-request-entry.v1
```

The M2.21 adapter consumes the M2.20 A2-to-authorization entry and the accepted S8 `createDelegationRequest()` constructor. It creates a canonical `DelegationRequest` only when:

```text
A2 entry is mechanically eligible
AND
execution.authorization.v1 decision == allow
AND
canonical capabilityRef is present
```

The caller may provide only the bounded S8 envelope identity fields. The caller cannot override:

```text
action
target
capabilityVersionId
payload
```

Those values are derived from the already-bound management authorization chain:

```text
action              <- A2 actionType
target              <- authorization targetRef
capabilityVersionId <- A2 canonical capabilityRef
payloadClass         <- fixed management-authorization
payload              <- action / eligibility / authorization / policy / evidence / work-approval refs
```

This prevents a source-side caller from obtaining authorization for one management action and smuggling a different S8 action, target, capability, or arbitrary payload into the request.

### M2.21 remains construction-only

Even after a canonical S8 request has been successfully constructed, the result mechanically remains:

```text
delegationRequestConstructed = true
delegationCreated = false
s8InvocationPerformed = false
transportSubmissionPerformed = false
destinationAdmissionPerformed = false
destinationHumanGateDecisionCreated = false
destinationExecutionPerformed = false
executionAuthorized = false
domainWritePerformed = false
binding = false
authority = s8-request-construction-proof-only
```

If authorization returns `needs_human_review`, `deny`, `unknown`, or the M2.20 binding is invalid, no S8 request is constructed.

The bridge imports no S8 transport/application module and contains no generic network, process, wallet, settlement, provider-write, or execution primitive.

### M2.21 first code-head validation

The first complete code slice was validated on the current main that already contains A7 and later group-fabric work:

```text
PR code head   2601292b7a10f8678a9ad3fc76d73ec5e5aacff6
main            eb22e91d8bca1378fa87bfcf360c8b4a97574f82
PR merge ref    e564632394ef6aea42f9e34f69d7febd0cdd4c87
workflow run    31386577130  SUCCESS
job             93448235740  SUCCESS
source syntax   PASS
tests           580 / 580 PASS
M2.21 focused   7 / 7 PASS
provider scan   PASS
```

This is head-bound **PR merge-ref validation**, not standalone branch-head checkout validation.

### What still blocks G4

M2.21 closes the source-side gap through canonical S8 request construction. It deliberately does not submit that request.

The shortest remaining G4 proof is now:

```text
already-proved source chain
A2 -> A7 -> canonical S8 DelegationRequest

still required
-> bounded S8 transport submission
-> destination-local admission + fresh authority/policy/capability/resource revalidation
-> destination-local HumanGate when required
-> exactly one explicitly bounded approved effect
-> destination execution receipt
-> source receipt consumption / management evidence ingestion
```

Required invariants:

```text
unauthorized effects = 0
management layer cannot manufacture AuthorityGrant
management layer cannot make HumanGate decision
source authorization cannot bypass destination-local admission
request identity must bind policy + authorization + capability + target + evidence
receipt identity must bind back to the exact accepted request/effect
uncertain effect must never auto-replay
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
AuthorizationAllow != S8 request submission
S8 request construction != destination admission
DestinationAdmission != HumanGate approval
HumanGate status != AIEXE permission to decide it
AuthorizationDecision != execution effect
G3 PASS != G4 PASS
```

## Allowed work before M3

1. continue read-only observation of Domain Controller channels and independent provider heads;
2. ingest later Domain-owned canonical cycles through the existing protocol only;
3. observe producer topology without mutating external scheduler configuration;
4. revalidate currentness on every head movement;
5. continue authorized recurring read-only provider ingestion;
6. keep A7 as the single accepted authorization owner and S8 as the single delegation owner;
7. advance G4 only by composing the already-proved canonical S8 request into destination-local authority while preserving HumanGate and exact-effect boundaries;
8. keep the owner cockpit fail-closed on unknown or stale Domain truth.

## Boundary

```text
second authorization owner = NO
second S8 owner = NO
A2 execution enabled = NO
S8 transport submission by M2.21 = NO
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
HumanGate decision = NO
```
