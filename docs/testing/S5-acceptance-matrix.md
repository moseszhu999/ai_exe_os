# S5 Acceptance Matrix — Approved Provider Adapters

## Verdict policy

Allowed final verdicts:

```text
GO
GO WITH ARCHITECTURE CHANGE
NO-GO
```

No `GO` if any critical row below is unexecuted, if a write method is reachable in the first S5 provider path, if arbitrary URL access/Workspace leakage occurs, if restart replays provider access, if live provider rows are simulated, or if credential/profile/process-local values reach renderer/persistence/artifact.

## A. Source / owner scope

| Row | Requirement | Evidence |
| --- | --- | --- |
| A1 | frozen exact product head recorded | exact 40-char SHA |
| A2 | changed files stay within S5 owner scopes | PR/file audit |
| A3 | full S0/S1/S2/S3/S4 compatibility remains green | full validation |
| A4 | no duplicate S5 owner or conflicting shared-root writer | repo audit |
| A5 | S5-I starts only after B/C/D/E are accepted/merged | Git history/PR audit |

## B. Adapter domain / provider-use authority

| Row | Requirement | Evidence |
| --- | --- | --- |
| B1 | adapter id/version semantic identity is immutable | domain test |
| B2 | unknown/blocked adapter fails closed | domain test |
| B3 | provider/action mismatch fails closed | domain test |
| B4 | target binding semantic-key reuse with changed intent is rejected | domain test |
| B5 | provider contract must be accepted and current | integration test |
| B6 | provider contract is reused as authority, not duplicated by S5 | architecture/static test |
| B7 | exact target is required; suffix classification alone grants no authority | domain test |
| B8 | Workspace isolation applies to bindings/observations | domain/integration test |

## C. Bounded transport / SSRF / method policy

| Row | Requirement | Evidence |
| --- | --- | --- |
| C1 | external provider target requires HTTPS | transport test |
| C2 | GET allowed only when declared | transport test |
| C3 | HEAD allowed only when declared | transport test |
| C4 | POST/PUT/PATCH/DELETE rejected before network access | method audit test |
| C5 | URL username/password components rejected | transport test |
| C6 | loopback/private/link-local/unspecified/multicast IP literal rejected | address-policy test |
| C7 | wrong exact target rejected before network access | transport test |
| C8 | provider-classification mismatch rejected | transport/provider test |
| C9 | redirect count bounded | redirect test |
| C10 | redirect to unapproved origin blocked | redirect test |
| C11 | redirect to HTTP/private target blocked | redirect test |
| C12 | redirect never upgrades request to write method | redirect method audit |
| C13 | timeout/network failure is bounded and does not auto-retry | transport test |
| C14 | no arbitrary URL/method/headers IPC or application primitive exists | static test |

## D. Response / normalization boundary

| Row | Requirement | Evidence |
| --- | --- | --- |
| D1 | response-body persistence policy is `none` | contract/static test |
| D2 | safe-header allow-list excludes credential/cookie headers | test |
| D3 | Vercel normalizer deterministic for same bounded result | provider test |
| D4 | Netlify normalizer deterministic for same bounded result | provider test |
| D5 | provider-specific normalizers cannot issue network calls | static test |
| D6 | evidence digest excludes unrestricted body/secret values | test |
| D7 | normalization failure produces bounded failure evidence | test |

## E. Canonical persistence / idempotency

| Row | Requirement | Evidence |
| --- | --- | --- |
| E1 | target binding persists in existing SQLite authority | integration test |
| E2 | provider observation persists in existing SQLite authority | integration test |
| E3 | no second provider JSONL/database becomes canonical | static/storage test |
| E4 | same completed observation identity returns existing evidence without second request | request-count test |
| E5 | same identity with changed intent collides | test |
| E6 | failed/timeout observation does not grant automatic retry | test |
| E7 | projections rebuild deterministically | digest test |

## F. Workspace / Agent / capability integration

| Row | Requirement | Evidence |
| --- | --- | --- |
| F1 | Workspace B cannot query Workspace A binding/observation | integration test |
| F2 | Workspace B cannot invoke Workspace A binding | integration test |
| F3 | unknown explicit Workspace fails closed | integration test |
| F4 | execution-path observation preserves existing Agent/install/grant checks | integration test |
| F5 | provider-use blocker remains visible and exact | integration test |
| F6 | read-only classification cannot be upgraded by UI payload | IPC/application test |

## G. S4 cockpit / UI

| Row | Requirement | Evidence |
| --- | --- | --- |
| G1 | cockpit shows provider adapter/provider/action/exact target | UI test |
| G2 | cockpit shows contract status/latest observation/evidence | UI test |
| G3 | provider blocker is explainable and linked to canonical evidence/event | lineage test |
| G4 | S4/S5 UI cannot override provider contract | static/integration test |
| G5 | no provider write control appears | static/runtime UI audit |
| G6 | renderer receives no arbitrary response body | IPC/UI test |
| G7 | safe DOM construction; no direct Node/SQLite | static test |

## H. Restart / recovery

| Row | Requirement | Evidence |
| --- | --- | --- |
| H1 | restart rehydrates target bindings | SQLite restart test |
| H2 | restart rehydrates latest observations/evidence | SQLite restart test |
| H3 | restart performs zero provider network replay | method/request-count audit |
| H4 | attention/cockpit provider explanation rebuilds deterministically | state/digest comparison |
| H5 | failed observation remains failed/blocked until explicit new observation command | restart test |

## I. IPC / Electron security

| Row | Requirement | Evidence |
| --- | --- | --- |
| I1 | S5 IPC sender validation | contract test |
| I2 | S5 payload validation | contract test |
| I3 | no arbitrary URL/method/header pass-through in preload | static test |
| I4 | preload remains sandbox-safe/self-contained | static/runtime evidence |
| I5 | `contextIsolation=true` | static/runtime evidence |
| I6 | `nodeIntegration=false` | static/runtime evidence |
| I7 | `sandbox=true` | static/runtime evidence |
| I8 | `webSecurity=true` | static/runtime evidence |
| I9 | S0/S1/S2/S3/S4 APIs remain compatible | contract test |

## J. Privacy

| Row | Requirement | Evidence |
| --- | --- | --- |
| J1 | no Authorization/Bearer/token/password/cookie values in persisted observation | recursive scan |
| J2 | no Set-Cookie/Cookie header values in normalized evidence | test + artifact scan |
| J3 | no profilePath/profileDir/userData/storageState | recursive scan |
| J4 | no processId/pid/ppid | recursive scan |
| J5 | no raw response body in canonical artifact | artifact audit |
| J6 | no browser profile/user-data directory uploaded | artifact audit |

## K. Provider-specific live acceptance

S5-F must run against a frozen product head and explicitly configured approved targets.

Required provider rows:

| Row | Requirement | Required result |
| --- | --- | --- |
| K1 | explicit approved Vercel public target configured | exact target recorded |
| K2 | Vercel adapter resolves correctly | PASS |
| K3 | live Vercel observation method audit | GET/HEAD only |
| K4 | Vercel normalized observation/evidence canonical | PASS |
| K5 | explicit approved Netlify public target configured | exact target recorded |
| K6 | Netlify adapter resolves correctly | PASS |
| K7 | live Netlify observation method audit | GET/HEAD only |
| K8 | Netlify normalized observation/evidence canonical | PASS |
| K9 | no live request outside the two approved targets/allowed redirects | PASS |
| K10 | no POST/PUT/PATCH/DELETE in complete provider method audit | PASS |

If one explicitly approved target is unavailable, the row is blocked/failed. The harness may not replace it with an unrelated target and still claim GO.

## L. Native real-Electron sequence

S5-F runs on native arm64 macOS using the real Electron application.

Required sequence:

```text
launch app
→ select Workspace A
→ bind exact approved Vercel target
→ bind exact approved Netlify target
→ observe Vercel
→ observe Netlify
→ verify canonical provider observations/evidence
→ verify S4/S5 cockpit explanation
→ attempt wrong Workspace/target/write method and prove pre-network fail-closed
→ restart app
→ prove bindings/observations rehydrate
→ prove provider request count does not increase on restart
→ capture screenshots/state/method audit
→ cleanup scoped processes
```

Critical native results:

| Row | Requirement | Result |
| --- | --- | --- |
| L1 | native architecture | `arm64` |
| L2 | real Electron | PASS |
| L3 | Vercel live read-only observation | PASS |
| L4 | Netlify live read-only observation | PASS |
| L5 | Workspace fail-closed | PASS |
| L6 | restart provider replay count | `0` new requests |
| L7 | page errors | `0` |
| L8 | console errors | `0` |
| L9 | residual scoped processes | `0` |

## M. Final artifact

Portable privacy-safe artifact includes at least:

```text
manifest.json
exact-product-head.txt
provider-target-bindings.json
provider-observations.json
provider-method-audit.json
provider-safety-matrix.json
canonical-events.jsonl
projection-restart-digests.json
electron-ui-audit.json
screenshot(s)
cleanup-audit.json
SHA256SUMS.txt
```

Every manifest/checksum entry self-validates before upload.

## N. Stop conditions

Immediate repair-before-GO or `NO-GO` if any occurs:

```text
arbitrary URL fetch is reachable
POST/PUT/PATCH/DELETE reaches first-slice provider transport
redirect escapes approved target/origin policy
private/loopback target is reachable through external provider adapter
Workspace leakage occurs
provider contract can be overridden by S5/S4
response body is harvested/persisted contrary to contract
credentials/cookies/tokens/profile/process-local data leak
restart replays a provider request
live provider row is simulated or substituted
provider write capability is added without a separate accepted contract
```
