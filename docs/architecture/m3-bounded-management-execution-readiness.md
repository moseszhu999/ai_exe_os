# M3 Bounded Management Execution — Readiness Gate

Date: 2026-08-11  
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

M3 starts only after every required gate independently reaches `PASS`. Controller adoption, recurrence evidence, policy eligibility, authorization-core `allow`, S8 request construction, source transport acknowledgement, destination admission, delegation HumanGate approval, a destination execution-binding identity, or an action HumanGate request never grants effect authority by implication.

---

## G1 — accepted S8 controlled-delegation runtime baseline

Frozen accepted S8 product head:

```text
7fdf410e009ea5a1f25bc03dea3b2e54a83c9d48
```

S8 remains the unique owner of bounded delegation, destination-local admission, destination-local HumanGate, execution binding, result publication, and source receipt consumption. The management plane composes with those owners and does not recreate them.

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

Latest read-only evidence remains fail-closed:

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

Last confirmed provider heads in the bounded audit:

```text
TrainingOS          ca0491ed5166e8f00b8e96f3f4665963a004c860  adoption STALE
TradeOS             934b4c76cdf523a9337892860bb1c0e0b8b4467d  adoption STALE / producer disabled
Video/Shared Media  23d92ffc4674f1581c4191e595d279a20008be53  adoption CURRENT
```

Canonical evidence:

```text
fixtures/management/m2-21-current-domain-producer-revalidation-2026-08-10.json
tests/m2-21-current-domain-producer-revalidation.test.cjs
src/management/portfolio/controller-adoption-readiness.cjs
```

AIEXE does not fabricate missing Domain sources, reduce the fixed three-Domain denominator, reuse an attested head as independent provider truth, or mutate external scheduler configuration to make G3 pass.

---

## G4 — A2 policy through accepted execution path

### Accepted/proved chain through M2.25

```text
A2 management policy eligibility
-> A5/A6 no-self-authorization boundaries
-> A7 execution.authorization.v1 pure decision core
-> M2.20 exact A2 -> authorization binding
-> M2.21 canonical S8 DelegationRequest construction
-> M2.22 canonical S8 source persistence + bounded transport submission
-> M2.23 destination receive + fresh destination-local admission + pending delegation HumanGate
-> M2.24 destination-owned delegation decision + fresh acceptance + exact local execution-binding observation
-> M2.25 exact local MissionRun / StepAttempt / ExecutionRun / action-HumanGate readiness observation
```

The management plane does not own the destination decision surfaces used between these observation slices. In particular, the destination S8 owner may independently approve or reject the delegation proposal, and the local S1/S2 execution owner may later independently decide the downstream action HumanGate. AIEXE observes those canonical states; it does not decide them.

### Authority separation

```text
policy eligible != authorization allow
authorization allow != S8 request construction
S8 request constructed != source transport submission
source transport acknowledged != destination admission
destination admission admissible != delegation HumanGate approval
delegation HumanGate approved != local execution binding
local ExecutionRun identity != action readiness
action HumanGate requested != action HumanGate approved
action HumanGate approved != bounded effect completion
completed destination effect != destination receipt publication
destination receipt published != source receipt consumption
source receipt consumed != management evidence ingestion
```

Consequential actions remain outside A2, including merge, deploy, payment/settlement/wallet/token, credential write, policy widening, Domain truth mutation, Production mutation, remote Worker control, and HumanGate decisions.

### M2.22 — source persistence and bounded transport

```text
src/management/policy/a2-s8-source-submission.cjs
tests/m2-a2-s8-source-submission.test.cjs
schema: aiexe.a2-s8-source-submission.v1
```

Uses only accepted S8 source-owner APIs and verifies exact source instance, peer binding, source/destination Workspaces, request sequence, predecessor digest, persisted request id, and persisted request digest. Exact acknowledged repeats are no-op; uncertain transport does not auto-replay.

### M2.23 — destination receive + fresh admission

```text
src/management/policy/a2-s8-destination-admission.cjs
tests/m2-a2-s8-destination-admission.test.cjs
schema: aiexe.a2-s8-destination-admission.v1
```

Uses existing destination-owner receive/admission APIs. Destination-local peer, policy, capability installation/grant, provider, resource, scheduling and admission facts remain destination-owned. If admissible, M2.23 stops at:

```text
proposal.state   = waiting_human
humanGate.state  = requested
```

Management performs no approval, binding creation, Mission creation, Worker submission, or effect.

### M2.24 — destination-owned delegation decision + binding observation

```text
src/management/policy/a2-s8-destination-binding.cjs
tests/m2-a2-s8-destination-binding.test.cjs
schema: aiexe.a2-s8-destination-binding.v1
```

M2.24 only reads the existing S8 destination state through `queryDelegationState`. It contains no call to destination approval/rejection, HumanGate decision, Worker submission, or effect method.

The isolated proof intentionally makes the delegation decision through the destination owner itself. AIEXE then verifies:

```text
fresh destination admission snapshot
exact delegation HumanGate decision
exact acceptance
exact destination execution binding
exact local Mission / PlanStep / StepAttempt / ExecutionRun identities
```

A real important boundary emerged from the accepted S8 implementation:

```text
local ExecutionRun identity MAY exist after destination binding
local ExecutionRun identity DOES NOT prove action readiness
local ExecutionRun identity DOES NOT prove action HumanGate approval
local ExecutionRun identity DOES NOT prove effect execution
```

M2.24 management output remains non-binding and execution-unauthorized.

### M2.25 — downstream action-readiness / action-HumanGate observation

PR #125 adds:

```text
src/management/policy/a2-s8-destination-action-readiness.cjs
tests/m2-a2-s8-destination-action-readiness.test.cjs
schema: aiexe.a2-s8-destination-action-readiness.v1
```

M2.25 accepts only:

```text
destinationBinding
destinationWorkspaceId
canonical s8Service
```

and reads only:

```text
queryDelegationState(destinationWorkspaceId)
queryMissionState(destinationWorkspaceId)
```

It verifies the M2.24 binding against the exact canonical destination identities before interpreting local action readiness:

```text
delegation request
proposal
delegation HumanGate
acceptance
execution binding
local Mission
local MissionRun
local PlanStep
local StepAttempt
local ExecutionRun
local Task
action-level HumanGate, when present
```

M2.25 mechanically separates these states:

```text
not_created
  local action ExecutionRun does not yet exist

blocked
  local action is blocked before action HumanGate
  destination blockers are preserved and cross-checked

waiting_human
  exact downstream action HumanGate exists with state=requested
  management does not decide it

rejected
  destination-owned action HumanGate rejection is observed as terminal no-effect evidence

advanced
  action HumanGate approved, execution active/result/completed, or recovery/effect territory
  M2.25 FAILS CLOSED because that state belongs to a later effect/receipt slice

review_needed
  identity ambiguity, drift, inconsistent cardinality, or unrecognized state
```

M2.25 fixes all management authority outputs to:

```text
destinationDelegationHumanGateDecisionCreatedByManagementLayer = false
destinationActionHumanGateDecisionCreatedByManagementLayer = false
destinationExecutionPerformedByManagementLayer = false
managementEffectInvocationPerformed = false
destinationReceiptObserved = false
automaticReplayAllowed = false
executionAuthorized = false
domainWritePerformedByManagementLayer = false
binding = false
authority = s8-destination-action-readiness-observation-only
```

It accepts no caller-supplied HumanGate decision, effect approval, execution result, or receipt answer.

### M2.25 code-head validation

```text
PR code head   3e308f84d60f7435218e26011cfdee63d9fc8c50
main           eb22e91d8bca1378fa87bfcf360c8b4a97574f82
PR merge ref   fcbfe8500661389633b3bdde60cc44d806fe9370
workflow run   31424188464  SUCCESS
job            93571873819  SUCCESS
source syntax  PASS
tests          613 / 613 PASS
M2.25 focused  8 / 8 PASS
provider scan  PASS
```

Workflow checkout identity:

```text
fcbfe8500661389633b3bdde60cc44d806fe9370
= merge(3e308f84d60f7435218e26011cfdee63d9fc8c50
        into eb22e91d8bca1378fa87bfcf360c8b4a97574f82)
```

This is head-bound PR merge-ref validation. The proof uses isolated in-memory SQLite and a project-owned test exchange. It performs zero production/external Domain effect.

### Newly explicit action-translation boundary

Inspection of the accepted local runtime path shows that a management-level A2 action name and a low-level runtime capability action are not interchangeable by naming convention.

For example, the current project-owned S0 browser runtime adapter accepts a bounded runtime action such as:

```text
submit_payload
```

whereas an A2 management action may be:

```text
run_approved_test_profile
```

Therefore the remaining G4 path MUST NOT silently alias one to the other.

Required invariant:

```text
ManagementActionSemantic != RuntimeCapabilityAction
unless an explicit canonical destination-owned/accepted action-binding contract proves the mapping.
```

The caller may not provide an arbitrary runtime action or payload override to bridge this gap. Until an exact destination-owned compatibility/binding contract exists, effect-entry readiness must fail closed.

### What still blocks G4

Already proved:

```text
A2 -> A7
-> canonical S8 request
-> canonical S8 source persist/push
-> destination receive
-> destination-local fresh admission
-> destination delegation HumanGate requested
-> destination-owned delegation decision observed
-> fresh acceptance + exact local execution binding observed
-> exact downstream action readiness / action HumanGate state observed
```

Still required:

```text
-> explicit canonical management-action -> runtime-capability-action compatibility/binding
-> destination-owned action HumanGate decision when required
-> exactly one explicitly bounded approved effect
-> destination execution receipt bound to exact request/effect
-> source receipt pull
-> explicit source receipt consumption
-> management evidence ingestion bound to the same request/effect
```

Required invariants:

```text
unauthorized effects = 0
management cannot manufacture AuthorityGrant
management cannot decide delegation HumanGate
management cannot decide downstream action HumanGate
management cannot invent runtime action translation
source authorization cannot bypass destination-local admission
request identity binds policy + authorization + capability + target + evidence
execution binding identity does not imply effect
receipt identity binds back to the exact accepted request/effect
uncertain transport/effect never auto-replays
```

Until the explicit action-binding plus effect-and-receipt path is proven:

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
AttestedHead != IndependentProviderHead
HistoricalRecurrence != CurrentProducerReadiness
SchedulerEnabled != StructuredProducerContract
ManagementProposal != ExecutionAuthority
A2Eligibility != AuthorizationAllow
AuthorizationAllow != S8RequestConstruction
S8RequestConstruction != SourceTransportAck
SourceTransportAck != DestinationAdmission
DestinationAdmission != DelegationHumanGateApproval
DelegationHumanGateApproval != ExecutionBinding
ExecutionBinding != ActionReadiness
ExecutionRunIdentity != EffectExecution
ActionHumanGateRequested != ActionHumanGateApproved
ManagementActionSemantic != RuntimeCapabilityActionWithoutCanonicalBinding
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
6. keep A7 as the single authorization owner and S8 as the single delegation/transport/destination-authority owner;
7. advance G4 with an explicit destination-owned action compatibility/binding contract before any effect-entry proof;
8. keep both delegation and downstream action HumanGate decisions destination/local-owner controlled;
9. keep ambiguous transport/effect outcomes fail-closed with no automatic replay;
10. keep the owner cockpit fail-closed on unknown or stale Domain truth.

## Boundary

```text
second authorization owner = NO
second S8 owner = NO
second scheduler = NO
A2 execution enabled = NO
production/external S8 effect in M2.22-M2.25 work = NO
HumanGate decision by management layer = NO
destination execution effect by management layer = NO
implicit management-action -> runtime-action alias = NO
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
