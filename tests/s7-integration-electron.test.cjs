'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { CHANNELS, membershipId, registerS7Ipc } = require('../src/application/s7-ipc.cjs');

const root = join(__dirname, '..');
const main = readFileSync(join(root, 'src/main/main.cjs'), 'utf8');
const preload = readFileSync(join(root, 'src/preload/index.cjs'), 'utf8');
const s6Renderer = readFileSync(join(root, 'src/renderer/s6-integrated.js'), 'utf8');
const s7Renderer = readFileSync(join(root, 'src/renderer/s7-integrated.js'), 'utf8');
const s7Service = readFileSync(join(root, 'src/application/s7-index.cjs'), 'utf8');

const S7_CHANNELS = [
  's7:sync:query-state',
  's7:sync:configure',
  's7:sync:push-pending',
  's7:sync:pull-mirror',
  's7:sync:membership:record',
];

test('root composition preserves accepted S7→S6→S5→S4 chain under S8 and main process owns exact endpoint configuration', () => {
  assert.match(main, /S5ApplicationService: S1ApplicationServiceS5/);
  assert.match(main, /S6ApplicationService: S1ApplicationServiceS6/);
  assert.match(main, /S7ApplicationService: S1ApplicationServiceS7/);
  assert.match(main, /S8ApplicationService: S1ApplicationService/);
  assert.match(main, /S1ApplicationServiceS7\.prototype instanceof S1ApplicationServiceS6/);
  assert.match(main, /S1ApplicationService\.prototype instanceof S1ApplicationServiceS7/);
  assert.match(main, /S1ApplicationService\.prototype instanceof S1ApplicationServiceS6/);
  assert.match(main, /S1ApplicationService\.prototype instanceof S4ApplicationService/);
  assert.match(main, /registerS7Ipc\(\{ ipcMain, assertSender, service: s1Service \}\)/);
  assert.match(main, /AI_EXE_OS_SYNC_ENDPOINT/);
  assert.match(main, /AI_EXE_OS_SYNC_ALLOW_LOOPBACK/);
  assert.match(main, /new ProjectOwnedSyncTransport\(\{ endpoint \}\)/);
  assert.doesNotMatch(main, /ipcMain\.handle\([^\n]*(url|header|method)/i);
  const serviceIndex = main.indexOf('s1Service = new S1ApplicationService');
  const registerIndex = main.lastIndexOf('registerIpc();');
  const windowIndex = main.indexOf('await createMainWindow();');
  assert.ok(serviceIndex >= 0 && serviceIndex < registerIndex && registerIndex < windowIndex);
  for (const security of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'webSecurity: true']) assert.ok(main.includes(security), security);
});

test('sandbox preload exposes exactly five bounded S7 methods and no URL/header/method or remote execution authority', () => {
  assert.equal((preload.match(/\brequire\s*\(/g) || []).length, 1);
  assert.equal((preload.match(/ipcRenderer\.invoke\('s7:sync:/g) || []).length, 5);
  assert.match(preload, /s7:\s*Object\.freeze\(\{ sync: s7Sync \}\)/);
  for (const channel of S7_CHANNELS) assert.ok(preload.includes(channel), `missing ${channel}`);
  assert.doesNotMatch(preload, /s7:sync:(start|stop|focus|pause|resume|execute|approve|reject|retry|provider|deploy|promote|rollback|mutate)/i);
  assert.doesNotMatch(preload, /s7[^\n]*(url|headers|authorization|cookie)/i);
  assert.doesNotMatch(preload, /state\.sqlite|DatabaseSync|workerManager|\bfetch\s*\(/);
});

test('S7 IPC registers exactly five sender-validated channels and derives membership id without accepting arbitrary transport arguments', async () => {
  assert.deepEqual([...CHANNELS], S7_CHANNELS);
  assert.equal(membershipId({ workspaceId: 'workspace-a', subjectId: 'local-operator' }), membershipId({ workspaceId: 'workspace-a', subjectId: 'local-operator' }));
  assert.notEqual(membershipId({ workspaceId: 'workspace-a', subjectId: 'local-operator' }), membershipId({ workspaceId: 'workspace-b', subjectId: 'local-operator' }));
  const handlers = new Map();
  const calls = [];
  const senders = [];
  const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
  const service = {
    querySyncState(workspaceId) { calls.push(['query', workspaceId]); return { workspaceId }; },
    configureSync(input) { calls.push(['configure', input]); return input; },
    pushPendingSync(input) { calls.push(['push', input]); return input; },
    pullSharedMirror(input) { calls.push(['pull', input]); return input; },
    recordMembership(input) { calls.push(['membership', input]); return input; },
  };
  registerS7Ipc({ ipcMain, assertSender: (event) => senders.push(event), service });
  assert.deepEqual([...handlers.keys()], S7_CHANNELS);
  const event = { senderFrame: { url: 'file:///trusted' } };
  await handlers.get('s7:sync:query-state')(event, 'workspace-a');
  await handlers.get('s7:sync:configure')(event, { workspaceId: 'workspace-a', status: 'disabled' });
  await handlers.get('s7:sync:push-pending')(event, { workspaceId: 'workspace-a' });
  await handlers.get('s7:sync:pull-mirror')(event, { workspaceId: 'workspace-a' });
  await handlers.get('s7:sync:membership:record')(event, { workspaceId: 'workspace-a', subjectId: 'local-operator', teamRoleId: 'owner-view', status: 'active' });
  assert.equal(senders.length, 5);
  assert.equal(calls.find(([name]) => name === 'membership')[1].id.startsWith('membership-'), true);
  assert.throws(() => handlers.get('s7:sync:configure')(event, null), /plain object/);
  assert.throws(() => handlers.get('s7:sync:membership:record')(event, []), /plain object/);
});

test('S7 panel is loaded after S6 and exposes collaboration explanation without remote control UI', () => {
  assert.match(s6Renderer, /s7-integrated\.js/);
  assert.match(s6Renderer, /data-s7-sync|s7Sync/);
  assert.match(s7Renderer, /getElementById\('s4-cockpit'\)/);
  for (const surface of ['Sync Status','Source Instance','Endpoint / Mode','Outbound Cursor','Acknowledged Cursor','Pending Envelopes','Remote Sources','Gap / Divergence','Members / Roles','Shared Workspace','Remote Worker Presence']) {
    assert.ok(s7Renderer.includes(surface), `missing ${surface}`);
  }
  assert.match(s7Renderer, /Push pending safe envelopes/);
  assert.match(s7Renderer, /Pull collaboration mirror/);
  assert.match(s7Renderer, /Read-only presence\. S7 exposes no remote Worker control/);
  assert.doesNotMatch(s7Renderer, /\bfetch\s*\(|XMLHttpRequest|node:sqlite|DatabaseSync|state\.sqlite/);
  assert.doesNotMatch(s7Renderer, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(s7Renderer, /bridge\.(?:startWorker|stopWorker|focusWorker|pauseWorker|resumeWorker|approveHumanGate|rejectHumanGate|retry|observe|deploy|promote|rollback)\b/i);
  assert.doesNotMatch(s7Renderer, /type\s*=\s*['"]url['"]|name\s*=\s*['"]authorization['"]/i);
});

test('S7 service persists only S7 sync/membership/mirror projections and contains no direct local execution control path', () => {
  for (const projection of ['syncConfiguration','syncSourceInstance','syncEnvelope','syncCursor','syncAck','syncDivergence','workspaceMembership','syncRemoteMirror']) {
    assert.match(s7Service, new RegExp(`projectionType: '${projection}'`));
  }
  assert.match(s7Service, /class S7ApplicationService extends S6SchedulingApplicationService/);
  assert.match(s7Service, /queryOperatorCockpit\(workspaceId\)/);
  assert.match(s7Service, /collaborationSync: this\.querySyncState\(workspaceId\)/);
  assert.doesNotMatch(s7Service, /workerManager\.start\s*\(/);
  assert.doesNotMatch(s7Service, /submitAuthorizedLocalTask\s*\(/);
  assert.doesNotMatch(s7Service, /approveHumanGate\s*\(/);
  assert.doesNotMatch(s7Service, /rejectHumanGate\s*\(/);
  assert.doesNotMatch(s7Service, /retryStepAfterReview\s*\(/);
  assert.doesNotMatch(s7Service, /locks\.(?:acquire|release)/);
});
