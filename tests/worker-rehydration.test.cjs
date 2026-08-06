const test = require('node:test');
const assert = require('node:assert/strict');
const { BrowserWorkerManager } = require('../src/main/browser-worker-manager.cjs');

function managerFrom(events) {
  return new BrowserWorkerManager({
    profilesRoot: '/tmp/ai-exe-os-test-profiles',
    leaseManager: {},
    testBaseUrl: 'http://127.0.0.1:1',
    eventStore: { readAll: () => events, append: () => {} },
  });
}

test('worker registry is reconstructed as stopped after restart', () => {
  const manager = managerFrom([{ type: 'worker.created', workerId: 'w1', projectId: 'p1', role: 'implementation', browserChannel: 'chrome' }]);
  const [worker] = manager.list();
  assert.equal(worker.id, 'w1');
  assert.equal(worker.status, 'stopped');
});
