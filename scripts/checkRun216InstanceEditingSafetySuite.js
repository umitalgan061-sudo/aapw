#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(process.argv[2] || '.');
const checks = [
  'scripts/checkRun216InstanceEditingExtendedFoundation.js',
  'scripts/checkEditorInstanceEditCoordinatorSafe.js'
];

function run(script) {
  const target = path.join(ROOT, script);
  if (!fs.existsSync(target)) throw new Error(`Run216 instance editing safety suite file missing: ${script}`);
  const result = spawnSync(process.execPath, [target, ROOT], { cwd: ROOT, encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`${script} failed with exit ${result.status}`);
}

try {
  for (const script of checks) run(script);
  console.log('[checkRun216InstanceEditingSafetySuite] PASS: extended foundation and failure-safe coordinator facade verified');
} catch (error) {
  console.error(`[checkRun216InstanceEditingSafetySuite] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
}
