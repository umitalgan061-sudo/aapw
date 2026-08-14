#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AUTHORING = path.join(ROOT, 'src/3d/editor/EditorLiveWorldAuthoring.js');
const HTML = path.join(ROOT, 'editor.html');
const MATERIALIZER = path.join(ROOT, 'scripts/materializeRun216ServiceWorkerCache.js');

function fail(message) { throw new Error(message); }
function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) fail(`Missing ${label}: ${needle}`);
}

function main() {
  const source = fs.readFileSync(AUTHORING, 'utf8');
  const html = fs.readFileSync(HTML, 'utf8');
  const materializer = fs.readFileSync(MATERIALIZER, 'utf8');

  assertIncludes(source, "liveSurface.liveState.groundCollider", 'canonical ground collider ownership');
  assertIncludes(source, "chunkManager.scene = api.scene", 'editor-scene streaming ownership');
  assertIncludes(source, "chunkManager.streamTowards", 'live terrain streaming');
  assertIncludes(source, "activeRaycaster.intersectObjects(objects, false)", 'synthetic-ground live raycast bridge');
  assertIncludes(source, "groundHeight(target.x, target.z)", 'target terrain-height sampling');
  assertIncludes(source, "groundHeight(x, z) - localBaseY", 'asset base-on-terrain placement');
  assertIncludes(source, "record.instances[index]", 'formation instance terrain projection');
  assertIncludes(source, "cleanupBootDemoMarkers", 'synthetic boot marker cleanup');
  assertIncludes(source, "EDIT MODE · LIVE WORLD", 'live-world viewport state');
  assertIncludes(source, "previousGroundRaycast", 'raycast rollback ownership');
  assertIncludes(source, "chunkManager.disposeAll?.()", 'streamed terrain disposal');

  const bridgeIndex = html.indexOf('./src/3d/editor/EditorLiveWorldBridge.js');
  const roadIndex = html.indexOf('./src/3d/editor/EditorRoadController.js');
  const terrainIndex = html.indexOf('./src/3d/editor/EditorTerrainPaintController.js');
  const authoringIndex = html.indexOf('./src/3d/editor/EditorLiveWorldAuthoring.js');
  if (!(bridgeIndex >= 0 && roadIndex > bridgeIndex && terrainIndex > roadIndex && authoringIndex > terrainIndex)) {
    fail('Editor live-world authoring must boot after bridge, road and terrain controllers.');
  }
  assertIncludes(materializer, './src/3d/editor/EditorLiveWorldAuthoring.js', 'offline cache registration');

  for (const forbidden of ['game3d.js', 'createPlayer(', 'createNPC', 'createDragon', 'combatController']) {
    if (source.includes(forbidden)) fail(`Live authoring must not own gameplay runtime: ${forbidden}`);
  }

  console.log('[checkRun216EditorLiveWorldAuthoring] PASS: canonical terrain raycast/height/streaming, demo cleanup, terrain-projected assets/formations, rollback/disposal, boot order and PWA cache contract are present without gameplay ownership.');
}

try { main(); } catch (error) {
  console.error(`[checkRun216EditorLiveWorldAuthoring] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
}
