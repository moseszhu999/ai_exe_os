'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BoundedReadOnlyHttpTransport,
  ProviderTransportError,
  parseExternalUrl,
  safeHeaders,
} = require('../src/provider-adapters/transport/read-only-http-transport.cjs');

function response(status, headers = {}, onCancel = () => {}) {
  return {
    status,
    headers: { get(name) { const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name); return key ? headers[key] : null; } },
    body: { async cancel() { onCancel(); } },
    async text() { throw new Error('response body must never be read'); },
    async json() { throw new Error('response body must never be parsed'); },
  };
}

test('transport rejects write methods before any network access', async () => {
  let calls = 0;
  const transport = new BoundedReadOnlyHttpTransport({ fetchImpl: async () => { calls += 1; return response(200); } });
  await assert.rejects(() => transport.observe({ approvedTarget: 'https://demo.vercel.app/', method: 'POST' }), (error) => error instanceof ProviderTransportError && error.code === 'method_blocked');
  assert.equal(calls, 0);
  assert.deepEqual(transport.methodAudit(), []);
});

test('external target policy rejects insecure credentialed loopback private and unsafe port targets', () => {
  for (const target of [
    'http://demo.vercel.app/',
    'https://user:pass@demo.vercel.app/',
    'https://127.0.0.1/',
    'https://192.168.1.2/',
    'https://169.254.2.3/',
    'https://[::1]/',
    'https://localhost/',
    'https://demo.vercel.app:8443/',
    'https://demo.vercel.app/#fragment',
  ]) assert.throws(() => parseExternalUrl(target), ProviderTransportError);
  assert.equal(parseExternalUrl('https://demo.vercel.app/').href, 'https://demo.vercel.app/');
});

test('GET observation persists safe metadata only and cancels body without reading it', async () => {
  let cancelled = 0;
  const transport = new BoundedReadOnlyHttpTransport({
    clock: () => '2026-08-07T00:00:00.000Z',
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://demo.vercel.app/');
      assert.equal(init.method, 'GET');
      assert.equal(init.redirect, 'manual');
      assert.equal(init.credentials, 'omit');
      return response(200, { 'Content-Type': 'text/html', ETag: 'abc', 'Set-Cookie': 'secret=1', 'X-Token': 'secret' }, () => { cancelled += 1; });
    },
  });
  const result = await transport.observe({ approvedTarget: 'https://demo.vercel.app/', method: 'GET' });
  assert.equal(result.state, 'succeeded');
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.headers, { 'content-type': 'text/html', etag: 'abc' });
  assert.equal(cancelled, 1);
  assert.doesNotMatch(JSON.stringify(result), /secret|set-cookie|x-token|body/i);
  assert.deepEqual(transport.methodAudit(), [{ method: 'GET', target: 'https://demo.vercel.app/' }]);
});

test('HEAD is accepted and never upgraded across same-origin redirect', async () => {
  const calls = [];
  const transport = new BoundedReadOnlyHttpTransport({
    fetchImpl: async (url, init) => {
      calls.push([url, init.method]);
      if (url.endsWith('/start')) return response(302, { Location: '/ready' });
      return response(204, { ETag: 'ready' });
    },
  });
  const result = await transport.observe({ approvedTarget: 'https://demo.netlify.app/start', method: 'HEAD' });
  assert.equal(result.state, 'succeeded');
  assert.equal(result.finalTarget, 'https://demo.netlify.app/ready');
  assert.deepEqual(calls, [
    ['https://demo.netlify.app/start', 'HEAD'],
    ['https://demo.netlify.app/ready', 'HEAD'],
  ]);
  assert.deepEqual(result.redirects, [{ from: 'https://demo.netlify.app/start', to: 'https://demo.netlify.app/ready', statusCode: 302, method: 'HEAD' }]);
});

test('redirect outside approved origin fails closed before second request', async () => {
  let calls = 0;
  const transport = new BoundedReadOnlyHttpTransport({
    fetchImpl: async () => { calls += 1; return response(302, { Location: 'https://evil.example/path' }); },
  });
  await assert.rejects(() => transport.observe({ approvedTarget: 'https://demo.vercel.app/start', method: 'GET' }), (error) => error instanceof ProviderTransportError && error.code === 'redirect_blocked');
  assert.equal(calls, 1);
});

test('redirect to HTTP or private target fails closed', async () => {
  for (const location of ['http://demo.vercel.app/next', 'https://127.0.0.1/next']) {
    let calls = 0;
    const transport = new BoundedReadOnlyHttpTransport({ fetchImpl: async () => { calls += 1; return response(302, { Location: location }); } });
    await assert.rejects(() => transport.observe({ approvedTarget: 'https://demo.vercel.app/start', method: 'GET' }), ProviderTransportError);
    assert.equal(calls, 1);
  }
});

test('redirect count is bounded and returns explicit blocked evidence', async () => {
  const transport = new BoundedReadOnlyHttpTransport({ maxRedirects: 1, fetchImpl: async (url) => response(302, { Location: url.endsWith('/a') ? '/b' : '/c' }) });
  const result = await transport.observe({ approvedTarget: 'https://demo.vercel.app/a', method: 'GET' });
  assert.equal(result.state, 'blocked');
  assert.equal(result.failureCode, 'redirect_limit');
  assert.equal(transport.methodAudit().length, 2);
});

test('network failure is bounded and never retried automatically', async () => {
  let calls = 0;
  const transport = new BoundedReadOnlyHttpTransport({
    clock: () => '2026-08-07T00:00:00.000Z',
    fetchImpl: async () => { calls += 1; throw new Error('offline with secret detail'); },
  });
  const result = await transport.observe({ approvedTarget: 'https://demo.netlify.app/', method: 'GET' });
  assert.equal(result.state, 'failed');
  assert.equal(result.failureCode, 'network_failure');
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(result), /secret detail/);
});

test('safe-header allow-list never forwards cookie or authorization values', () => {
  assert.deepEqual(safeHeaders({ 'Content-Type': 'application/json', Authorization: 'Bearer secret', Cookie: 'x=1', 'Cache-Control': 'no-store' }), {
    'cache-control': 'no-store',
    'content-type': 'application/json',
  });
});
