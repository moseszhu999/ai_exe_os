# M2.14 / M2.16 — First real external Controller source cycle and independent revalidation

Date: 2026-08-10  
Owner: PR #125 / `agent/group-management-plane-m0`  
Authority: read-only evidence only

## Corrected outcome

M2.14 established a real and useful fact: all three external core Domains publish one canonical marked out-of-band Controller source using the accepted `aiexe.external-controller-attestation.v1` protocol.

```text
TrainingOS
  sourceRef    https://github.com/moseszhu999/training-learning-rails/issues/477#issuecomment-5236850688
  attestedHead 8f0d38dca4dcd28883359c427e133d0c1a9eebb8

TradeOS
  sourceRef    https://github.com/moseszhu999/chaintrace-app/issues/567#issuecomment-5236890201
  attestedHead 6958c3b5fb3a8d8b6b70b7a614910b0e1ea9202b

Video Operation / Shared Media
  sourceRef    https://github.com/moseszhu999/global-tool-radar/issues/115#issuecomment-5236897897
  attestedHead 24996407449df28b2d83fce1a145b3200fff168a
```

The exact source bodies remain captured in:

```text
fixtures/management/m2-real-external-controller-adoption-cycle-2026-08-10.json
```

That source-capture fixture proves:

1. three real marked structured sources exist;
2. each recorded full-body SHA-256 matches its captured body;
3. only the marked JSON block becomes authoritative input;
4. repository/head fields are explicit;
5. surrounding prose is non-authoritative;
6. LLM fact generation is not part of the acceptance path.

## M2.16 correction — source existence is not provider-head proof

The original M2.14 focused test incorrectly reused each source fixture's own `headSha` as the GitHub provider observation head. That created a self-validating loop: the attestation supplied the head that was then used to decide whether the attestation matched the head.

M2.16 removes that assumption. Provider `main` head must now be supplied from an independent read-only provider observation.

Canonical independent revalidation evidence:

```text
fixtures/management/m2-external-controller-adoption-revalidation-2026-08-10.json
schema        aiexe.external-controller-adoption-revalidation.v1
evidenceClass REAL_EXTERNAL_CONTROLLER_INDEPENDENT_HEAD_REVALIDATION
```

Independently observed provider heads:

```text
TrainingOS
  provider main 8f0d38dca4dcd28883359c427e133d0c1a9eebb8
  attested head 8f0d38dca4dcd28883359c427e133d0c1a9eebb8
  result        accepted_exact_head_current

TradeOS
  provider main 6958c3b5fb3a8d8b6b70b7a614910b0e1ea9202b
  attested head 6958c3b5fb3a8d8b6b70b7a614910b0e1ea9202b
  result        accepted_exact_head_current

Video / Shared Media
  provider main 23d92ffc4674f1581c4191e595d279a20008be53
  attested head 24996407449df28b2d83fce1a145b3200fff168a
  result        exact_head_mismatch -> unknown
```

Therefore the superseding first-cycle truth is:

```text
external structured source existence       3 / 3
independent first-cycle current acceptance  2 / 3
rejected on exact-head mismatch              1 / 3
first-cycle acceptance complete              NO
recurring structured producer proof          0 / 3
G3                                            PARTIAL
G4 / A2 execution                             UNAUTHORIZED
```

The previous statement `first-cycle exact-head acceptance = 3 / 3` is superseded and must not be used as evidence.

## Regression boundary

`tests/m2-real-external-controller-adoption-cycle.test.cjs` now requires an independently supplied provider head. The observation helper refuses to default to the attestation source head, preventing this self-proof pattern from returning.

A later real Domain cycle must still provide a fresh canonical source and independently pass full-body digest, repository binding, exact-head and freshness checks. The Video/Media path additionally needs a source that attests the actual current provider head at observation time.

## Authority boundary

```text
external scheduler mutation                NO
second scheduler                            NO
external Domain repository mutation         NO
LLM prose-to-truth extraction               NO
cross-repository credentials                NO
A2 execution                                NO
Domain write                                NO
Merge PR #125                               NO while gated
Deploy                                      NO
Production mutation                         NO
Payment / settlement / wallet / token       NO
remote Worker control                       NO
HumanGate decision                          NO
```
