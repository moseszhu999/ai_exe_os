# M2.14 — First real external Controller adoption cycle

Date: 2026-08-10

## Outcome

All three external core Domains now publish one canonical marked out-of-band Controller source using the already accepted `aiexe.external-controller-attestation.v1` protocol.

```text
TrainingOS
  https://github.com/moseszhu999/training-learning-rails/issues/477#issuecomment-5236850688
  exact head 8f0d38dca4dcd28883359c427e133d0c1a9eebb8

TradeOS
  https://github.com/moseszhu999/chaintrace-app/issues/567#issuecomment-5236890201
  exact head 6958c3b5fb3a8d8b6b70b7a614910b0e1ea9202b

Video Operation / Shared Media
  https://github.com/moseszhu999/global-tool-radar/issues/115#issuecomment-5236897897
  exact head 24996407449df28b2d83fce1a145b3200fff168a
```

The exact source bodies are captured in `fixtures/management/m2-real-external-controller-adoption-cycle-2026-08-10.json`. The focused contract verifies:

1. full-body SHA-256 matches the recorded immutable digest;
2. only the marked JSON block becomes authoritative Domain facts;
3. exact repository and head are required;
4. source freshness is required;
5. all three first-cycle sources can be accepted as current read-only Domain receipts;
6. a head mismatch fails closed to `unknown`.

## Important boundary

This closes the previous **source-existence / first-cycle ingestion** gap, but it does **not** yet close G3.

```text
external structured source existence = 3 / 3
first-cycle exact-head acceptance in canonical parser = 3 / 3
recurring structured producer proof = NOT YET PROVEN
G3 = PARTIAL
G4 / A2 execution = UNAUTHORIZED
```

A later independent Domain output cycle must produce fresh, changed source bodies and AIEXE must ingest them through the same digest/head/freshness gates before G3 may be promoted from PARTIAL.

No external scheduler was enabled or modified by this slice. No Domain repository code was changed. No Domain write, merge, deploy, Production mutation, HumanGate decision, payment, settlement, wallet/token action or remote Worker control is authorized here.
