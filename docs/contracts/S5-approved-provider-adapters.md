# S5 Approved Provider Adapters Contract

Status: **NORMATIVE — IMPLEMENTATION BLOCKING**

Canonical coordination issue: **#73**

Exact starting baseline:

```text
main: 4982b2bd6fd896f26c85f6dc5146653804ebec07
S0: GO
S1: GO
S2: GO
S3: GO
S4: GO
```

## 1. Product definition

S5 adds approved external-provider observation to the accepted local execution OS.

The first S5 vertical slice is read-only:

```text
Workspace / Agent / Capability authority
→ accepted ProviderUseContract snapshot
→ exact approved provider target
→ immutable adapter definition
→ bounded GET/HEAD observation
→ normalized ProviderObservation
→ canonical SQLite evidence/event
→ S4 Operator Cockpit explanation
```

S5 is not a deployment engine and is not a generic HTTP client.

## 2. First accepted provider surfaces

The first provider-specific adapters are:

```text
Vercel public deployment observation
Netlify public deployment observation
```

They may observe an exact explicitly approved public HTTPS deployment target. The first slice does not require provider credentials and does not use authenticated control-plane APIs.

The accepted first-slice method set is exactly:

```text
GET
HEAD
```

No `POST`, `PUT`, `PATCH`, `DELETE`, provider SDK mutation, deploy, promote, rollback, domain mutation, environment mutation, secret mutation, billing mutation, SQL, schema mutation, or workflow-dispatch action belongs to this contract.

## 3. Authority boundaries

### Existing authority remains canonical

S5 reuses accepted authority:

- Workspace visibility and ownership;
- CapabilityInstallation / AgentCapabilityGrant;
- immutable CapabilityVersion metadata;
- accepted provider snapshot / ProviderUseContract gate;
- S1 HumanGate semantics for any future write-class action;
- S1/S2 canonical SQLite execution events/projections;
- S4 explanation/cockpit as a derived view.

S5 must not create a second provider-authorization truth.

### Provider adapter

A provider adapter translates one already-authorized provider observation action into one bounded provider request and one normalized result.

An adapter may not:

```text
select a Workspace
invent a grant
expand an allowed action
generate an arbitrary target
change provider contract status
retry a failed/uncertain provider request automatically
store credentials/cookies/tokens
perform provider writes
```

## 4. Canonical S5 model

```ts
interface ProviderAdapterDefinition {
  id: string;
  provider: 'vercel' | 'netlify';
  version: string;
  actions: ProviderActionDefinition[];
  status: 'available' | 'deprecated' | 'blocked';
}

interface ProviderActionDefinition {
  id: 'observe_public_deployment';
  methodSet: ('GET' | 'HEAD')[];
  responseBodyPolicy: 'none';
  actionClass: 'READ_ONLY';
}

interface ProviderTargetBinding {
  id: string;
  workspaceId: string;
  provider: 'vercel' | 'netlify';
  adapterId: string;
  providerContractId: string;
  action: 'observe_public_deployment';
  exactTarget: string;
  status: 'active' | 'disabled';
}

interface ProviderObservation {
  id: string;
  workspaceId: string;
  bindingId: string;
  adapterId: string;
  provider: 'vercel' | 'netlify';
  action: 'observe_public_deployment';
  method: 'GET' | 'HEAD';
  exactTarget: string;
  state: 'succeeded' | 'failed' | 'blocked';
  observedAt: string;
  statusCode: number | null;
  normalizedHeaders: object;
  evidenceDigest: string;
  failureCode: string | null;
}
```

Adapter definitions are immutable by `(id, version)` semantic identity. Changed semantics require a new version.

Target binding semantic key reuse with a different provider/action/target/contract is rejected.

## 5. Exact-target contract

Every network request must be preceded by all of:

```text
Workspace exists and is active
Agent/capability authority is valid when invoked through execution flow
ProviderUseContract snapshot exists
provider contract status is accepted
provider contract review is not expired
requested provider matches binding
requested adapter matches binding
requested action is explicitly allowed
requested HTTP method is GET or HEAD
exact target equals the approved binding target
external target scheme is HTTPS
external target contains no username/password component
external target contains no fragment
external target is not loopback/private/link-local/unspecified/multicast IP literal
provider hostname matches the provider-specific public deployment policy
```

Unknown or mismatched input fails before provider access.

The adapter interface must not expose an arbitrary `fetch(url, options)` capability to renderer/application callers.

## 6. Provider-specific target policy

Initial public-deployment policies:

```text
Vercel: exact approved target with provider classification for vercel public deployment surface
Netlify: exact approved target with provider classification for netlify public deployment surface
```

The exact target is canonical. Provider hostname classification is an additional safety check, not permission to observe every deployment under a suffix.

A suffix match alone never authorizes a target.

## 7. Redirect policy

Redirects are fail-closed and bounded.

Required rules:

```text
maximum redirect count is finite and small
redirect method may not upgrade into a write method
redirect target must remain inside the accepted exact-origin policy
redirect to a different unapproved origin is blocked
redirect to HTTP is blocked
redirect containing credentials is blocked
redirect to private/loopback/link-local target is blocked
```

The transport records bounded redirect metadata for evidence but does not persist unrestricted response bodies.

## 8. Response and evidence policy

The initial observation persists only bounded normalized metadata:

```text
HTTP status code
selected safe headers such as content-type / etag / last-modified / cache-control when present
adapter/provider identity
exact approved target
method
timing class / bounded failure code
evidence digest
```

Response-body policy for S5 v1 is `none`.

S5 must not persist or render:

```text
Authorization
Set-Cookie / Cookie
provider tokens
passwords
credential query values
browser profile paths
user-data paths
storage state
process IDs
raw provider secrets
```

## 9. Failure semantics

Provider failures are bounded observations, not retry authorization.

Examples:

```text
contract_blocked
action_blocked
target_mismatch
provider_mismatch
method_blocked
scheme_blocked
private_target_blocked
redirect_blocked
timeout
network_failure
http_failure
normalization_failure
```

A failed observation may be recorded once as evidence if a provider request actually occurred. Reissuing a network request requires a new explicit observation command / attempt identity.

Restart never automatically repeats an observation.

## 10. Workspace isolation

ProviderTargetBinding and ProviderObservation are Workspace-scoped.

Workspace B may not:

```text
query Workspace A bindings
query Workspace A observations
invoke Workspace A binding
reuse Workspace A exact target as implicit authority
```

Unknown explicit Workspace fails closed and never falls back to Workspace A.

## 11. Persistence

S5 uses the existing canonical SQLite event/projection authority.

Required semantic events may include:

```text
provider.target_bound
provider.target_disabled
provider.observation_requested
provider.observation_blocked
provider.observation_recorded
```

No second JSONL/provider database becomes canonical.

Projections must be rebuildable from canonical events and restart must not replay network access.

## 12. S4 cockpit integration

S4 may explain:

```text
provider adapter id/version
provider/action
exact approved target
contract status
latest observation status/evidence
blocked reason
last observed timestamp
```

S4 may not:

```text
override contract status
change exact target authority
perform provider write
mark observation successful without canonical evidence
clear provider blocker by UI-only mutation
```

## 13. IPC / renderer boundary

Renderer receives only bounded safe observation state.

Preload/API methods must be explicit and typed; no arbitrary URL/method passthrough.

Renderer remains:

```text
contextIsolation=true
nodeIntegration=false
sandbox=true
webSecurity=true
no direct SQLite access
safe DOM construction
```

## 14. First integrated user story

1. Workspace A has accepted read-only provider-use authority.
2. Bind one exact Vercel public deployment target and one exact Netlify public deployment target.
3. Observe each through its provider-specific adapter.
4. Method audit records only GET/HEAD.
5. Persist only normalized metadata/evidence digest in canonical SQLite.
6. Show results in S4 cockpit.
7. Reject wrong provider, wrong target, non-HTTPS, private target and write method before provider access.
8. Workspace B cannot see/invoke Workspace A bindings.
9. Restart rehydrates observations without network replay.
10. Native Electron acceptance proves two live approved provider targets and uploads privacy-safe immutable evidence.

## 15. Implementation ownership

After S5-A merges, disjoint owners may start from the same exact `main`:

```text
S5-B domain/validation:
  src/provider-adapters/domain/**
  tests/s5-provider-domain*.test.cjs

S5-C bounded transport:
  src/provider-adapters/transport/**
  tests/s5-provider-transport*.test.cjs

S5-D provider-specific normalizers:
  src/provider-adapters/providers/**
  tests/s5-provider-normalizers*.test.cjs

S5-E component UI:
  src/renderer/s5/**
  src/preload/s5-bridge-contract.cjs
  tests/s5-provider-ui*.test.cjs

S5-I shared integration only after B/C/D/E merge:
  src/application/** S5 integration files
  src/main/main.cjs
  src/preload/index.cjs
  root renderer composition
  canonical persistence wiring/tests

S5-F:
  read-only frozen product head
  acceptance scripts/workflows/results only
```

Sibling implementation owners may not import unmerged sibling branches.

## 16. Permanent exclusions

This contract does not authorize ChatGPT website automation, unsupported third-party AI-output extraction, credential/cookie/token replication, CAPTCHA or anti-abuse evasion, pricing/metering/rate/concurrency circumvention, provider deploy/write actions, production database mutation, or irreversible financial/legal execution.

Any provider write capability requires a separately reviewed contract and explicit Human-Gate semantics before implementation.
