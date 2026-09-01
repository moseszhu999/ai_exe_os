# Provider Anthropic Messages Executor v1

Status: P2.4 stacked draft contract.

This contract extends the existing AIEXE model provider executor with one additional bounded protocol family: `anthropic.messages`.

It does not create a second authorization owner, credential store, provider router, scheduler, generic HTTP client, or Domain truth owner.

## Exact authority chain

```text
provider.runtime.manifest.v1
-> exact provider.runtime.route.v1
-> provider.adapter.plan.v1
-> exact plan digest verification
-> execution.authorization.v1
-> exact endpoint/network-policy resolution
-> exact credential resolution
-> one destination-local HTTPS transport invocation
-> provider.execution.receipt.v1
```

No endpoint, credential, or network work may happen before the canonical execution authorization result is `allow` and current.

## Supported scope

```text
providerKind      = model_api
protocolFamily    = anthropic.messages
protocolOperation = messages.create
transport.mode    = https
riskClass         = observe | draft
credential count  = exactly 1
credential scheme = api_key
API version        = 2023-06-01
```

`internalWrite` and `externalAction` remain closed in the model executor.

## Wire contract

The exact endpoint URL is not supplied by the caller. It is resolved from the opaque `endpoint.*` reference after authorization and must be an approved HTTPS URL with no embedded credentials, query, or fragment.

The transport method is fixed internally to `POST`.

Headers are constructed only by the executor:

```text
x-api-key: <process-local resolved secret>
anthropic-version: 2023-06-01
content-type: application/json
```

The caller cannot provide:

- `x-api-key`
- `authorization`
- `anthropic-version`
- `anthropic-beta`
- arbitrary headers
- arbitrary HTTP method
- arbitrary URL
- raw credential material

The P1 adapter plan already restricts Anthropic requests to:

```text
modelRef
messages[] with user/assistant roles
optional system text
required maxTokens
```

and compiles them to the bounded `messages.create` payload.

## Credential boundary

Anthropic direct Messages execution requires the destination credential resolver to return the exact opaque credential reference with:

```text
status = ready
scheme = api_key
secret = process-local value
```

OpenAI/OpenAI-compatible model execution continues to require `scheme=bearer` and uses the internal `Authorization: Bearer ...` header. The executor does not permit callers to choose or override the credential-to-header mapping.

## Protocol version evidence

The executor pins Anthropic API version `2023-06-01` and passes it to the endpoint resolver, destination transport, and immutable provider execution receipt as `protocolVersion`.

This is intentionally explicit. A future Anthropic API-version change must move code/evidence and revalidate exact-head behavior; it must not silently drift through environment configuration or caller headers.

## Response boundary

The destination transport returns only:

```text
statusCode
contentType
bodyText
providerRequestId?
```

Raw response headers are rejected. Responses must be bounded valid JSON. A 2xx payload is returned to the authorized caller separately from the receipt. Non-2xx provider payloads do not become result data and are not copied into the receipt.

Transport exceptions are normalized to the bounded error `provider transport failed` so endpoint or credential material cannot leak through raw exception text.

## Receipt boundary

`provider.execution.receipt.v1` records only bounded evidence including:

```text
requestDigest
planDigest
providerManifestDigest
protocolFamily = anthropic.messages
protocolVersion = 2023-06-01
protocolOperation = messages.create
authorization decision reference/digest
opaque endpoint/credential/network-policy refs
timestamps
outcome/status
provider request id when bounded
response digest
```

It never stores the real endpoint URL, API key, request headers, raw provider error body, or raw transport exception.

## Official protocol basis

Anthropic's current Messages examples require an API key header, an `anthropic-version` header, JSON content, and the `/v1/messages` Messages API shape. P2.4 pins the stable API version currently shown by Anthropic's official Messages examples: `2023-06-01`.

No beta header is part of this P2.4 contract.

## Non-goals

```text
generic provider HTTP surface     NO
caller-controlled headers         NO
caller-controlled auth scheme     NO
Anthropic beta feature passthrough NO
internalWrite                      NO
externalAction                     NO
automatic provider selection       NO
production credential validation   NO
merge                              NO
deploy                             NO
```

Follow-on work should consolidate shared model/MCP uncertainty, retry, idempotency, and reviewed-retry semantics before any write-capable provider executor is considered.
