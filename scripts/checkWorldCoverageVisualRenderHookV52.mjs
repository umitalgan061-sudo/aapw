import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'src/3d/world/worldCoverageVisualRuntimeV52.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'game3d.html'), 'utf8');
let checks = 0;
const check = (value, message) => { checks += 1; assert.ok(value, message); };

const lifecycle = [
  'installWorldCoverageVisualRuntimeV52',
  'updateWorldCoverageVisualRuntimeV52',
  'getWorldCoverageVisualRuntimeV52Manifest',
  'disposeWorldCoverageVisualRuntimeV52',
  'restoreWorldCoverageVisualRuntimeV52',
];
for (const token of lifecycle) check(source.includes(token), `lifecycle token: ${token}`);

check(source.includes('const HOOK_FLAG = Symbol.for'), 'render hook must use a realm-stable Symbol flag');
check(source.includes('if (prototype[HOOK_FLAG]) return true;'), 'install must be idempotent');
check(source.includes('Object.defineProperty(prototype, HOOK_FLAG'), 'hook metadata must be non-enumerable by default');
check(source.includes('originalRender.call(this, scene, camera, ...rest)'), 'original render must remain callable');
check(source.includes('if (scene?.isScene)'), 'hook must only process real scenes');
check(source.includes('scene.userData.activeCamera = camera'), 'active camera must be recorded for distance policies');
check(source.includes('updateWorldCoverageVisualRuntimeV52(scene, camera)'), 'render hook must invoke visual update');
check(html.includes("import './src/3d/world/worldCoverageVisualRuntimeV52.js';"), 'entry html must load hook');

const unsafeLifecyclePatterns = [
  'setInterval(updateWorldCoverageVisualRuntimeV52',
  'setTimeout(updateWorldCoverageVisualRuntimeV52',
  'window.addEventListener(\'resize\', updateWorldCoverageVisualRuntimeV52',
];
for (const token of unsafeLifecyclePatterns) check(!source.includes(token), `no unbounded lifecycle side effect: ${token}`);

const renderContract = [
  'maxMaterialMutationsPerFrame',
  'maxObjectMutationsPerFrame',
  'rescanIntervalFrames',
  'MATERIAL_REFRESH_BATCH',
  'OBJECT_REFRESH_BATCH',
  'MAX_SCAN_NODES',
];
for (const token of renderContract) check(source.includes(token) || fs.readFileSync(path.join(ROOT, 'src/3d/world/worldCoverageVisualRuntimeV52Policies.js'), 'utf8').includes(token), `render budget token: ${token}`);

const disposalContract = [
  'restoreMaterialState(material)',
  'object.visible = state.visible',
  'object.frustumCulled = state.frustumCulled',
  'object.scale.set(...state.scale)',
  'delete scene.userData[CONTROLLER_KEY]',
];
for (const token of disposalContract) check(source.includes(token), `disposal token: ${token}`);

const stateMarkers = [
  'worldCoverageVisualRuntimeV52',
  'worldCoverageVisualV52Manifest',
  'worldCoverageVisualV52BlackSkyFallback',
  'worldCoverageVisualV52WaterKind',
  'worldCoverageVisualV52TerrainTier',
  'worldCoverageVisualV52GeologyTier',
  'worldCoverageVisualV52EdgeSoftening',
  'worldCoverageVisualV52GroundContact',
];
for (const token of stateMarkers) check(source.includes(token), `state marker: ${token}`);

console.log(`WORLD_COVERAGE_VISUAL_RUNTIME_V52_RENDER_HOOK_OK checks=${checks}`);
