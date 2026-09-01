'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCredentialBinding } = require('../src/integrations/provider-runtime/credential-binding.cjs');

const plan = { providerId: 'openai-primary', protocolFamily: 'openai.responses', transportBinding: { credentialRef: 'credential.openai-primary' } };
test('credential binding checks exact opaque ref and returns secret-free projection', async () => {
  const binding = await resolveCredentialBinding({ plan, authorization: { decision: 'allow' }, at: '2026-09-01T00:00:00.000Z', credentialResolver: { resolve: async () => ({ credentialRef: 'credential.openai-primary', providerId: 'openai-primary', protocolFamily: 'openai.responses', scheme: 'bearer', status: 'ready', expiresAt: '2026-09-02T00:00:00.000Z', secret: 'test-secret' }) } });
  assert.equal(binding.secret, 'test-secret');
  assert.doesNotMatch(JSON.stringify(binding.public), /test-secret/);
  assert.match(binding.bindingDigest, /^sha256:[a-f0-9]{64}$/);
});
test('credential binding fails closed on mismatched ref and expiry', async () => {
  await assert.rejects(() => resolveCredentialBinding({ plan, authorization: { decision: 'allow' }, at: '2026-09-01T00:00:00.000Z', credentialResolver: { resolve: async () => ({ credentialRef: 'credential.other', scheme: 'bearer', status: 'ready', secret: 'x' }) } }), /does not match/);
  await assert.rejects(() => resolveCredentialBinding({ plan, authorization: { decision: 'allow' }, at: '2026-09-03T00:00:00.000Z', credentialResolver: { resolve: async () => ({ credentialRef: 'credential.openai-primary', scheme: 'bearer', status: 'ready', expiresAt: '2026-09-02T00:00:00.000Z', secret: 'x' }) } }), /expired/);
});
