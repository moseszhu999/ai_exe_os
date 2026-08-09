'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { S7ApplicationService } = require('../src/application/s7-index.cjs');
const { S8SourceHandoffApplicationService } = require('../src/application/s8-source-handoff-service.cjs');
const { S8DestinationAuthorityApplicationService } = require('../src/application/s8-destination-authority-service.cjs');
const { S8ProductApplicationService } = require('../src/application/s8-product-service.cjs');

function source(path) { return readFileSync(join(__dirname, '..', path), 'utf8'); }

test('S8 Electron root uses the composed product service with source handoff and destination authority', () => {
  assert.equal(S8ProductApplicationService.prototype instanceof S8SourceHandoffApplicationService, true);
  assert.equal(S8SourceHandoffApplicationService.prototype instanceof S7ApplicationService, true);
  for (const method of ['requestDelegationGate', 'decideDelegationGate', 'approveDelegationProposal', 'rejectDelegationProposal']) {
    assert.equal(S8ProductApplicationService.prototype[method], S8DestinationAuthorityApplicationService.prototype[method]);
  }
  const main = source('src/main/main.cjs');
  assert.match(main, /S8ApplicationService: S1ApplicationService \} = require\('\.\.\/application\/s8-product-service\.cjs'\)/);
  assert.doesNotMatch(main, /S8ApplicationService: S1ApplicationService \} = require\('\.\.\/application\/s8-source-handoff-service\.cjs'\)/);
  assert.doesNotMatch(main, /S8ApplicationService: S1ApplicationService \} = require\('\.\.\/application\/s8-index\.cjs'\)/);
});

test('S7 cockpit composition automatically loads exactly one S8 integrated panel script', () => {
  const s7 = source('src/renderer/s7-integrated.js');
  assert.match(s7, /script\[data-ai-exe-os-s8\]/);
  assert.match(s7, /script\.src = '\.\/s8-integrated\.js'/);
  assert.match(s7, /script\.dataset\.aiExeOsS8 = 'true'/);
  assert.match(s7, /document\.body\.append\(script\)/);
});

test('S8 integrated panel remains a bounded delegation UI rather than remote administration', () => {
  const s8 = source('src/renderer/s8-integrated.js');
  assert.match(s8, /Controlled Remote Execution Delegation/);
  assert.match(s8, /Remote source cannot decide this gate/);
  assert.match(s8, /Post-start remote cancellation is non-authoritative/);
  assert.doesNotMatch(s8, /bridge\.(startWorker|stopWorker|pauseWorker|resumeWorker|focusWorker|approveHumanGate|rejectHumanGate)/);
});
