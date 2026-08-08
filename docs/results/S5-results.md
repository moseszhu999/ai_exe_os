# S5 Approved Provider Adapters — Final Results

Status: **COMPLETED — GO**

Canonical parent: **#73**

Final product scope: exact-target, public, read-only provider observation for Vercel and Netlify.

## Accepted product head

```text
integration PR: #85
frozen accepted product head: 5b1933a284c00b86bf438a53af6beb94c8d6eda9
product merge commit: 66bfc21eec82b98edd0abca4315bbac47313f818
merge method: squash with expected_head_sha
```

The frozen product head did not move during S5-F. Product PR #85 was merged only after independent S5-F acceptance passed.

## Source validation

Exact frozen product source validation:

```text
workflow: S0 source validation
run: 31229722089
result: SUCCESS
source syntax: PASS
tests: 223 / 223 PASS
provider-boundary scan: PASS
```

The accepted integration preserves the service chain:

```text
S5 → S4 → S3 → S2 → S1
```

and preserves the sandbox preload rule established during S2: the root preload remains self-contained and requires only Electron.

## S5 product path

Accepted user path:

```text
Workspace / Agent / Capability authority
→ accepted ProviderUseContract snapshot
→ exact Workspace-scoped ProviderTargetBinding
→ immutable provider adapter/action identity
→ bounded HTTPS GET/HEAD observation
→ normalized ProviderObservation
→ canonical SQLite event/projection evidence
→ S4 Operator Cockpit explanation
```

Accepted provider adapters:

```text
vercel.public-deployment@1.0.0
netlify.public-deployment@1.0.0
```

The first S5 vertical slice is intentionally public and unauthenticated. No provider credential reference or authenticated provider API is part of this milestone.

## Final approved live targets

The final immutable S5-F acceptance used exactly:

```text
Vercel:
https://chaintrace-app.vercel.app/

Netlify:
https://gleaming-cajeta-c158d9.netlify.app/
```

Both are user-owned public production aliases resolved from connected hosting projects before the final passing run.

No other origin was accepted by the final matrix. Same-origin redirect was permitted under the S5 transport contract; cross-origin redirect remained fail-closed.

## Fail-closed target history

The failed attempts are retained as useful contract evidence rather than erased.

### Vercel generated deployment URL rejected

Initial candidate:

```text
https://chaintrace-eh6lm584p-aaronzhu1.vercel.app/
```

First S5-F live run:

```text
run: 31230662642
frozen source: PASS
native arm64: PASS
full source tests: PASS
live result: redirect_blocked
```

Provider inspection established that anonymous access redirected outside the approved origin to Vercel SSO and involved SSO state/cookie behavior.

S5 did **not** follow that redirect, copy a cookie, use a share URL, use a token, or weaken the redirect rule. The input was explicitly rejected and superseded by the same owned project's public production alias:

```text
https://chaintrace-app.vercel.app/
```

### Netlify project with no current deployment rejected

Initial candidate:

```text
https://chaintrace-app.netlify.app/
```

Second S5-F live run:

```text
run: 31231100498
frozen source: PASS
native arm64: PASS
full source tests: PASS
Vercel public alias: advanced successfully
Netlify result: http_failure
```

Connected Netlify project metadata reported no current deployment for that site. The input was explicitly rejected rather than treating project existence as deployment health.

A different user-owned Netlify project had an authoritative current READY production deployment:

```text
project: gleaming-cajeta-c158d9
site id: e05d452e-032a-4950-86ca-d72ca92faee9
current deploy id: 6a700c721d42ff0008452106
context: production
state: ready
public alias: https://gleaming-cajeta-c158d9.netlify.app/
```

That exact alias became the final approved Netlify acceptance target.

These revisions changed only acceptance inputs. They did not change the product transport or authorization policy.

## Independent S5-F acceptance

Canonical S5-F owner: **#80**

QA carrier:

```text
PR: #86
branch: qa/s5-native-live-provider-acceptance-v1
final carrier head: cce03b957bb46e2d14ef8dd56bbf03e3fba074a3
base: frozen product head 5b1933a284c00b86bf438a53af6beb94c8d6eda9
changed files: exactly 3 QA files
product files changed by carrier: 0
merged: false
```

Final workflow:

```text
workflow: S5 native live provider acceptance
run: 31231708249
result: SUCCESS
native job: 93036692361 — SUCCESS
exact frozen-source job: 93036692372 — SUCCESS
```

Acceptance evidence class:

```text
github-hosted-native-apple-silicon
```

This does not claim a personal physical workstation run.

## Native provider results

Final direct native matrix:

```text
architecture: arm64
Rosetta: not used
Electron executable: arm64
Vercel HEAD: 200 / succeeded
Netlify HEAD: 200 / succeeded
provider requests after restart: 0
```

Netlify performed one same-origin redirect:

```text
https://gleaming-cajeta-c158d9.netlify.app/
→ https://gleaming-cajeta-c158d9.netlify.app/jhc
```

The method remained `HEAD`, the origin remained unchanged, and the final status was 200. This is within the accepted same-origin redirect policy.

Negative rows proved fail-closed behavior before provider access for:

```text
private target
URL credentials
provider/adapter mismatch
cross-Workspace access
write method
```

## Real Electron results

The native S5-F run launched the real Electron application and exercised the S5 provider panel integrated into the S4 Operator Cockpit.

Bridge compatibility:

```text
S0 methods: 10
S1 methods: 6
S2 methods: 9
S3 methods: 7
S4 methods: 5
S5 methods: 3
```

Live Electron observations:

```text
Vercel GET: 200 / succeeded
Netlify GET: 200 / succeeded
page errors: 0
console errors: 0
```

The S5 UI exposes only:

```text
queryState
bindTarget
observe
```

It contains no free-form transport request builder and no provider write/deploy control.

Three real Electron screenshots were captured:

```text
s5-provider-before.png          1009 × 5661
s5-provider-after-live.png      1009 × 5860
s5-provider-after-restart.png   1009 × 5665
```

Independent visual review confirmed that the S5 surfaces are rendered inside the integrated operator console rather than as an empty shell.

## Restart and idempotency

Direct service restart:

```text
provider requests after restart: 0
bindings after restart: 2
observations after restart: 2
projection digest before: 0ffb939b8ef5093c98344e1681db62ae65f41fb5100859f14953230b41129104
projection digest after:  0ffb939b8ef5093c98344e1681db62ae65f41fb5100859f14953230b41129104
canonical event count before: 26
canonical event count after:  26
```

Electron same-userData restart:

```text
provider method audit after restart: []
canonical Vercel replay: replayed=true, networkRequested=false
canonical Netlify replay: replayed=true, networkRequested=false
```

Restart therefore reconstructs canonical provider state without provider replay.

## Canonical provider events

The final direct native evidence contains two exact target bindings and two completed observations.

Relevant event types include:

```text
provider.target_bound × 2
provider.observation_requested × 2
provider.observation_recorded × 2
```

Recorded provider observations are body-free and include normalized status/evidence digests only.

## Immutable artifacts

Native/live artifact:

```text
artifact id: 9014030399
GitHub digest: sha256:b4227fdb0eb05a30250a4dd8b876dec1bb760245ea565cf14c748b3de6117ccf
```

Exact-source artifact:

```text
artifact id: 9014024123
GitHub digest: sha256:9b3c6443e3afc91f4d1b1c16ca414060da407b62cea492bab1da5a936b07fc9d
```

Independent post-run audit downloaded both ZIPs and proved:

```text
actual native ZIP SHA256 == GitHub artifact digest
actual source ZIP SHA256 == GitHub artifact digest
native SHA256SUMS: all 16 listed files PASS
source checksums: 2 / 2 PASS
manifest product SHA: exact frozen product head
manifest approved targets: exact final Vercel + Netlify targets
recursive JSON/JSONL privacy scan: 0 findings
scoped residual processes: 0
```

## Privacy and authority result

The final evidence contains no raw:

```text
Authorization headers
cookies / Set-Cookie
passwords
provider tokens
private keys
browser profile paths
userData paths
process IDs
response bodies
```

Permanent S5 authority boundary:

```text
HTTPS only
GET/HEAD only
exact explicitly approved target
same-origin bounded redirect only
no arbitrary URL fetch primitive exposed to renderer
no response-body harvesting
no credential/token/cookie replication
no authenticated provider API in S5 v1
no deploy/promote/rollback/environment/domain/secret mutation
no GitHub write path
no automatic production deployment or database mutation
```

A future provider write capability requires a separate explicit contract, Human Gate policy, implementation owner, and independent acceptance. S5 GO does not grant that authority.

## Final verdict

```text
S5 Approved Provider Adapters: GO
```

The accepted result is a reusable, Workspace-scoped, exact-target, read-only provider observation layer with canonical SQLite evidence, real Vercel and Netlify live validation, real Electron integration, restart idempotency, and privacy-safe immutable evidence.
