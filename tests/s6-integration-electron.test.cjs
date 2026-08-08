'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { registerS6Ipc, CHANNELS } = require('../src/application/s6-ipc.cjs');

const root = join(__dirname, '..');
const main = readFileSync(join(root, 'src/main/main.cjs'), 'utf8');
const preload = readFileSync(join(root, 'src/preload/index.cjs'), 'utf8');
const s5Renderer = readFileSync(join(root, 'src/renderer/s5-integrated.js'), 'utf8');
const s6Renderer = readFileSync(join(root, 'src/renderer/s6-integrated.js'), 'utf8');
const s6Service = readFileSync(join(root, 'src/application/s6-index.cjs'), 'utf8');

const S6_CHANNELS = [
  's6:scheduling:query-state',
  's6:scheduling:record-policy',
  's6:scheduling:compute-decision',
  's6:scheduling:revalidate-proposal',
];

test('root composition instantiates S6 over accepted S5→S4→S3→S2 chain before IPC and BrowserWindow', () => {
  const serviceIndex = main.indexOf('s1Service = new S1ApplicationService');
  const registerIndex = main.lastIndexOf('registerIpc();');
  const windowIndex = main.indexOf('await createMainWindow();');
  assert.ok(serviceIndex >= 0 && serviceIndex < registerIndex && registerIndex < windowIndex);
  assert.match(main, /S5ApplicationService: S1ApplicationServiceS5/);
  assert.match(main, /S6ApplicationService: S1ApplicationService/);
  assert.match(main, /S1ApplicationService\.prototype instanceof S1ApplicationServiceS5/);
  assert.match(main, /registerS6Ipc\(\{ ipcMain, assertSender, service: s1Service \}\)/);
  assert.match(main, /databasePath: join\(s1RuntimeRoot, 'state\.sqlite'\)/);
  for (const security of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'webSecurity: true']) assert.ok(main.includes(security), security);
});

test('sandbox preload adds exactly four bounded S6 scheduling methods without execution/provider-write authority', () => {
  assert.equal((preload.match(/\brequire\s*\(/g) || []).length, 1);
  assert.equal((preload.match(/ipcRenderer\.invoke\('s6:scheduling:/g) || []).length, 4);
  assert.match(preload, /s6:\s*Object\.freeze\(\{ scheduling: s6Scheduling \}\)/);
  for (const channel of S6_CHANNELS) assert.ok(preload.includes(channel), `missing ${channel}`);
  assert.doesNotMatch(preload, /s6:scheduling:(start|execute|approve|reject|retry|provider|deploy|promote|rollback|mutate)/i);
  assert.doesNotMatch(preload, /state\.sqlite|DatabaseSync|workerManager|\bfetch\s*\(/);
});

test('S6 IPC registers exactly four sender-validated explicit channels', async () => {
  assert.deepEqual([...CHANNELS], S6_CHANNELS);
  const handlers = new Map();
  const calls = [];
  const senders = [];
  const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
  const service = {
    querySchedulingState(workspaceId) { calls.push(['query', workspaceId]); return { workspaceId }; },
    recordSchedulingPolicy(input) { calls.push(['policy', input]); return input; },
    computeSchedulingDecisionForWorkspace(input) { calls.push(['decision', input]); return input; },
    revalidateSchedulingProposal(input) { calls.push(['revalidate', input]); return input; },
  };
  registerS6Ipc({ ipcMain, assertSender: (event) => senders.push(event), service });
  assert.deepEqual([...handlers.keys()], S6_CHANNELS);
  const event = { senderFrame: { url: 'file:///trusted' } };
  await handlers.get('s6:scheduling:query-state')(event, 'workspace-a');
  await handlers.get('s6:scheduling:compute-decision')(event, { workspaceId: 'workspace-a' });
  await handlers.get('s6:scheduling:revalidate-proposal')(event, { workspaceId: 'workspace-a', proposalId: 'proposal-a' });
  assert.equal(senders.length, 3);
  assert.deepEqual(calls, [
    ['query', 'workspace-a'],
    ['decision', { workspaceId: 'workspace-a' }],
    ['revalidate', { workspaceId: 'workspace-a', proposalId: 'proposal-a' }],
  ]);
  assert.throws(() => handlers.get('s6:scheduling:record-policy')(event, null), /plain object/);
  assert.throws(() => handlers.get('s6:scheduling:compute-decision')(event, []), /plain object/);
});

test('S6 cockpit is loaded after S5 and exposes all required explanation surfaces', () => {
  assert.match(s5Renderer, /s6-integrated\.js/);
  assert.match(s5Renderer, /data-s6-scheduling|s6Scheduling/);
  assert.match(s6Renderer, /getElementById\('s4-cockpit'\)/);
  for (const surface of ['Policy', 'Capacity', 'Eligible Queue', 'Selected Assignment', 'Deferred Reasons', 'Worker Compatibility', 'Provider Capacity', 'Decision Evidence']) {
    assert.ok(s6Renderer.includes(surface), `missing ${surface}`);
  }
  assert.match(s6Renderer, /Record immutable bounded policy/);
  assert.match(s6Renderer, /Compute scheduling decision/);
  assert.match(s6Renderer, /Revalidate proposal/);
  assert.doesNotMatch(s6Renderer, /\bfetch\s*\(|XMLHttpRequest|node:sqlite|DatabaseSync|state\.sqlite/);
  assert.doesNotMatch(s6Renderer, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(s6Renderer, /bridge\.(?:startWorker|execute|approveHumanGate|rejectHumanGate|retry|observe|deploy|promote|rollback)\b/i);
});

test('S6 application integration persists proposals but contains no direct runtime start, gate approval, provider call or retry path', () => {
  assert.match(s6Service, /class S6ApplicationService extends S5ApplicationService/);
  assert.match(s6Service, /new ProjectionRepository\(\{ store: this\.store, projectionType: 'schedulingDecision' \}\)/);
  assert.match(s6Service, /new ProjectionRepository\(\{ store: this\.store, projectionType: 'assignmentProposal' \}\)/);
  assert.match(s6Service, /revalidateAssignmentProposal/);
  assert.doesNotMatch(s6Service, /workerManager\.start\s*\(/);
  assert.doesNotMatch(s6Service, /submitAuthorizedLocalTask\s*\(/);
  assert.doesNotMatch(s6Service, /approveHumanGate\s*\(/);
  assert.doesNotMatch(s6Service, /coordinator\.approve\s*\(/);
  assert.doesNotMatch(s6Service, /observeProvider\s*\(/);
  assert.doesNotMatch(s6Service, /retryStepAfterReview\s*\(/);
});
