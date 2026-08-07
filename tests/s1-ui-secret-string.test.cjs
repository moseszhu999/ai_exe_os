'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeForDisplay } = require('../src/renderer/s1/view-model.cjs');

test('redacts Bearer, session and private-key strings even under generic field names', () => {
  const displayed = sanitizeForDisplay({
    message: 'Bearer abcdefghijklmnopqrstuvwxyz',
    note: 'sessionid=secret-session-value',
    document: '-----BEGIN PRIVATE KEY-----\nsecret',
    safe: 'ordinary evidence text',
  });
  assert.deepEqual(displayed, {
    message: '[redacted]',
    note: '[redacted]',
    document: '[redacted]',
    safe: 'ordinary evidence text',
  });
});
