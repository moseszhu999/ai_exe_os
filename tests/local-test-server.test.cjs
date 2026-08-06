const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { LocalTestServer, validatePort } = require('../src/main/local-test-server.cjs');

const rootDirectory = join(__dirname, '..', 'test-pages');

test('local test server exposes only the project-owned test surface', async (t) => {
  const server = new LocalTestServer({ rootDirectory });
  t.after(() => server.stop());
  const baseUrl = await server.start();
  const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
  assert.deepEqual(health, { ok: true, scope: 'local-project-owned-test-surface' });
  const page = await fetch(`${baseUrl}/task-form.html`).then((response) => response.text());
  assert.match(page, /Project-owned S0 test page/);
  assert.match(page, /not a third-party AI provider/);
});

test('configured port preserves a stable loopback origin across restarts', async () => {
  const first = new LocalTestServer({ rootDirectory });
  const firstUrl = await first.start();
  const port = Number(new URL(firstUrl).port);
  await first.stop();

  const second = new LocalTestServer({ rootDirectory, port });
  try {
    const secondUrl = await second.start();
    assert.equal(secondUrl, firstUrl);
  } finally {
    await second.stop();
  }
});

test('local test server rejects invalid ports', () => {
  assert.equal(validatePort(0), 0);
  assert.equal(validatePort(43119), 43119);
  assert.throws(() => validatePort(-1), /integer from 0 to 65535/);
  assert.throws(() => validatePort(65536), /integer from 0 to 65535/);
  assert.throws(() => validatePort(1.5), /integer from 0 to 65535/);
});
