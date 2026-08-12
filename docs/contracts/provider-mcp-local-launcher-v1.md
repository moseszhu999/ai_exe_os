# Registered Local MCP Launcher Executor v1

Status: stacked Draft implementation over AIEXE Provider Runtime P3.1. Merge=NO. Deploy=NO.

## Purpose

Close the third execution-path gap in the shared AIEXE Provider Runtime:

```text
TrainingOS / TradeOS / Video Operation / future Domain OS
→ AIEXE CapabilityVersion
→ provider.runtime.manifest.v1
→ provider.runtime.route.v1
→ provider.adapter.plan.v1
→ canonical execution.authorization.v1
→ exact registered local launcher
→ one bounded MCP tools/call
→ provider.execution.receipt.v1
```

This path is for local MCP hosts such as a desktop worker, Codex-adjacent host, local agent runtime, or other pre-registered process integration. It is **not** a generic shell/process executor.

## Exact transport scope

```text
providerKind      = mcp_server
protocolFamily    = mcp
transport.mode    = registered_local_launcher
protocolOperation = tools/call
riskClass         = observe | draft
```

The v1 executor deliberately refuses:

```text
internalWrite
externalAction
endpointRef
credentialRefs
networkPolicyRef
caller-supplied URL
caller-supplied command
caller-supplied argv
caller-supplied cwd
caller-supplied env
caller-supplied executable/path
arbitrary JSON-RPC method
```

## Registered-launcher boundary

The canonical Provider Runtime P0 contract already allows an opaque:

```text
launcherRef = launcher.<id>
```

The local executor resolves that reference through a destination-owned registry interface:

```js
launcherRegistry.resolve({
  providerId,
  protocolFamily: 'mcp',
  protocolVersion,
  launcherRef,
})
```

The only accepted registry result is:

```text
launcherRef
status = approved
protocolFamily = mcp
transportMode = registered_local_launcher
```

No command, process path, environment variable, working directory, shell argument, token, endpoint, or launcher implementation detail may cross this contract. Extra fields fail closed.

The effect port receives only:

```text
providerId
protocolVersion
launcher.launcherRef
request.requestId
request.method = tools/call
request.toolName
request.arguments
```

The destination-local transport remains responsible for mapping the opaque launcher reference to its already-approved local implementation.

## Authorization order

The executor preserves the existing AIEXE authorization owner and ordering:

```text
exact P1 plan + plan digest
→ observe/draft check
→ exact registered_local_launcher binding
→ exact action/target/HumanGate binding
→ evaluateExecutionAuthorizationV1(...)
→ decision == allow + current
→ exact launcher registry resolution
→ exactly one localMcpTransport.invokeTool(...)
→ bounded response validation
→ provider.execution.receipt.v1
```

Launcher resolution and local effect work do not happen before canonical authorization succeeds.

## Receipt boundary

The receipt remains secret-free and records:

```text
protocolFamily = mcp
protocolOperation = tools/call
launcherRef = exact opaque launcher ref
endpointRef = null
credentialRefs = []
networkPolicyRef = null
networkPerformed = false
credentialResolved = false
externalActionPerformed = false
automaticRetryPerformed = false
```

It does not record command lines, paths, environment, process identifiers, session identifiers, tokens, or raw launcher errors.

## MCP protocol status

This first local-launcher slice intentionally reuses the current outbound Provider Runtime constant:

```text
MCP_STABLE_PROTOCOL_VERSION = 2025-11-25
```

That preserves exact compatibility with the existing P2.3 outbound MCP executor. It does **not** claim that this is the final Group-wide MCP baseline.

Current `main` separately contains a newer inbound TradeOS MCP endpoint based on MCP SDK v2 / protocol `2026-07-28`. Therefore protocol-version convergence remains an explicit follow-on:

```text
current outbound provider executor = 2025-11-25
current merged inbound endpoint     = 2026-07-28
```

The migration must become an explicit provider/runtime protocol policy rather than silently changing a hard-coded version under existing receipts.

## P3/P3.1 follow-on

This slice adds the missing destination-local executor but does not yet alter the existing P3/P3.1 shared attempt wrapper. The current P3 plan-context code assumes an `endpointRef`, so registered-local-launcher attempts must not be claimed as P3/P3.1-supported until a follow-on generalizes transport identity to:

```text
remote MCP  → endpointRef + optional credential/network refs
local MCP   → launcherRef
```

That follow-on must preserve:

- exactly one effect-port entry per attempt;
- uncertain outcome after effect-port exceptions;
- no automatic retry;
- reviewed retry only;
- persistent request-digest claim before effect;
- restart recovery without replay;
- no second authorization/persistence owner.

## Focused tests

The dedicated local-launcher suite covers:

1. authorized observe execution using only an opaque launcher ref;
2. authorization denial before launcher resolution/effect;
3. exact registry ref/status/protocol/transport binding;
4. registry command/path/env/process metadata smuggling rejection;
5. endpoint/credential/network-policy widening rejection;
6. internalWrite/externalAction refusal;
7. MCP protocol drift and response metadata smuggling rejection;
8. sanitized local transport failure.

## Non-goals

```text
generic shell executor = NO
generic process spawn API = NO
raw command/argv/env/cwd = NO
arbitrary local path = NO
live Codex control = NO
remote Worker control = NO
internalWrite = NO
externalAction = NO
P3/P3.1 support claim = NO until follow-on
MCP 2026-07-28 migration = NO in this slice
merge = NO
deploy = NO
production mutation = NO
```
