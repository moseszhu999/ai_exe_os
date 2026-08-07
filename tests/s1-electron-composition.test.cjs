'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const main = readFileSync(join(root, 'src/main/main.cjs'), 'utf8');
const preload = readFileSync(join(root, 'src/preload/index.cjs'), 'utf8');
const html = readFileSync(join(root, 'src/renderer/index.html'), 'utf8');
const renderer = readFileSync(join(root, 'src/renderer/app.js'), 'utf8');

function indexOfOrFail(source, pattern) {
  const index = source.indexOf(pattern);
  assert.notEqual(index, -1, `missing ${pattern}`);
  return index;
}

test('starts SQLite/recovery application service before IPC and secure BrowserWindow', () => {
  const service = indexOfOrFail(main, 's1Service = new S1ApplicationService');
  const ipc = main.lastIndexOf('registerIpc();');
  const window = indexOfOrFail(main, 'await createMainWindow();');
  assert.ok(service < ipc && ipc < window);
  assert.match(main, /databasePath: join\(s1RuntimeRoot, 'state\.sqlite'\)/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /webSecurity: true/);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(main, /registerS1Ipc\(\{ ipcMain, assertSender, service: s1Service \}\)/);
});

test('preserves every S0 preload method and exposes exactly six nested S1 methods', () => {
  for (const method of ['getState', 'createWorker', 'startWorker', 'stopWorker', 'focusWorker', 'pauseWorker', 'resumeWorker', 'createTask', 'confirmLocalTask', 'observePullRequest']) {
    assert.match(preload, new RegExp(`\\b${method}:`));
  }
  for (const method of ['queryState', 'installCapability', 'grantCapability', 'createTask', 'rejectHumanGate', 'approveHumanGate']) {
    assert.match(preload, new RegExp(`\\b${method}:`));
  }
  assert.equal((preload.match(/ipcRenderer\.invoke\('s1:/g) || []).length, 6);
});

test('integrated renderer keeps CSP, all ten S1 surfaces, and no direct database or Node access', () => {
  assert.match(html, /Content-Security-Policy/);
  for (const surface of ['Projects', 'Workspaces', 'Marketplace', 'Agents', 'Workers', 'Tasks', 'Execution Graph', 'Human Gates', 'Evidence', 'Events \/ Recovery']) {
    assert.ok(html.includes(surface), `missing ${surface}`);
  }
  assert.doesNotMatch(renderer, /require\s*\(/);
  assert.doesNotMatch(renderer, /node:sqlite|DatabaseSync|state\.sqlite/);
  assert.doesNotMatch(renderer, /innerHTML|insertAdjacentHTML/);
  assert.match(renderer, /api\.s1\.rejectHumanGate/);
  assert.match(renderer, /api\.s1\.approveHumanGate/);
  assert.match(renderer, /api\.createWorker/);
  assert.match(renderer, /api\.startWorker/);
});

test('S1 startup registers bindings without automatically creating S0 workers', () => {
  const service = readFileSync(join(root, 'src/application/s1-application-service.cjs'), 'utf8');
  const seed = service.slice(service.indexOf('for (const seed of ['), service.indexOf('installCapability'));
  assert.doesNotMatch(seed, /workerManager\.create/);
  assert.match(seed, /workerBinding\.save/);
});
