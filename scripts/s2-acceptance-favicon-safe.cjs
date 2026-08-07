'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

// Acceptance-only loopback server. It mirrors the product LocalTestServer surface and adds only
// /favicon.ico -> 204 so browser console auditing remains strict without changing product code.
const localServerModule = require('../src/main/local-test-server.cjs');
const ProductLocalTestServer = localServerModule.LocalTestServer;

class AcceptanceLocalTestServer extends ProductLocalTestServer {
  async start() {
    if (this.server) return this.baseUrl();
    this.server = http.createServer((request, response) => {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (path === '/favicon.ico') {
        response.writeHead(204, { 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      if (path === '/' || path === '/task-form.html') {
        const body = readFileSync(join(this.rootDirectory, 'task-form.html'));
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
          'Cache-Control': 'no-store',
        });
        response.end(body);
        return;
      }
      if (path === '/health') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ ok: true, scope: 'local-project-owned-test-surface' }));
        return;
      }
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    });

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.requestedPort, this.host, resolve);
    });
    this.port = this.server.address().port;
    return this.baseUrl();
  }
}
localServerModule.LocalTestServer = AcceptanceLocalTestServer;

// Acceptance-only instrumentation around the public S2 service. It does not mutate product state;
// it exports the canonical event stream and proves projection/checkpoint equality across restart.
const s2Module = require('../src/application/s2-index.cjs');
const ProductS2ApplicationService = s2Module.S2ApplicationService;
const outputRoot = process.env.S2_ACCEPTANCE_OUTPUT || join(process.cwd(), 'runtime', 's2-acceptance');
mkdirSync(outputRoot, { recursive: true });

let projectionBeforeRestart = null;
let eventCountBeforeRestart = null;
let checkpointBeforeRestart = null;
let digestEvidenceWritten = false;

class AcceptanceS2ApplicationService extends ProductS2ApplicationService {
  recordCheckpoint(input) {
    const checkpoint = super.recordCheckpoint(input);
    if (input?.id === 'happy-checkpoint' && checkpointBeforeRestart === null) {
      checkpointBeforeRestart = checkpoint.projectionDigest;
    } else if (input?.id === 'happy-checkpoint' && !digestEvidenceWritten) {
      const projectionAfterRestart = this.store.projectionDigest({ workspaceId: 'workspace-a' });
      const eventCountAfterRestart = this.store.listEvents().length;
      assert.equal(checkpoint.projectionDigest, checkpointBeforeRestart, 'checkpoint digest changed across restart');
      assert.equal(projectionAfterRestart, projectionBeforeRestart, 'projection digest changed across restart');
      assert.equal(eventCountAfterRestart, eventCountBeforeRestart, 'restart appended canonical events unexpectedly');
      const canonicalEventsPath = this.store.exportEventsJsonl(join(outputRoot, 'canonical-events.jsonl'));
      const canonicalText = readFileSync(canonicalEventsPath, 'utf8');
      assert.doesNotMatch(canonicalText, /profilePath|user-data|processId|\bpid\b|\bppid\b|authorization|\bBearer\b|cookie|password|secret|access[_-]?token|refresh[_-]?token|private[_ -]?key/i);
      writeFileSync(join(outputRoot, 'projection-checkpoint-digests.json'), `${JSON.stringify({
        status: 'PASS',
        workspaceId: 'workspace-a',
        eventCountBeforeRestart,
        eventCountAfterRestart,
        projectionBeforeRestart,
        projectionAfterRestart,
        checkpointBeforeRestart,
        checkpointAfterRestart: checkpoint.projectionDigest,
      }, null, 2)}\n`);
      digestEvidenceWritten = true;
    }
    return checkpoint;
  }

  close() {
    if (projectionBeforeRestart === null && checkpointBeforeRestart !== null) {
      projectionBeforeRestart = this.store.projectionDigest({ workspaceId: 'workspace-a' });
      eventCountBeforeRestart = this.store.listEvents().length;
    }
    return super.close();
  }
}
s2Module.S2ApplicationService = AcceptanceS2ApplicationService;

require('./s2-acceptance-native-mac.cjs');
