'use strict';

const { createHash } = require('node:crypto');
const net = require('node:net');
const { assertSafeIdentifier } = require('../../domain/identifiers.cjs');
const { assertProviderSnapshotAllows } = require('../../domain/provider-contract-snapshot.cjs');
const { deepFreeze, requiredText } = require('../../domain/workspace-model.cjs');

const ALLOWED_METHODS = new Set(['GET', 'HEAD']);
const SENSITIVE_KEY = /^(authorization|proxy-authorization|cookie|set-cookie|password|passwd|token|access[_-]?token|refresh[_-]?token|secret|private[_ -]?key|profilePath|profileDir|userData|userDataDir|storageState|processId|pid|ppid)$/i;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')}`;
}

function normalizedHost(url) {
  return url.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

function isBlockedIpLiteral(host) {
  const version = net.isIP(host);
  if (!version) return false;
  if (version === 4) {
    const parts = host.split('.').map(Number);
    const [a, b] = parts;
    return a === 0
      || a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
      || a >= 224;
  }
  const normalized = host.toLowerCase();
  return normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith('ff');
}

function assertSafeExternalTarget(target) {
  const raw = requiredText(target, 'provider exact target', 2048);
  let url;
  try { url = new URL(raw); } catch { throw new Error('Provider exact target must be a valid URL'); }
  if (url.protocol !== 'https:') throw new Error('Provider exact target must use HTTPS');
  if (url.username || url.password) throw new Error('Provider exact target must not contain credentials');
  if (url.hash) throw new Error('Provider exact target must not contain a fragment');
  if (url.port && url.port !== '443') throw new Error('Provider exact target must use the default HTTPS port');
  const host = normalizedHost(url);
  if (!host || host === 'localhost' || host.endsWith('.localhost')) throw new Error('Provider exact target must not be loopback');
  if (isBlockedIpLiteral(host)) throw new Error('Provider exact target must not be private, loopback, link-local, unspecified, shared, or multicast IP');
  return url.href;
}

function normalizeMethods(methods) {
  if (!Array.isArray(methods) || methods.length === 0) throw new TypeError('Provider action methods must be a non-empty array');
  const result = methods.map((method) => String(method).toUpperCase());
  if (result.some((method) => !ALLOWED_METHODS.has(method))) throw new Error('S5 provider actions may only declare GET or HEAD');
  if (new Set(result).size !== result.length) throw new Error('Provider action methods must be unique');
  return result.sort();
}

function createProviderAdapterDefinition(input) {
  const status = input?.status || 'available';
  if (!['available', 'deprecated', 'blocked'].includes(status)) throw new Error('Invalid provider adapter status');
  if (!Array.isArray(input?.actions) || input.actions.length === 0) throw new TypeError('Provider adapter actions are required');
  const actions = input.actions.map((action) => deepFreeze({
    id: assertSafeIdentifier(action?.id, 'provider action id'),
    methods: normalizeMethods(action?.methods),
    responseBodyPolicy: action?.responseBodyPolicy === 'none' ? 'none' : (() => { throw new Error('S5 response body policy must be none'); })(),
    actionClass: action?.actionClass === 'READ_ONLY' ? 'READ_ONLY' : (() => { throw new Error('S5 provider action class must be READ_ONLY'); })(),
  }));
  if (new Set(actions.map((action) => action.id)).size !== actions.length) throw new Error('Provider adapter action ids must be unique');
  const definition = {
    id: assertSafeIdentifier(input?.id, 'provider adapter id'),
    provider: assertSafeIdentifier(input?.provider, 'provider id'),
    version: requiredText(input?.version, 'provider adapter version', 80),
    actions,
    status,
  };
  return deepFreeze({ ...definition, definitionDigest: digest(definition) });
}

function createProviderTargetBinding(input) {
  const status = input?.status || 'active';
  if (!['active', 'disabled'].includes(status)) throw new Error('Invalid provider target binding status');
  return deepFreeze({
    id: assertSafeIdentifier(input?.id, 'provider target binding id'),
    workspaceId: assertSafeIdentifier(input?.workspaceId, 'workspace id'),
    provider: assertSafeIdentifier(input?.provider, 'provider id'),
    adapterId: assertSafeIdentifier(input?.adapterId, 'provider adapter id'),
    providerContractId: assertSafeIdentifier(input?.providerContractId, 'provider contract id'),
    action: assertSafeIdentifier(input?.action, 'provider action id'),
    exactTarget: assertSafeExternalTarget(input?.exactTarget),
    status,
  });
}

function sameBindingIntent(left, right) {
  const keys = ['workspaceId', 'provider', 'adapterId', 'providerContractId', 'action', 'exactTarget', 'status'];
  return keys.every((key) => left?.[key] === right?.[key]);
}

function assertProviderObservationAllowed({ binding, adapter, snapshot, method = 'GET', target = binding?.exactTarget, now = new Date() }) {
  if (!binding || binding.status !== 'active') throw new Error('Provider target binding is unknown or disabled');
  if (!adapter || adapter.status !== 'available') throw new Error('Provider adapter is unknown or unavailable');
  if (adapter.id !== binding.adapterId) throw new Error('Provider adapter does not match binding');
  if (adapter.provider !== binding.provider) throw new Error('Provider does not match binding');
  const snapshotId = snapshot?.id || snapshot?.contractId;
  if (snapshotId !== binding.providerContractId) throw new Error('Provider contract does not match binding');
  if (snapshot?.providerId !== binding.provider) throw new Error('Provider contract provider does not match binding');
  assertProviderSnapshotAllows({ snapshot, action: binding.action, now });
  const action = adapter.actions.find((candidate) => candidate.id === binding.action);
  if (!action) throw new Error('Provider action is not implemented by adapter');
  const normalizedMethod = String(method).toUpperCase();
  if (!action.methods.includes(normalizedMethod)) throw new Error('Provider method is not allowed by adapter action');
  const normalizedTarget = assertSafeExternalTarget(target);
  if (normalizedTarget !== binding.exactTarget) throw new Error('Provider target does not match exact approved binding target');
  return deepFreeze({ method: normalizedMethod, target: normalizedTarget, action });
}

function normalizeSafeHeaders(headers = {}) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) throw new TypeError('normalizedHeaders must be an object');
  const entries = Object.entries(headers).map(([key, value]) => {
    const normalizedKey = String(key).toLowerCase();
    if (SENSITIVE_KEY.test(normalizedKey)) throw new Error(`Sensitive provider header is forbidden: ${normalizedKey}`);
    if (!/^[a-z0-9-]{1,80}$/.test(normalizedKey)) throw new Error('Invalid normalized provider header name');
    return [normalizedKey, requiredText(String(value), `provider header ${normalizedKey}`, 1000)];
  });
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
}

function createProviderObservation(input) {
  if (Object.prototype.hasOwnProperty.call(input || {}, 'body') || Object.prototype.hasOwnProperty.call(input || {}, 'responseBody')) {
    throw new Error('S5 provider observations must not contain response bodies');
  }
  const state = input?.state;
  if (!['succeeded', 'failed', 'blocked'].includes(state)) throw new Error('Invalid provider observation state');
  const method = String(input?.method || '').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw new Error('Provider observation method must be GET or HEAD');
  const normalizedHeaders = normalizeSafeHeaders(input?.normalizedHeaders || {});
  const statusCode = input?.statusCode == null ? null : Number(input.statusCode);
  if (statusCode !== null && (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599)) throw new Error('Invalid provider observation status code');
  const base = {
    id: assertSafeIdentifier(input?.id, 'provider observation id'),
    workspaceId: assertSafeIdentifier(input?.workspaceId, 'workspace id'),
    bindingId: assertSafeIdentifier(input?.bindingId, 'provider target binding id'),
    adapterId: assertSafeIdentifier(input?.adapterId, 'provider adapter id'),
    provider: assertSafeIdentifier(input?.provider, 'provider id'),
    action: assertSafeIdentifier(input?.action, 'provider action id'),
    method,
    exactTarget: assertSafeExternalTarget(input?.exactTarget),
    state,
    observedAt: requiredText(input?.observedAt, 'provider observedAt', 40),
    statusCode,
    normalizedHeaders,
    failureCode: input?.failureCode == null ? null : assertSafeIdentifier(input.failureCode, 'provider failure code'),
  };
  if (!Number.isFinite(Date.parse(base.observedAt))) throw new Error('provider observedAt must be ISO-compatible');
  if (state === 'succeeded' && base.failureCode) throw new Error('Successful provider observation cannot include failureCode');
  return deepFreeze({ ...base, evidenceDigest: digest(base) });
}

function assertSameWorkspace(record, workspaceId, label = 'Provider record') {
  if (!record || record.workspaceId !== workspaceId) throw new Error(`${label} crosses Workspace boundary`);
  return true;
}

module.exports = {
  assertProviderObservationAllowed,
  assertSafeExternalTarget,
  assertSameWorkspace,
  createProviderAdapterDefinition,
  createProviderObservation,
  createProviderTargetBinding,
  isBlockedIpLiteral,
  sameBindingIntent,
};
