'use strict';

const { assertSafeIdentifier } = require('../../domain/identifiers.cjs');
const { requiredText } = require('../../domain/workspace-model.cjs');

const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 5000;

function isLoopbackHost(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]';
}

function assertSyncEndpointUrl(value, { allowLoopback = false } = {}) {
  const text = requiredText(value, 'sync endpoint url', 2048);
  let url;
  try { url = new URL(text); } catch { throw new TypeError('sync endpoint must be a valid URL'); }
  if (url.username || url.password) throw new Error('sync endpoint must not contain URL credentials');
  if (url.hash) throw new Error('sync endpoint must not contain a fragment');
  const loopback = isLoopbackHost(url.hostname);
  if (loopback && allowLoopback) {
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('loopback sync endpoint must use HTTP(S)');
  } else if (url.protocol !== 'https:') {
    throw new Error('external sync endpoint must use HTTPS');
  }
  url.search = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function createSyncEndpoint(input) {
  const status = input?.status || 'active';
  if (!['active', 'disabled'].includes(status)) throw new Error('Invalid SyncEndpoint status');
  const url = assertSyncEndpointUrl(input?.url, { allowLoopback: input?.allowLoopback === true });
  return Object.freeze({
    id: assertSafeIdentifier(input?.id, 'sync endpoint id'),
    url: url.toString(),
    origin: url.origin,
    status,
    allowLoopback: input?.allowLoopback === true,
  });
}

function operationUrl(endpoint, operation, query = {}) {
  if (!endpoint || endpoint.status !== 'active') throw new Error('active SyncEndpoint is required');
  if (!['append', 'mirror', 'cursor'].includes(operation)) throw new Error('unsupported sync transport operation');
  const url = new URL(operation, endpoint.url);
  if (url.origin !== endpoint.origin) throw new Error('sync operation escaped configured origin');
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url;
}

async function readBoundedJson(response, maxBytes = MAX_RESPONSE_BYTES) {
  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('sync response exceeds configured size limit');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) throw new Error('sync response exceeds configured size limit');
  if (!buffer.byteLength) return null;
  let parsed;
  try { parsed = JSON.parse(buffer.toString('utf8')); } catch { throw new Error('sync response is not valid JSON'); }
  return parsed;
}

class ProjectOwnedSyncTransport {
  constructor({ endpoint, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, maxRequestBytes = MAX_REQUEST_BYTES, maxResponseBytes = MAX_RESPONSE_BYTES } = {}) {
    if (!endpoint || endpoint.status !== 'active') throw new TypeError('active SyncEndpoint is required');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
    const timeout = Number(timeoutMs);
    if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60000) throw new RangeError('sync timeout must be between 100 and 60000 ms');
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeout;
    this.maxRequestBytes = Number(maxRequestBytes);
    this.maxResponseBytes = Number(maxResponseBytes);
    Object.freeze(this);
  }

  async request({ operation, method, query = {}, body = null }) {
    if (!['GET', 'POST'].includes(method)) throw new Error('sync transport only allows GET/POST');
    const url = operationUrl(this.endpoint, operation, query);
    let encodedBody;
    if (method === 'POST') {
      encodedBody = JSON.stringify(body ?? {});
      if (Buffer.byteLength(encodedBody, 'utf8') > this.maxRequestBytes) throw new Error('sync request exceeds configured size limit');
    } else if (body !== null) {
      throw new Error('GET sync request must not include a body');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('sync transport timeout')), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method,
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
        headers: method === 'POST'
          ? { 'content-type': 'application/json; charset=utf-8', accept: 'application/json' }
          : { accept: 'application/json' },
        ...(method === 'POST' ? { body: encodedBody } : {}),
      });
      if (response.status >= 300 && response.status < 400) throw new Error(`sync redirect rejected: ${response.status}`);
      if (response.url) {
        const observed = new URL(response.url);
        if (observed.origin !== this.endpoint.origin) throw new Error('sync response escaped configured origin');
      }
      const payload = await readBoundedJson(response, this.maxResponseBytes);
      if (!response.ok) {
        const reason = payload?.reasonCode || payload?.error || `http_${response.status}`;
        throw new Error(`sync transport rejected: ${reason}`);
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  appendEnvelopes({ workspaceId, sourceInstanceId, envelopes }) {
    if (!Array.isArray(envelopes) || envelopes.length < 1) throw new TypeError('envelopes must be a non-empty array');
    return this.request({
      operation: 'append', method: 'POST',
      body: {
        workspaceId: assertSafeIdentifier(workspaceId, 'workspace id'),
        sourceInstanceId: assertSafeIdentifier(sourceInstanceId, 'source instance id'),
        envelopes,
      },
    });
  }

  readMirror({ workspaceId, sinceCursor = 0 }) {
    const cursor = Number(sinceCursor);
    if (!Number.isInteger(cursor) || cursor < 0) throw new TypeError('sinceCursor must be a non-negative integer');
    return this.request({ operation: 'mirror', method: 'GET', query: { workspaceId: assertSafeIdentifier(workspaceId, 'workspace id'), sinceCursor: cursor } });
  }

  readCursor({ workspaceId, sourceInstanceId }) {
    return this.request({ operation: 'cursor', method: 'GET', query: {
      workspaceId: assertSafeIdentifier(workspaceId, 'workspace id'),
      sourceInstanceId: assertSafeIdentifier(sourceInstanceId, 'source instance id'),
    } });
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  ProjectOwnedSyncTransport,
  assertSyncEndpointUrl,
  createSyncEndpoint,
  isLoopbackHost,
  operationUrl,
  readBoundedJson,
};
