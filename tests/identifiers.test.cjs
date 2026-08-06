const test = require('node:test');
const assert = require('node:assert/strict');
const { assertSafeIdentifier, assertSafeGitHubName } = require('../src/domain/identifiers.cjs');

test('safe local identifiers reject path traversal and markup', () => {
  assert.equal(assertSafeIdentifier('worker-a_01'), 'worker-a_01');
  assert.throws(() => assertSafeIdentifier('../../outside'), /must match/);
  assert.throws(() => assertSafeIdentifier('<img>'), /must match/);
});

test('GitHub names reject slash-separated or markup input', () => {
  assert.equal(assertSafeGitHubName('ai_exe_os', 'repo'), 'ai_exe_os');
  assert.throws(() => assertSafeGitHubName('owner/repo', 'repo'), /unsupported/);
  assert.throws(() => assertSafeGitHubName('<script>', 'repo'), /unsupported/);
});
