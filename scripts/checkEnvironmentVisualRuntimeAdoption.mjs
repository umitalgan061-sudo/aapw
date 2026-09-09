import assert from 'node:assert/strict';
import { applyEnvironmentVisualRuntimeAdoption, deriveEnvironmentVisualProfile } from '../src/3d/world/environmentVisualRuntimeAdoption.js';

const profile = deriveEnvironmentVisualProfile({
  isMobileClass: false,
  cameraDistanceMeters: 1200,
  waterCoverage: 0.4,
  snowCoverage: 0.25,
  relief: 0.9,
  blackSkyRisk: true,
  framePressure: 0.1,
});
assert.equal(Object.isFrozen(profile), true);
assert.equal(profile.targets.visibleGrid, 0);
assert.equal(profile.targets.rectangularWaterBlocks, 0);
assert.ok(profile.normalEnergy >= 0.22 && profile.normalEnergy <= 0.82);
assert.ok(profile.fogFar >= 2500);

const malformed = deriveEnvironmentVisualProfile({ cameraDistanceMeters: Number.NaN, relief: Infinity, waterCoverage: -Infinity });
assert.ok(Number.isFinite(malformed.antiTilingPhase));
assert.ok(Number.isFinite(malformed.normalEnergy));

const makeMaterial = () => ({ roughness: 0.5, metalness: 0, opacity: 1, userData: {}, needsUpdate: false });
const makeRoot = () => ({
  userData: {},
  traverse(visitor) { visitor({ material: makeMaterial() }); },
});
const scene = { fog: { near: 1, far: 500, density: 0.2 }, userData: {} };
const water = makeRoot();
const geology = makeRoot();
const vegetation = makeRoot();
const roads = makeRoot();
const result = applyEnvironmentVisualRuntimeAdoption({
  scene,
  water,
  naturalGeology: geology,
  vegetation,
  roads,
  camera: { position: { length: () => 1200 } },
  observations: { waterCoverage: 0.4, snowCoverage: 0.25, relief: 0.8, blackSkyRisk: true },
});
assert.equal(result.patched.water, 1);
assert.equal(result.patched.geology, 1);
assert.equal(result.patched.vegetation, 1);
assert.equal(result.patched.roads, 1);
assert.equal(scene.fog.far >= 2500, true);
assert.equal(scene.userData.buzulVisualRuntimeAdoption.patched.water, 1);
console.log('environment visual runtime adoption: PASS');
