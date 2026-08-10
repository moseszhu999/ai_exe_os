# execution.authorization.v1 — Entry Proof and No-Self-Authorization Boundary

Date: 2026-08-10  
Controller: Issue #126  
Baseline: `dce842e6874e6842b461cd4b5958df577608da94`  
Status: entry-control proof only; no authorization runtime; no provider execution

## 1. Purpose

This document closes the pre-implementation ambiguity around the future group-level `execution.authorization.v1` contract without creating a second S8 runtime, delegation store, HumanGate, ResourceLock owner, Domain truth store, wallet service, settlement service, or provider adapter.

The contract to be implemented later is a **pure authorization decision envelope**. It composes accepted references and returns a bounded decision. It does not execute the requested action.

```text
Domain action request + verified prerequisite references + local authority state
→ pure authorization evaluation
→ allow | deny | needs_human_review | unknown
→ immutable decision-evidence digest

authorization decision != execution
```

## 2. Fresh entry-gate audit

### A0 — unique controlled-delegation baseline — PASS

AIEXE PR #122 is merged. Current main composes `S8ProductApplicationService` from the accepted source-handoff service plus destination-local authority methods. Remote delegation data remains proposal/admission state until destination-local acceptance.

Accepted current source:

```text
src/application/s8-product-service.cjs
src/application/s8-destination-authority-service.cjs
src/application/s8-index.cjs
```

There is no permission to create `S8-v2` or a parallel delegation runtime.

### A1 — S1 HumanGate / ResourceLock / Mission owner re-audit — PASS

Current main confirms:

- `HumanGateService` owns requested → approved/rejected/expired decision state and rejects unsupported or repeated conflicting decisions;
- destination delegation acceptance revalidates local admission before creating local execution binding;
- current S8 admission reads local installation/grant/provider authority, current resource lock digest, and current scheduling policy;
- remote input cannot decide the destination HumanGate;
- local execution is created only after destination-local acceptance.

Therefore the future authorization contract must reference these owners. It must not recreate them.

### A2 — Group Management Plane boundary re-audit — PASS_FOR_ENTRY_BOUNDARY

AIEXE PR #125 remains OPEN / DRAFT. Its current M2.18 boundary is still observe-and-propose and explicitly keeps:

```text
M3 = BLOCKED
A2 execution = UNAUTHORIZED
Domain write = NO
HumanGate decision = NO
payment / settlement / wallet / token action = NO
```

Issue #126 requires this boundary to be re-audited, not bypassed. The re-audit therefore passes as an **entry-boundary fact** while #125 remains separately gated. `execution.authorization.v1` must not be used as a shortcut to unlock #125 A2 execution.

### A3 — portable human CapabilityCredential owner — PASS

TrainingOS PR #655 is merged. The accepted contract fixes:

```text
CapabilityCredential != AuthorityGrant
eligible_prerequisite != execution authorization
wallet ownership != human capability credential
```

TrainingOS PR #709 is also merged and adds a bounded current-self credential read source. That read source is actor-bound and read-only; it still does not create authority.

AIEXE consumes credential/eligibility references only. It never mutates TrainingOS credential truth.

### A4 — real Domain OS read-only request contract — PASS_CONTRACT / NO_RUNTIME_CLAIM

TradeOS PR #649 is merged on TradeOS main and is now the accepted Group Value Execution Fabric architecture/control baseline. It defines the TradeOS-owned domain request semantics:

```text
trade.action.requirements.v1
trade.intent.v1
```

The accepted boundary fixes:

```text
requirements object != authorization decision
authorization decision != execution
CapabilityCredential != AuthorityGrant
Agent capability package != delegation
```

This satisfies the A4 requirement for one accepted Domain OS **read-only request contract**. It does not claim that a live TradeIntent runtime exists; TradeOS G3 remains separately blocked by its real-business-truth gates.

## 3. A5 — exact no-self-authorization proof

A future `execution.authorization.v1` implementation is admissible only if all of the following are structural invariants.

### 3.1 Request cannot supply the answer

The request schema MUST reject fields equivalent to:

```text
allow
approved
authorized
executionAuthorized
authorityGranted
decision
force
bypass
skipHumanGate
```

No caller-provided boolean or reason string may become authorization truth.

### 3.2 Capability cannot mint authority

These implications are forbidden:

```text
installed Agent package -> authorized
Agent capability declaration -> delegation
human CapabilityCredential -> AuthorityGrant
organization role -> CapabilityCredential
wallet possession -> actor authority
valid credential -> HumanGate approval
```

Each prerequisite must be independently referenced from its accepted owner.

### 3.3 Requested actor cannot be its own verifier

Actor/request data may identify what action is requested. It may not manufacture or attest the validity of:

```text
AuthorityGrant
delegation
HumanGate approval
CapabilityCredential lifecycle
provider authority
revocation state
resource lock ownership
policy acceptance
```

Those values must come from accepted owner projections or verified envelopes passed into the pure evaluator.

### 3.4 Missing truth is never approval

If any required authority, policy, credential, delegation, revocation, HumanGate, evidence, amount, counterparty, asset, time-window, or scope fact is missing or stale, the evaluator returns:

```text
unknown
```

or a bounded `deny` reason where policy explicitly makes the absence disqualifying.

It must never default missing truth to `allow`.

### 3.5 Allow is conjunctive and digest-bound

`allow` is possible only when every required prerequisite independently passes and the result binds the exact normalized input to a decision-evidence digest.

An `allow` decision does not create, widen, renew, or persist any prerequisite authority object.

**A5 design verdict: PASS — no self-authorization path is permitted by the target contract.**

## 4. A6 — mechanical separation from execution

The first implementation must be a pure module with a boundary equivalent to:

```text
evaluateExecutionAuthorization(input)
  -> ExecutionAuthorizationDecisionV1
```

### 4.1 Forbidden implementation dependencies

The authorization core must not import or invoke:

```text
network clients
HTTP/fetch
filesystem writes
child_process
Electron IPC send/invoke
wallet/signer/private-key modules
bank adapters
stablecoin adapters
DEX/CEX/OTC adapters
custody adapters
Domain mutation services
S8 transport submission
```

### 4.2 Output is data only

The output may contain:

```text
schema
decisionRef
requestedActionRef
organizationRef
actorRef / actorKind
decision: allow | deny | needs_human_review | unknown
reasonCodes[]
verifiedPrerequisiteRefs[]
missingPrerequisiteRefs[]
limits snapshot
validFrom / expiresAt
decisionEvidenceDigest
```

It must not contain:

```text
provider handle
signer
private key
callback
executable command
adapter instance
transaction payload that is automatically sent
```

### 4.3 Later execution adapter is a separate owner/interface

Any future execution path must independently consume an accepted decision by exact reference/digest and re-check its own execution-time requirements. The evaluator itself never calls that path.

A future executor MUST be able to be absent from the process while authorization unit tests still pass completely.

**A6 design verdict: PASS — authorization output and adapter invocation are mechanically specified as separate layers.**

## 5. First implementation scope unlocked by this proof

After this entry-proof PR is independently accepted against current main, Issue #126 may open exactly one bounded implementation owner for a pure contract module.

Allowed first code slice:

```text
src/authorization/execution-authorization-v1.cjs
tests/execution-authorization-v1.test.cjs
```

Allowed behavior:

- validate a closed input schema;
- compose already-resolved references/envelopes;
- fail closed on unknown/stale/mismatched prerequisites;
- return deterministic decision + reason codes + SHA-256 evidence digest;
- mechanically prove no provider/execution side effect.

Not allowed in that first slice:

```text
network call
provider call
HumanGate decision mutation
AuthorityGrant creation
credential lookup/mutation
Domain OS write
wallet/signing
payment
settlement
DEX/CEX/OTC execution
bank instruction
Production mutation
```

## 6. Gate result

```text
A0 merged unique S8 baseline                 PASS
A1 S1 authority-owner re-audit               PASS
A2 management-plane boundary re-audit        PASS_FOR_ENTRY_BOUNDARY
A3 portable human CapabilityCredential       PASS
A4 accepted Domain read-only request contract PASS_CONTRACT
A5 no-self-authorization design proof        PASS
A6 authorization/execution separation proof  PASS
```

This result unlocks only a **pure authorization contract implementation candidate** after this proof is accepted. It does not authorize any consequential action or financial execution.
