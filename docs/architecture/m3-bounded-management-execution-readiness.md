# M3 Bounded Management Execution — Readiness Gate

Date: 2026-08-10 JST  
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

M3 starts only after every required gate independently reaches `PASS`. Controller adoption, recurrence evidence, policy eligibility, provider ingestion, an authorization decision, or an authorization-core `allow` never grants execution authority by implication.

---

## G1 — accepted S8 controlled-delegation runtime baseline

Frozen accepted S8 product head:

```text
7fdf410e009ea5a1f25bc03dea3b2e54a83c9d48
```

S8 proves bounded delegation and destination-local authority. It does not turn an AIEXE management proposal into execution authority.

```text
G1 = PASS
```

---

## G2 — broader real replay / evaluation

Current accepted evidence remains:

```text
historical project-level real replay     6 labelled cases
real workstream replay                    3 project scenarios
M2.12 real transition replay             10 cases
SIMULATED adversarial replay              11 cases
```

M2.12 real transition result remains 10/10 exact with 0 false escalations and 0 missed escalations. The simulated corpus is not counted as real history.

```text
G2 = PASS
```

---

## G3 — recurring real structured Controller attestations

### Canonical truth rule

External Domain truth is accepted only through structured Domain-owned sources and must be revalidated against an independently observed current provider head.

```text
Controller source
-> canonical marked attestation
-> exact repository binding
-> independent provider-head revalidation
-> current structured adoption
-> producer readiness
-> fixed three-Domain G3 gate
```

A previously accepted attestation becomes stale when its repository main moves. Historical recurrence remains historical evidence; it is not current Domain truth.

### M2.19 current-head revalidation

M2.18 observed all three M2.17 heads as current at `2026-08-10T09:57Z` and reported structured adoption `3 / 3`. That statement was correct for that observation window only.

Afterward TrainingOS and TradeOS advanced:

```text
TrainingOS
  attested head   8f0d38dca4dcd28883359c427e133d0c1a9eebb8
  provider main   ca0491ed5166e8f00b8e96f3f4665963a004c860
  compare         provider ahead by 1
  M2.19 state     STRUCTURED_CONTROLLER_ATTESTATION_STALE

TradeOS
  attested head   6958c3b5fb3a8d8b6b70b7a614910b0e1ea9202b
  provider main   cab553a75a07d67639f065124e76cf52a7b86428
  compare         provider ahead by 1
  M2.19 state     STRUCTURED_CONTROLLER_ATTESTATION_STALE

Video / Shared Media
  attested head   23d92ffc4674f1581c4191e595d279a20008be53
  provider main   23d92ffc4674f1581c4191e595d279a20008be53
  compare         identical
  M2.19 state     STRUCTURED_CONTROLLER_ADOPTED
```

Canonical evidence:

```text
fixtures/management/m2-controller-currentness-revalidation-2026-08-10.json
tests/m2-controller-currentness-revalidation.test.cjs
src/management/portfolio/controller-adoption-readiness.cjs
```

`revalidateControllerAdoptionReadiness()` requires an independently supplied complete provider-head set. If a previously adopted attestation is no longer on the provider head, it mechanically clears current structured-adoption status and verified-current evidence. Repository substitution and partial provider sets fail closed.

Therefore the M2.19 dated observation is:

```text
required external Domains          3
current structured adoption        1 / 3
stale structured attestations      2 / 3
current adopted Domain             Video/Shared Media
stale Domains                       TrainingOS, TradeOS
```

This is a deliberate correction from the historical M2.18 `3 / 3 current`: the management plane does not carry an old department report forward after the department changes.

### Video recurrence improvement

Video/Shared Media now has a second independent structured Controller cycle at the still-current M2.19 head `23d92ffc4674f1581c4191e595d279a20008be53`.

The old blocker "Video needs a second independent cycle" is closed as source recurrence evidence. Video still does not pass G3 because its native producer has not proved the canonical structured producer contract.

### Producer topology

Read-only native task observation used by M2.19:

```text
TrainingOS    enabled
TradeOS       disabled
Video/Media   enabled

structured producer contracts observed   0 / 3
out-of-band persistence observed          3 / 3
```

The fixed G3 denominator remains exactly:

```text
trainingos                    moseszhu999/training-learning-rails
tradeos                       moseszhu999/chaintrace-app
video-operation-shared-media  moseszhu999/global-tool-radar
```

All three must simultaneously have current structured adoption, observed + enabled producer topology, a proved structured producer contract, out-of-band persistence, and canonical recurrence proof.

```text
G3 = PARTIAL / BLOCKED FOR M3
```

### Shortest real G3 path

```text
1. TrainingOS emits a fresh canonical structured Controller attestation at current main
2. TradeOS emits a fresh canonical structured Controller attestation at current main
3. each Domain-owned native producer proves the canonical structured producer contract
4. TradeOS has a current enabled Domain-owned producer
5. AIEXE independently revalidates all three provider heads
6. fixed-scope G3 recomputes all three as current recurring structured producers
```

AIEXE does not create the missing Domain reports or mutate external scheduler configuration to make this gate pass.

---

## G4 — A2 policy through accepted execution path

### Management policy remains non-binding

The A2 management policy separates eligibility from execution:

```text
policy eligible != authorization allow
authorization allow != execution authorized
```

Consequential actions remain outside A2, including merge, deploy, payment/settlement/wallet/token, credential write, policy widening, Domain truth mutation, Production mutation, remote Worker control, and HumanGate decisions.

### Accepted A5/A6 entry-boundary proof

The accepted A5/A6 entry proof established no-self-authorization and mechanical separation between authorization and execution.

```text
9955c6fc8bb2555aa65ca1b37254b961c475c03b
A5-A6: prove execution.authorization.v1 entry boundaries
```

### Accepted A7 pure authorization decision core

PR #139 has now merged. The accepted main baseline is:

```text
8578716ccd60595c152e4a64a7cb67b8381268bd
A7: implement pure execution.authorization.v1 decision core
```

The A7 core is pure data-in/data-out authorization composition. It can return:

```text
allow
deny
needs_human_review
unknown
```

It does not create AuthorityGrant, delegation or HumanGate state; does not invoke S8; does not read live Domain providers; and performs no external or execution effect.

### M2.20 — management A2 -> accepted authorization core entry proof

PR #125 now adds:

```text
src/management/policy/a2-execution-authorization-entry.cjs
tests/m2-a2-execution-authorization-entry.test.cjs
```

Schema:

```text
aiexe.a2-execution-authorization-entry.v1
```

The adapter proves that a management A2 request cannot enter the accepted authorization core unless the authorization request is mechanically bound to the same:

```text
action identity
action type
project target
policy reference
evidence references
canonical agent capability
preapproved bounded-work reference when required
```

Additional fail-closed rules:

```text
forbidden consequential A2 action
  -> blocked before authorization-core evaluation

prepare_non_binding_plan
  -> intentionally does not enter execution authorization

human capability requirement on management-agent entry
  -> blocked

HumanGate required by authorization core
  -> needs_human_review; management layer does not decide the gate
```

Most importantly, even when the accepted A7 core returns:

```text
decision = allow
```

the M2.20 result remains:

```text
executionAuthorized = false
s8InvocationPerformed = false
destinationExecutionPerformed = false
humanGateDecisionCreated = false
domainWritePerformed = false
binding = false
authority = authorization-entry-proof-only
```

This proves the CEO management plane can form a mechanically valid authorization request without silently turning that request into an execution effect.

### M2.20 validation

Validated PR head:

```text
PR head       687a922e22052a7efa7c05e6f7ef8ccd772c53bd
A7 main       8578716ccd60595c152e4a64a7cb67b8381268bd
PR merge ref  754705f8d0fe928a88082c12591365dd3ee0f697
```

GitHub Actions:

```text
workflow run                 31379954798  SUCCESS
job                          93427685528  SUCCESS
source syntax                PASS
tests                        562 / 562 PASS
M2.20 focused tests          7 / 7 PASS
provider boundary scan       PASS
GITHUB_TOKEN                 Contents: read; Metadata: read
```

The workflow checked out:

```text
754705f8d0fe928a88082c12591365dd3ee0f697
= merge(687a922e22052a7efa7c05e6f7ef8ccd772c53bd
        into 8578716ccd60595c152e4a64a7cb67b8381268bd)
```

This is **head-bound PR merge-ref validation**, not standalone branch-head checkout validation.

### What still blocks G4

M2.20 closes the management-policy-to-authorization-decision composition gap. It does **not** close the execution-path gap.

The shortest remaining G4 proof is:

```text
A2 policy-eligible management request
-> accepted execution.authorization.v1 decision
-> canonical S8 delegation request
-> destination-local admission + fresh revalidation
-> destination-local HumanGate when required
-> one explicitly bounded approved effect
-> destination execution receipt
-> source receipt consumption / management evidence
```

Required invariants:

```text
unauthorized effects = 0
management layer cannot manufacture AuthorityGrant
management layer cannot make HumanGate decision
authorization allow cannot bypass S8 destination authority
receipt identity must trace back to policy + authorization + capability + task
```

Until that end-to-end bounded path is proven:

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
AuthorizationDecision != execution effect
AuthorizationAllow != S8 destination admission
G3 PASS != G4 PASS
HumanGate status != AIEXE permission to decide it
```

## Allowed work before M3

1. continue read-only observation of Domain Controller channels and independent provider heads;
2. ingest later Domain-owned canonical cycles through the existing protocol only;
3. observe producer topology without mutating scheduler configuration;
4. revalidate currentness on every head movement;
5. continue authorized recurring read-only provider ingestion;
6. treat the merged A7 authorization core as the single accepted authorization owner;
7. build the next G4 proof only by composing into canonical S8 / destination-local authority, not a second execution path;
8. keep the owner cockpit fail-closed on unknown or stale Domain truth.

## Boundary

```text
second authorization owner = NO
second S8 owner = NO
A2 execution enabled = NO
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
