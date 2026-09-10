import assert from 'node:assert/strict';
import {
  buildEnvironmentVisualAdoptionV56,
  applyEnvironmentVisualAdoptionV56,
  compareEnvironmentVisualAdoptionV56,
  validateEnvironmentVisualAdoptionV56,
} from '../src/3d/world/environmentVisualAdoptionV56.js';

const baseSamples = [
  { id: 'coast-1', position: { x: 10, y: 0, z: 20 }, biome: 'coastal', slope: 0.12, elevation: 0.2, moisture: 0.7, waterDistance: 2, waterDepth: 0, grounded: true, materialReady: true, assetFamily: 'grass', canonicalHeight: 1, renderedHeight: 1.01, colliderHeight: 1.02 },
  { id: 'ridge-1', position: { x: 80, y: 4, z: -20 }, biome: 'alpine', slope: 0.82, elevation: 0.92, moisture: 0.18, snow: 0.64, waterDistance: 100, grounded: true, materialReady: true, assetFamily: 'rock', canonicalHeight: 14, renderedHeight: 14.02, colliderHeight: 14.03 },
  { id: 'forest-1', position: { x: -40, y: 1, z: 60 }, biome: 'forest', slope: 0.24, elevation: 0.34, moisture: 0.66, waterDistance: 30, grounded: true, materialReady: true, assetFamily: 'tree', canonicalHeight: 4, renderedHeight: 4, colliderHeight: 4 },
];

const weather = { sunElevation: 0.78, exposure: 0.2, fogNear: 80, fogFar: 16000, backgroundLuminance: 0.32, cameraRelativeSky: true };
const assets = [
  { id: 'tree-a', family: 'vegetation', materialRoles: ['trunk', 'leaves', 'bark'], hydrated: true, lodReady: true, instancingReady: true },
  { id: 'rock-a', family: 'env', materialRoles: ['rock', 'moss', 'scree'], hydrated: true, lodReady: true, instancingReady: true },
];

const first = buildEnvironmentVisualAdoptionV56({ samples: baseSamples, weather, assets });
const second = buildEnvironmentVisualAdoptionV56({ samples: baseSamples.slice().reverse(), weather, assets: assets.slice().reverse() });

assert.equal(first.version, 'v56');
assert.equal(first.manifest.sampleCount, 3);
assert.equal(first.manifest.assetCount, 2);
assert.equal(first.manifest.cameraProfiles.fullWorld.width, 1536);
assert.equal(first.manifest.cameraProfiles.fullWorld.height, 1024);
assert.equal(first.manifest.sharedMaterialPlacement.authority[0], 'MaterialAssignmentCore.js');
assert.equal(first.manifest.sharedMaterialPlacement.editorRuntimeImport, false);
assert.equal(first.manifest.queryContract.ground, true);
assert.equal(first.rows[0].surfaceBand, 'shore');
assert.equal(first.rows[1].surfaceBand, 'cliff');
assert.ok(Math.abs(Object.values(first.rows[0].weights).reduce((sum, value) => sum + value, 0) - 1) < 0.00001);
assert.equal(first.rows[1].placement.eligible, false);
assert.ok(first.rows[1].placement.reasons.includes('steep-cliff'));
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.manifest), true);
assert.equal(Object.isFrozen(first.rows[0]), true);
assert.equal(first.digest, second.digest, 'digest must be order-independent for identical observations');

const malformed = buildEnvironmentVisualAdoptionV56({
  samples: [{ id: 7, position: { x: NaN, z: Infinity }, slope: NaN, canonicalHeight: NaN }],
  weather: { fogFar: NaN, backgroundLuminance: NaN },
});
assert.equal(malformed.version, 'v56');
assert.equal(Number.isFinite(malformed.rows[0].position.x), true);
assert.equal(Number.isFinite(malformed.rows[0].position.z), true);
assert.equal(Number.isFinite(malformed.manifest.weather.fogFar), true);

const unsafe = buildEnvironmentVisualAdoptionV56({
  samples: [{ id: 'bad-water', rectangularWater: true, moire: true, blackSky: true, grounded: false }],
  weather: { backgroundLuminance: 0, cameraRelativeSky: false },
});
assert.equal(unsafe.manifest.acceptance.visibleRectangularWater, 1);
assert.equal(unsafe.manifest.acceptance.visibleWaterMoire, 1);
assert.equal(unsafe.manifest.acceptance.visibleBlackSky, 1);
assert.equal(unsafe.manifest.acceptance.allVisibleFailureTargetsMet, false);

const target = {};
assert.equal(applyEnvironmentVisualAdoptionV56(target, first), true);
assert.equal(target.environmentVisualAdoption.digest, first.digest);
assert.equal(applyEnvironmentVisualAdoptionV56({}, { version: 'v55' }), false);

const comparison = compareEnvironmentVisualAdoptionV56(unsafe, first);
assert.equal(comparison.improved, true);
assert.ok(comparison.improvement > 0);

const validation = validateEnvironmentVisualAdoptionV56(first);
assert.equal(validation.ok, true);
assert.equal(validateEnvironmentVisualAdoptionV56({ version: 'v55' }).ok, false);

console.log(JSON.stringify({
  check: 'environment-visual-adoption-v56',
  status: 'PASS',
  digest: first.digest,
  visibleFailureTotal: first.manifest.acceptance.visibleFailureTotal,
}));
