'use strict';

const { assertSafeIdentifier } = require('../../domain/identifiers.cjs');
const { requiredText } = require('../../domain/workspace-model.cjs');
const { isLoopbackHost } = require('../../sync/transport/index.cjs');

const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 5000;
const OPERATIONS = Object.freeze({
  request: { path: 'delegations/requests', method: 'POST' },
  inbox: { path: 'delegations/inbox', method: 'GET' },
  ack: { path: 'delegations/acks', method: 'POST' },
  receipts: { path: 'delegations/receipts', method: 'GET' },
  cancellation: { path: 'delegations/cancellations', method: 'POST' },
});

function assertDelegationEndpointUrl(value, { allowLoopback = false } = {}) {
  const text = requiredText(value, 'delegation endpoint url', 2048);
  let url;
  try { url = new URL(text); } catch { throw new TypeError('delegation endpoint must be a valid URL'); }
  if (url.username || url.password) throw new Error('delegation endpoint must not contain URL credentials');
  if (url.hash) throw new Error('delegation endpoint must not contain a fragment');
  const loopback = isLoopbackHost(url.hostname);
  if (loopback && allowLoopback) {
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('loopback delegation endpoint must use HTTP(S)');
  } else if (url.protocol !== 'https:') {
    throw new Error('external delegation endpoint must use HTTPS');
  }
  url.search = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function createDelegationEndpoint(input) {
  const status = input?.status || 'active';
  if (!['active', 'disabled'].includes(status)) throw new Error('Invalid DelegationEndpoint status');
  const url = assertDelegationEndpointUrl(input?.url, { allowLoopback: input?.allowLoopback === true });
  return Object.freeze({
    id: assertSafeIdentifier(input?.id, 'delegation endpoint id'),
    url: url.toString(),
    origin: url.origin,
    status,
    allowLoopback: input?.allowLoopback === true,
  });
}

function operationUrl(endpoint, operation, query = {}) {
  if (!endpoint || endpoint.status !== 'active') throw new Error('active DelegationEndpoint is required');
  const spec = OPERATIONS[operation];
  if (!spec) throw new Error('unsupported delegation transport operation');
  const url = new URL(spec.path, endpoint.url);
  if (url.origin !== endpoint.origin) throw new Error('delegation operation escaped configured origin');
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url;
}

async function readBoundedJson(response, maxBytes = MAX_RESPONSE_BYTES) {
  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('delegation response exceeds configured size limit');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) throw new Error('delegation response exceeds configured size limit');
  if (!buffer.byteLength) return null;
  let parsed;
  try { parsed = JSON.parse(buffer.toString('utf8')); } catch { throw new Error('delegation response is not valid JSON'); }
  return parsed;
}

class ProjectOwnedDelegationTransport {
  constructor({ endpoint, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, maxRequestBytes = MAX_REQUEST_BYTES, maxResponseBytes = MAX_RESPONSE_BYTES } = {}) {
    if (!endpoint || endpoint.status !== 'active') throw new TypeError('active DelegationEndpoint is required');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
    const timeout = Number(timeoutMs);
    if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60000) throw new RangeError('delegation timeout must be between 100 and 60000 ms');
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeout;
    this.maxRequestBytes = Number(maxRequestBytes);
    this.maxResponseBytes = Number(maxResponseBytes);
    Object.freeze(this);
  }

  async request({ operation, query = {}, body = null }) {
    const spec = OPERATIONS[operation];
    if (!spec) throw new Error('unsupported delegation transport operation');
    const url = operationUrl(this.endpoint, operation, query);
    let encodedBody;
    if (spec.method === 'POST') {
      encodedBody = JSON.stringify(body ?? {});
      if (Buffer.byteLength(encodedBody, 'utf8') > this.maxRequestBytes) throw new Error('delegation request exceeds configured size limit');
    } else if (body !== null) {
      throw new Error('GET delegation request must not include a body');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('delegation transport timeout')), this.timeoutMs);
    try {
      const headers = spec.method === 'POST'
        ? { 'content-type': 'application/json; charset=utf-8', accept: 'application/json' }
        : { accept: 'application/json' };
      const response = await this.fetchImpl(url, {
        method: spec.method,
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
        headers,
        ...(spec.method === 'POST' ? { body: encodedBody } : {}),
      });
      if (response.status >= 300 && response.status < 400) throw new Error(`delegation redirect rejected: ${response.status}`);
      if (response.url) {
        const observed = new URL(response.url);
        if (observed.origin !== this.endpoint.origin) throw new Error('delegation response escaped configured origin');
      }
      const payload = await readBoundedJson(response, this.maxResponseBytes);
      if (!response.ok) {
        const reason = payload?.reasonCode || payload?.error || `http_${response.status}`;
        throw new Error(`delegation transport rejected: ${reason}`);
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  submitRequest(delegationRequest) {
    if (!delegationRequest || typeof delegationRequest !== 'object') throw new TypeError('delegationRequest is required');
    return this.request({ operation: 'request', body: { request: delegationRequest } });
  }

  readInbox({ destinationInstanceId, destinationWorkspaceId, sinceSequence = 0 }) {
    const sequence = Number(sinceSequence);
    if (!Number.isInteger(sequence) || sequence < 0) throw new TypeError('sinceSequence must be a non-negative integer');
    return this.request({
      operation: 'inbox',
      query: {
        destinationInstanceId: assertSafeIdentifier(destinationInstanceId, 'destination instance id'),
        destinationWorkspaceId: assertSafeIdentifier(destinationWorkspaceId, 'destination workspace id'),
        sinceSequence: sequence,
      },
    });
  }

  acknowledgeRequest({ requestId, requestDigest, state, reasonCode = null }) {
    if (!['accepted', 'duplicate', 'rejected', 'divergent'].includes(state)) throw new Error('invalid delegation acknowledgement state');
    return this.request({
      operation: 'ack',
      body: {
        requestId: assertSafeIdentifier(requestId, 'delegation request id'),
        requestDigest: requiredText(requestDigest, 'delegation request digest', 100),
        state,
        reasonCode: reasonCode == null ? null : assertSafeIdentifier(reasonCode, 'delegation acknowledgement reason'),
      },
    });
  }

  readReceipts({ sourceInstanceId, sourceWorkspaceId, sinceRevision = 0 }) {
    const revision = Number(sinceRevision);
    if (!Number.isInteger(revision) || revision < 0) throw new TypeError('sinceRevision must be a non-negative integer');
    return this.request({
      operation: 'receipts',
      query: {
        sourceInstanceId: assertSafeIdentifier(sourceInstanceId, 'source instance id'),
        sourceWorkspaceId: assertSafeIdentifier(sourceWorkspaceId, 'source workspace id'),
        sinceRevision: revision,
      },
    });
  }

  submitCancellation(cancellationProposal) {
    if (!cancellationProposal || typeof cancellationProposal !== 'object') throw new TypeError('cancellationProposal is required');
    return this.request({ operation: 'cancellation', body: { cancellationProposal } });
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  OPERATIONS,
  ProjectOwnedDelegationTransport,
  assertDelegationEndpointUrl,
  createDelegationEndpoint,
  operationUrl,
  readBoundedJson,
};
