'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const electronExecutable = require('electron');
const { S5ApplicationService } = require('../src/application/s5-index.cjs');
const { BoundedReadOnlyHttpTransport } = require('../src/provider-adapters/transport/read-only-http-transport.cjs');

const PRODUCT_SHA = process.env.S5_PRODUCT_SHA || '5b1933a284c00b86bf438a53af6beb94c8d6eda9';
const OUTPUT = process.env.S5_ACCEPTANCE_OUTPUT || join(process.cwd(), 'runtime', 's5-acceptance');
const VERCEL_TARGET = process.env.S5_VERCEL_TARGET || 'https://chaintrace-eh6lm584p-aaronzhu1.vercel.app/';
const NETLIFY_TARGET = process.env.S5_NETLIFY_TARGET || 'https://chaintrace-app.netlify.app/';

function sh(name, args = []) { return execFileSync(name, args, { encoding: 'utf8' }).trim(); }
function shOr(name, args, fallback = 'unavailable') { try { return sh(name, args); } catch { return fallback; } }
function writeJson(name, value) { writeFileSync(join(OUTPUT, name), `${JSON.stringify(value, null, 2)}\n`); }

class PassiveWorkerManager {
  list() { return []; }
  async focus() { throw new Error('unused'); }
  async stop() { throw new Error('unused'); }
  pause() { throw new Error('unused'); }
  resume() { throw new Error('unused'); }
  async submitAuthorizedLocalTask() { throw new Error('unused'); }
}

function sourceAudit() {
  const head = sh('git', ['rev-parse', 'HEAD']);
  sh('git', ['merge-base', '--is-ancestor', PRODUCT_SHA, head]);
  const raw = shOr('git', ['diff', '--name-only', PRODUCT_SHA, head], '');
  const changedPaths = raw ? raw.split('\n').filter(Boolean) : [];
  for (const path of changedPaths) {
    assert.ok(
      path.startsWith('scripts/s5-acceptance-')
        || path.startsWith('.github/workflows/s5-')
        || path === 'docs/results/S5-results.md',
      `acceptance carrier modified product path: ${path}`,
    );
  }
  return { productSha: PRODUCT_SHA, acceptanceHead: head, changedPaths };
}

function architecture() {
  assert.equal(process.arch, 'arm64');
  assert.equal(sh('uname', ['-m']), 'arm64');
  assert.notEqual(shOr('sysctl', ['-in', 'sysctl.proc_translated'], '0'), '1');
  assert.ok(existsSync(electronExecutable), 'Electron executable missing');
  const electronFile = sh('file', ['-b', electronExecutable]);
  const electronArchs = shOr('lipo', ['-archs', electronExecutable]);
  assert.match(`${electronFile} ${electronArchs}`, /arm64/, 'Electron is not arm64-capable');
  return { node: process.arch, uname: sh('uname', ['-m']), electron: { file: electronFile, lipo: electronArchs } };
}

async function rejectWithoutRequest(transport, fn, pattern) {
  const before = transport.methodAudit().length;
  await assert.rejects(fn, pattern);
  assert.equal(transport.methodAudit().length, before, 'blocked input reached provider transport');
  return 'PASS';
}

function assertLiveAudit(audit) {
  assert.ok(audit.length >= 2, 'expected live requests for both providers');
  const allowedOrigins = new Set([new URL(VERCEL_TARGET).origin, new URL(NETLIFY_TARGET).origin]);
  const seenOrigins = new Set();
  for (const row of audit) {
    assert.ok(['GET', 'HEAD'].includes(row.method), `write method reached provider audit: ${row.method}`);
    const origin = new URL(row.target).origin;
    assert.ok(allowedOrigins.has(origin), `request escaped approved origins: ${row.target}`);
    seenOrigins.add(origin);
  }
  assert.ok(seenOrigins.has(new URL(VERCEL_TARGET).origin), 'Vercel live target was not requested');
  assert.ok(seenOrigins.has(new URL(NETLIFY_TARGET).origin), 'Netlify live target was not requested');
}

function assertPrivacySafe(value) {
  const raw = JSON.stringify(value);
  assert.doesNotMatch(raw, /"(?:authorization|proxy-authorization|cookie|set-cookie|password|access[_-]?token|refresh[_-]?token|secret|private[_ -]?key|profilePath|profileDir|userDataDir|storageState|processId|pid|ppid|body|responseBody)"\s*:/i);
}

async function main() {
  mkdirSync(OUTPUT, { recursive: true });
  const source = sourceAudit();
  const arch = architecture();
  const runtimeRoot = mkdtempSync(join(tmpdir(), 'ai-exe-os-s5-provider-'));
  const databasePath = join(runtimeRoot, 'state.sqlite');
  const transport = new BoundedReadOnlyHttpTransport({ timeoutMs: 15000, maxRedirects: 3 });
  let service = new S5ApplicationService({ databasePath, workerManager: new PassiveWorkerManager(), providerTransport: transport });
  try {
    const safety = {};
    safety.privateTargetBlockedBeforeNetwork = await rejectWithoutRequest(
      transport,
      () => transport.observe({ approvedTarget: 'https://127.0.0.1/', method: 'HEAD' }),
      /allowed external target|private_target_blocked|not an allowed external target/i,
    );
    safety.credentialTargetBlockedBeforeNetwork = await rejectWithoutRequest(
      transport,
      () => transport.observe({ approvedTarget: 'https://user:pass@example.com/', method: 'HEAD' }),
      /credentials|credential/i,
    );
    const beforeBadBinding = transport.methodAudit().length;
    assert.throws(() => service.bindProviderTarget({
      id: 's5-bad-provider-target', workspaceId: 'workspace-a', provider: 'vercel', adapterId: 'vercel.public-deployment',
      providerContractId: 'provider-vercel-public', action: 'observe_public_deployment', exactTarget: NETLIFY_TARGET,
    }), /Vercel|mismatch|hostname/i);
    assert.equal(transport.methodAudit().length, beforeBadBinding);
    safety.providerMismatchBlockedBeforeNetwork = 'PASS';

    const vercel = service.bindProviderTarget({
      id: 's5-live-vercel-binding', workspaceId: 'workspace-a', provider: 'vercel', adapterId: 'vercel.public-deployment',
      providerContractId: 'provider-vercel-public', action: 'observe_public_deployment', exactTarget: VERCEL_TARGET,
    });
    const netlify = service.bindProviderTarget({
      id: 's5-live-netlify-binding', workspaceId: 'workspace-a', provider: 'netlify', adapterId: 'netlify.public-deployment',
      providerContractId: 'provider-netlify-public', action: 'observe_public_deployment', exactTarget: NETLIFY_TARGET,
    });
    assert.throws(() => service.requireS5Binding('workspace-b', vercel.id), /Cross-Workspace/);
    safety.crossWorkspaceBlockedBeforeNetwork = 'PASS';
    safety.writeMethodBlockedBeforeNetwork = await rejectWithoutRequest(
      transport,
      () => service.observeProvider({ id: 's5-blocked-write', workspaceId: 'workspace-a', bindingId: vercel.id, method: 'POST' }),
      /GET or HEAD|not permitted|method/i,
    );

    const vercelResult = await service.observeProvider({
      id: 's5-live-vercel-observation', workspaceId: 'workspace-a', bindingId: vercel.id, method: 'HEAD',
    });
    const netlifyResult = await service.observeProvider({
      id: 's5-live-netlify-observation', workspaceId: 'workspace-a', bindingId: netlify.id, method: 'HEAD',
    });
    assert.equal(vercelResult.networkRequested, true);
    assert.equal(netlifyResult.networkRequested, true);
    assert.equal(vercelResult.observation.provider, 'vercel');
    assert.equal(netlifyResult.observation.provider, 'netlify');
    assert.equal(vercelResult.observation.state, 'succeeded', `Vercel live observation failed: ${vercelResult.observation.failureCode || vercelResult.observation.statusCode}`);
    assert.equal(netlifyResult.observation.state, 'succeeded', `Netlify live observation failed: ${netlifyResult.observation.failureCode || netlifyResult.observation.statusCode}`);
    assert.equal(vercelResult.observation.exactTarget, VERCEL_TARGET);
    assert.equal(netlifyResult.observation.exactTarget, NETLIFY_TARGET);

    const state = service.queryProviderState('workspace-a');
    assert.equal(state.found, true);
    assert.deepEqual(state.bindings.map((item) => item.id).sort(), [netlify.id, vercel.id].sort());
    assert.deepEqual(state.observations.map((item) => item.id).sort(), ['s5-live-netlify-observation', 's5-live-vercel-observation'].sort());
    const liveAudit = transport.methodAudit();
    assertLiveAudit(liveAudit);
    const cockpit = service.queryOperatorCockpit('workspace-a');
    assert.equal(cockpit.providerAdapters.observations.length, 2);
    assertPrivacySafe(state);
    assertPrivacySafe(cockpit.providerAdapters);

    writeJson('provider-target-bindings.json', { status: 'PASS', productSha: PRODUCT_SHA, bindings: state.bindings });
    writeJson('provider-observations.json', { status: 'PASS', productSha: PRODUCT_SHA, observations: state.observations });
    writeJson('provider-method-audit.json', { status: 'PASS', productSha: PRODUCT_SHA, audit: liveAudit });
    writeJson('provider-safety-matrix.json', {
      status: 'PASS', productSha: PRODUCT_SHA, source, architecture: arch,
      approvedTargets: { vercel: VERCEL_TARGET, netlify: NETLIFY_TARGET },
      rows: {
        ...safety,
        exactTargetBindings: 'PASS', liveVercelObservation: 'PASS', liveNetlifyObservation: 'PASS',
        methodAuditReadOnly: 'PASS', approvedOriginOnly: 'PASS', canonicalEvidenceBodyFree: 'PASS', cockpitEvidenceVisible: 'PASS',
      },
    });
    writeJson('provider-cockpit-state.json', cockpit.providerAdapters);

    const projectionBefore = service.store.projectionDigest({ workspaceId: 'workspace-a' });
    const eventCountBefore = service.store.listEvents().length;
    service.store.exportEventsJsonl(join(OUTPUT, 'canonical-events.jsonl'));
    service.close();
    service = null;

    const restartTransport = new BoundedReadOnlyHttpTransport({ timeoutMs: 15000, maxRedirects: 3 });
    service = new S5ApplicationService({ databasePath, workerManager: new PassiveWorkerManager(), providerTransport: restartTransport });
    const restartState = service.queryProviderState('workspace-a');
    assert.equal(restartState.bindings.length, 2);
    assert.equal(restartState.observations.length, 2);
    assert.deepEqual(restartTransport.methodAudit(), [], 'restart replayed provider network access');
    const replayVercel = await service.observeProvider({ id: 's5-live-vercel-observation', workspaceId: 'workspace-a', bindingId: vercel.id, method: 'HEAD' });
    const replayNetlify = await service.observeProvider({ id: 's5-live-netlify-observation', workspaceId: 'workspace-a', bindingId: netlify.id, method: 'HEAD' });
    assert.equal(replayVercel.replayed, true);
    assert.equal(replayNetlify.replayed, true);
    assert.equal(replayVercel.networkRequested, false);
    assert.equal(replayNetlify.networkRequested, false);
    assert.deepEqual(restartTransport.methodAudit(), [], 'idempotent replay issued provider request');
    const projectionAfter = service.store.projectionDigest({ workspaceId: 'workspace-a' });
    const eventCountAfter = service.store.listEvents().length;
    assert.equal(projectionAfter, projectionBefore);
    assert.equal(eventCountAfter, eventCountBefore);
    writeJson('projection-restart-digests.json', {
      status: 'PASS', productSha: PRODUCT_SHA,
      projectionBefore, projectionAfter, eventCountBefore, eventCountAfter,
      providerRequestsAfterRestart: restartTransport.methodAudit().length,
      bindingsAfterRestart: restartState.bindings.length,
      observationsAfterRestart: restartState.observations.length,
    });

    const result = {
      status: 'PASS', productSha: PRODUCT_SHA, evidenceClass: 'github-hosted-native-apple-silicon',
      source, architecture: arch, approvedTargets: { vercel: VERCEL_TARGET, netlify: NETLIFY_TARGET },
      liveStatus: {
        vercel: { state: vercelResult.observation.state, statusCode: vercelResult.observation.statusCode },
        netlify: { state: netlifyResult.observation.state, statusCode: netlifyResult.observation.statusCode },
      },
      requestCount: liveAudit.length, restartRequestCount: restartTransport.methodAudit().length,
    };
    writeJson('native-provider-matrix.json', result);
    console.log(JSON.stringify(result, null, 2));

    service.close();
    service = null;
    await new Promise((resolve) => setTimeout(resolve, 250));
    const residual = sh('ps', ['-axo', 'command']).split('\n').filter((line) => line.includes(runtimeRoot));
    assert.deepEqual(residual, []);
    writeJson('cleanup-audit.json', { status: 'PASS', residualScopedProcesses: residual });
  } finally {
    try { service?.close(); } catch {}
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
