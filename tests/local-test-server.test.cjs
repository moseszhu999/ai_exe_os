const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { LocalTestServer } = require('../src/main/local-test-server.cjs');

test('local test server exposes only the project-owned test surface', async (t) => {
  const server = new LocalTestServer({ rootDirectory: join(__dirname, '..', 'test-pages') });
  t.after(() => server.stop());
  const baseUrl = await server.start();
  const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
  assert.deepEqual(health, { ok: true, scope: 'local-project-owned-test-surface' });
  const page = await fetch(`${baseUrl}/task-form.html`).then((response) => response.text());
  assert.match(page, /Project-owned S0 test page/);
  assert.match(page, /not a third-party AI provider/);
});
