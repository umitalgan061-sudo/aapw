#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(process.argv[2] || '.');
const checks = [
  ['scripts/checkEditorInstanceSelectionModel.js', ['src/3d/editor/EditorInstanceSelectionModel.js']],
  ['scripts/checkEditorInstanceSelectionPersistence.js', [ROOT]],
  ['scripts/checkEditorInstanceRenderAdapter.js', ['src/3d/editor/EditorInstanceRenderAdapter.js']]
];

function resolveArg(arg) {
  return arg === ROOT ? ROOT : path.join(ROOT, arg);
}

function main() {
  const required = [
    'src/3d/editor/EditorInstanceSelectionModel.js',
    'src/3d/editor/EditorInstanceRenderAdapter.js',
    'src/3d/editor/EditorSceneSerializer.js',
    ...checks.map(([script]) => script)
  ];
  for (const relative of required) {
    const target = path.join(ROOT, relative);
    if (!fs.existsSync(target)) throw new Error(`Run216 instance editing foundation file missing: ${relative}`);
  }

  for (const [script, args] of checks) {
    const command = [path.join(ROOT, script), ...args.map(resolveArg)];
    const result = spawnSync(process.execPath, command, { cwd: ROOT, encoding: 'utf8' });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 0) throw new Error(`${script} failed with exit ${result.status}`);
  }

  console.log('[checkRun216InstanceEditingFoundation] PASS: selection, persistence and render-adapter foundation verified');
}

try {
  main();
} catch (error) {
  console.error(`[checkRun216InstanceEditingFoundation] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
}
