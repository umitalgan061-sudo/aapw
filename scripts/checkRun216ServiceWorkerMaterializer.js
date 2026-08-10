#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_SW = path.join(ROOT, 'service-worker.js');
const MATERIALIZER = path.join(ROOT, 'scripts', 'materializeRun216ServiceWorkerCache.js');
const MARKER = '// Run216 World Editor TransformControls offline shell extension.';
const REQUIRED_PATHS = Object.freeze([
  './src/3d/editor/EditorTransformControls.js',
  './src/3d/editor/EditorScaleInputController.js',
  './src/3d/editor/EditorAssetScalePolicy.js',
  './src/3d/editor/EditorRoadModel.js',
  './src/3d/editor/EditorRoadController.js',
  './src/3d/editor/EditorTerrainCellModel.js',
  './src/3d/editor/EditorTerrainPaintController.js',
  './src/3d/editor/EditorTerrainSemantics.js',
  './src/3d/editor/EditorClipboardController.js',
  './src/3d/editor/EditorEditModeEnvironment.js',
  './src/3d/editor/EditorLiveWorldBridge.js',
  './src/3d/editor/EditorLiveWorldAuthoring.js',
  './src/3d/editor/EditorLiveWorldVisualSync.js',
  './src/3d/editor/EditorPlacementControllerSafe.js',
  './src/3d/editor/EditorLiveWorldResourceCleanup.js',
  './src/3d/editor/EditorWorldPatchCompiler.js',
  './src/3d/vendor/three/addons/controls/TransformControls.js'
]);

function fail(message) {
  throw new Error(message);
}

function runNode(args, options = {}) {
  const result = childProcess.spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    ...options
  });
  if (result.status !== 0) {
    fail(`Command failed: node ${args.join(' ')}\n${result.stdout || ''}${result.stderr || ''}`);
  }
  return result;
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

function main() {
  if (!fs.existsSync(SOURCE_SW)) fail('service-worker.js is missing');
  if (!fs.existsSync(MATERIALIZER)) fail('Run216 service-worker materializer is missing');

  const original = fs.readFileSync(SOURCE_SW);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run216-sw-real-'));
  const tempSw = path.join(dir, 'service-worker.js');

  try {
    fs.writeFileSync(tempSw, original);
    const env = { ...process.env, RUN216_ROOT: dir };

    runNode([MATERIALIZER], { env });
    const first = fs.readFileSync(tempSw);
    const firstText = first.toString('utf8');
    const markerIndex = firstText.indexOf(MARKER);
    if (markerIndex !== 0) fail(`Run216 marker must be the exact prefix, got index ${markerIndex}`);

    for (const entry of REQUIRED_PATHS) {
      const occurrences = count(firstText, entry);
      if (occurrences !== 1) fail(`Expected exactly one cache entry for ${entry}, found ${occurrences}`);
    }

    const originalOffset = first.length - original.length;
    if (originalOffset <= 0) fail('Materialized service worker did not grow additively');
    if (!first.subarray(originalOffset).equals(original)) fail('Existing service-worker bytes changed');

    runNode(['--check', tempSw]);
    runNode([MATERIALIZER, '--verify-only'], { env });
    runNode([MATERIALIZER], { env });

    const second = fs.readFileSync(tempSw);
    if (!second.equals(first)) fail('Second materialization changed bytes; operation is not idempotent');
    if (!fs.readFileSync(SOURCE_SW).equals(original)) fail('Regression test mutated repository service-worker.js');

    console.log(`[checkRun216ServiceWorkerMaterializer] PROOF: originalBytes=${original.length} materializedBytes=${first.length} additiveBytes=${originalOffset}`);
    console.log('[checkRun216ServiceWorkerMaterializer] PASS: real service-worker copy preserves all existing bytes, adds TransformControls + scale + road + terrain + clipboard + fog-free edit + live-world bridge + world-patch compiler cache paths once, remains syntactically valid, verifies cleanly and is idempotent');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`[checkRun216ServiceWorkerMaterializer] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
}