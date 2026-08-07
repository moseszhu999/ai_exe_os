'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalDigest } = require('../src/checkpoint/mission-checkpoint.cjs');

test('checkpoint digest ignores row order for stable-id projection collections', () => {
  const a = {
    run: { id: 'run-a', state: 'completed' },
    attempts: [
      { id: 'attempt-b', state: 'completed' },
      { id: 'attempt-a', state: 'completed' },
    ],
    outputs: [
      { id: 'output-b', value: { ok: 2 } },
      { id: 'output-a', value: { ok: 1 } },
    ],
  };
  const b = {
    outputs: [
      { value: { ok: 1 }, id: 'output-a' },
      { value: { ok: 2 }, id: 'output-b' },
    ],
    attempts: [
      { state: 'completed', id: 'attempt-a' },
      { state: 'completed', id: 'attempt-b' },
    ],
    run: { state: 'completed', id: 'run-a' },
  };
  assert.equal(canonicalDigest(a), canonicalDigest(b));
});

test('checkpoint digest preserves order for ordinary arrays without stable IDs', () => {
  assert.notEqual(canonicalDigest({ sequence: ['a', 'b'] }), canonicalDigest({ sequence: ['b', 'a'] }));
});
