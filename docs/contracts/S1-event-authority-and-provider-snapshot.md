# S1 Event Authority and Provider Contract Snapshot

Status: **NORMATIVE — OVERRIDES AMBIGUOUS WORDING**

Canonical issue: **#10**

This addendum resolves two implementation-blocking ambiguities before S1 code begins.

## 1. Single canonical event authority

For S1 and later local execution:

```text
SQLite execution_events
= the single canonical local domain event store
```

The existing S0 JSONL file is:

```text
legacy S0 evidence
one-time deterministic migration input
optional read-only export format
```

It is **not** a second canonical write target after S1 migration.

## 2. No dual-write design

S1 must not require a command to write both SQLite and JSONL before it is considered committed.

The required transaction is:

```text
BEGIN IMMEDIATE
insert one canonical SQLite event
update SQLite projections
COMMIT
```

Only after commit may the runtime effect start.

A JSONL evidence export, when requested, is produced from committed SQLite canonical events and is not part of the command commit boundary.

This prevents:

```text
SQLite committed / JSONL failed
JSONL committed / SQLite failed
different event ordering between stores
recovery selecting the wrong authority
```

## 3. S0 JSONL migration authority

The S0 importer records:

```text
source path or evidence reference
source SHA-256
source byte length
source event count
importer version
startedAt
completedAt
first imported SQLite sequence
last imported SQLite sequence
status
```

For every known S0 event, the importer derives a deterministic S1 idempotency key from:

```text
source digest
source sequence / line identity
event type
aggregate identity
```

Re-importing the same source digest produces zero additional canonical events.

The importer never mutates or deletes the source JSONL file.

After successful migration, all S1 commands read and write SQLite only.

## 4. Projection rebuild

All query projections are disposable and rebuildable from `execution_events`.

A rebuild:

```text
creates new projection tables or clears them inside a bounded transaction
replays canonical events in SQLite sequence order
validates aggregate versions and foreign keys
compares expected and actual counts/state digests
publishes the rebuilt projection only after verification
```

Projection state never overrides canonical event history.

## 5. ProviderUseContract snapshot

Provider-use authorization is time-sensitive. An ExecutionRun must not rely only on a mutable current provider-contract row.

At `execution.requested`, persist an immutable authorization snapshot:

```ts
interface ProviderContractSnapshot {
  providerContractId: string;
  providerId: string;
  surfaceId: string;
  reviewedAt: string;
  statusAtRequest: 'accepted';
  governingTerms: string[];
  supportedMechanism: string;
  permittedAction: string;
  target: string;
  rateAndConcurrencyLimits: string[];
  humanConfirmationPolicy: string;
  sourceDigests: string[];
}
```

The snapshot is stored in the canonical `execution.requested` event or an immutable referenced record whose digest is included in that event.

## 6. Revalidation before external effect

Immediately before an external effect starts, the scheduler verifies:

```text
snapshot existed at request time
current provider contract is still accepted
current contract has not newly prohibited the action/target
required Human Gate is approved
```

If the current contract is expired, blocked, or materially changed:

```text
execution does not start
execution.blocked is appended
resources are released
operator sees provider_contract_changed_or_expired
```

The historical snapshot remains attached to the blocked run for audit.

## 7. Local capability exception

A purely project-owned local deterministic capability may declare:

```text
providerContractIds: []
targetClass: project_owned_local
```

It still requires Workspace installation, Agent grant, resource checks, and its configured Human Gate policy.

This local exception does not imply authorization for any third-party surface.

## 8. Acceptance additions

S1 cannot receive `GO` until evidence proves:

- [ ] one authoritative SQLite event sequence exists after migration;
- [ ] no command path dual-writes JSONL and SQLite as co-equal authorities;
- [ ] JSONL export is reproducible from committed SQLite events;
- [ ] repeated S0 import creates zero duplicates;
- [ ] projection rebuild matches canonical state digest;
- [ ] every provider-bound ExecutionRun stores an immutable contract snapshot;
- [ ] an expired/changed provider contract blocks execution before the external effect;
- [ ] project-owned local capability execution does not create a fake provider authorization claim.

## 9. Precedence

Where other S1 documents say “event log remains canonical,” interpret that phrase as:

```text
SQLite execution_events remains canonical in S1;
S0 JSONL is legacy import evidence and optional export only.
```

This addendum does not weaken the S0 no-duplicate, Human Gate, credential, provider, or recovery boundaries.