'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOperationGrant } = require('../src/authorization/execution-operation-grant-v1.cjs');
const { OperationGrantLedger } = require('../src/authorization/execution-operation-grant-ledger.cjs');
const d = (letter = 'a') => `sha256:${letter.repeat(64)}`;
const input = () => ({ grantRef: 'grant.test', sourceApprovalRef: 'approval.test', organizationRef: 'org.test', actorRef: 'agent.runtime', automationRef: 'automation.test', jobRef: 'job.test', operationRef: 'operation.test', targetRef: 'target.test', commandDigest: d(), cwdDigest: d(), envDigest: d(), configDigest: d(), capabilityDigest: d(), issuedAt: '2026-09-01T00:00:00.000Z', expiresAt: '2026-09-02T00:00:00.000Z', maxUses: 2, status: 'active' });
test('exact grant is consumed up to maxUses and then exhausted', async () => { const ledger = new OperationGrantLedger({ sourceApprovalReader: { get: async () => ({ status: 'approved' }) } }); const grant = ledger.put(createOperationGrant(input())); await ledger.consume(grant.grantRef, grant, '2026-09-01T01:00:00.000Z'); await ledger.consume(grant.grantRef, grant, '2026-09-01T02:00:00.000Z'); await assert.rejects(() => ledger.consume(grant.grantRef, grant, '2026-09-01T03:00:00.000Z'), /exhausted/); });
test('approval, revocation, expiry, and digest drift fail closed', async () => { const ledger = new OperationGrantLedger({ sourceApprovalReader: { get: async () => ({ status: 'pending' }) } }); const grant = ledger.put(createOperationGrant(input())); await assert.rejects(() => ledger.consume(grant.grantRef, grant, '2026-09-01T01:00:00.000Z'), /source_approval_missing/); });
