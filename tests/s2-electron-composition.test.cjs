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

test('S2 service initializes on canonical SQLite before both IPC groups and BrowserWindow', () => {
  const service = indexOfOrFail(main, 's1Service = new S1ApplicationService');
  const registerIpcCall = main.lastIndexOf('registerIpc();');
  const window = indexOfOrFail(main, 'await createMainWindow();');
  assert.notEqual(registerIpcCall, -1, 'missing registerIpc() call');
  assert.ok(service < registerIpcCall && registerIpcCall < window);
  assert.match(main, /registerS1Ipc\(\{ ipcMain, assertSender, service: s1Service \}\)/);
  assert.match(main, /registerS2Ipc\(\{ ipcMain, assertSender, service: s1Service \}\)/);
  assert.match(main, /S2ApplicationService: S1ApplicationService/);
  assert.match(main, /databasePath: join\(s1RuntimeRoot, 'state\.sqlite'\)/);
  for (const security of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'webSecurity: true']) assert.ok(main.includes(security), security);
});

test('preload preserves S0 and S1 APIs and exposes nested S2 Mission bridge only', () => {
  for (const method of ['getState','createWorker','startWorker','stopWorker','focusWorker','pauseWorker','resumeWorker','createTask','confirmLocalTask','observePullRequest']) {
    assert.ok(preload.includes(`${method}:`), `missing ${method}`);
  }
  assert.equal((preload.match(/ipcRenderer\.invoke\('s1:/g) || []).length, 6);
  for (const method of ['queryState','installCapability','grantCapability','createTask','rejectHumanGate','approveHumanGate']) {
    assert.match(preload, new RegExp(`${method}:\\s*\\(`));
  }
  assert.match(preload, /s2:\s*Object\.freeze\(\{/);
  assert.match(preload, /mission:\s*createS2BridgeContract\(ipcRenderer\)/);
  assert.doesNotMatch(preload, /state\.sqlite|DatabaseSync|workerManager/);
});

test('integrated renderer presents all S2 surfaces and retains strict CSP / no Node or direct DB access', () => {
  assert.match(html, /Content-Security-Policy/);
  for (const surface of ['Missions','Mission Builder','Execution Plan','Step Details','Agent Handoffs','Human Gates','Checkpoints','Run Timeline','Evidence / Recovery']) {
    assert.ok(html.includes(surface), `missing ${surface}`);
  }
  assert.doesNotMatch(renderer, /require\s*\(/);
  assert.doesNotMatch(renderer, /node:sqlite|DatabaseSync|state\.sqlite/);
  assert.doesNotMatch(renderer, /innerHTML|insertAdjacentHTML/);
  assert.match(renderer, /api\.s2\.mission\.createMission/);
  assert.match(renderer, /api\.s2\.mission\.createRevision/);
  assert.match(renderer, /api\.s2\.mission\.startMission/);
  assert.match(renderer, /api\.s2\.mission\.pauseMission/);
  assert.match(renderer, /api\.s2\.mission\.resumeMission/);
  assert.match(renderer, /api\.s2\.mission\.cancelMission/);
  assert.match(renderer, /api\.s2\.mission\.recordCheckpoint/);
  assert.match(renderer, /api\.s2\.mission\.retryStepAfterReview/);
  assert.match(renderer, /api\.s1\.approveHumanGate/);
});

test('Mission Builder uses the actual S1 local target rather than a hardcoded acceptance port', () => {
  assert.match(renderer, /target: next\.localTarget/);
  assert.match(renderer, /allowedTargets: \[localTarget\]/);
  assert.doesNotMatch(renderer, /target: 'http:\/\/127\.0\.0\.1:43119\/task-form\.html'/);
});
