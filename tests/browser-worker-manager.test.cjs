const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { BrowserWorkerManager } = require('../src/main/browser-worker-manager.cjs');

function fakePage() {
  return {
    goto: async () => {},
    url: () => 'http://127.0.0.1/test',
    fill: async () => { throw new Error('injected fill failure'); },
    click: async () => {},
    waitForSelector: async () => {},
    textContent: async () => 'unused',
    bringToFront: async () => {},
  };
}

test('uncertain local submission immediately returns worker to waiting_human', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ai-exe-os-worker-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const events = [];
  const page = fakePage();
  const context = { pages: () => [page], close: async () => {} };
  const manager = new BrowserWorkerManager({
    profilesRoot: root,
    testBaseUrl: 'http://127.0.0.1',
    eventStore: { readAll: () => [], append: (event) => events.push(event) },
    leaseManager: { acquire: () => {}, release: () => true },
    playwrightLoader: () => ({ chromium: { launchPersistentContext: async () => context } }),
  });
  manager.create({ id: 'w1', projectId: 'p1', role: 'implementation', browserChannel: 'chromium' });
  await manager.start('w1');
  await assert.rejects(
    manager.submitAuthorizedLocalTask({ workerId: 'w1', taskId: 't1', payload: 'safe local payload' }),
    /injected fill failure/,
  );
  assert.equal(manager.list()[0].status, 'waiting_human');
  assert.equal(events.at(-1).type, 'task.local_submission_uncertain');
});
