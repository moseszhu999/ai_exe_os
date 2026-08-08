# TrainingOS MCP Runtime Attestation v1

Status: S1A source contract / observe-only pre-installation gate

## Purpose

This slice is the first runtime-facing step after the merged TrainingOS Course Design Capability v1.1.

It deliberately does **not** make the capability installable and does not create a second connection, authorization, installation, grant, scheduler, Mission or evidence authority.

The split is intentional:

```text
S1A
current immutable draft CapabilityVersion
→ authenticated MCP initialize
→ exact server identity
→ runtime version floor
→ tools/list
→ required observe-tool annotations
→ bounded discovery receipt

S1B (later, only after live S1A evidence)
new immutable available CapabilityVersion
→ existing CapabilityInstallation
→ existing Workspace-scoped AgentCapabilityGrant
→ read-only tool invocation
→ existing canonical evidence path
```

The split avoids circular reasoning. The current v1.1 CapabilityVersion is `draft`, while the existing AI Execution OS installation model correctly rejects versions that are not `available`.

## Existing authorities remain canonical

This contract reuses, rather than replaces:

```text
CapabilityPackage
→ immutable CapabilityVersion
→ CapabilityInstallation
→ Workspace-scoped AgentCapabilityGrant
→ Task / Human Gate / execution / evidence
```

S1A uses only the already-compiled capability metadata. It does not persist an Installation or Grant.

## TrainingOS runtime truth used by this contract

Current owning repository snapshot inspected for this slice:

```text
repo: moseszhu999/training-learning-rails
observed main: ca2ea700ef2b19febad23f4892d03dcf35a598ad
```

Canonical HTTP surface:

```text
GET  /api/integrations/agents/mcp
POST /api/integrations/agents/mcp
```

The Netlify route maps that path to the single `trainingos-mcp` function.

GET is protected-resource metadata. POST is MCP JSON-RPC.

The final function composes the existing TrainingOS MCP layers rather than creating a second MCP server. The current outer Challenge Runtime layer reports:

```text
serverInfo.name = trainingos-agent-gateway
serverInfo.version = 1.6.0
```

The Course Design Capability v1.1 correctly declares:

```text
trainingos.mcp >= 0.5.2
```

`0.5.2` is therefore a **minimum compatible runtime version**, not an assertion that the final composed server must still report exactly `0.5.2`.

This distinction is important because inner MCP layers may evolve independently while the final composed endpoint advances its own server version.

## Authentication truth

TrainingOS `initialize` itself calls the authenticated context provider. Therefore a real S1A network probe requires a current valid TrainingOS OAuth bearer.

S1A does not mint, copy, persist or log that bearer.

The core verifier accepts an injected MCP client interface:

```text
client.request(jsonRpcMessage)
```

Token acquisition/refresh remains owned by the existing TrainingOS OAuth/delegated-identity path and a later bounded connection runner. The core verifier has no `accessToken`, cookie, password, credential or Authorization-header field.

A 401 / JSON-RPC `-32001` during `initialize` or `tools/list` produces:

```text
status = auth_required
verified = false
```

It is never upgraded to a PASS.

## Observe-only scope

S1A accepts only a Capability manifest whose non-observe grant classes are empty:

```text
draft = []
internalWrite = []
externalAction = []
```

For Course Design v1.1 the required observe tools are:

```text
get_class_learning_structure
get_course_design_context
```

The final TrainingOS MCP may advertise many additional tools, including bounded write tools. Their presence does not grant them to this capability.

Only the observe tools declared in the immutable CapabilityVersion are attested.

## Required runtime checks

A successful `verified_discovery` receipt requires all of the following:

1. the compiled capability has exactly one required `trainingos.mcp` dependency;
2. the capability is observe-only for this S1A slice;
3. authenticated `initialize` succeeds;
4. `serverInfo.name` is exactly `trainingos-agent-gateway`;
5. observed stable server semver is greater than or equal to the manifest minimum;
6. `tools/list` succeeds under the same caller context;
7. every required observe tool appears exactly once;
8. every required observe tool has `readOnlyHint=true`;
9. every required observe tool has `destructiveHint=false`;
10. the emitted receipt contains only a bounded normalized subset and no server/tool secret-shaped metadata.

Server extras are not copied into the receipt.

## Receipt

Success:

```text
schemaVersion = ai-execution-os.mcp-runtime-attestation.v1
status = verified_discovery
verified = true
packageId
capabilityVersion
capabilityIntegrityDigest
serverId
expectedServerName
observedServerName
minimumServerVersion
observedServerVersion
protocolVersion
requiredObserveTools[]
observedRequiredTools[]
discoveryDigest
checkedAt
truthBoundary
```

Authentication blocker:

```text
status = auth_required
verified = false
phase = initialize | tools/list
```

## Truth boundary

Every S1A receipt fixes:

```text
installationPerformed=false
agentGrantPerformed=false
toolInvocationPerformed=false
canonicalWritePerformed=false
humanApprovalInferred=false
```

A successful source/unit test of this verifier proves verifier behavior only.

A real runtime PASS additionally requires a separately evidenced authenticated network run against the exact intended TrainingOS MCP endpoint. A ready Netlify deploy, repository source, unit test or fake client is not that network evidence.

## Deliberate non-goals

S1A does not:

- change TrainingOS;
- create another TrainingOS MCP endpoint;
- create an AI Execution OS super-token;
- copy a human OAuth bearer into canonical state;
- make Course Design v1.1 `available`;
- create CapabilityInstallation;
- create AgentCapabilityGrant;
- call a course-design tool;
- create a Mission or Task;
- execute a Human Gate;
- write TrainingOS data;
- touch S6 scheduling;
- perform Production deployment.

## Next gate

Do not start S1B merely because source tests pass.

S1B requires an authentic S1A runtime artifact showing either:

```text
verified_discovery
```

or a truthful blocker such as:

```text
auth_required
network_unreachable
server_identity_mismatch
version_below_floor
required_tool_missing
required_tool_not_read_only
```

Only a real authenticated `verified_discovery` may justify publishing a new immutable install-ready Course Design Capability version for the existing Installation / AgentGrant path.
