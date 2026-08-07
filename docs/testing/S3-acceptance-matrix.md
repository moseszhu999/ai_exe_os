# S3 Acceptance Matrix — GitHub-Native Engineering Workflow

Status: **DRAFT — Gate 0**

Parent: Issue #43

A final `GO` requires every critical row below to execute against one frozen exact product head. Static source inspection alone is not sufficient for live-provider or restart rows.

## A. Contract / source ownership

- [ ] exact product head SHA recorded;
- [ ] component and integration owner scopes are disjoint;
- [ ] no sibling implementation imports an unmerged sibling branch;
- [ ] S3 provider surface contains no GitHub write endpoint/action;
- [ ] canonical event authority is SQLite only;
- [ ] acceptance carrier changes acceptance-owned paths only.

## B. Repository / Workspace authority

- [ ] RepositoryRegistration is explicit and Workspace-scoped;
- [ ] same repository may be independently registered in two Workspaces without cross-visibility;
- [ ] cross-Workspace RepositoryBinding rejected;
- [ ] inactive/archived repository blocks DeliveryGate;
- [ ] repository id semantic reuse with different owner/repository rejected.

## C. Branch / path ownership

- [ ] active exclusive branch reservation conflicts deterministically with another exclusive owner;
- [ ] independent branches do not conflict;
- [ ] overlapping exclusive path prefixes conflict;
- [ ] sibling non-overlapping path prefixes do not conflict;
- [ ] read-only claims do not create false write conflicts;
- [ ] traversal/absolute/invalid path claims rejected;
- [ ] release/supersede removes only the intended ownership blocker.

## D. PR exact-head identity

- [ ] PullRequestBinding pins repository + PR number + expected head SHA;
- [ ] observation matching expected head may proceed to other gates;
- [ ] observed different head yields `head_mismatch` and immediately invalidates current readiness;
- [ ] historical evidence for old head remains immutable but cannot satisfy new head;
- [ ] explicit local rebinding creates/supersedes identity without GitHub write;
- [ ] closed-unmerged PR is blocked.

## E. Checks / reviews

- [ ] required check success recognized only for bound head;
- [ ] missing required check => `required_check_missing`;
- [ ] queued/in-progress required check => `required_check_pending`;
- [ ] failed/cancelled/timed-out required check => `required_check_failed`;
- [ ] unresolved required review thread => `review_thread_unresolved`;
- [ ] resolved/outdated thread normalization deterministic;
- [ ] review state is recorded as provider evidence, not inferred human approval.

## F. Base freshness / merge order

- [ ] base/current-base evidence observed explicitly;
- [ ] stale/behind base blocks when policy requires current base;
- [ ] incomplete base observation is fail-closed;
- [ ] merge-order constraints form an acyclic graph;
- [ ] predecessor-not-merged blocks only dependent successor;
- [ ] explicit predecessor merge evidence satisfies constraint;
- [ ] PR close without merge does not satisfy merge-order constraint.

## G. DeliveryGate / Mission integration

- [ ] one gate exposes deterministic blocker codes;
- [ ] unrelated Mission branch remains eligible while one delivery path is blocked;
- [ ] exact-head-ready evidence is immutable and head-bound;
- [ ] merge-observed evidence contains merge provenance;
- [ ] only declared delivery dependency releases a downstream S2 step;
- [ ] no StepOutput/Handoff or terminal evidence is fabricated by GitHub observation;
- [ ] RepairProposal creation performs zero GitHub write.

## H. Canonical durability

- [ ] unchanged repeated PR observation appends zero duplicate canonical events;
- [ ] unchanged checks observation appends zero duplicate canonical events;
- [ ] unchanged review-thread observation appends zero duplicate canonical events;
- [ ] restart rehydrates registrations/bindings/ownership/gates/evidence deterministically;
- [ ] restart performs zero provider write and zero duplicate delivery event;
- [ ] projection rebuild digest before/after equals;
- [ ] stale exact-head state remains stale after restart.

## I. Integrated Electron UI

Required visible surfaces:

```text
Repositories
Ownership
Pull Requests
Checks
Review Threads
Delivery Gates
Merge Order
Delivery Evidence
Repair Proposals
```

- [ ] Workspace switch isolates repository/delivery data;
- [ ] operator can see expected head vs observed head;
- [ ] operator can see base freshness;
- [ ] operator can explain every DeliveryGate blocker code;
- [ ] check status and review-thread state visible without raw provider secrets;
- [ ] ownership conflict names bounded local owners/paths;
- [ ] RepairProposal visibly marked proposal-only;
- [ ] renderer has no direct Node/database/provider credential access;
- [ ] Electron page errors = 0;
- [ ] Electron console errors = 0.

## J. Live read-only GitHub acceptance

Execute bounded live reads against a known repository and known PR/commit selected and recorded at acceptance time.

- [ ] repository identity resolved;
- [ ] PR head/base matches live provider response;
- [ ] at least one check/check-run/status observation executed live;
- [ ] review-thread/review observation executed when provider/API support and chosen PR permits it; otherwise final acceptance must select a PR where this row is executable rather than skip it;
- [ ] commit/merge or compare observation executed live;
- [ ] repeated identical live observation is canonically idempotent;
- [ ] no POST/PATCH/PUT/DELETE/provider write request executed;
- [ ] provider rate/permission failure is reported as blocked, not fabricated evidence.

## K. Security / privacy artifact

Final portable artifact must contain:

```text
machine verdict
frozen product SHA
normalized live GitHub observations
canonical event export
projection/restart digests
DeliveryGate blocker/evidence snapshots
Electron screenshots
provider request-method audit
SHA256SUMS.txt
```

- [ ] no Authorization/Bearer/GitHub token/cookie/password/private-key data;
- [ ] no raw environment dump;
- [ ] no browser/Electron profile or user-data directory;
- [ ] every artifact file covered by portable relative SHA-256 manifest;
- [ ] manifest verifies after extraction to a different directory;
- [ ] product worktree clean;
- [ ] scoped residual processes = 0.

## L. Final verdict

Allowed verdicts:

```text
GO
GO WITH ARCHITECTURE CHANGE
NO-GO
```

Do not issue `GO` with any critical unexecuted row, any reachable GitHub write path, any exact-head invalidation defect, any unresolved ownership ambiguity, or any credential/privacy artifact leak.
