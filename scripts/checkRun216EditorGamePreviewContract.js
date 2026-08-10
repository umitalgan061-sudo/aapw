#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const fail = (message) => { throw new Error(message); };
const need = (text, needle, label) => { if (!text.includes(needle)) fail(`Missing ${label}: ${needle}`); };

try {
  const gameHtml = read('game3d.html');
  const gate = read('src/3d/editor/EditorGamePatchPreviewGateSafe.js');
  const preview = read('src/3d/editor/EditorGamePatchPreview.js');
  const launcher = read('src/3d/editor/EditorGamePreviewLauncher.js');
  const editorHtml = read('editor.html');
  const gameSource = read('src/3d/game3d.js');
  const materializer = read('scripts/materializeRun216ServiceWorkerCache.js');

  const gateIndex = gameHtml.indexOf('./src/3d/editor/EditorGamePatchPreviewGateSafe.js');
  const initIndex = gameHtml.indexOf("import { initGame3D } from './src/3d/game3d.js'");
  if (!(gateIndex >= 0 && gateIndex < initIndex)) fail('Safe preview gate must execute before game init module.');
  if (gameHtml.includes('./src/3d/editor/EditorGamePatchPreviewGate.js')) fail('Race-prone preview gate must remain unwired.');
  if (gameHtml.includes('./src/3d/editor/EditorGamePatchPreview.js')) fail('Heavy preview module must not be statically wired into normal game HTML.');

  need(gate, "params.get('editorPatch') === '1'", 'query gate');
  need(gate, "await import('./EditorGamePatchPreview.js')", 'serialized lazy preview import');

  for (const needle of [
    "const STORAGE_KEY = 'westeros-world-editor.scene.v1'",
    'validateEditorScene(JSON.parse(text))',
    'const originalRender = prototype.render',
    "this.domElement?.id !== 'game3d-canvas'",
    'if (prototype.render === captureRender) prototype.render = originalRender',
    'new EditorAssetManager()',
    'new EditorInstanceManager(scene, assetManager)',
    'rehydrateInstanceGroups(data.instanceGroups, instanceManager, findEditorAsset)',
    "collisionPolicy: 'visual-only'",
    'instanceManager.clear()',
    'AssetLoader.disposeObject3D(child)'
  ]) need(preview, needle, 'isolated visual preview');
  if (preview.includes('groundCollider') || preview.includes('settlementCollider') || preview.includes('playerHealth')) {
    fail('Editor game preview must not mutate gameplay collision/health ownership.');
  }

  need(launcher, "button.textContent = '▶ Oyunda Önizle'", 'preview launcher button');
  need(launcher, 'localSession.saveLocal({ quiet: true })', 'save-before-preview');
  need(launcher, "window.location.assign('./game3d.html?editorPatch=1')", 'preview navigation');
  const localIndex = editorHtml.indexOf('./src/3d/editor/EditorLocalSession.js');
  const launcherIndex = editorHtml.indexOf('./src/3d/editor/EditorGamePreviewLauncher.js');
  if (!(localIndex >= 0 && launcherIndex > localIndex)) fail('Preview launcher must boot after local session.');

  if (gameSource.includes('__WESTEROS_GAME_EDITOR_PREVIEW__') || gameSource.includes('editorPatch=1')) {
    fail('Core game3d.js must remain unaware of editor preview mode.');
  }

  for (const cached of [
    './src/3d/editor/EditorGamePreviewLauncher.js',
    './src/3d/editor/EditorGamePatchPreviewGateSafe.js',
    './src/3d/editor/EditorGamePatchPreview.js'
  ]) need(materializer, cached, 'PWA preview cache path');

  console.log('[checkRun216EditorGamePreviewContract] PASS: preview is query-gated, lazy, ordered before init, visual-only, canonical-scene validated, resource-clean and invisible to core game3d.js/normal game path.');
} catch (error) {
  console.error(`[checkRun216EditorGamePreviewContract] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
}
