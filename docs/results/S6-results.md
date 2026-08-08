# S6 Scheduling Policy — Final Results

## Final verdict

**GO** at frozen product head:

```text
b9cce3a331b33c273e5eecd11fa3269fd5c9b135
```

S6 is accepted as a deterministic, bounded scheduling policy / selection layer over the existing S2/S1 authority chain. It does not create a second execution authority.

## Scope and ownership closure

S6 waterfall completed through the planned owner topology:

- S6-A docs / Gate 0: PR #89
- S6-B deterministic scheduling policy domain: PR #95
- S6-C bounded capacity / Worker compatibility: PR #96
- S6-D canonical-ready orchestration / proposal revalidation: PR #97
- S6-E scheduling explanation UI: PR #98
- S6-I SQLite / application / IPC / cockpit integration: PR #99
- S6 scheduler-consumption repair discovered by native-readiness review: PR #100
- S6-F frozen-head native acceptance carrier: PR #101, closed without merge

The final product head contains the accepted product implementation only. The S6-F QA carrier was never merged into product `main`.

## Frozen product source validation

Frozen product head:

```text
b9cce3a331b33c273e5eecd11fa3269fd5c9b135
```

The final S6-F workflow validated this exact product SHA in an isolated worktree.

Result:

```text
301 / 301 tests PASS
0 failed
```

The carrier scope audit confirmed that the S6-F branch changed exactly three QA-owned files:

```text
.github/workflows/s6-native-multisession-acceptance.yml
scripts/s6-acceptance-electron-ui.cjs
scripts/s6-acceptance-native-matrix.cjs
```

No product source file was modified by the acceptance carrier.

## Authoritative native acceptance run

GitHub Actions workflow:

```text
S6 native multi-session scheduling acceptance
run: 31253533327
```

Jobs:

```text
Exact frozen product source validation                         SUCCESS
Native arm64 dual-session scheduling + Electron acceptance    SUCCESS
```

The native job ran on Apple Silicon arm64 and exercised:

- native Node arm64;
- real Google Chrome with arm64 support;
- Playwright Chromium arm64;
- two concurrent Worker browser sessions;
- real Electron with the full S0 → S6 bridge;
- the real S6 → S2 → S1 scheduling / HumanGate path.

## Immutable artifacts

Native S6 artifact:

```text
artifact id: 9020728700
sha256: 1e140a855a75d811bd33a8e9c26aa739de3afc0bd17af391d6b144568c5c2536
```

Exact-source artifact:

```text
artifact id: 9020722240
sha256: 0a8439eb89413073f50099fe9911fb90b86197b7b6fda132ceceae027db34761
```

Independent post-run download audit confirmed:

- downloaded ZIP SHA256 values exactly match GitHub artifact digests;
- every internal `SHA256SUMS` / source checksum entry verifies;
- JSON / JSONL privacy scan is clean;
- both real Electron full-page screenshots are present and readable;
- manifest product SHA equals the frozen product SHA.

## Scheduling / capacity result

The native matrix created three canonical ready PlanSteps with only two allowed active slots.

Observed result:

```text
eligible candidates before capacity exhaustion: 3
active assignments created: 2
remaining canonical eligible candidate: 1
```

Selected assignments:

```text
high priority   → s1-worker-chrome
normal priority → s1-worker-chromium
```

The low-priority candidate remained canonical `ready` and was deferred after both slots were reserved.

The final no-assignment decision recorded explicit reasons including:

```text
global_capacity_exhausted
workspace_capacity_exhausted
no_compatible_worker
```

The observed capacity snapshot was exactly at, never above, both configured upper bounds:

```text
global active:    2 / 2
Workspace active: 2 / 2
```

## S1 resource authority result

S1 remained the final resource authority.

The two accepted assignments produced:

```text
2 browser_profile reservations
2 provider_surface reservations
```

S6 used those existing S1 locks as scheduling inputs. It did not bypass or replace the lock manager.

A live browser session is treated as capacity supply, not automatically as consumed scheduling demand. The scheduling slot becomes consumed when the existing S1 resource reservation is created.

The native-readiness review also caught and repaired an important integration detail before S6-F: provider-surface reservation is an implicit S1 resource and therefore must be visible to S6. Two Workers may not be assigned concurrently to the same exclusive provider surface merely because their browser profiles differ.

## HumanGate / execution-authority result

Both selected PlanSteps stopped at the existing S1 HumanGate boundary:

```text
StepAttempts waiting_human: 2
HumanGates requested:       2
browser submissions:        0
```

S6 did not approve a HumanGate and did not directly submit browser work.

The accepted AssignmentProposal was consumed by the inherited S2 scheduler, which then created the StepAttempt / Task / HumanGate using the accepted S2/S1 path.

This is the required S6 authority shape:

```text
S6 policy selects
→ AssignmentProposal
→ S2/S1 revalidates / consumes
→ S1 Task + resource lock + HumanGate
→ runtime start remains outside S6 authority
```

## Determinism and bounded fairness

The exercised deterministic snapshot produced identical scheduling input digests under reversed candidate collection order:

```text
sha256:5ef9e188adc85474bb11a8079cef54f91e265de788128c570f7c74f9729c0984
```

The bounded-aging sequence showed:

```text
critical-fresh   effective rank 0
low-aged         effective rank 1, bounded boost steps 2
high-fresh       effective rank 1
```

The aged low-priority candidate advanced ahead of fresh high-priority work at the bounded tie, demonstrating starvation prevention, while it did not outrank fresh critical work. The configured `maxPriorityBoostSteps` remained a hard bound.

No opaque ML score or non-reproducible ranking was used.

## Conservative provider / compatibility boundaries

The native acceptance explicitly exercised conservative failure behavior:

```text
unknown provider capacity → provider_capacity_unknown
stale provider capacity   → provider_capacity_stale
```

Neither case was upgraded to unlimited capacity.

Cross-Workspace Worker/session reuse returned:

```text
cross_workspace_worker
```

and remained incompatible.

A stale AssignmentProposal revalidation returned:

```text
state: stale
reason: stale_authority_snapshot
```

before any start.

## Restart / no-replay result

SQLite restart evidence:

```text
projection digest:       unchanged
event count:             74 → 74
SchedulingDecision count: 3 → 3
AssignmentProposal count: 2 → 2
StepAttempt count:         2 → 2
browser submissions:       0 → 0
```

Real Electron same-userData restart evidence:

```text
StepAttempts:        2 → 2
ready steps:         [step-low] → [step-low]
SchedulingDecisions: 3 → 3
AssignmentProposals: 2 → 2
submission events:   0 → 0
```

Restart rehydrated evidence and did not replay scheduling starts or browser effects.

## S4 / S6 cockpit result

The real Electron screenshots visibly contain the integrated S6 scheduling panel with the required explanation surfaces:

```text
Policy
Capacity
Eligible Queue
Selected Assignment
Deferred Reasons
Worker Compatibility
Provider Capacity
Decision Evidence
```

The cockpit showed the active policy, 2/2 capacity, the remaining eligible low-priority candidate, accepted proposals, and the capacity-deferred no-assignment decision.

The same state remained visible after restart.

## Runtime hygiene / privacy

Acceptance results:

```text
Worker page errors:       0
Worker console errors:    0
Electron page errors:     0
Electron console errors:  0
residual scoped processes: 0
```

Independent artifact privacy scan found no forbidden credential / cookie / token / private-key / browser-profile-path / user-data / process-id fields in JSON or canonical JSONL evidence.

The artifact contains privacy-safe digests for resource keys rather than raw resource/profile internals where appropriate.

## Compatibility with S0–S5

The frozen product full validation remained green with all pre-existing suites plus S6 tests:

```text
301 / 301 PASS
```

The final Electron preload retains the existing S0–S5 surfaces and adds only the bounded S6 scheduling namespace:

```text
queryState
recordPolicy
computeDecision
revalidateProposal
```

There is no S6 IPC for Worker start, provider write, HumanGate approval/rejection, automatic retry, deployment, rollback, or mutation.

## Permanent S6 boundary

S6 remains an optimization layer inside already accepted authority and resource limits.

It must not:

- invent Tasks / Missions / PlanSteps to fill capacity;
- turn blocked / waiting_human / failed / cancelled / uncertain work into ready work;
- approve or reject HumanGates;
- grant or install capabilities;
- bypass S1 resource locks;
- start an external effect directly;
- auto-retry failed or uncertain effects;
- infer unlimited provider capacity from missing quota evidence;
- circumvent provider pricing, rate, quota, metering, concurrency, anti-abuse or protective controls;
- copy credentials, cookies, tokens or browser profiles across Workspaces;
- perform hidden provider writes, production deployment, production database mutation, financial execution or legal execution.

## Closure

All S6 final acceptance requirements in issue #88 are satisfied at the frozen product head.

**S6 final verdict: GO.**
