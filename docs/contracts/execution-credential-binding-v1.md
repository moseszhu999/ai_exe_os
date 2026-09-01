# `execution.credential-binding.v1`

AIEXE resolves an opaque `credential.*` reference only after `execution.authorization.v1` returns `allow` and immediately before a destination-local effect. The resolver must match the exact provider, protocol, scheme, network policy, organization and expiry. Secret values are never persisted or projected into receipts, logs, model messages, transcripts, or Platform Workspace payloads.

The public binding contains `credentialRef`, provider/protocol metadata, status, expiry and `bindingDigest`. The secret is an in-memory transport concern owned by the destination executor. This contract does not create a Secret Store, grant Domain authority, or replace Human Gate/permission evaluation.
