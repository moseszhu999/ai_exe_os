'use strict';

const { createHash } = require('node:crypto');
const { requiredText, deepFreeze } = require('../../domain/workspace-model.cjs');

const EXECUTION_CREDENTIAL_BINDING_SCHEMA = 'execution.credential-binding.v1';
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function resolveCredentialBinding({ plan, authorization, credentialResolver, at }) {
  if (!authorization || authorization.decision !== 'allow') throw new Error('credential binding requires an allow authorization decision');
  if (!credentialResolver || typeof credentialResolver.resolve !== 'function') throw new TypeError('credentialResolver.resolve is required');
  const credentialRef = plan.transportBinding.credentialRef;
  if (typeof credentialRef !== 'string' || !credentialRef.startsWith('credential.')) throw new Error('plan credentialRef must be opaque');
  const raw = credentialResolver.resolve({ providerId: plan.providerId, protocolFamily: plan.protocolFamily, credentialRef, at });
  return Promise.resolve(raw).then((binding) => {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) throw new TypeError('resolved credential binding must be an object');
    if (binding.credentialRef !== credentialRef) throw new Error('resolved credentialRef does not match exact provider plan');
    if (binding.providerId !== undefined && binding.providerId !== plan.providerId) throw new Error('resolved providerId does not match exact provider plan');
    if (binding.protocolFamily !== undefined && binding.protocolFamily !== plan.protocolFamily) throw new Error('resolved protocolFamily does not match exact provider plan');
    if (binding.status !== 'ready') throw new Error('resolved credential is not ready');
    const expectedScheme = plan.protocolFamily === 'anthropic.messages' ? 'api_key' : 'bearer';
    if (binding.scheme !== expectedScheme) throw new Error(`credential scheme mismatch: expected ${expectedScheme}`);
    const secret = requiredText(binding.secret, 'resolved model credential', 8192);
    if (/\r|\n/.test(secret)) throw new Error('resolved model credential contains forbidden control characters');
    const expiresAt = binding.expiresAt == null ? null : requiredText(binding.expiresAt, 'credential expiresAt', 80);
    if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(at))) throw new Error('credential binding is expired');
    const metadata = { schema: EXECUTION_CREDENTIAL_BINDING_SCHEMA, credentialRef, providerId: plan.providerId, protocolFamily: plan.protocolFamily, scheme: binding.scheme, status: binding.status, expiresAt };
    const publicBinding = deepFreeze({ ...metadata, bindingDigest: digest(metadata) });
    return Object.freeze({ ...publicBinding, secret, public: publicBinding });
  });
}

function normalizeCredentialBindingRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('credential binding request must be an object');
  if (value.schema !== EXECUTION_CREDENTIAL_BINDING_SCHEMA) throw new Error('unsupported credential binding schema');
  if (typeof value.credentialRef !== 'string' || !value.credentialRef.startsWith('credential.')) throw new Error('credentialRef must be opaque');
  if (value.bindingDigest != null && !DIGEST_RE.test(value.bindingDigest)) throw new Error('bindingDigest must be sha256');
  return Object.freeze({ ...value });
}

module.exports = { EXECUTION_CREDENTIAL_BINDING_SCHEMA, normalizeCredentialBindingRequest, resolveCredentialBinding };
