#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = process.env.RUN216_ROOT ? path.resolve(process.env.RUN216_ROOT) : path.resolve(__dirname, '..');
const TARGET_PATH = path.join(ROOT, 'service-worker.js');
const MARKER = '// Run216 World Editor TransformControls offline shell extension.';
const REQUIRED_PATHS = Object.freeze([
  './src/3d/editor/EditorTransformControls.js',
  './src/3d/editor/EditorScaleInputController.js',
  './src/3d/editor/EditorAssetScalePolicy.js',
  './src/3d/editor/EditorRoadModel.js',
  './src/3d/editor/EditorRoadController.js',
  './src/3d/editor/EditorTerrainCellModel.js',
  './src/3d/editor/EditorTerrainPaintController.js',
  './src/3d/editor/EditorClipboardController.js',
  './src/3d/editor/EditorEditModeEnvironment.js',
  './src/3d/editor/EditorLiveWorldBridge.js',
  './src/3d/editor/EditorLiveWorldAuthoring.js',
  './src/3d/editor/EditorLiveWorldVisualSync.js',
  './src/3d/editor/EditorWorldPatchCompiler.js',
  './src/3d/vendor/three/addons/controls/TransformControls.js'
]);
const BLOCK = `${MARKER}\nself.addEventListener('install', () => {\n${REQUIRED_PATHS.map((entry) => `    GAME3D_SHELL_FILES.push('${entry}');`).join('\n')}\n});\n\n`;

function fail(message) {
  throw new Error(message);
}

function verifyContent(content) {
  const text = content.toString('utf8');
  if (!text.startsWith(BLOCK)) fail('Run216 service-worker block is not the exact file prefix');
  for (const entry of REQUIRED_PATHS) {
    const count = text.split(entry).length - 1;
    if (count !== 1) fail(`Expected exactly one Run216 cache entry for ${entry}, found ${count}`);
  }
  return true;
}

function materialize(targetPath = TARGET_PATH) {
  if (!fs.existsSync(targetPath)) fail(`Missing ${path.relative(ROOT, targetPath)}`);
  const before = fs.readFileSync(targetPath);
  const beforeText = before.toString('utf8');

  if (beforeText.startsWith(BLOCK)) {
    verifyContent(before);
    return { created: false, before, after: before };
  }
  if (beforeText.includes(MARKER)) fail('Run216 service-worker marker exists away from the exact prefix');
  for (const entry of REQUIRED_PATHS) {
    if (beforeText.includes(entry)) fail(`Run216 cache path already exists outside the exact prefix: ${entry}`);
  }

  const after = Buffer.concat([Buffer.from(BLOCK, 'utf8'), before]);
  fs.writeFileSync(targetPath, after);
  const persisted = fs.readFileSync(targetPath);
  verifyContent(persisted);
  if (!persisted.subarray(Buffer.byteLength(BLOCK)).equals(before)) fail('Existing service-worker bytes changed during Run216 prepend');
  return { created: true, before, after: persisted };
}

function verifyTarget() {
  if (!fs.existsSync(TARGET_PATH)) fail('service-worker.js is missing');
  const content = fs.readFileSync(TARGET_PATH);
  verifyContent(content);
  console.log('[materializeRun216ServiceWorkerCache] PASS: exact Run216 cache prefix present once');
}

function runSelfTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run216-sw-'));
  const target = path.join(dir, 'service-worker.js');
  const original = Buffer.from("const GAME3D_SHELL_FILES = [];\nself.addEventListener('install', () => {});\n", 'utf8');
  try {
    fs.writeFileSync(target, original);
    const first = materialize(target);
    if (!first.created) fail('self-test first materialization did not create prefix');
    const firstBytes = fs.readFileSync(target);
    if (!firstBytes.subarray(Buffer.byteLength(BLOCK)).equals(original)) fail('self-test changed existing bytes');
    const second = materialize(target);
    if (second.created) fail('self-test second materialization was not idempotent');
    if (!fs.readFileSync(target).equals(firstBytes)) fail('self-test idempotent bytes drifted');
    console.log('[materializeRun216ServiceWorkerCache] PASS: prepend-only and idempotency self-test');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }
  if (process.argv.includes('--verify-only')) {
    verifyTarget();
    return;
  }
  const result = materialize();
  console.log(`[materializeRun216ServiceWorkerCache] PASS: ${result.created ? 'created exact prefix' : 'already exact'}; existing service-worker bytes preserved`);
}

try {
  main();
} catch (error) {
  console.error(`[materializeRun216ServiceWorkerCache] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
}