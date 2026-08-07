'use strict';

const { createHash } = require('node:crypto');

const NETLIFY_PUBLIC_DEPLOYMENT_ADAPTER = Object.freeze({
  id: 'netlify.public-deployment',
  provider: 'netlify',
  version: '1.0.0',
  action: 'observe_public_deployment',
  methods: Object.freeze(['GET', 'HEAD']),
  actionClass: 'READ_ONLY',
  responseBodyPolicy: 'none',
  hostSuffix: '.netlify.app',
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function assertNetlifyPublicTarget(target) {
  let url;
  try { url = new URL(String(target)); } catch { throw new Error('Invalid Netlify public deployment target'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Invalid Netlify public deployment target');
  const host = url.hostname.toLowerCase();
  if (!host.endsWith(NETLIFY_PUBLIC_DEPLOYMENT_ADAPTER.hostSuffix) || host === 'netlify.app') {
    throw new Error('Target is not a Netlify public deployment hostname');
  }
  return url.href;
}

function normalizeNetlifyObservation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Netlify bounded observation is required');
  if ('body' in input || 'responseBody' in input) throw new Error('Netlify normalizer does not accept response bodies');
  const target = assertNetlifyPublicTarget(input.target);
  const finalTarget = assertNetlifyPublicTarget(input.finalTarget || input.target);
  const method = String(input.method || '').toUpperCase();
  if (!NETLIFY_PUBLIC_DEPLOYMENT_ADAPTER.methods.includes(method)) throw new Error('Netlify observation method must be GET or HEAD');
  if (!['succeeded', 'failed', 'blocked'].includes(input.state)) throw new Error('Invalid Netlify observation state');
  const headers = input.headers && typeof input.headers === 'object' && !Array.isArray(input.headers) ? { ...input.headers } : {};
  const redirects = Array.isArray(input.redirects) ? input.redirects.map((item) => ({
    from: String(item.from), to: String(item.to), statusCode: Number(item.statusCode), method: String(item.method),
  })) : [];
  const normalized = {
    adapterId: NETLIFY_PUBLIC_DEPLOYMENT_ADAPTER.id,
    adapterVersion: NETLIFY_PUBLIC_DEPLOYMENT_ADAPTER.version,
    provider: 'netlify',
    action: NETLIFY_PUBLIC_DEPLOYMENT_ADAPTER.action,
    method,
    target,
    finalTarget,
    state: input.state,
    statusCode: input.statusCode == null ? null : Number(input.statusCode),
    headers,
    redirects,
    observedAt: String(input.observedAt || ''),
    failureCode: input.failureCode == null ? null : String(input.failureCode),
  };
  const digest = createHash('sha256').update(JSON.stringify(stable(normalized))).digest('hex');
  return deepFreeze({ ...normalized, normalizerDigest: `sha256:${digest}` });
}

module.exports = { NETLIFY_PUBLIC_DEPLOYMENT_ADAPTER, assertNetlifyPublicTarget, normalizeNetlifyObservation };
