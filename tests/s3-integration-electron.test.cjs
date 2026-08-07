'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { registerS3Ipc } = require('../src/application/s3-ipc.cjs');

const root = join(__dirname, '..');
const main = readFileSync(join(root, 'src/main/main.cjs'), 'utf8');
const preload = readFileSync(join(root, 'src/preload/index.cjs'), 'utf8');
const html = readFileSync(join(root, 'src/renderer/index.html'), 'utf8');
const s3Renderer = readFileSync(join(root, 'src/renderer/s3-integrated.js'), 'utf8');

const S3_SURFACES = [
  'Repositories', 'Ownership', 'Pull Requests', 'Checks', 'Review Threads',
  'Delivery Gates', 'Merge Order', 'Delivery Evidence', 'Repair Proposals',
];

const S3_CHANNELS = [
  's3:github:query-state',
  's3:github:repository:register',
  's3:github:branch:reserve',
  's3:github:paths:claim',
  's3:github:pr:bind',
  's3:github:delivery:observe',
  's3:github:repair:propose',
];

test('legacy GitHub JSONL observer is removed and compatibility observation routes through canonical S3 service', () => {
  assert.doesNotMatch(main, /GitHubStateObserver|GitHubReadOnlyAdapter/);
  assert.doesNotMatch(main, /githubObserver\s*=|githubObserver\.observePullRequest/);
  assert.match(main, /github:observe-pr/);
  assert.match(main, /s1Service\.observeCompatibilityPullRequest\(safeInputObject\(input\)\)/);
  assert.match(main, /githubToken:\s*process\.env\.AI_EXE_OS_GITHUB_TOKEN\s*\|\|\s*null/);
  assert.match(main, /registerS3Ipc\(\{ ipcMain, assertSender, service: s1Service \}\)/);
  assert.equal((main.match(/state\.sqlite/g) || []).length >= 1, true);
});

test('sandbox preload preserves S0/S1/S2 and adds exactly seven nested S3 GitHub methods without local require', () => {
  assert.equal((preload.match(/\brequire\s*\(/g) || []).length, 1);
  assert.match(preload, /require\('electron'\)/);
  assert.doesNotMatch(preload, /require\(['"]\.\.?\//);
  assert.equal((preload.match(/ipcRenderer\.invoke\('s1:/g) || []).length, 6);
  assert.equal((preload.match(/ipcRenderer\.invoke\('s2:mission:/g) || []).length, 9);
  assert.equal((preload.match(/ipcRenderer\.invoke\('s3:github:/g) || []).length, 7);
  assert.match(preload, /s3:\s*Object\.freeze\(\{ github: s3Github \}\)/);
  for (const channel of S3_CHANNELS) assert.ok(preload.includes(channel), `missing ${channel}`);
  assert.doesNotMatch(preload, /s3:github:(merge|comment|review:submit|update|delete|dispatch)/i);
  assert.doesNotMatch(preload, /state\.sqlite|DatabaseSync|workerManager/);
});

test('S3 IPC registers exactly seven sender-validated channels and only calls local/read-only service methods', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
  const senderChecks = [];
  const calls = [];
  const service = {
    queryGitHubDeliveryState: (workspaceId) => ({ workspaceId }),
    registerRepository: (input) => { calls.push(['registerRepository', input]); return input; },
    reserveBranch: (input) => { calls.push(['reserveBranch', input]); return input; },
    claimPaths: (input) => { calls.push(['claimPaths', input]); return input; },
    bindPullRequest: (input) => { calls.push(['bindPullRequest', input]); return input; },
    observeDelivery: (input) => { calls.push(['observeDelivery', input]); return input; },
    createRepairProposal: (input) => { calls.push(['createRepairProposal', input]); return input; },
  };
  registerS3Ipc({ ipcMain, assertSender: (event) => senderChecks.push(event), service });
  assert.deepEqual([...handlers.keys()].sort(), [...S3_CHANNELS].sort());
  const event = { senderFrame: { url: 'file:///trusted' } };
  await handlers.get('s3:github:query-state')(event, 'workspace-a');
  await handlers.get('s3:github:delivery:observe')(event, { workspaceId: 'workspace-a', pullRequestBindingId: 'binding-a' });
  assert.equal(senderChecks.length, 2);
  assert.deepEqual(calls.map((item) => item[0]), ['observeDelivery']);
  await assert.rejects(() => handlers.get('s3:github:delivery:observe')(event, null), /object payload/);
});

test('integrated S3 renderer exposes all nine evidence surfaces and no provider-write or Node/database path', () => {
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /Provider mode: READ-ONLY/);
  assert.match(html, /s3-integrated\.js/);
  for (const surface of S3_SURFACES) assert.ok(html.includes(surface), `missing ${surface}`);
  for (const id of ['s3-register','s3-reserve','s3-claim','s3-load-head','s3-bind','s3-observe','s3-repair']) {
    assert.ok(html.includes(`id="${id}"`), `missing ${id}`);
  }
  assert.doesNotMatch(s3Renderer, /\brequire\s*\(/);
  assert.doesNotMatch(s3Renderer, /node:sqlite|DatabaseSync|state\.sqlite|innerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(s3Renderer, /mergePullRequest|closePullRequest|createComment|submitReview|updatePullRequest|deleteBranch|workflowDispatch/);
  assert.match(s3Renderer, /Refresh GitHub evidence · Read-Only/);
  assert.match(s3Renderer, /Created local RepairProposal; no GitHub write occurred/);
  assert.match(s3Renderer, /S3_SENSITIVE_KEY/);
});
