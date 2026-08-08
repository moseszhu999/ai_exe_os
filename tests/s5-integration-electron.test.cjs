'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { registerS5Ipc, CHANNELS } = require('../src/application/s5-ipc.cjs');

const root = join(__dirname, '..');
const main = readFileSync(join(root, 'src/main/main.cjs'), 'utf8');
const preload = readFileSync(join(root, 'src/preload/index.cjs'), 'utf8');
const s4Renderer = readFileSync(join(root, 'src/renderer/s4-integrated.js'), 'utf8');
const s5Renderer = readFileSync(join(root, 'src/renderer/s5-integrated.js'), 'utf8');
const s5Service = readFileSync(join(root, 'src/application/s5-index.cjs'), 'utf8');

const S5_CHANNELS = [
  's5:provider:query-state',
  's5:provider:bind-target',
  's5:provider:observe',
];

test('root composition instantiates S5 over the accepted S4→S3→S2 chain before IPC and BrowserWindow', () => {
  const serviceIndex = main.indexOf('s1Service = new S1ApplicationService');
  const registerIndex = main.lastIndexOf('registerIpc();');
  const windowIndex = main.indexOf('await createMainWindow();');
  assert.ok(serviceIndex >= 0 && serviceIndex < registerIndex && registerIndex < windowIndex);
  assert.match(main, /S5ApplicationService: S1ApplicationService/);
  assert.match(main, /S4ApplicationService\.prototype instanceof S3ApplicationService/);
  assert.match(main, /S1ApplicationService\.prototype instanceof S4ApplicationService/);
  assert.match(main, /registerS5Ipc\(\{ ipcMain, assertSender, service: s1Service \}\)/);
  assert.match(main, /databasePath: join\(s1RuntimeRoot, 'state\.sqlite'\)/);
  for (const security of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'webSecurity: true']) assert.ok(main.includes(security), security);
});

test('sandbox preload preserves S0-S4 and adds exactly three bounded S5 provider methods', () => {
  assert.equal((preload.match(/\brequire\s*\(/g) || []).length, 1);
  assert.match(preload, /require\('electron'\)/);
  assert.equal((preload.match(/ipcRenderer\.invoke\('s1:/g) || []).length, 6);
  assert.equal((preload.match(/ipcRenderer\.invoke\('s2:mission:/g) || []).length, 9);
  assert.equal((preload.match(/ipcRenderer\.invoke\('s3:github:/g) || []).length, 7);
  assert.equal((preload.match(/ipcRenderer\.invoke\('s4:console:/g) || []).length, 5);
  assert.equal((preload.match(/ipcRenderer\.invoke\('s5:provider:/g) || []).length, 3);
  assert.match(preload, /s5:\s*Object\.freeze\(\{ provider: s5Provider \}\)/);
  for (const channel of S5_CHANNELS) assert.ok(preload.includes(channel), `missing ${channel}`);
  assert.doesNotMatch(preload, /s5:provider:(deploy|promote|rollback|update|delete|post|put|patch)/i);
  assert.doesNotMatch(preload, /state\.sqlite|DatabaseSync|workerManager|fetch\s*\(/);
});

test('S5 IPC registers exactly three sender-validated explicit channels', async () => {
  assert.deepEqual([...CHANNELS], S5_CHANNELS);
  const handlers = new Map();
  const calls = [];
  const senders = [];
  const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
  const service = {
    queryProviderState(workspaceId) { calls.push(['query', workspaceId]); return { workspaceId }; },
    bindProviderTarget(input) { calls.push(['bind', input]); return input; },
    observeProvider(input) { calls.push(['observe', input]); return input; },
  };
  registerS5Ipc({ ipcMain, assertSender: (event) => senders.push(event), service });
  assert.deepEqual([...handlers.keys()], S5_CHANNELS);
  const event = { senderFrame: { url: 'file:///trusted' } };
  await handlers.get('s5:provider:query-state')(event, 'workspace-a');
  await handlers.get('s5:provider:observe')(event, { workspaceId: 'workspace-a', bindingId: 'binding-a' });
  assert.equal(senders.length, 2);
  assert.deepEqual(calls, [['query', 'workspace-a'], ['observe', { workspaceId: 'workspace-a', bindingId: 'binding-a' }]]);
  assert.throws(() => handlers.get('s5:provider:bind-target')(event, null), /plain object/);
  assert.throws(() => handlers.get('s5:provider:observe')(event, []), /plain object/);
});

test('S5 provider panel is loaded from S4 cockpit and contains no free-form transport or provider-write control', () => {
  assert.match(s4Renderer, /s5-integrated\.js/);
  assert.match(s4Renderer, /data-s5-provider|s5Provider/);
  assert.match(s5Renderer, /getElementById\('s4-cockpit'\)/);
  assert.match(s5Renderer, /#s1-workspace/);
  assert.match(s5Renderer, /Approved Provider Adapters/);
  assert.match(s5Renderer, /Approved Targets/);
  assert.match(s5Renderer, /Provider Observations & Evidence/);
  assert.match(s5Renderer, /Observe selected approved target/);
  assert.match(s5Renderer, /observe_public_deployment/);
  assert.doesNotMatch(s5Renderer, /createElement\(['"]input['"]\)/);
  assert.doesNotMatch(s5Renderer, /\bfetch\s*\(|XMLHttpRequest|node:sqlite|DatabaseSync|state\.sqlite/);
  assert.doesNotMatch(s5Renderer, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(s5Renderer, /\b(?:deploy|promote|rollback)\s*\(|\b(?:POST|PUT|PATCH|DELETE)\b/i);
  assert.doesNotMatch(s5Renderer, /bridge\.(?:deploy|promote|rollback|update|delete)\b/i);
});

test('S5 application observe path cannot accept arbitrary URL, headers or provider write method', () => {
  assert.match(s5Service, /requireS5Binding\(input\.workspaceId, input\.bindingId\)/);
  assert.match(s5Service, /providerTransport\.observe\(\{ approvedTarget: binding\.exactTarget, method \}\)/);
  assert.doesNotMatch(s5Service, /providerTransport\.observe\(\{[^}]*input\.exactTarget/);
  assert.doesNotMatch(s5Service, /input\.headers|input\.url|input\.target/);
  assert.doesNotMatch(s5Service, /\bfetch\s*\(/);
  assert.doesNotMatch(s5Service, /\bPOST\b|\bPUT\b|\bPATCH\b|\bDELETE\b/);
});
