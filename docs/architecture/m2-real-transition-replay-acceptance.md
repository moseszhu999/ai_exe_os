# M2.12 Real Transition Replay Acceptance

Status: **G2 PASS** for the bounded M3 management-readiness gate.  
Owner: AIEXE Group Management Plane PR #125.  
Evidence class: real historical/provider transitions; simulation remains separate.

## Decision

Gate 2 previously remained partial because the accepted replay set still lacked enough **real** episodes for:

```text
owner conflict
stale -> recovery
policy block
false project-wide pause
false / missed escalation
recovery after blocker clear
```

M2.12 closes those named evidence gaps without changing the attention algorithm or relabelling simulated cases as history.

The new immutable corpus is:

```text
fixtures/management/m2-real-transition-replay-2026-08-10.json
schema        = aiexe.real-transition-replay.v1
evidenceClass = REAL_HISTORICAL_AND_PROVIDER_TRANSITION
real cases    = 10
```

The labels are derived from explicit historical PR dispositions, merge outcomes, canonical provider captures and exact-head truth boundaries. The attention engine under test does not generate the expected labels.

## Real transition coverage

### 1. TrainingOS stale exact-head evidence -> recovery

PR #576 explicitly invalidated an older exact-head PASS after a semantic repair. The repaired head required fresh immutable validation before merge.

```text
stale episode
  old accepted evidence no longer current
  -> expected ESCALATE / needs_attention

recovery episode
  final repaired head 0147336d70cc098ae7d88049997a29fd8dd69094
  merged as effdd2fd0110a9a92dec995656c3f50a0742ddef
  -> expected CONTINUE / automatic
```

This is a real stale-to-recovery pair rather than a simulated exact-head mismatch.

### 2. TradeOS production-autodeploy policy block -> recovery

PR #647 explicitly recorded:

```text
code_verdict  = READY
merge_verdict = BLOCKED_PRODUCTION_AUTODEPLOY
```

That real policy blocker maps to PAUSE / blocked. After release-control decoupling was accepted and synchronized into the sole owner path, the same product slice reached final head `b7dbc2c556d7586cd8fe9a8bdab6440910303f60` and merged as `f7256893a787d7740bcf553633fb4d30bedca8ef`.

This supplies both a real policy block and recovery-after-blocker-clear episode.

### 3. TrainingOS route-owner conflict -> owner-safe rebuild recovery

PR #476 became an unsafe merge path after the accepted top-level route owner moved. It closed unmerged rather than overwriting the current owner.

PR #480 explicitly replaced that conflicted path, rebuilt from latest main, reused the accepted route/Marketplace owners and merged as `42f83d61acaf9a54e51aa32d7e62b9ddd6587d22`.

This supplies a real owner-conflict PAUSE and a real owner-safe CONTINUE recovery.

### 4. Real provider churn -> escalation without false project-wide pause

Post-binding scheduled provider captures repeatedly observed real head/open-work movement in TrainingOS, TradeOS and Video / Shared Media while canonical external structured Controller adoption remained absent.

For each Domain:

```text
GitHub source movement = real
Domain status          = unknown
owner                  = unknown
canonical Controller   = absent
```

The safe labelled decision is ESCALATE / needs_attention. It is neither:

```text
CONTINUE  # would infer health from provider activity
PAUSE     # would invent project-wide pause authority from incomplete truth
```

These three real episodes exercise false-pause avoidance and missed-escalation protection against current recurring provider evidence.

### 5. Current AIEXE attestation head mismatch

The real M2.7 structured AIEXE receipt still attests S8 main `7fdf410e009ea5a1f25bc03dea3b2e54a83c9d48`, while current provider main is `dce842e6874e6842b461cd4b5958df577608da94`.

The exact-head mismatch must ESCALATE and cannot silently preserve the old active Domain projection.

## Replay result

`tests/m2-real-transition-replay.test.cjs` verifies:

```text
real transition cases      10
exact proposal matches     10
exact rate                  1.0
false escalations           0
missed escalations          0
recovery pairs              3
provider unknown escalates  3 / 3
false provider-wide pauses  0
```

Exact-head S0 acceptance run:

```text
run                    31358930299  SUCCESS
job                    93363772751  SUCCESS
PR merge-ref            9a5374948a9cf1a186ef2276d9dddf92bae76a07
Source syntax check      PASS
tests                    511 / 511 PASS
Provider boundary scan   PASS
GITHUB_TOKEN             Contents: read; Metadata: read
```

## Corpus separation

M2.12 does not replace or relabel earlier evidence.

Current evaluation inventory is deliberately separated:

```text
historical project-level real replay   6 cases
real workstream replay                  3 project scenarios
M2.12 real transition replay           10 cases
SIMULATED adversarial replay            11 cases
```

The 11 adversarial cases remain explicitly `SIMULATED`. They improve failure-mode coverage but are not counted as real episodes used to close the remaining G2 evidence gaps.

## Why G2 is now PASS

The M3 readiness gate named no separate human-review-count or minimum-N requirement. Its blocking condition was the missing breadth of real transition classes listed above.

M2.12 now provides real multi-project evidence for every named missing class and verifies the current deterministic attention engine against those labels with zero false or missed escalation in this bounded corpus.

Therefore:

```text
G2 broader replay / evaluation acceptance = PASS
```

This is a **bounded evaluation acceptance**, not a claim of universal decision accuracy. New real failures must still be added to the replay ledger and may reopen the gate if they expose a policy defect.

## Authority boundary

G2 PASS changes evaluation readiness only. It does not authorize execution.

```text
managementAuthority = observe-and-propose
A2 execution         = blocked
Domain write         = NO
external Domain write/comment = NO
Merge PR #125        = NO while other gates remain open
Deploy               = NO
Production mutation  = NO
credentials          = NO
payment / settlement / wallet / token = NO
remote Worker control = NO
HumanGate decision    = NO
```

G3 remains the next material gate. G4 remains downstream and must not be inferred from G2 PASS.
