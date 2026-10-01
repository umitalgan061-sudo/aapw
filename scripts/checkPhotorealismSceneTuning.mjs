import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  PHOTOREALISM_SCENE_TUNING,
  applyPhotorealismSceneTuning,
} from '../src/3d/world/photorealismSceneTuning.ts';

assert.equal(PHOTOREALISM_SCENE_TUNING.skyBackgroundHex, 0x17263a);
assert.equal(PHOTOREALISM_SCENE_TUNING.fogFallbackHex, 0x6f7f8d);
assert.ok(PHOTOREALISM_SCENE_TUNING.minimumSkyLuminance > 0);
assert.ok(PHOTOREALISM_SCENE_TUNING.minimumFogDensity > 0);
assert.ok(PHOTOREALISM_SCENE_TUNING.maximumFogDensity < 0.01);
assert.ok(PHOTOREALISM_SCENE_TUNING.maximumWaterSaturation < 0.8);
assert.notEqual(PHOTOREALISM_SCENE_TUNING.skyBackgroundHex, 0x000000);
assert.notEqual(PHOTOREALISM_SCENE_TUNING.skyBackgroundHex, 0x0c0805);

const sharedBackground = new THREE.Color(0x0c0805);
const scene = new THREE.Scene();
scene.background = sharedBackground;
scene.fog = new THREE.FogExp2(0x050505, 0.01);
const tuning = applyPhotorealismSceneTuning(scene);

assert.equal(tuning.backgroundHex, PHOTOREALISM_SCENE_TUNING.skyBackgroundHex);
assert.equal(tuning.fogFallbackApplied, true);
assert.equal(tuning.fogDensitySanitized, true);
assert.equal(scene.fog.density, PHOTOREALISM_SCENE_TUNING.maximumFogDensity);
assert.notEqual(scene.background, sharedBackground, 'background guard must not retain shared Color identity');
assert.equal(sharedBackground.getHex(), 0x0c0805, 'shared background Color must remain untouched');
assert.equal(scene.fog.color.getHex(), PHOTOREALISM_SCENE_TUNING.fogFallbackHex);

const second = applyPhotorealismSceneTuning(scene);
assert.deepEqual(second, tuning, 'scene tuning must be idempotent and deterministic');

const linearFogScene = new THREE.Scene();
linearFogScene.background = new THREE.Color(0x284057);
linearFogScene.fog = new THREE.Fog(0x284057, 1, 100);
const linearFogTuning = applyPhotorealismSceneTuning(linearFogScene);
assert.equal(linearFogTuning.fogDensitySanitized, false, 'linear fog has no density clamp');

const nonColorScene = new THREE.Scene();
nonColorScene.background = new THREE.Texture();
const nonColorTuning = applyPhotorealismSceneTuning(nonColorScene);
assert.equal(nonColorTuning.backgroundHex, PHOTOREALISM_SCENE_TUNING.skyBackgroundHex);
assert.ok(nonColorScene.background instanceof THREE.Color);

console.log(JSON.stringify({
  ok: true,
  suite: 'photorealism-scene-tuning',
  backdropGuard: 'blue-slate',
  fogFallback: 'non-black',
  fogDensityBound: true,
  sharedColorIsolation: true,
  idempotent: true,
  nonColorBackgroundFailClosed: true,
}));
