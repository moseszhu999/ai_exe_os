# Provider Terms and Supported Paths Gate

Status: **NORMATIVE — BLOCKING**

This document adds a second feasibility gate to AI Execution OS.

The project must distinguish:

```text
technical browser-control feasibility
from
provider-authorized product use
```

A browser action being technically possible does not mean the target provider permits it.

## Normative precedence

This document overrides any earlier S0 wording that could be read as authorization to automate an arbitrary signed-in AI website.

Until a target provider passes this gate, the S0 spike may use only:

```text
local test pages
project-owned test services
explicitly authorized public test repositories
provider-supported official automation surfaces
manual browser navigation without programmatic output extraction
```

## OpenAI / ChatGPT current gate

OpenAI's individual Terms of Use, effective January 1, 2026, state that users may not:

- automatically or programmatically extract data or Output;
- interfere with or disrupt the Services;
- circumvent rate limits or restrictions;
- bypass protective measures or safety mitigations.

Primary source:

- https://openai.com/policies/terms-of-use/

Therefore the current project must not implement ChatGPT web automation whose purpose or effect is to:

```text
programmatically submit and harvest many ChatGPT conversations
extract ChatGPT output into the scheduler automatically
circumvent subscription limits, concurrency limits, rate limits, or usage restrictions
replace a supported paid interface with browser automation to avoid its pricing
hide automation through user-agent, fingerprint, TCP, TLS, or protocol impersonation
```

This remains blocked even when:

```text
the user is manually signed in;
the browser is visible;
the session uses a normal Chrome profile;
the action is performed through DOM clicks rather than an API;
the software is local-only or open source.
```

Human supervision does not by itself convert a prohibited automated extraction or limit-circumvention workflow into a supported use.

## Supported OpenAI paths

The project may integrate an OpenAI surface only when the exact path is currently supported and the integration follows its documented limits.

Possible supported categories include:

```text
official ChatGPT product features
official desktop browser or Chrome-extension workflows
official connectors and actions
official developer APIs under their applicable terms
manual user interaction without programmatic output extraction
```

A product feature being available does not imply that an independent third-party scheduler may automate it.

Before implementing any OpenAI provider adapter, record:

```text
provider
product surface
account/plan type
current governing terms
supported automation mechanism
permitted inputs and outputs
rate/concurrency limits
human confirmation requirements
prohibited behavior
review date
source links
```

## Per-provider gate

Every target provider requires a `ProviderUseContract` before implementation.

```ts
interface ProviderUseContract {
  providerId: string;
  surfaceId: string;
  reviewedAt: string;
  governingTerms: string[];
  supportedMechanism: string;
  permittedActions: string[];
  prohibitedActions: string[];
  rateAndConcurrencyLimits: string[];
  authenticationPath: string;
  humanConfirmationPolicy: string;
  evidenceRequired: string[];
  status: "approved" | "manual-only" | "blocked" | "unknown";
}
```

Default status is:

```text
unknown → blocked for automation
```

## S0 scope after this amendment

The S0 technical spike may prove:

```text
Electron control plane
managed persistent Chrome/Chromium profiles
two-worker isolation
profile leases
restart recovery
pause/resume/focus
human-gated local task transitions
read-only GitHub state transitions
```

It must not use ChatGPT web output extraction as acceptance evidence.

Scenario C from the original spike contract is amended to use one of:

```text
a local project-owned prompt simulator;
a local HTML task form;
an explicitly supported provider test surface;
manual-only interaction where the scheduler does not capture or extract output.
```

The scheduler may record only generic execution evidence such as:

```text
page opened
human confirmation requested
human confirmed
form submitted on an authorized test page
local test response observed
```

## Cost thesis boundary

The project may measure:

```text
local CPU and memory cost
browser process count
session reuse efficiency
task latency
operator time
GitHub workflow throughput
```

It must not define success as avoiding, evading, or circumventing a provider's pricing, metering, usage limits, or supported commercial interface.

## Stop conditions

Stop a provider adapter immediately if:

```text
its purpose depends on bypassing usage limits;
it requires automated output extraction prohibited by current terms;
it requires identity, fingerprint, user-agent, TCP, TLS, or protocol impersonation;
it requires CAPTCHA or anti-abuse bypass;
the supported mechanism is unclear;
the provider blocks or withdraws the relevant automation path.
```

## Review cadence

Provider terms and product capabilities change. Each contract must be re-reviewed:

```text
before first implementation
before public release
before enabling external writes
after a material provider policy or product change
at least every 90 days while the adapter remains active
```

## Current provider status

| Provider surface | Status | Current S0 use |
|---|---|---|
| Local/project-owned test pages | approved | technical orchestration tests |
| GitHub API / `gh` read-only state | approved subject to GitHub terms | PR/check scheduling evidence |
| ChatGPT web automated prompt/output workflow | blocked | not allowed in S0 |
| ChatGPT manual user interaction | manual-only | no programmatic output extraction |
| Vercel / Netlify / Supabase / Neon | unknown until reviewed | no S0 write adapter |

## Verdict impact

The technical architecture remains viable, but the product decision becomes:

```text
CONDITIONAL GO
```

The condition is permanent:

```text
each provider adapter must pass an explicit terms-and-supported-paths gate.
```
