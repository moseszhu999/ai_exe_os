const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const Module = require('node:module');

const probePath = join(__dirname, 's0-runtime-recovery-matrix-probe.cjs');
let source = readFileSync(probePath, 'utf8');

const replacements = [
  ['firstSubmission.result', 'firstSubmission.execution.result', 1],
  ['secondSubmission.result', 'secondSubmission.execution.result', 2],
];

for (const [from, to, expectedCount] of replacements) {
  const actualCount = source.split(from).length - 1;
  assert.equal(
    actualCount,
    expectedCount,
    `Recovery probe contract changed: expected ${expectedCount} occurrence(s) of ${from}, found ${actualCount}`,
  );
  source = source.split(from).join(to);
}

const compiled = new Module(probePath, module);
compiled.filename = probePath;
compiled.paths = Module._nodeModulePaths(__dirname);
compiled._compile(source, probePath);
