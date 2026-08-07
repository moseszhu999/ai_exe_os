'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { S0BrowserWorkerAdapter, safeWorkerSummary } = require('../src/main/runtime-adapters/s0-browser-worker-adapter.cjs');
const { assertNoForbiddenSecrets } = require('../src/storage/sqlite-event-store.cjs');

const target = 'http://127.0.0.1:43119/task-form.html';

test('safe worker summary excludes profile paths and process-local details', () => {
  const summary = safeWorkerSummary({
    id: 'worker-a',
    projectId: 'project-a',
    role: 'implementation',
    browserChannel: 'chromium',
    status: 'waiting_human',
    activeTaskId: 'task-a',
    lastKnownUrl: target,
    profilePath: '/Users/example/private-profile',
    processId: 12345,
  });
  assert.deepEqual(summary, {
    id: 'worker-a',
    projectId: 'project-a',
    role: 'implementation',
    browserChannel: 'chromium',
    status: 'waiting_human',
    activeTaskId: 'task-a',
    lastKnownUrl: target,
  });
  assert.equal('profilePath' in summary, false);
  assert.equal('processId' in summary, false);
  assert.doesNotThrow(() => assertNoForbiddenSecrets({ execution: { worker: summary, result: 'accepted' } }));
});

test('runtime adapter returns only a persistence-safe worker summary', async () => {
  const adapter = new S0BrowserWorkerAdapter({
    workerManager: {
      async submitAuthorizedLocalTask() {
        return {
          worker: {
            id: 'worker-a', projectId: 'project-a', role: 'implementation', browserChannel: 'chromium',
            status: 'waiting_human', activeTaskId: 'task-a', lastKnownUrl: target,
            profilePath: '/private/profile', processId: 999,
          },
          result: 'accepted:hello',
        };
      },
    },
  });
  const result = await adapter.execute({
    workerId: 'worker-a', taskId: 'task-a', capabilityAction: 'submit_payload', target, payload: 'hello',
  });
  assert.equal(result.result, 'accepted:hello');
  assert.equal(result.worker.id, 'worker-a');
  assert.equal('profilePath' in result.worker, false);
  assert.equal('processId' in result.worker, false);
  assert.doesNotThrow(() => assertNoForbiddenSecrets({ execution: result }));
});
