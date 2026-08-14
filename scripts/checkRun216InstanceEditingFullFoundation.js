#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(process.argv[2] || '.');
const checks = [
  ['scripts/checkEditorInstanceSelectionModel.js', ['src/3d/editor/EditorInstanceSelectionModel.js']],
  ['scripts/checkEditorInstanceSelectionPersistence.js', [ROOT]],
  ['scripts/checkEditorInstanceRenderAdapter.js', ['src/3d/editor/EditorInstanceRenderAdapter.js']],
  ['scripts/checkEditorInstancePickingModel.js', ['src/3d/editor/EditorInstancePickingModel.js']],
  ['scripts/checkEditorInstanceTransformProxy.js', ['src/3d/editor/EditorInstanceTransformProxy.js']],
  ['scripts/checkEditorInstanceEditSession.js', ['src/3d/editor/EditorInstanceEditSession.js']]
];

const modules = [
  'src/3d/editor/EditorInstanceSelectionModel.js',
  'src/3d/editor/EditorInstanceRenderAdapter.js',
  'src/3d/editor/EditorInstancePickingModel.js',
  'src/3d/editor/EditorInstanceTransformProxy.js',
  'src/3d/editor/EditorInstanceEditSession.js'
];

function resolveArg(arg) {
  return arg === ROOT ? ROOT : path.join(ROOT, arg);
}

function runNode(args, label) {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`${label} failed with exit ${result.status}`);
}

function main() {
  const required = [...modules, ...checks.map(([script]) => script)];
  for (const relative of required) {
    const target = path.join(ROOT, relative);
    if (!fs.existsSync(target)) throw new Error(`Run216 full instance editing foundation file missing: ${relative}`);
  }

  for (const relative of modules) {
    runNode(['--check', path.join(ROOT, relative)], `node --check ${relative}`);
  }

  for (const [script, args] of checks) {
    runNode([path.join(ROOT, script), ...args.map(resolveArg)], script);
  }

  console.log('[checkRun216InstanceEditingFullFoundation] PASS: selection, persistence, render adapter, picking, transform proxy and transactional edit-session rollback verified');
}

try {
  main();
} catch (error) {
  console.error(`[checkRun216InstanceEditingFullFoundation] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
}
