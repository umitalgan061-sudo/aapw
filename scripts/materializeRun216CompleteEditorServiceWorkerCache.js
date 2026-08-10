#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'service-worker.js');
const MARKER = '// Run216 complete World Editor offline shell extension.';
const PATHS = Object.freeze([
  './src/3d/editor/EditorAssetScalePolicy.js',
  './src/3d/editor/EditorClipboardController.js',
  './src/3d/editor/EditorEditModeEnvironment.js',
  './src/3d/editor/EditorGamePatchPreview.js',
  './src/3d/editor/EditorGamePatchPreviewGate.js',
  './src/3d/editor/EditorGamePatchPreviewGateSafe.js',
  './src/3d/editor/EditorGamePreviewLauncher.js',
  './src/3d/editor/EditorHistoryController.js',
  './src/3d/editor/EditorInstanceBoundsSafety.js',
  './src/3d/editor/EditorInstanceCoordinatorLifecycle.js',
  './src/3d/editor/EditorInstanceEditCoordinator.js',
  './src/3d/editor/EditorInstanceEditCoordinatorSafe.js',
  './src/3d/editor/EditorInstanceEditOperations.js',
  './src/3d/editor/EditorInstanceEditSession.js',
  './src/3d/editor/EditorInstanceInteractionBootstrap.js',
  './src/3d/editor/EditorInstanceInteractionInstaller.js',
  './src/3d/editor/EditorInstanceInteractionPipeline.js',
  './src/3d/editor/EditorInstanceInteractionRuntime.js',
  './src/3d/editor/EditorInstanceInteractionSingleton.js',
  './src/3d/editor/EditorInstanceLifecycleSafety.js',
  './src/3d/editor/EditorInstancePickingModel.js',
  './src/3d/editor/EditorInstancePointerController.js',
  './src/3d/editor/EditorInstancePointerOwnership.js',
  './src/3d/editor/EditorInstanceRaycastSource.js',
  './src/3d/editor/EditorInstanceRenderAdapter.js',
  './src/3d/editor/EditorInstanceSelectionModel.js',
  './src/3d/editor/EditorInstanceTransformBridge.js',
  './src/3d/editor/EditorInstanceTransformProxy.js',
  './src/3d/editor/EditorLiveWorldAuthoring.js',
  './src/3d/editor/EditorLiveWorldBridge.js',
  './src/3d/editor/EditorLiveWorldResourceCleanup.js',
  './src/3d/editor/EditorLiveWorldVisualSync.js',
  './src/3d/editor/EditorLocalSession.js',
  './src/3d/editor/EditorLocationNavigator.js',
  './src/3d/editor/EditorPlacementController.js',
  './src/3d/editor/EditorPlacementControllerSafe.js',
  './src/3d/editor/EditorRoadController.js',
  './src/3d/editor/EditorRoadModel.js',
  './src/3d/editor/EditorScaleInputController.js',
  './src/3d/editor/EditorTerrainCellModel.js',
  './src/3d/editor/EditorTerrainPaintController.js',
  './src/3d/editor/EditorTerrainSemantics.js',
  './src/3d/editor/EditorTransformControls.js',
  './src/3d/editor/EditorWorldPatchCompiler.js',
  './src/3d/vendor/three/addons/controls/TransformControls.js'
]);

const BLOCK = `${MARKER}\nself.addEventListener('install', () => {\n${PATHS.map((entry) => `    GAME3D_SHELL_FILES.push('${entry}');`).join('\n')}\n});\n\n`;

const before = fs.readFileSync(TARGET);
const text = before.toString('utf8');
if (text.startsWith(BLOCK)) {
  console.log('[materializeRun216CompleteEditorServiceWorkerCache] PASS: exact prefix already present');
  process.exit(0);
}
if (text.includes(MARKER)) throw new Error('Run216 complete cache marker exists away from exact prefix');
for (const entry of PATHS) {
  if (text.includes(`GAME3D_SHELL_FILES.push('${entry}')`)) throw new Error(`Cache entry already exists outside complete prefix: ${entry}`);
}
const after = Buffer.concat([Buffer.from(BLOCK, 'utf8'), before]);
fs.writeFileSync(TARGET, after);
const persisted = fs.readFileSync(TARGET);
if (!persisted.subarray(Buffer.byteLength(BLOCK)).equals(before)) throw new Error('Existing service-worker bytes changed');
console.log(`[materializeRun216CompleteEditorServiceWorkerCache] PASS: prepended ${PATHS.length} cache entries; existing bytes preserved`);
