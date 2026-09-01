'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOperationGrant, assertOperationGrantMatches } = require('../src/authorization/execution-operation-grant-v1.cjs');

const d = (letter = 'a') => `sha256:${letter.repeat(64)}`;
function validGrantInput() { return { grantRef: 'grant.test', sourceApprovalRef: 'approval.test', organizationRef: 'org.test', actorRef: 'agent.runtime', automationRef: 'automation.test', jobRef: 'job.test', operationRef: 'operation.test', targetRef: 'target.test', commandDigest: d(), cwdDigest: d(), envDigest: d(), configDigest: d(), capabilityDigest: d(), issuedAt: '2026-09-01T00:00:00.000Z', expiresAt: '2026-09-02T00:00:00.000Z', maxUses: 2, status: 'active' }; }
function invocation() { const g = validGrantInput(); return { ...g }; }
test('grant binds exact operation digests and refs', () => { const grant = createOperationGrant(validGrantInput()); assert.equal(grant.schema, 'execution.operation-grant.v1'); assert.equal(grant.uses, 0); assert.throws(() => assertOperationGrantMatches(grant, { ...invocation(), cwdDigest: d('b') }), /cwd digest drift/); });
test('grant requires source approval and bounded expiry', () => { assert.throws(() => createOperationGrant({ ...validGrantInput(), sourceApprovalRef: null }), /sourceApprovalRef/); assert.throws(() => createOperationGrant({ ...validGrantInput(), maxUses: 0 }), /maxUses/); });
