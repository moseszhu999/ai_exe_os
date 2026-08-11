# Provider MCP Executor v1

## Status

P2.3 stacked after the unified Provider Runtime P0/P1/P2 model executor work.

This contract adds a bounded destination-local MCP tool execution path. It does not widen the S5 provider observation transport and does not add a generic JSON-RPC, HTTP, URL, method, or header execution surface.

## Scope

Accepted input is an exact `provider.adapter.plan.v1` created by P1 with all of the following:

- `providerKind = mcp_server`
- `protocolFamily = mcp`
- `transportBinding.mode = mcp_streamable_http`
- `protocolOperation = tools/call`
- semantic risk class `observe` or `draft`
- exact tool name already bound by the provider route and P1 plan digest
- exact opaque `endpoint.*` reference
- exact opaque `network.*` policy reference
- zero or one exact opaque `credential.*` reference

`internalWrite` and `externalAction` remain closed in P2.3.

## Stable MCP protocol pin

P2.3 intentionally pins the stable MCP protocol revision:

```text
2025-11-25
```

The transport adapter must report that exact negotiated protocol version. Version drift fails closed.

This is deliberate. The MCP draft changed transport/session semantics after the 2025-11-25 stable revision. AIEXE must not silently adopt a draft protocol behavior without an explicit reviewed contract change.

Primary specification references:

- https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- https://modelcontextprotocol.io/specification/draft/changelog

## Authority order

The executor preserves the same canonical authority order as the P2 model executor:

```text
exact P1 plan + plan digest
-> semantic risk must be observe|draft
-> exact authorization action/target binding
-> evaluateExecutionAuthorizationV1(...)
-> decision must equal allow and remain current
-> exact endpoint/network policy resolution
-> optional exact credential resolution
-> one destination-local mcpTransport.invokeTool(...)
-> provider.execution.receipt.v1
```

Authorization binding remains:

```text
action = provider.runtime.<providerId>.<operationId>
target = semanticOperation.targetRef || providerContractId
```

The executor consumes the accepted authorization owner. It never accepts `authorized=true`, does not create a HumanGate answer, and does not create AuthorityGrant/delegation truth.

## MCP transport port

The only MCP effect port is:

```text
mcpTransport.invokeTool({
  providerId,
  protocolVersion,
  endpoint,
  credential,
  request: {
    requestId,
    method: 'tools/call',
    toolName,
    arguments,
  },
})
```

There is no generic `invoke`, `fetch`, arbitrary JSON-RPC method, caller-selected HTTP method, caller-selected header map, or caller-selected URL.

The destination-local transport owns the concrete Streamable HTTP lifecycle, including initialize/session behavior required by the pinned stable MCP revision. Session identifiers are process-local transport state and are not Provider Runtime receipt fields.

The bounded transport result is:

```text
{
  protocolVersion: '2025-11-25',
  result: <bounded MCP tools/call result>,
  providerRequestId?: <bounded opaque string>
}
```

Raw response headers, session IDs, cookies, tokens, or transport debug bodies are rejected from the executor response contract.

## Endpoint policy

Remote MCP endpoints require exact approved HTTPS.

Local MCP is supported only when all of the following are true:

- resolver returns the exact `endpointRef`
- resolver returns the exact `networkPolicyRef`
- resolver status is `approved`
- URL host is exactly `127.0.0.1` or `[::1]`
- resolver explicitly sets `allowLoopbackHttp = true`

`localhost`, arbitrary private addresses, arbitrary HTTP origins, query parameters, fragments, and embedded URL credentials are not accepted by this executor contract.

This lets a destination-local Shared Media MCP server run on loopback without turning the runtime into an arbitrary internal-network HTTP client.

## Credentials

MCP execution supports either:

- no credential, or
- exactly one destination-resolved bearer credential

Raw credential values never appear in the Provider Runtime plan or execution receipt. The secret exists only in the process-local call into the destination-owned MCP transport.

## Result and evidence

A successful or tool-level-error MCP response returns the bounded MCP result to the immediate caller. The immutable receipt stores only evidence metadata and a digest of that result.

The receipt includes:

- request ID/digest
- plan digest
- provider contract and manifest digest
- protocol family/version/operation
- semantic operation and risk class
- exact tool name
- authorization decision reference/evidence digest
- opaque endpoint/credential/network-policy refs
- started/completed timestamps
- success or `tool_error`
- optional provider request ID
- response digest
- proof flags showing no external action and no automatic retry

The receipt does not store:

- endpoint URL
- bearer secret
- MCP session identifier
- response headers
- cookies
- raw transport error text
- raw tool result content

## Retry and uncertainty

P2.3 performs exactly one `invokeTool` call. Transport exceptions are sanitized and are never automatically retried.

A later shared P3 contract should own retry/idempotency/uncertainty semantics. Until then, transport failure requires a new reviewed execution attempt rather than silent replay.

## Non-goals

- registered-local-launcher MCP execution: NO
- MCP `internalWrite`: NO
- MCP `externalAction`: NO
- generic JSON-RPC executor: NO
- generic HTTP executor: NO
- arbitrary headers or URL: NO
- protocol draft auto-upgrade: NO
- HumanGate creation/approval: NO
- second authorization owner: NO
- merge: NO
- deploy: NO
- production/live provider credential use in validation: NO
