'use strict';

const net = require('node:net');

const SAFE_HEADER_NAMES = Object.freeze(['cache-control', 'content-length', 'content-type', 'etag', 'last-modified']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const READ_ONLY_METHODS = new Set(['GET', 'HEAD']);

class ProviderTransportError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'ProviderTransportError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function normalizeHost(url) {
  return url.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

function blockedIpLiteral(host) {
  const version = net.isIP(host);
  if (!version) return false;
  if (version === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 0
      || a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
      || a >= 224;
  }
  const value = host.toLowerCase();
  return value === '::'
    || value === '::1'
    || value.startsWith('fc')
    || value.startsWith('fd')
    || /^fe[89ab]/.test(value)
    || value.startsWith('ff');
}

function parseExternalUrl(value, label = 'provider URL') {
  let url;
  try { url = new URL(String(value)); } catch { throw new ProviderTransportError('invalid_target', `${label} is invalid`); }
  if (url.protocol !== 'https:') throw new ProviderTransportError('scheme_blocked', `${label} must use HTTPS`);
  if (url.username || url.password) throw new ProviderTransportError('credential_url_blocked', `${label} must not contain credentials`);
  if (url.hash) throw new ProviderTransportError('fragment_blocked', `${label} must not contain a fragment`);
  if (url.port && url.port !== '443') throw new ProviderTransportError('port_blocked', `${label} must use the default HTTPS port`);
  const host = normalizeHost(url);
  if (!host || host === 'localhost' || host.endsWith('.localhost') || blockedIpLiteral(host)) {
    throw new ProviderTransportError('private_target_blocked', `${label} is not an allowed external target`);
  }
  return url;
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key ? headers[key] : null;
}

function safeHeaders(headers) {
  const result = {};
  for (const name of SAFE_HEADER_NAMES) {
    const value = headerValue(headers, name);
    if (value !== null && value !== undefined && String(value).length <= 1000) result[name] = String(value);
  }
  return Object.freeze(result);
}

async function cancelBody(response) {
  try {
    if (response?.body && typeof response.body.cancel === 'function') await response.body.cancel();
  } catch {
    // Body cancellation is best-effort and never changes normalized provider evidence.
  }
}

function redirectLocation(response) {
  const value = headerValue(response?.headers, 'location');
  return value === null || value === undefined ? null : String(value);
}

class BoundedReadOnlyHttpTransport {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 5000, maxRedirects = 3, clock = () => new Date().toISOString() } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new RangeError('timeoutMs must be between 1 and 30000');
    if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 5) throw new RangeError('maxRedirects must be between 0 and 5');
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxRedirects = maxRedirects;
    this.clock = clock;
    this.audit = [];
  }

  methodAudit() {
    return this.audit.map((item) => Object.freeze({ ...item }));
  }

  validateRequest({ approvedTarget, method }) {
    const approved = parseExternalUrl(approvedTarget, 'approved provider target');
    const normalizedMethod = String(method || '').toUpperCase();
    if (!READ_ONLY_METHODS.has(normalizedMethod)) {
      throw new ProviderTransportError('method_blocked', 'S5 provider transport allows only GET or HEAD', { method: normalizedMethod || null });
    }
    return { approved, method: normalizedMethod };
  }

  validateRedirect({ from, location, approvedOrigin }) {
    if (!location) throw new ProviderTransportError('redirect_blocked', 'Provider redirect is missing Location');
    let next;
    try { next = new URL(location, from); } catch { throw new ProviderTransportError('redirect_blocked', 'Provider redirect target is invalid'); }
    next = parseExternalUrl(next.href, 'provider redirect target');
    if (next.origin !== approvedOrigin) {
      throw new ProviderTransportError('redirect_blocked', 'Provider redirect escaped approved origin', { origin: next.origin });
    }
    return next;
  }

  async observe({ approvedTarget, method = 'GET' }) {
    const { approved, method: normalizedMethod } = this.validateRequest({ approvedTarget, method });
    const approvedOrigin = approved.origin;
    let current = approved;
    const redirects = [];

    for (let redirectCount = 0; ; redirectCount += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response;
      try {
        this.audit.push(Object.freeze({ method: normalizedMethod, target: current.href }));
        response = await this.fetchImpl(current.href, {
          method: normalizedMethod,
          redirect: 'manual',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
          headers: { Accept: '*/*' },
        });
      } catch (error) {
        clearTimeout(timer);
        const timeout = error?.name === 'AbortError' || controller.signal.aborted;
        return Object.freeze({
          state: 'failed',
          method: normalizedMethod,
          target: approved.href,
          finalTarget: current.href,
          statusCode: null,
          headers: Object.freeze({}),
          redirects: Object.freeze([...redirects]),
          observedAt: this.clock(),
          failureCode: timeout ? 'timeout' : 'network_failure',
        });
      } finally {
        clearTimeout(timer);
      }

      const statusCode = Number(response?.status);
      if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
        await cancelBody(response);
        return Object.freeze({
          state: 'failed', method: normalizedMethod, target: approved.href, finalTarget: current.href,
          statusCode: null, headers: Object.freeze({}), redirects: Object.freeze([...redirects]), observedAt: this.clock(), failureCode: 'invalid_response',
        });
      }

      if (REDIRECT_STATUSES.has(statusCode)) {
        const location = redirectLocation(response);
        await cancelBody(response);
        if (redirectCount >= this.maxRedirects) {
          return Object.freeze({
            state: 'blocked', method: normalizedMethod, target: approved.href, finalTarget: current.href,
            statusCode, headers: Object.freeze({}), redirects: Object.freeze([...redirects]), observedAt: this.clock(), failureCode: 'redirect_limit',
          });
        }
        const next = this.validateRedirect({ from: current, location, approvedOrigin });
        redirects.push(Object.freeze({ from: current.href, to: next.href, statusCode, method: normalizedMethod }));
        current = next;
        continue;
      }

      const normalizedHeaders = safeHeaders(response?.headers);
      await cancelBody(response);
      return Object.freeze({
        state: statusCode >= 200 && statusCode < 400 ? 'succeeded' : 'failed',
        method: normalizedMethod,
        target: approved.href,
        finalTarget: current.href,
        statusCode,
        headers: normalizedHeaders,
        redirects: Object.freeze([...redirects]),
        observedAt: this.clock(),
        failureCode: statusCode >= 200 && statusCode < 400 ? null : 'http_failure',
      });
    }
  }
}

module.exports = {
  BoundedReadOnlyHttpTransport,
  ProviderTransportError,
  SAFE_HEADER_NAMES,
  blockedIpLiteral,
  parseExternalUrl,
  safeHeaders,
};
