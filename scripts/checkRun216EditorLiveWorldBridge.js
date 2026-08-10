#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'editor.html'), 'utf8');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src/3d/editor/EditorLiveWorldBridge.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(HTML.includes('./src/3d/editor/EditorLiveWorldBridge.js'), 'editor.html does not load EditorLiveWorldBridge.js');
assert(HTML.indexOf('EditorEditModeEnvironment.js') < HTML.indexOf('EditorLiveWorldBridge.js'), 'live-world bridge must load after fog-free edit environment');
assert(HTML.indexOf('EditorLiveWorldBridge.js') < HTML.indexOf('EditorRoadController.js'), 'live-world bridge must load before editor road tools');
assert(SOURCE.includes("from '../sceneManager.js'"), 'bridge does not reuse canonical sceneManager factory');
assert(SOURCE.includes('createScene(offscreenCanvas)'), 'bridge does not construct the canonical gameplay world');
assert(SOURCE.includes('for (const child of liveChildren) editorScene.add(child)'), 'bridge does not transfer canonical world graph into editor scene');
assert(SOURCE.includes("child?.name === 'Editor Ground'"), 'bridge does not identify synthetic editor ground');
assert(SOURCE.includes('editorGround.visible = false'), 'bridge does not hide synthetic editor ground');
assert(SOURCE.includes('editorScene.fog = null'), 'bridge does not preserve fog-free edit mode');
assert(SOURCE.includes('spawnRealCastleModels'), 'bridge does not load the same real castle models used by gameplay');
assert(SOURCE.includes('REAL_CASTLE') === false, 'bridge duplicates gameplay castle sizing constants instead of reusing gameplay loader');
assert(!SOURCE.includes("from '../game3d.js'"), 'bridge imports game3d runtime and may start player/gameplay systems');
assert(!SOURCE.includes('initGame3D('), 'bridge calls full gameplay bootstrap instead of isolated world creation');
assert(SOURCE.includes('liveState.controls?.dispose?.()'), 'bridge does not release temporary world OrbitControls');
assert(SOURCE.includes('liveState.freeCamera?.dispose?.()'), 'bridge does not release temporary free-camera controller');
assert(SOURCE.includes('liveState.renderer?.dispose?.()'), 'bridge does not release temporary offscreen renderer');
for (const marker of ['terrainChunkCount', 'roadSegmentCount', 'settlementCount', 'realCastleCount', 'syntheticGroundHidden']) {
  assert(SOURCE.includes(marker), `bridge snapshot is missing ${marker}`);
}

console.log('[checkRun216EditorLiveWorldBridge] PASS: editor reuses canonical gameplay world factory, hides synthetic ground, keeps edit fog disabled, loads gameplay castle models and does not start game3d runtime.');
