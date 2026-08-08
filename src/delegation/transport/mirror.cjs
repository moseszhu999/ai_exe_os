'use strict';

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeDeep(nested);
  return Object.freeze(value);
}

class DelegationExchangeMirror {
  constructor() {
    this.requestsById = new Map();
    this.requestOrder = [];
    this.acksByRequestId = new Map();
    this.receiptsByKey = new Map();
    this.receiptOrder = [];
    this.cancellationsById = new Map();
  }

  appendRequest(request) {
    if (!request || typeof request !== 'object') throw new TypeError('delegation request is required');
    const existing = this.requestsById.get(request.id);
    if (existing) {
      if (existing.requestDigest === request.requestDigest) return freezeDeep({ state: 'duplicate', reasonCode: 'exact_duplicate', request: existing });
      return freezeDeep({ state: 'divergent', reasonCode: 'request_digest_conflict', requestId: request.id });
    }
    const sameSequence = this.requestOrder.map((id) => this.requestsById.get(id)).find((item) => (
      item.sourceInstanceId === request.sourceInstanceId
      && item.peerBindingId === request.peerBindingId
      && item.requestSequence === request.requestSequence
    ));
    if (sameSequence) return freezeDeep({ state: 'divergent', reasonCode: 'request_sequence_conflict', requestId: request.id });
    this.requestsById.set(request.id, freezeDeep({ ...request }));
    this.requestOrder.push(request.id);
    return freezeDeep({ state: 'accepted', reasonCode: 'stored', request: this.requestsById.get(request.id) });
  }

  readInbox({ destinationInstanceId, destinationWorkspaceId, sinceSequence = 0 }) {
    return freezeDeep(this.requestOrder
      .map((id) => this.requestsById.get(id))
      .filter((item) => item.destinationInstanceId === destinationInstanceId
        && item.destinationWorkspaceId === destinationWorkspaceId
        && Number(item.requestSequence) > Number(sinceSequence))
      .sort((a, b) => a.requestSequence - b.requestSequence));
  }

  recordAck(ack) {
    if (!ack || typeof ack !== 'object') throw new TypeError('delegation acknowledgement is required');
    const request = this.requestsById.get(ack.requestId);
    if (!request) return freezeDeep({ state: 'rejected', reasonCode: 'unknown_request' });
    if (request.requestDigest !== ack.requestDigest) return freezeDeep({ state: 'divergent', reasonCode: 'request_digest_conflict' });
    const existing = this.acksByRequestId.get(ack.requestId);
    if (existing) {
      if (JSON.stringify(existing) === JSON.stringify(ack)) return freezeDeep({ state: 'duplicate', reasonCode: 'exact_duplicate', ack: existing });
      return freezeDeep({ state: 'divergent', reasonCode: 'ack_conflict' });
    }
    const stored = freezeDeep({ ...ack });
    this.acksByRequestId.set(ack.requestId, stored);
    return freezeDeep({ state: 'accepted', reasonCode: 'stored', ack: stored });
  }

  appendReceipt(receipt) {
    if (!receipt || typeof receipt !== 'object') throw new TypeError('delegation receipt is required');
    const key = `${receipt.delegationRequestId}:${receipt.receiptRevision}`;
    const existing = this.receiptsByKey.get(key);
    if (existing) {
      if (existing.receiptDigest === receipt.receiptDigest) return freezeDeep({ state: 'duplicate', reasonCode: 'exact_duplicate', receipt: existing });
      return freezeDeep({ state: 'divergent', reasonCode: 'receipt_digest_conflict' });
    }
    const stored = freezeDeep({ ...receipt });
    this.receiptsByKey.set(key, stored);
    this.receiptOrder.push(key);
    return freezeDeep({ state: 'accepted', reasonCode: 'stored', receipt: stored });
  }

  readReceipts({ sourceInstanceId, sourceWorkspaceId, sinceRevision = 0 }) {
    return freezeDeep(this.receiptOrder
      .map((key) => this.receiptsByKey.get(key))
      .filter((item) => item.sourceInstanceId === sourceInstanceId
        && item.sourceWorkspaceId === sourceWorkspaceId
        && Number(item.receiptRevision) > Number(sinceRevision))
      .sort((a, b) => a.receiptRevision - b.receiptRevision));
  }

  appendCancellation(cancellationProposal) {
    if (!cancellationProposal || typeof cancellationProposal !== 'object') throw new TypeError('cancellation proposal is required');
    const existing = this.cancellationsById.get(cancellationProposal.id);
    if (existing) {
      if (JSON.stringify(existing) === JSON.stringify(cancellationProposal)) return freezeDeep({ state: 'duplicate', reasonCode: 'exact_duplicate', cancellationProposal: existing });
      return freezeDeep({ state: 'divergent', reasonCode: 'cancellation_id_conflict' });
    }
    if (!this.requestsById.has(cancellationProposal.delegationRequestId)) return freezeDeep({ state: 'rejected', reasonCode: 'unknown_request' });
    const stored = freezeDeep({ ...cancellationProposal });
    this.cancellationsById.set(stored.id, stored);
    return freezeDeep({ state: 'accepted', reasonCode: 'stored', cancellationProposal: stored });
  }
}

module.exports = { DelegationExchangeMirror };
