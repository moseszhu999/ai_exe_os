# M3 Bounded Management Execution — Readiness Gate

Date: 2026-08-10 JST  
Management-plane owner: PR #125 / `agent/group-management-plane-m0`  
Authorization-core owner: PR #139 / `agent/pure-authorization-decision-contract-v1`  
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

M3 starts only after every required gate independently reaches `PASS`. Controller adoption, recurrence evidence, policy eligibility, provider ingestion, or an authorization decision core never grants execution authority by implication.

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

A previously accepted attestation becomes stale the moment its repository main moves. Historical recurrence remains historical evidence; it is not current Domain truth.

### Historical milestones

M2.16 corrected the first self-validation bug: an attestation's own `headSha` cannot be reused as provider truth.

M2.17 then established a second independently accepted cycle for TrainingOS and TradeOS and a current accepted source for Video/Shared Media.

M2.18 observed all three M2.17 heads as current at `2026-08-10T09:57Z` and reported structured adoption `3 / 3`. That statement was correct for that observation window only.

### M2.19 — current-head revalidation supersedes M2.18 currentness

After M2.18, TrainingOS and TradeOS advanced their default branches:

```text
TrainingOS
  attested head   8f0d38dca4dcd28883359c427e133d0c1a9eebb8
  provider main   ca0491ed5166e8f00b8e96f3f4665963a004c860
  compare         provider ahead by 1
  current state   STRUCTURED_CONTROLLER_ATTESTATION_STALE

TradeOS
  attested head   6958c3b5fb3a8d8b6b70b7a614910b0e1ea9202b
  provider main   cab553a75a07d67639f065124e76cf52a7b86428
  compare         provider ahead by 1
  current state   STRUCTURED_CONTROLLER_ATTESTATION_STALE

Video / Shared Media
  attested head   23d92ffc4674f1581c4191e595d279a20008be53
  provider main   23d92ffc4674f1581c4191e595d279a20008be53
  compare         identical
  current state   STRUCTURED_CONTROLLER_ADOPTED
```

Canonical evidence:

```text
fixtures/management/m2-controller-currentness-revalidation-2026-08-10.json
tests/m2-controller-currentness-revalidation.test.cjs
src/management/portfolio/controller-adoption-readiness.cjs
```

`revalidateControllerAdoptionReadiness()` now requires an independently supplied complete provider-head set. If a previously adopted attestation is no longer on the provider head, it mechanically:

```text
state = STRUCTURED_CONTROLLER_ATTESTATION_STALE
structuredControllerAdopted = false
verifiedCurrentEnvelopeEvidenceRefs = []
exactHeadSha = current provider head
```

It cannot fetch provider truth itself and cannot accept repository substitution or a partial provider set.

Therefore the current external structured-adoption truth at the M2.19 observation is:

```text
required external Domains          3
current structured adoption        1 / 3
stale structured attestations      2 / 3
current adopted Domain             Video/Shared Media
stale Domains                       TrainingOS, TradeOS
```

This is a deliberate downgrade from the historical M2.18 `3 / 3`; it proves the management plane fails closed when departments move after reporting.

### Video recurrence improvement

Video/Shared Media now has a second independent structured Controller cycle at the still-current head `23d92ffc4674f1581c4191e595d279a20008be53`.

Thus the old M2.18 blocker "Video needs a second independent cycle" is closed as source evidence. It still does **not** pass G3 because its native producer has not proved the canonical structured producer contract.

### Current producer topology

Read-only native task observation remains:

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

### Shortest real G3 path after M2.19

```text
1. TrainingOS emits a fresh canonical structured Controller attestation at current main
2. TradeOS emits a fresh canonical structured Controller attestation at current main
3. each Domain-owned native producer proves the canonical structured producer contract
4. TradeOS has a current enabled Domain-owned producer
5. AIEXE independently revalidates all three provider heads
6. fixed-scope G3 recomputes all three as current recurring structured producers
```

Video no longer needs an additional source cycle solely to establish two-cycle recurrence evidence; its remaining blocker is producer-contract proof.

AIEXE does not create the missing Domain reports or mutate external scheduler configuration to make this gate pass.

---

## G4 — A2 policy through accepted execution path

### Management policy remains non-binding

The A2 management policy still separates eligibility from execution:

```text
policy eligible != execution authorized
```

Consequential actions remain outside A2, including merge, deploy, payment/settlement/wallet/token, credential write, policy widening, Domain truth mutation, Production mutation, remote Worker control, and HumanGate decisions.

### A5/A6 entry-boundary proof is now on main

AIEXE main advanced to:

```text
9955c6fc8bb2555aa65ca1b37254b961c475c03b
A5-A6: prove execution.authorization.v1 entry boundaries
```

That entry proof establishes no-self-authorization and mechanical separation between authorization and execution. It explicitly does not authorize #125 management execution.

### A7 has a separate active owner

The first pure `execution.authorization.v1` decision core is owned by PR #139, not PR #125:

```text
PR #139
head  147702cf5f3d5edb4f36b2debb217e26e9c317a8
state open / Ready for Review / mergeable
files 2
CI run 31379123250  SUCCESS
```

PR #139 is data-in/data-out authorization composition only. Its own contract states that it does not read live Domain providers, invoke S8 transport, make HumanGate decisions, create AuthorityGrant, or perform execution/external actions.

PR #125 therefore classifies G4 implementation ownership as `JOIN_STACK`: consume and later validate the accepted authorization core; do not create a second authorization runtime.

Even if PR #139 is later accepted, G4 is not automatically PASS. The remaining proof must show an eligible management A2 request can enter the accepted authorization + S8 path, be independently revalidated at the destination, preserve any required HumanGate, execute only a bounded approved effect, and return a receipt — with unauthorized effects remaining zero.

```text
G4 = PARTIAL / ACTIVE OWNER #139 / BLOCKED FOR M3
A2 execution = UNAUTHORIZED
```

---

## G5 — recurring provider-backed read-only ingestion

The existing native AIEXE hourly scheduler remains the single AIEXE ingestion scheduler. Distinct spaced successful scheduled captures already established recurring read-only provider ingestion.

```text
G5 = PASS
```

---

## M2.19 validation

Latest PR head after the currentness fail-closed implementation:

```text
PR head       6f09933cd6429893d49b1a89027bc0c0e8a41f43
current main  9955c6fc8bb2555aa65ca1b37254b961c475c03b
PR merge ref  700efbdb216aef9773156e92005ab883f8f01113
```

GitHub Actions:

```text
workflow run                31379448890  SUCCESS
job                         93426094523  SUCCESS
source syntax               PASS
tests                       540 / 540 PASS
M2.19 focused tests         3 / 3 PASS
provider boundary scan      PASS
GITHUB_TOKEN                Contents: read; Metadata: read
```

The pull-request workflow checked out the merge ref:

```text
700efbdb216aef9773156e92005ab883f8f01113
= merge(6f09933cd6429893d49b1a89027bc0c0e8a41f43
        into 9955c6fc8bb2555aa65ca1b37254b961c475c03b)
```

This is **latest-head-bound PR merge-ref validation**, not standalone branch-head checkout validation.

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
G3 PASS != G4 PASS
G4 decision core != M3 entry authorization
HumanGate status != AIEXE permission to decide it
```

## Allowed work before M3

1. continue read-only observation of Domain Controller channels and independent provider heads;
2. ingest later Domain-owned canonical cycles through the existing protocol only;
3. observe producer topology without mutating scheduler configuration;
4. revalidate currentness on every head movement;
5. continue authorized recurring read-only provider ingestion;
6. follow PR #139 as the unique A7 authorization-core owner;
7. after an accepted A7 baseline exists, build only the management-to-authorization integration proof needed by G4, without a second execution path;
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
