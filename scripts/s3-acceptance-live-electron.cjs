'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join, relative, resolve } = require('node:path');
const { _electron: electron } = require('playwright');
const { GitHubObservationAdapter } = require('../src/main/github-observation/github-observation-adapter.cjs');
const { S1SqliteEventStore } = require('../src/storage/index.cjs');

const REPO_ROOT = resolve(__dirname, '..');
const ARTIFACT_DIR = resolve(process.env.S3_ARTIFACT_DIR || join(REPO_ROOT, 'artifacts', 's3-acceptance'));
const PRODUCT_HEAD = String(process.env.S3_PRODUCT_HEAD || '').trim();
const MERGED_MAIN = String(process.env.S3_MERGED_MAIN || '').trim();
const TARGET_OWNER = String(process.env.S3_TARGET_OWNER || 'moseszhu999').trim();
const TARGET_REPO = String(process.env.S3_TARGET_REPO || 'ai_exe_os').trim();
const TARGET_PR = Number(process.env.S3_TARGET_PR || '55');
const TOKEN = String(process.env.AI_EXE_OS_GITHUB_TOKEN || '');
const USER_DATA_DIR = resolve(process.env.S3_USER_DATA_DIR || join(tmpdir(), `ai-exe-os-s3-${process.pid}`));

const SHA40 = /^[0-9a-f]{40}$/i;
const FORBIDDEN_KEY = /^(password|passwd|cookie|cookies|set-cookie|authorization|authorizationcode|access[_-]?token|refresh[_-]?token|id[_-]?token|token|profilepath|profiledir|browserprofile|userdata(dir)?|storagestate|processid|pid|ppid)$/i;
const FORBIDDEN_STRING = /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bgh[pousr]_[A-Za-z0-9_]{10,}|\b(?:sessionid|access_token|refresh_token)=)/i;

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function writeJson(name, value) {
  writeFileSync(join(ARTIFACT_DIR, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function assertPrivacySafe(value, path = 'value') {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (FORBIDDEN_STRING.test(value)) throw new Error(`Forbidden secret-like value at ${path}`);
    return;
  }
  if (typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPrivacySafe(item, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`Forbidden sensitive key at ${path}.${key}`);
    assertPrivacySafe(nested, `${path}.${key}`);
  }
}

function filesRecursively(root) {
  const out = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) out.push(...filesRecursively(path));
    else out.push(path);
  }
  return out;
}

function assertArtifactDoesNotContainToken() {
  if (!TOKEN) return;
  const needle = Buffer.from(TOKEN);
  for (const file of filesRecursively(ARTIFACT_DIR)) {
    const bytes = readFileSync(file);
    if (bytes.includes(needle)) throw new Error(`GitHub token leaked into artifact: ${relative(ARTIFACT_DIR, file)}`);
  }
}

function writeChecksums() {
  const files = filesRecursively(ARTIFACT_DIR)
    .filter((file) => !file.endsWith('SHA256SUMS.txt'))
    .sort();
  const lines = files.map((file) => `${sha256Buffer(readFileSync(file))}  ${relative(ARTIFACT_DIR, file).replaceAll('\\', '/')}`);
  writeFileSync(join(ARTIFACT_DIR, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, { mode: 0o600 });
}

async function liveProviderAudit() {
  const requests = [];
  const adapter = new GitHubObservationAdapter({
    token: TOKEN || null,
    fetchImpl: async (url, options = {}) => {
      const method = String(options.method || 'GET').toUpperCase();
      const parsed = new URL(url);
      requests.push(Object.freeze({ method, host: parsed.host, path: parsed.pathname }));
      return fetch(url, options);
    },
  });

  const pullRequest = await adapter.observePullRequest({ owner: TARGET_OWNER, repo: TARGET_REPO, number: TARGET_PR });
  assert.equal(pullRequest.headSha, PRODUCT_HEAD, 'live PR head must equal frozen S3 product head');
  assert.equal(pullRequest.merged, true, 'acceptance target PR must be merged');
  assert.ok(pullRequest.mergeCommitSha && SHA40.test(pullRequest.mergeCommitSha), 'merged PR must expose merge commit SHA');

  const checks = await adapter.observeChecks({ owner: TARGET_OWNER, repo: TARGET_REPO, sha: pullRequest.headSha });
  const reviews = await adapter.observeReviewThreads({ owner: TARGET_OWNER, repo: TARGET_REPO, number: TARGET_PR, headSha: pullRequest.headSha });
  const compare = await adapter.compare({ owner: TARGET_OWNER, repo: TARGET_REPO, base: pullRequest.baseSha, head: pullRequest.headSha });

  assert.ok(requests.length >= 4, 'live provider audit must issue bounded read observations');
  assert.equal(requests.every((request) => request.method === 'GET'), true, 'every live GitHub provider request must be GET');
  assert.equal(requests.every((request) => request.host === 'api.github.com'), true, 'provider requests must remain on api.github.com');

  const evidence = { pullRequest, checks, reviews, compare, requests };
  assertPrivacySafe(evidence, 'liveProviderEvidence');
  writeJson('live-provider-observation.json', evidence);
  return evidence;
}

async function runElectron() {
  rmSync(USER_DATA_DIR, { recursive: true, force: true });
  mkdirSync(USER_DATA_DIR, { recursive: true, mode: 0o700 });

  const electronApp = await electron.launch({
    args: ['.'],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      AI_EXE_OS_GITHUB_TOKEN: TOKEN,
      AI_EXE_OS_USER_DATA_DIR: USER_DATA_DIR,
      AI_EXE_OS_TEST_PORT: String(process.env.S3_TEST_PORT || '45119'),
    },
  });

  let uiState;
  try {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.locator('#s3-heading').waitFor({ state: 'visible' });
    assert.match(await window.locator('body').innerText(), /AI Execution OS · S3/);
    assert.match(await window.locator('body').innerText(), /Provider mode: READ-ONLY/);

    await window.locator('#s3-repository').fill(`${TARGET_OWNER}/${TARGET_REPO}`);
    await window.locator('#s3-pr-number').fill(String(TARGET_PR));
    await window.locator('#s3-branch').fill('qa/s3-live-acceptance');
    await window.locator('#s3-path').fill('scripts/s3-acceptance-live-electron.cjs');

    await window.locator('#s3-register').click();
    await window.waitForFunction(() => document.querySelector('#s3-repositories')?.textContent?.includes('moseszhu999/ai_exe_os'));

    await window.locator('#s3-reserve').click();
    await window.waitForFunction(() => document.querySelector('#s3-ownership')?.textContent?.includes('qa/s3-live-acceptance'));

    await window.locator('#s3-claim').click();
    await window.waitForFunction(() => document.querySelector('#s3-ownership')?.textContent?.includes('scripts/s3-acceptance-live-electron.cjs'));

    await window.locator('#s3-load-head').click();
    await window.waitForFunction((head) => document.querySelector('#s3-expected-head')?.value === head, PRODUCT_HEAD);
    assert.equal(await window.locator('#s3-expected-head').inputValue(), PRODUCT_HEAD);

    await window.locator('#s3-required-checks').fill('');
    await window.locator('#s3-require-reviews').uncheck();
    await window.locator('#s3-require-base').check();
    await window.locator('#s3-bind').click();
    await window.waitForFunction((pr) => document.querySelector('#s3-prs')?.textContent?.includes(`PR #${pr}`), TARGET_PR);

    await window.locator('#s3-observe').click();
    await window.waitForFunction(() => document.querySelector('#s3-gates')?.textContent?.includes('satisfied'));
    await window.waitForFunction(() => document.querySelector('#s3-evidence')?.textContent?.includes('merge_observed'));

    uiState = await window.evaluate(async () => window.aiExecutionOS.s3.github.queryState('workspace-a'));
    assertPrivacySafe(uiState, 'uiState');
    assert.equal(uiState.repositories.length, 1);
    assert.equal(uiState.pullRequestBindings.length, 1);
    assert.equal(uiState.deliveryGates.some((gate) => gate.state === 'satisfied'), true);
    assert.equal(uiState.deliveryEvidence.some((item) => item.kind === 'merge_observed' && item.headSha === PRODUCT_HEAD), true);

    await window.screenshot({ path: join(ARTIFACT_DIR, 'electron-s3-delivery.png'), fullPage: true });
    writeJson('electron-ui-state.json', uiState);
  } finally {
    await electronApp.close();
  }

  const databasePath = join(USER_DATA_DIR, 's1-runtime', 'state.sqlite');
  assert.equal(existsSync(databasePath), true, 'canonical S1/S2/S3 SQLite database must exist after Electron acceptance');

  const store = new S1SqliteEventStore({ databasePath });
  const canonicalEvents = store.listEvents({ workspaceId: 'workspace-a' }).filter((event) => event.eventType.startsWith('github.'));
  const projectionTypes = [
    'repositoryRegistration','repositoryBinding','branchReservation','pathOwnershipClaim',
    'pullRequestBinding','pullRequestSnapshot','checkObservation','reviewThreadObservation',
    'mergeOrderConstraint','deliveryGate','deliveryEvidence','repairProposal','deliveryDependency',
  ];
  const projectionCounts = Object.fromEntries(projectionTypes.map((projectionType) => [projectionType, store.listProjections({ projectionType }).length]));
  store.close();

  assert.ok(canonicalEvents.some((event) => event.eventType === 'github.pull_request_observed'));
  assert.ok(canonicalEvents.some((event) => event.eventType === 'github.delivery_evidence_recorded'));
  assertPrivacySafe(canonicalEvents, 'canonicalEvents');
  writeJson('canonical-github-events.json', canonicalEvents);
  writeJson('projection-counts.json', projectionCounts);

  copyFileSync(databasePath, join(ARTIFACT_DIR, 'state.sqlite'));
  for (const suffix of ['-wal', '-shm']) {
    const source = `${databasePath}${suffix}`;
    if (existsSync(source)) copyFileSync(source, join(ARTIFACT_DIR, `state.sqlite${suffix}`));
  }

  return { uiState, canonicalEvents, projectionCounts };
}

async function main() {
  assert.ok(SHA40.test(PRODUCT_HEAD), 'S3_PRODUCT_HEAD must be an exact 40-character SHA');
  assert.ok(SHA40.test(MERGED_MAIN), 'S3_MERGED_MAIN must be an exact 40-character SHA');
  assert.ok(Number.isInteger(TARGET_PR) && TARGET_PR > 0, 'S3_TARGET_PR must be a positive integer');
  assert.ok(TOKEN, 'AI_EXE_OS_GITHUB_TOKEN is required for the private-repo live read-only row');

  rmSync(ARTIFACT_DIR, { recursive: true, force: true });
  mkdirSync(ARTIFACT_DIR, { recursive: true, mode: 0o700 });

  const providerEvidence = await liveProviderAudit();
  const electronEvidence = await runElectron();

  const manifest = {
    verdict: 'PASS',
    productHead: PRODUCT_HEAD,
    mergedMain: MERGED_MAIN,
    liveTarget: `${TARGET_OWNER}/${TARGET_REPO}#${TARGET_PR}`,
    mergeCommitSha: providerEvidence.pullRequest.mergeCommitSha,
    providerMethods: [...new Set(providerEvidence.requests.map((item) => item.method))],
    canonicalGitHubEventCount: electronEvidence.canonicalEvents.length,
    projectionCounts: electronEvidence.projectionCounts,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    generatedAt: new Date().toISOString(),
  };
  assertPrivacySafe(manifest, 'manifest');
  writeJson('manifest.json', manifest);

  assertArtifactDoesNotContainToken();
  writeChecksums();
  assertArtifactDoesNotContainToken();

  rmSync(USER_DATA_DIR, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({ verdict: 'PASS', artifactDir: ARTIFACT_DIR, productHead: PRODUCT_HEAD, mergedMain: MERGED_MAIN })}\n`);
}

main().catch((error) => {
  try { rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch {}
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
