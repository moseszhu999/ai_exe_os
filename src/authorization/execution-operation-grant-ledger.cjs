'use strict';

const { createHash } = require('node:crypto');
const { assertOperationGrantMatches, normalizeOperationGrant } = require('./execution-operation-grant-v1.cjs');

function digest(value) { return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }

class OperationGrantLedger {
  constructor({ sourceApprovalReader, clock = () => new Date().toISOString() } = {}) {
    this.records = new Map();
    this.sourceApprovalReader = sourceApprovalReader ?? { get: async () => ({ status: 'approved' }) };
    this.clock = clock;
  }
  put(grant) { const value = normalizeOperationGrant(grant); this.records.set(value.grantRef, value); return value; }
  get(grantRef) { return this.records.get(grantRef); }
  revoke(grantRef, reason, at = this.clock()) { const current = this.records.get(grantRef); if (!current) throw new Error('grant missing'); const next = normalizeOperationGrant({ ...current, status: 'revoked', revokedAt: at }); this.records.set(grantRef, next); return next; }
  async consume(grantRef, invocation, at = this.clock()) {
    const current = this.records.get(grantRef);
    if (!current) throw new Error('grant missing');
    const approval = await this.sourceApprovalReader.get(current.sourceApprovalRef);
    if (!approval || approval.status !== 'approved') throw new Error('source_approval_missing');
    if (current.status === 'revoked') throw new Error('grant_revoked');
    if (Date.parse(current.expiresAt) <= Date.parse(at)) throw new Error('grant_expired');
    if (current.uses >= current.maxUses || current.status === 'exhausted') throw new Error('grant_exhausted');
    const match = assertOperationGrantMatches(current, invocation);
    const nextUses = current.uses + 1;
    const next = normalizeOperationGrant({ ...current, uses: nextUses, status: nextUses >= current.maxUses ? 'exhausted' : 'active' });
    this.records.set(grantRef, next);
    return Object.freeze({ grant: next, useRef: `grantuse_${digest({ grantRef, uses: nextUses }).slice(7, 31)}`, useDigest: match.useDigest });
  }
}

module.exports = { OperationGrantLedger };
