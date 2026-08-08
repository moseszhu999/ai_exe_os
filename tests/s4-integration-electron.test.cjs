'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { registerS4Ipc, CHANNELS } = require('../src/application/s4-ipc.cjs');

const root = join(__dirname, '..');
const main = readFileSync(join(root, 'src/main/main.cjs'), 'utf8');
const preload = readFileSync(join(root, 'src/preload/index.cjs'), 'utf8');
const s3Renderer = readFileSync(join(root, 'src/renderer/s3-integrated.js'), 'utf8');
const s4Renderer = readFileSync(join(root, 'src/renderer/s4-integrated.js'), 'utf8');

const EXPECTED_CHANNELS = [
  's4:console:query',
  's4:console:worker:focus',
  's4:console:worker:stop',
  's4:console:worker:pause',
  's4:console:worker:resume',
];

const SURFACES = [
  'Cockpit / Overview', 'Projects & Workspaces', 'Missions / Execution Graph', 'Workers & Sessions',
  'Agents / Capabilities / Provider Use', 'Human Gate Inbox', 'Blockers & Recovery', 'GitHub Delivery', 'Evidence & Event Lineage',
];

test('root composition preserves S5→S4→S3→S2 chain before IPC and BrowserWindow', () => {
  const serviceIndex = main.indexOf('s1Service = new S1ApplicationService');
  const registerIndex = main.lastIndexOf('registerIpc();');
  const windowIndex = main.indexOf('await createMainWindow();');
  assert.ok(serviceIndex >= 0 && serviceIndex < registerIndex && registerIndex < windowIndex);
  assert.match(main, /S4ApplicationService/);
  assert.match(main, /S5ApplicationService: S1ApplicationService/);
  assert.match(main, /S3ApplicationService\.prototype instanceof S2ApplicationService/);
  assert.match(main, /S4ApplicationService\.prototype instanceof S3ApplicationService/);
  assert.match(main, /S1ApplicationService\.prototype instanceof S4ApplicationService/);
  assert.match(main, /registerS4Ipc\(\{ ipcMain, assertSender, service: s1Service \}\)/);
  assert.match(main, /databasePath: join\(s1RuntimeRoot, 'state\.sqlite'\)/);
  for (const security of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'webSecurity: true']) assert.ok(main.includes(security), security);
});

test('sandbox preload remains self-contained and adds exactly five nested S4 console methods', () => {
  assert.equal((preload.match(/\brequire\s*\(/g) || []).length, 1);
  assert.match(preload, /require\('electron'\)/);
  assert.doesNotMatch(preload, /require\(['"]\.\.?\//);
  assert.equal((preload.match(/ipcRenderer\.invoke\('s1:/g) || []).length, 6);
  assert.equal((preload.match(/ipcRenderer\.invoke\('s2:mission:/g) || []).length, 9);
  assert.equal((preload.match(/ipcRenderer\.invoke\('s3:github:/g) || []).length, 7);
  assert.equal((preload.match(/ipcRenderer\.invoke\('s4:console:/g) || []).length, 5);
  assert.match(preload, /s4:\s*Object\.freeze\(\{ console: s4Console \}\)/);
  for (const channel of EXPECTED_CHANNELS) assert.ok(preload.includes(channel), `missing ${channel}`);
  assert.doesNotMatch(preload, /state\.sqlite|DatabaseSync|workerManager|profilePath|processId/);
});

test('S4 IPC registers exactly five sender-validated local control/query channels', async () => {
  assert.deepEqual([...CHANNELS], EXPECTED_CHANNELS);
  const handlers = new Map();
  const senderChecks = [];
  const calls = [];
  const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
  const service = {
    queryOperatorCockpit(workspaceId) { calls.push(['query', workspaceId]); return { workspaceId }; },
    focusWorker(input) { calls.push(['focus', input]); return input; },
    stopWorker(input) { calls.push(['stop', input]); return input; },
    pauseWorker(input) { calls.push(['pause', input]); return input; },
    resumeWorker(input) { calls.push(['resume', input]); return input; },
  };
  registerS4Ipc({ ipcMain, assertSender: (event) => senderChecks.push(event), service });
  assert.deepEqual([...handlers.keys()], EXPECTED_CHANNELS);
  const event = { senderFrame: { url: 'file:///trusted' } };
  await handlers.get('s4:console:query')(event, 'workspace-a');
  await handlers.get('s4:console:worker:stop')(event, { workspaceId: 'workspace-a', workerId: 'worker-a' });
  assert.equal(senderChecks.length, 2);
  assert.deepEqual(calls, [['query', 'workspace-a'], ['stop', { workspaceId: 'workspace-a', workerId: 'worker-a' }]]);
  assert.throws(() => handlers.get('s4:console:worker:focus')(event, null), /object payload/);
});

test('integrated cockpit reuses the existing Workspace selector and exposes nine explainability surfaces', () => {
  assert.match(s3Renderer, /s4-integrated\.js/);
  assert.match(s3Renderer, /data-s4-cockpit|s4Cockpit/);
  assert.match(s4Renderer, /#s1-workspace/);
  assert.doesNotMatch(s4Renderer, /createElement\(['"]select['"]\).*workspace/i);
  for (const surface of SURFACES) assert.ok(s4Renderer.includes(surface), `missing ${surface}`);
  for (const label of ['Focus', 'Pause', 'Resume', 'Stop selected Worker']) assert.ok(s4Renderer.includes(label), `missing ${label}`);
  assert.match(s4Renderer, /GitHub Delivery · Read-Only/);
});

test('integrated cockpit is DOM-safe and cannot invoke global Worker or provider-write paths', () => {
  assert.doesNotMatch(s4Renderer, /\brequire\s*\(/);
  assert.doesNotMatch(s4Renderer, /node:sqlite|DatabaseSync|state\.sqlite|innerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(s4Renderer, /stopAll|kill\s*\(|process\.kill/);
  assert.doesNotMatch(s4Renderer, /mergePullRequest|createComment|submitReview|workflowDispatch|deleteBranch|updatePullRequest|s3:github:(merge|comment|update|delete|dispatch)/i);
  assert.match(s4Renderer, /textContent/);
  assert.match(s4Renderer, /profilePath|processId|authorization/);
});
