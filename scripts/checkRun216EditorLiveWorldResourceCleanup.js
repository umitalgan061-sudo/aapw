#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'src/3d/editor/EditorLiveWorldResourceCleanup.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'editor.html'), 'utf8');
const materializer = fs.readFileSync(path.join(ROOT, 'scripts/materializeRun216ServiceWorkerCache.js'), 'utf8');
const fail = (message) => { throw new Error(message); };

function required(text, needle, label) {
  if (!text.includes(needle)) fail(`Missing ${label}: ${needle}`);
}

try {
  for (const needle of [
    'state.chunkManager?.disposeAll?.()',
    'disposeWater(state.water)',
    'disposeAuroraSky(state.sky)',
    'disposeStarfield(state.stars)',
    'disposeRiverMesh(state.river)',
    'disposeWaterfallMesh(waterfall)',
    'disposeSettlements(state.settlements)',
    'disposeRoadNetwork(state.roads)',
    'disposeVegetation(state.vegetation)',
    'disposeDayNightLighting(state.scene, state.lights)',
    "window.addEventListener('pagehide', dispose, { once: true })"
  ]) required(source, needle, 'live-world resource cleanup');
  if (source.includes('disposeRealCastleModels')) fail('Real castles are bridge-owned and must not be double-disposed by cleanup layer.');
  if (source.includes('renderer.dispose')) fail('Cleanup layer must not own editor renderer disposal.');

  const placementIndex = html.indexOf('./src/3d/editor/EditorPlacementControllerSafe.js');
  const cleanupIndex = html.indexOf('./src/3d/editor/EditorLiveWorldResourceCleanup.js');
  if (!(placementIndex >= 0 && cleanupIndex > placementIndex)) fail('Resource cleanup must boot after live authoring tools.');
  required(materializer, './src/3d/editor/EditorLiveWorldResourceCleanup.js', 'PWA cleanup cache path');

  console.log('[checkRun216EditorLiveWorldResourceCleanup] PASS: terrain/water/sky/stars/river/waterfalls/settlements/roads/vegetation/lights use canonical disposers on pagehide without double-owning real castles or renderer.');
} catch (error) {
  console.error(`[checkRun216EditorLiveWorldResourceCleanup] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
}
