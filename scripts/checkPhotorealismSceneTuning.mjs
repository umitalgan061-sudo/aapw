import assert from 'node:assert/strict';
import { PHOTOREALISM_SCENE_TUNING } from '../src/3d/world/photorealismSceneTuning.ts';

assert.equal(PHOTOREALISM_SCENE_TUNING.skyBackgroundHex, 0x17263a);
assert.equal(PHOTOREALISM_SCENE_TUNING.fogFallbackHex, 0x6f7f8d);
assert.ok(PHOTOREALISM_SCENE_TUNING.minimumSkyLuminance > 0);
assert.ok(PHOTOREALISM_SCENE_TUNING.maximumWaterSaturation < 0.8);
assert.notEqual(PHOTOREALISM_SCENE_TUNING.skyBackgroundHex, 0x000000);
assert.notEqual(PHOTOREALISM_SCENE_TUNING.skyBackgroundHex, 0x0c0805);
console.log('Photorealism scene tuning proof PASS');
