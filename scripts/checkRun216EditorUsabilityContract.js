#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const fail = (message) => { throw new Error(message); };
const requireText = (text, needle, label) => { if (!text.includes(needle)) fail(`Missing ${label}: ${needle}`); };

function main() {
  const html = read('editor.html');
  const authoring = read('src/3d/editor/EditorLiveWorldAuthoring.js');
  const visuals = read('src/3d/editor/EditorLiveWorldVisualSync.js');
  const placement = read('src/3d/editor/EditorPlacementControllerSafe.js');
  const materializer = read('scripts/materializeRun216ServiceWorkerCache.js');

  const bridgeIndex = html.indexOf('./src/3d/editor/EditorLiveWorldBridge.js');
  const authoringIndex = html.indexOf('./src/3d/editor/EditorLiveWorldAuthoring.js');
  const visualsIndex = html.indexOf('./src/3d/editor/EditorLiveWorldVisualSync.js');
  const placementIndex = html.indexOf('./src/3d/editor/EditorPlacementControllerSafe.js');
  if (!(bridgeIndex >= 0 && authoringIndex > bridgeIndex && visualsIndex > authoringIndex && placementIndex > visualsIndex)) {
    fail('Live World usability modules are not booted in dependency order.');
  }
  if (html.includes('./src/3d/editor/EditorPlacementController.js')) {
    fail('Deprecated placement prototype must remain unwired.');
  }

  requireText(authoring, 'liveSurface.liveState.groundCollider', 'canonical terrain height source');
  requireText(authoring, 'chunkManager.scene = api.scene', 'streamed terrain editor-scene ownership');
  requireText(authoring, 'activeRaycaster.intersectObjects(objects, false)', 'real surface raycast');
  requireText(authoring, 'cleanupBootDemoMarkers', 'synthetic demo cleanup');
  requireText(authoring, "badge.textContent = 'EDIT MODE · LIVE WORLD'", 'live editor badge');

  for (const needle of [
    "updateWater(state.water, api.camera.position",
    "updateAuroraSky(state.sky, api.camera.position",
    "updateStarfield(state.stars, api.camera.position",
    'updateDayNightLighting(',
    'window.requestAnimationFrame(tick)',
    'window.cancelAnimationFrame(frame)'
  ]) requireText(visuals, needle, 'live visual synchronization');
  if (visuals.includes('.render(') || visuals.includes('setAnimationLoop')) {
    fail('Visual sync must not take renderer-loop ownership.');
  }

  for (const needle of [
    "placeButton.textContent = 'Yerleştir'",
    "groundButton.textContent = 'Zemine Oturt'",
    'authoring.surfacePointFromClient(event.clientX, event.clientY)',
    'Math.max(terrainY, Number(point.y) || terrainY)',
    'object.position.y += terrainY - box.min.y',
    'new MutationObserver(syncUi)',
    "roads?.isDrawing?.()",
    "window.__WESTEROS_EDITOR_TERRAIN__?.setMode?.(null)",
    "#we-road-tools, #we-terrain-tools, #we-transform-tools",
    '@media(max-width:900px)'
  ]) requireText(placement, needle, 'placement usability');
  if (placement.includes('DOMSubtreeModified')) fail('Live placement must not use deprecated mutation events.');

  for (const cached of [
    './src/3d/editor/EditorLiveWorldAuthoring.js',
    './src/3d/editor/EditorLiveWorldVisualSync.js',
    './src/3d/editor/EditorPlacementControllerSafe.js'
  ]) requireText(materializer, cached, 'PWA cache registration');

  console.log('[checkRun216EditorUsabilityContract] PASS: live-world boot order, canonical terrain authoring, camera-follow visuals, safe click placement, ground snap, tool arbitration, mobile visibility and PWA cache contract are present; deprecated placement prototype remains unwired.');
}

try { main(); } catch (error) {
  console.error(`[checkRun216EditorUsabilityContract] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
}
