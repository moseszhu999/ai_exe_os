const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
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

function closableContext(page) {
  const context = new EventEmitter();
  context.pages = () => [page];
  context.close = async () => context.emit('close');
  return context;
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

test('unexpected browser close releases the profile and permits a clean restart', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ai-exe-os-worker-close-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const events = [];
  const contexts = [];
  let releaseCalls = 0;
  let launchCalls = 0;
  const manager = new BrowserWorkerManager({
    profilesRoot: root,
    testBaseUrl: 'http://127.0.0.1',
    eventStore: { readAll: () => [], append: (event) => events.push(event) },
    leaseManager: {
      acquire: () => {},
      release: () => {
        releaseCalls += 1;
        return true;
      },
    },
    playwrightLoader: () => ({
      chromium: {
        launchPersistentContext: async () => {
          launchCalls += 1;
          const context = closableContext(fakePage());
          contexts.push(context);
          return context;
        },
      },
    }),
  });

  manager.create({ id: 'w1', projectId: 'p1', role: 'implementation', browserChannel: 'chromium' });
  await manager.start('w1');
  assert.equal(manager.list()[0].status, 'idle');

  contexts[0].emit('close');

  assert.equal(manager.list()[0].status, 'stopped');
  assert.equal(releaseCalls, 1);
  assert.equal(events.at(-1).type, 'worker.stopped');
  assert.equal(events.at(-1).reason, 'browser_context_closed');

  await manager.start('w1');
  assert.equal(launchCalls, 2);
  assert.equal(manager.list()[0].status, 'idle');
});

test('operator stop remains idempotent when context close emits a close event', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ai-exe-os-worker-stop-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const events = [];
  let releaseCalls = 0;
  const context = closableContext(fakePage());
  const manager = new BrowserWorkerManager({
    profilesRoot: root,
    testBaseUrl: 'http://127.0.0.1',
    eventStore: { readAll: () => [], append: (event) => events.push(event) },
    leaseManager: {
      acquire: () => {},
      release: () => {
        releaseCalls += 1;
        return true;
      },
    },
    playwrightLoader: () => ({ chromium: { launchPersistentContext: async () => context } }),
  });

  manager.create({ id: 'w1', projectId: 'p1', role: 'implementation', browserChannel: 'chromium' });
  await manager.start('w1');
  await manager.stop('w1');

  const stoppedEvents = events.filter((event) => event.type === 'worker.stopped');
  assert.equal(stoppedEvents.length, 1);
  assert.equal(stoppedEvents[0].reason, 'operator_stop');
  assert.equal(releaseCalls, 1);
  assert.equal(manager.list()[0].status, 'stopped');
});
