const { readdirSync, statSync } = require('node:fs');
const { join, extname } = require('node:path');
const { spawnSync } = require('node:child_process');

const roots = ['scripts', 'src', 'tests'];
const extensions = new Set(['.cjs', '.js']);
let failures = 0;

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
      continue;
    }
    if (!extensions.has(extname(path))) continue;
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    if (result.status !== 0) {
      failures += 1;
      process.stderr.write(result.stderr || result.stdout);
    }
  }
}

for (const root of roots) walk(root);
if (failures > 0) process.exit(1);
console.log('Source syntax check: PASS');
