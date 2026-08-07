'use strict';

const vercel = require('./vercel-public-deployment.cjs');
const netlify = require('./netlify-public-deployment.cjs');

const PROVIDER_ADAPTERS = Object.freeze([
  vercel.VERCEL_PUBLIC_DEPLOYMENT_ADAPTER,
  netlify.NETLIFY_PUBLIC_DEPLOYMENT_ADAPTER,
]);

function resolveProviderAdapter({ provider, adapterId }) {
  const adapter = PROVIDER_ADAPTERS.find((candidate) => candidate.provider === provider && candidate.id === adapterId);
  if (!adapter) throw new Error('Unknown or mismatched provider adapter');
  return adapter;
}

function normalizeProviderObservation({ provider, boundedObservation }) {
  if (provider === 'vercel') return vercel.normalizeVercelObservation(boundedObservation);
  if (provider === 'netlify') return netlify.normalizeNetlifyObservation(boundedObservation);
  throw new Error('Unsupported S5 provider');
}

module.exports = {
  ...vercel,
  ...netlify,
  PROVIDER_ADAPTERS,
  normalizeProviderObservation,
  resolveProviderAdapter,
};
