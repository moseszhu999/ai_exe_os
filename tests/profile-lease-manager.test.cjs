const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { ProfileLeaseManager } = require('../src/main/profile-lease-manager.cjs');

test('profile lease is exclusive and releasable', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ai-exe-os-lease-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manager = new ProfileLeaseManager({ processIsAlive: (pid) => pid === 100 });
  manager.acquire({ profilePath: root, workerId: 'a', processId: 100 });
  assert.throws(() => manager.acquire({ profilePath: root, workerId: 'b', processId: 200 }), /already leased/);
  assert.equal(manager.release({ profilePath: root, workerId: 'a' }), true);
  assert.equal(manager.acquire({ profilePath: root, workerId: 'b', processId: 200 }).workerId, 'b');
});

test('stale profile lease can be recovered', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ai-exe-os-stale-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, '.ai-exe-os-profile-lock.json'), JSON.stringify({ workerId: 'dead', processId: 999, profilePath: root }));
  const manager = new ProfileLeaseManager({ processIsAlive: () => false });
  const lease = manager.acquire({ profilePath: root, workerId: 'new', processId: 200 });
  assert.equal(lease.workerId, 'new');
});
