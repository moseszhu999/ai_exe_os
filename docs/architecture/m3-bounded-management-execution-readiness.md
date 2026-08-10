# M3 Bounded Management Execution — Readiness Gate

Date: 2026-08-10  
Management-plane owner: PR #125 / `agent/group-management-plane-m0`  
Accepted authorization baseline: A7 merged by PR #139  
Accepted controlled-delegation baseline: S8  
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

M3 starts only after every required gate independently reaches `PASS`. Controller adoption, recurrence evidence, policy eligibility, provider ingestion, an authorization-core `allow`, S8 request construction, source transport acknowledgement, or destination admission never grants execution authority by implication.

---

## G1 — accepted S8 controlled-delegation runtime baseline

Frozen accepted S8 product head:

```text
7fdf410e009ea5a1f25bc03dea3b2e54a83c9d48
```

S8 owns bounded delegation, destination-local admission, destination-local HumanGate, execution binding, result publication, and source receipt consumption. The management plane must compose with these owners rather than recreate them.

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

Latest read-only audit remains the M2.21 snapshot at `2026-08-10T12:03:00Z`:

```text
TrainingOS
  latest canonical attestation   8f0d38dca4dcd28883359c427e133d0c1a9eebb8
  current provider main          ca0491ed5166e8f00b8e96f3f4665963a004c860
  compare                        provider ahead by 1
  current adoption               STALE
  native producer                enabled / hourly minute 0
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
  native producer                enabled / hourly minute 36
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

Current shortest G3 path:

```text
1. TrainingOS emits a fresh canonical structured Controller attestation at current main
2. TradeOS emits a fresh canonical structured Controller attestation at current main
3. every Domain-owned native producer proves the canonical structured producer contract
4. TradeOS has a current enabled Domain-owned producer
5. AIEXE independently revalidates all three provider heads
6. fixed-scope G3 recomputes 3 / 3 current recurring structured producers
```

AIEXE does not fabricate missing Domain sources and does not mutate external scheduler configuration to make this gate pass.

---

## G4 — A2 policy through accepted execution path

### Accepted/proved chain through M2.23

```text
A2 management policy eligibility
-> A5/A6 no-self-authorization boundaries
-> A7 execution.authorization.v1 pure decision core
-> M2.20 exact A2 -> authorization binding
-> M2.21 canonical S8 DelegationRequest construction
-> M2.22 canonical S8 source persistence + bounded transport submission
-> M2.23 destination-local S8 receive + admission observation
-> destination-local HumanGate state = requested when admissible
```

Authority remains separated:

```text
policy eligible != authorization allow
authorization allow != S8 request construction
S8 request constructed != source transport submission
source transport acknowledged != destination admission
destination admission admissible != HumanGate approval
HumanGate requested != HumanGate approved
HumanGate approved != completed execution effect
completed destination effect != source receipt consumption
```

Consequential actions remain outside A2, including merge, deploy, payment/settlement/wallet/token, credential write, policy widening, Domain truth mutation, Production mutation, remote Worker control, and HumanGate decisions.

### M2.21 — authorization allow -> canonical S8 request

```text
src/management/policy/a2-s8-delegation-request-entry.cjs
tests/m2-a2-s8-delegation-request-entry.test.cjs
```

The caller cannot substitute `action`, `target`, `capabilityVersionId`, or arbitrary payload. Those fields are derived from the already-bound A2 + A7 chain.

### M2.22 — canonical S8 request -> single S8 source owner -> bounded transport

```text
src/management/policy/a2-s8-source-submission.cjs
tests/m2-a2-s8-source-submission.test.cjs
schema: aiexe.a2-s8-source-submission.v1
```

M2.22 uses only the accepted S8 source public service surface:

```text
queryDelegationState
createDelegationRequest
pushDelegationRequest
```

It verifies exact source instance, peer binding, source/destination workspaces, request sequence, predecessor digest, persisted request id, and persisted request digest before transport. Exact acknowledged repeat is a no-op; uncertain transport outcome is review-needed with `automaticReplayAllowed = false`.

M2.22 therefore proves authorized management instruction -> canonical S8 source persistence -> bounded S8 transport submission. It does not grant destination authority.

### M2.23 — destination receive + fresh destination-local admission

PR #125 now adds:

```text
src/management/policy/a2-s8-destination-admission.cjs
tests/m2-a2-s8-destination-admission.test.cjs
schema: aiexe.a2-s8-destination-admission.v1
```

M2.23 accepts only:

```text
sourceSubmission
destinationWorkspaceId
canonical s8Service
```

It does not accept caller-supplied peer, policy, grant, capability, provider, resource, scheduling, admission, HumanGate, approval, binding, Worker, or execution answers.

The adapter uses only the existing destination owner methods:

```text
queryDelegationState(destinationWorkspaceId)
pullDelegationInbox({ workspaceId: destinationWorkspaceId })
```

The canonical S8 destination owner itself receives the request, validates the request digest and exact peer scope, and re-reads destination-local authority facts including:

```text
active destination peer binding
active delegation policy
local CapabilityInstallation
local AgentCapabilityGrant
local capability version
local provider snapshot/currentness
local resource availability
local scheduling capacity
pending/accepted delegation counts
```

The resulting canonical admission snapshot is then checked back against the exact M2.22 `delegationRequestDigest`.

If destination-local admission is inadmissible, M2.23 observes the canonical `inadmissible` proposal and reason codes. It creates no HumanGate, acceptance, binding, Mission, Worker submission, or effect.

If destination-local admission is admissible, the accepted S8 owner creates only a destination-local delegation HumanGate request. M2.23 requires the exact state:

```text
proposal.state    = waiting_human
humanGate.state   = requested
```

and still fixes:

```text
destinationHumanGateDecisionCreated = false
delegationCreated = false
destinationExecutionBindingCreated = false
destinationExecutionPerformed = false
executionAuthorized = false
domainWritePerformedByManagementLayer = false
automaticReplayAllowed = false
binding = false
authority = s8-destination-admission-observation-only
```

Thus an admissible management request reaches the destination's canonical HumanGate queue but cannot cross it.

### M2.23 fail-closed behavior

Focused proof covers:

```text
missing destination-local grant
  -> admission inadmissible / local_grant_missing
  -> no HumanGate / binding / effect

tampered transport payload
  -> canonical request digest/schema rejection
  -> no proposal/admission promotion

wrong destination Workspace
  -> no request observation or promotion

exact already-observed request
  -> existing-exact no-pull no-op
  -> no second inbox pull / no second HumanGate

source result not safely acknowledged
  -> zero destination-owner calls

destination pull outcome uncertain
  -> review-needed containment
  -> no HumanGate decision / effect / automatic replay

existing proposal already advanced beyond pending HumanGate
  -> review-needed
  -> management layer does not overwrite destination authority state
```

The management adapter imports no second S8 application/transport/admission owner and has no approval, rejection, local Mission creation, Worker execution, generic network, wallet, settlement, or provider-write primitive.

### M2.23 first code-head validation

```text
PR code head   968e89b93e1fd9575ee613c1acaf710a0e674c20
main            eb22e91d8bca1378fa87bfcf360c8b4a97574f82
PR merge ref    3dfb9618acc385fb8275b23bd3da52e12db04eac
workflow run    31391549005  SUCCESS
job             93464240741  SUCCESS
source syntax   PASS
tests           597 / 597 PASS
M2.23 focused   8 / 8 PASS
provider scan   PASS
```

Workflow checkout identity:

```text
3dfb9618acc385fb8275b23bd3da52e12db04eac
= merge(968e89b93e1fd9575ee613c1acaf710a0e674c20
        into eb22e91d8bca1378fa87bfcf360c8b4a97574f82)
```

This is head-bound **PR merge-ref validation**, not standalone branch-head checkout validation.

The integration proof uses isolated in-memory SQLite and a test delegation exchange. No production or external Domain S8 endpoint is contacted by M2.23 work.

### What still blocks G4

Already proved:

```text
A2 -> A7
-> canonical S8 request
-> canonical S8 source persist/push
-> destination receive
-> destination-local fresh admission
-> destination-local HumanGate requested when admissible
```

Still required:

```text
-> destination-local HumanGate decision by the destination authority owner
-> fresh acceptance snapshot / destination execution binding
-> exactly one explicitly bounded approved effect
-> destination execution receipt bound to exact request/effect
-> source receipt pull
-> explicit source receipt consumption
-> management evidence ingestion bound to the same request/effect
```

Required invariants:

```text
unauthorized effects = 0
management layer cannot manufacture AuthorityGrant
management layer cannot decide destination HumanGate
source authorization cannot bypass destination-local admission
source transport acknowledgement is not execution authority
admission admissible is not approval
request identity binds policy + authorization + capability + target + evidence
receipt identity binds back to the exact accepted request/effect
uncertain transport/effect never auto-replays
```

Until that end-to-end effect-and-receipt path is proven:

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
A2Eligibility != AuthorizationAllow
AuthorizationAllow != S8RequestConstruction
S8RequestConstruction != SourceTransportAck
SourceTransportAck != DestinationAdmission
DestinationAdmission != HumanGateApproval
HumanGateRequested != HumanGateApproved
HumanGateStatus != AIEXEPermissionToDecideIt
DestinationEffect != SourceReceiptConsumption
TransportUncertain != RetryPermission
EffectUncertain != RetryPermission
G3 PASS != G4 PASS
```

## Allowed work before M3

1. continue read-only observation of Domain Controller channels and independent provider heads;
2. ingest later Domain-owned canonical cycles through the existing protocol only;
3. observe producer topology without mutating external scheduler configuration;
4. revalidate currentness on every head movement;
5. continue authorized recurring read-only provider ingestion;
6. keep A7 as the single accepted authorization owner and S8 as the single delegation/transport/destination-authority owner;
7. advance G4 only through destination-owned HumanGate, bounded effect, canonical receipt, and explicit source receipt consumption;
8. keep ambiguous transport/effect outcomes fail-closed with no automatic replay;
9. keep the owner cockpit fail-closed on unknown or stale Domain truth.

## Boundary

```text
second authorization owner = NO
second S8 owner = NO
A2 execution enabled = NO
production/external S8 submission in M2.22/M2.23 work = NO
HumanGate decision by management layer = NO
destination execution effect by management layer = NO
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
