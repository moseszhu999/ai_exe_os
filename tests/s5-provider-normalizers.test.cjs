'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  NETLIFY_PUBLIC_DEPLOYMENT_ADAPTER,
  PROVIDER_ADAPTERS,
  VERCEL_PUBLIC_DEPLOYMENT_ADAPTER,
  assertNetlifyPublicTarget,
  assertVercelPublicTarget,
  normalizeProviderObservation,
  normalizeNetlifyObservation,
  normalizeVercelObservation,
  resolveProviderAdapter,
} = require('../src/provider-adapters/providers/index.cjs');

function bounded(target, overrides = {}) {
  return {
    state: 'succeeded', method: 'GET', target, finalTarget: target, statusCode: 200,
    headers: { 'content-type': 'text/html', etag: 'abc' }, redirects: [],
    observedAt: '2026-08-07T00:00:00.000Z', failureCode: null, ...overrides,
  };
}

test('Vercel and Netlify adapter definitions are distinct immutable read-only identities', () => {
  assert.equal(PROVIDER_ADAPTERS.length, 2);
  assert.equal(VERCEL_PUBLIC_DEPLOYMENT_ADAPTER.id, 'vercel.public-deployment');
  assert.equal(NETLIFY_PUBLIC_DEPLOYMENT_ADAPTER.id, 'netlify.public-deployment');
  for (const adapter of PROVIDER_ADAPTERS) {
    assert.equal(adapter.action, 'observe_public_deployment');
    assert.deepEqual(adapter.methods, ['GET', 'HEAD']);
    assert.equal(adapter.actionClass, 'READ_ONLY');
    assert.equal(adapter.responseBodyPolicy, 'none');
    assert.equal(Object.isFrozen(adapter), true);
  }
});

test('provider hostname classification validates but does not broaden target identity', () => {
  assert.equal(assertVercelPublicTarget('https://alpha.vercel.app/'), 'https://alpha.vercel.app/');
  assert.equal(assertNetlifyPublicTarget('https://beta.netlify.app/'), 'https://beta.netlify.app/');
  assert.throws(() => assertVercelPublicTarget('https://beta.netlify.app/'), /Vercel/);
  assert.throws(() => assertNetlifyPublicTarget('https://alpha.vercel.app/'), /Netlify/);
  assert.throws(() => assertVercelPublicTarget('https://vercel.app/'), /Vercel/);
  assert.throws(() => assertNetlifyPublicTarget('https://netlify.app/'), /Netlify/);
});

test('Vercel normalizer is deterministic and body-free', () => {
  const input = bounded('https://alpha.vercel.app/');
  const first = normalizeVercelObservation(input);
  const second = normalizeVercelObservation({ ...input, headers: { etag: 'abc', 'content-type': 'text/html' } });
  assert.equal(first.normalizerDigest, second.normalizerDigest);
  assert.equal(first.provider, 'vercel');
  assert.equal(first.adapterId, 'vercel.public-deployment');
  assert.throws(() => normalizeVercelObservation({ ...input, body: 'forbidden' }), /response bodies/);
});

test('Netlify normalizer is deterministic and body-free', () => {
  const input = bounded('https://beta.netlify.app/', { method: 'HEAD', statusCode: 204 });
  const first = normalizeNetlifyObservation(input);
  const second = normalizeNetlifyObservation({ ...input, redirects: [] });
  assert.equal(first.normalizerDigest, second.normalizerDigest);
  assert.equal(first.provider, 'netlify');
  assert.equal(first.adapterId, 'netlify.public-deployment');
  assert.throws(() => normalizeNetlifyObservation({ ...input, responseBody: '{}' }), /response bodies/);
});

test('provider registry resolves exact provider and adapter identity', () => {
  assert.equal(resolveProviderAdapter({ provider: 'vercel', adapterId: 'vercel.public-deployment' }).provider, 'vercel');
  assert.equal(resolveProviderAdapter({ provider: 'netlify', adapterId: 'netlify.public-deployment' }).provider, 'netlify');
  assert.throws(() => resolveProviderAdapter({ provider: 'vercel', adapterId: 'netlify.public-deployment' }), /Unknown/);
  assert.equal(normalizeProviderObservation({ provider: 'vercel', boundedObservation: bounded('https://alpha.vercel.app/') }).provider, 'vercel');
  assert.equal(normalizeProviderObservation({ provider: 'netlify', boundedObservation: bounded('https://beta.netlify.app/') }).provider, 'netlify');
});

test('provider normalizer source contains no network or write primitive', () => {
  for (const file of ['vercel-public-deployment.cjs', 'netlify-public-deployment.cjs', 'index.cjs']) {
    const source = readFileSync(join(__dirname, '..', 'src', 'provider-adapters', 'providers', file), 'utf8');
    assert.doesNotMatch(source, /\bfetch\s*\(|node:https|node:http|\.request\s*\(|axios|got\s*\(/);
    assert.doesNotMatch(source, /\bPOST\b|\bPUT\b|\bPATCH\b|\bDELETE\b|deploy|promote|rollback/i);
  }
});
