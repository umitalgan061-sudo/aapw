#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(process.argv[2] || '.');
const checks = [
  'scripts/checkRun216InstanceEditingFullFoundation.js',
  'scripts/checkEditorInstanceBoundsSafety.js',
  'scripts/checkEditorInstanceEditOperations.js',
  'scripts/checkEditorInstanceEditCoordinator.js',
  'scripts/checkEditorInstanceLifecycleSafety.js'
];

function runNode(script) {
  const target = path.join(ROOT, script);
  if (!fs.existsSync(target)) throw new Error(`Run216 extended instance foundation file missing: ${script}`);
  const result = spawnSync(process.execPath, [target, ROOT], { cwd: ROOT, encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`${script} failed with exit ${result.status}`);
}

function main() {
  for (const script of checks) runNode(script);
  console.log('[checkRun216InstanceEditingExtendedFoundation] PASS: full foundation, bounds, operations, coordinator and failure-safe lifecycle verified');
}

try {
  main();
} catch (error) {
  console.error(`[checkRun216InstanceEditingExtendedFoundation] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
}
