# `execution.operation-grant.v1`

An operation grant is a derivative, exact-repeat approval record sourced from the existing Human Gate/approval owner. It binds the organization, actor, automation, job, operation, target, command, working-directory, environment, configuration and capability digests, with issue/expiry, revocation, use count and maximum uses.

Every effect revalidates the source approval, current permission, all exact digests, expiry, revocation and use limit. Any drift is `grant_drifted` and requires a fresh Human Gate. The grant is not authority by itself: it cannot synthesize an `authorityGrant`, bypass `execution.authorization.v1`, create Domain truth, or authorize a provider without destination-local authorization.
