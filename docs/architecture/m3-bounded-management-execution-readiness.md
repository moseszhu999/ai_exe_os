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

M3 starts only after every required gate independently reaches `PASS`. Policy eligibility, authorization-core `allow`, S8 request construction, source transport acknowledgement, destination admission, delegation HumanGate approval, a destination execution binding, an exact destination-owned source-to-runtime action binding, or a downstream action HumanGate request never grants effect authority by implication.

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

Latest bounded evidence remains fail-closed:

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

Last fully captured three-Domain audit:

```text
TrainingOS          ca0491ed5166e8f00b8e96f3f4665963a004c860  adoption STALE
TradeOS             934b4c76cdf523a9337892860bb1c0e0b8b4467d  adoption STALE / producer disabled
Video/Shared Media  23d92ffc4674f1581c4191e595d279a20008be53  adoption CURRENT
```

A later read-only observation on 2026-08-11 saw TradeOS advance again to:

```text
09fd5fc19dc2d7a8fbf57eee9662c91cff0d0466
```

That observation can only reinforce stale-currentness for the retained TradeOS attestation; it does not by itself update the fixed three-Domain adoption denominator or prove a producer contract.

Canonical evidence:

```text
fixtures/management/m2-21-current-domain-producer-revalidation-2026-08-10.json
tests/m2-21-current-domain-producer-revalidation.test.cjs
src/management/portfolio/controller-adoption-readiness.cjs
```

AIEXE does not fabricate missing Domain sources, reduce the fixed three-Domain denominator, reuse an attested head as independent provider truth, or mutate external scheduler configuration to make G3 pass.

---

## G4 — A2 policy through accepted execution path

### Accepted/proved chain through M2.27

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
-> M2.26 destination-owned immutable management-action -> runtime-action binding contract + read-only effect-entry preflight
-> M2.27 existing S8 destination owner consumes the exact binding into canonical S2 StepBinding and revalidates runtime AgentGrant/provider/payload semantics
```

The management plane does not own the destination decision surfaces between these slices. The destination S8 owner may independently approve or reject a delegation proposal. The local S1/S2 execution owner may later independently decide the downstream action HumanGate. AIEXE observes or composes with canonical states; it does not decide either gate.

### Authority separation

```text
policy eligible != authorization allow
authorization allow != S8 request construction
S8 request constructed != source transport submission
source transport acknowledged != destination admission
destination admission admissible != delegation HumanGate approval
delegation HumanGate approved != local execution binding
local execution binding != runtime semantic compatibility
runtime semantic compatibility != action HumanGate approval
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

Uses existing destination-owner receive/admission APIs. Destination-local peer, policy, capability installation/grant, provider, resource, scheduling and admission facts remain destination-owned. If admissible, M2.23 stops at a requested destination delegation HumanGate. Management performs no approval, binding creation, Mission creation, Worker submission, or effect.

### M2.24 — destination-owned delegation decision + binding observation

```text
src/management/policy/a2-s8-destination-binding.cjs
tests/m2-a2-s8-destination-binding.test.cjs
schema: aiexe.a2-s8-destination-binding.v1
```

M2.24 only reads the existing S8 destination state. The isolated proof intentionally makes the delegation decision through the destination owner itself, then verifies the fresh admission, exact acceptance, exact execution binding and destination-local identities.

Important public boundary preserved by M2.27:

```text
approveDelegationProposal(...).actionGate = null
```

The delegation-decision return value does not silently become a downstream action-decision API. A downstream action HumanGate must be observed through canonical execution state.

### M2.25 — downstream action-readiness observation

```text
src/management/policy/a2-s8-destination-action-readiness.cjs
tests/m2-a2-s8-destination-action-readiness.test.cjs
schema: aiexe.a2-s8-destination-action-readiness.v1
```

M2.25 rebinds the M2.24 delegation evidence to the exact local Mission / MissionRun / PlanStep / StepAttempt / ExecutionRun / Task / action HumanGate and separates `blocked`, `waiting_human`, `rejected`, and advanced/effect territory fail-closed. It never makes the action HumanGate decision or invokes an effect.

### M2.26 — destination-owned action-binding contract + preflight

```text
src/domain/capability-model.cjs
src/management/policy/a2-s8-destination-effect-entry-preflight.cjs
tests/m2-a2-s8-destination-effect-entry-preflight.test.cjs
```

M2.26 makes action translation explicit instead of relying on name similarity. `CapabilityVersion` owns an immutable/default-empty set of:

```text
delegatedActionBindings[]:
  sourceAction
  sourceTarget
  runtimeAction
  runtimeTarget
  payloadBinding
```

Required invariant:

```text
ManagementActionSemantic != RuntimeCapabilityAction
unless an exact destination-owned CapabilityVersion binding proves the mapping.
```

The management preflight is read-only. It cannot supply or override runtime action, runtime target, payload transformation, HumanGate answer, AuthorityGrant, provider answer, or effect result. The current canonical `local.form-submit@1.0.0` publishes an explicit empty binding set, so a non-native management semantic fails closed instead of silently becoming `submit_payload`.

M2.26 validated code head:

```text
head           7451e8d356dc6249f13dd1d402d58bca0f88e217
main           eb22e91d8bca1378fa87bfcf360c8b4a97574f82
PR merge ref   03fdbf04123aa60f5009bbff7ab2cb22632967f1
workflow run   31426966707  SUCCESS
job            93580847308  SUCCESS
source syntax  PASS
tests          621 / 621 PASS
M2.26 focused  8 / 8 PASS
provider scan  PASS
```

The original M2.26 code head failed one focused assertion because the test incorrectly expected JavaScript `Object.freeze` runtime metadata to survive SQLite serialization. The fix retained the immutable model contract and corrected the persistence-projection assertion; no authority or validation rule was weakened.

### M2.27 — destination owner consumes exact runtime binding

Production owner changes:

```text
src/delegation/admission/index.cjs
src/application/s8-destination-authority-service.cjs
src/application/s8-product-service.cjs
```

Focused proof:

```text
tests/m2-a2-s8-destination-runtime-binding.test.cjs
```

M2.27 separates two different contracts that were previously conflated:

```text
DelegationPolicy validates SOURCE semantics:
  run_approved_test_profile
  project:trainingos

Destination CapabilityVersion resolves RUNTIME semantics:
  submit_payload
  http://127.0.0.1:43119/task-form.html

Destination AgentGrant/provider validate RUNTIME semantics.
```

Only the existing S8 destination owner resolves and consumes the binding. Management never supplies `runtimeAction`, `runtimeTarget`, `payloadBinding`, provider approval, AgentGrant, HumanGate decision, or effect answer.

The exact runtime semantic is persisted into canonical S2 `StepBinding`, not merely returned from a management preflight. The downstream action gate is then created by the existing local S1/S2 path and is observable through:

```text
DelegatedExecutionBinding
-> localStepAttemptId
-> StepAttempt.humanGateId
-> canonical HumanGate(state=requested)
```

The delegation approval API still returns `actionGate=null`, preserving M2.24's separation of delegation approval from downstream action approval.

M2.27 focused tests prove:

1. exact destination-owned binding lands in canonical S2 StepBinding and stops at requested action HumanGate;
2. destination AgentGrant grants the runtime semantic, not the source management semantic;
3. missing binding fails closed for a non-native source action;
4. provider-denied runtime action is blocked before delegation HumanGate consumption or Mission creation;
5. unsupported payload binding is blocked before delegation HumanGate consumption;
6. repeated destination approval is exact-once for Mission/binding and never auto-approves the action gate;
7. the destination binding owner exposes no management-supplied runtime choice or effect shortcut.

Red-team/debug evidence also preserved a pre-existing contract: an intermediate implementation exposed the action gate in `approveDelegationProposal()` and caused the old M2.24 regression test to fail. That implementation was rejected. The final implementation restores `actionGate=null` and proves the downstream gate through canonical StepAttempt state instead.

M2.27 focused diagnostic validation:

```text
head           6712f84b4f82b07812b506556f9505ac6cca6fd6
PR merge ref   28160692bd1045e31ed7424cf6c13629b8afcc95
workflow run   31430071091  SUCCESS
job            93591070579  SUCCESS
M2.27 focused  7 / 7 PASS
provider scan  PASS
```

S8/M2-S8 regression validation after preserving the M2.24 boundary:

```text
head           f1d5fae14a16512317f4a266e2f23ccfa16b7091
workflow run   31430828702  SUCCESS
```

Full code-head validation after restoring the normal full test command:

```text
head           8a4fe1cda3947a4a4f4ae98e6ac523ff84ab0cdf
workflow run   31430911750  SUCCESS
job            93593826538  SUCCESS
source/unit validation  SUCCESS
provider boundary       SUCCESS
```

The exact full-suite test count and checkout merge-ref are not promoted here from inference; the final documentation head below must receive its own PR merge-ref validation before this slice is considered documentation-complete.

All M2.27 effects are isolated to project-owned in-memory SQLite / test exchange / fake Worker surfaces. No production or external Domain runtime effect was performed.

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
-> exact downstream action readiness observed
-> destination-owned source-semantic -> runtime-semantic binding contract
-> exact binding consumed by existing destination S8 owner
-> runtime AgentGrant/provider/payload semantics revalidated
-> exact runtime semantic persisted in canonical S2 StepBinding
-> downstream action HumanGate requested
```

Still required:

```text
-> destination-owned downstream action HumanGate decision when required
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
destination AgentGrant/provider validate runtime semantics, not source naming
request identity binds policy + authorization + capability + target + evidence
execution binding identity does not imply effect
receipt identity binds back to the exact accepted request/effect
uncertain transport/effect never auto-replays
```

Until the destination-owned action decision plus exact effect-and-receipt path is proven:

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
ExecutionBinding != RuntimeSemanticCompatibility
RuntimeSemanticCompatibility != ActionHumanGateApproval
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
7. advance G4 only through destination-owned capability binding + runtime authority + HumanGate/effect/receipt paths;
8. keep both delegation and downstream action HumanGate decisions destination/local-owner controlled;
9. keep ambiguous transport/effect outcomes fail-closed with no automatic replay;
10. keep the owner cockpit fail-closed on unknown or stale Domain truth.

## Boundary

```text
second authorization owner = NO
second S8 owner = NO
second scheduler = NO
A2 execution enabled = NO
production/external S8 effect in M2.22-M2.27 work = NO
HumanGate decision by management layer = NO
downstream action HumanGate decision in M2.27 = NO
destination runtime effect in M2.27 = NO
implicit management-action -> runtime-action alias = NO
management-supplied runtime action/target/payload binding = NO
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
