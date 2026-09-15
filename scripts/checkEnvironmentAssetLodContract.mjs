import assert from 'node:assert/strict';
import {
  buildEnvironmentAssetLodContract,
  applyEnvironmentAssetLodContract,
  getEnvironmentAssetLodConstants
} from '../src/3d/world/environmentAssetLodContract.js';

const camera = {
  projection: 'orthographic',
  position: { x: 0, y: 900, z: 0 },
  viewport: { width: 1536, height: 1024 }
};

const samples = [
  {
    id: 'tree-boreal-01', assetId: 'tree-boreal-01', family: 'vegetation',
    sourcePath: 'assets/models/vegetation/tree-boreal-01.glb',
    surfaceRoles: ['trunk', 'bark', 'leaves'],
    position: { x: 20, y: 30, z: 40 }, boundsRadius: 8, scale: 1.1,
    slope: 0.22, moisture: 0.62, waterDistance: 18, snowCover: 0.1,
    grounded: true, canonical: true, owner: 'world', sharedMaterialPlacementContract: true,
    materialManifest: [
      { slot: 'trunk', role: 'bark', hydrated: true, source: 'imported' },
      { slot: 'leaves', role: 'leaves', hydrated: true, source: 'imported' }
    ]
  },
  {
    id: 'rock-alpine-01', assetId: 'rock-alpine-01', family: 'env',
    sourcePath: 'assets/models/env/rock-alpine-01.glb',
    surfaceRoles: ['rock', 'scree'],
    position: { x: -30, y: 220, z: 50 }, boundsRadius: 16, scale: 1,
    slope: 0.91, moisture: 0.18, waterDistance: 44, snowCover: 0.7,
    grounded: true, canonical: true, owner: 'natural-geology', sharedMaterialPlacementContract: true
  },
  {
    id: 'tree-invalid-water', assetId: 'tree-invalid-water', family: 'vegetation',
    sourcePath: 'assets/models/vegetation/tree-invalid-water.glb',
    surfaceRoles: ['trunk', 'leaves'],
    position: { x: 80, y: 1, z: 90 }, boundsRadius: 5, scale: 1,
    slope: 0.2, moisture: 1, waterDistance: 0.1, snowCover: 0,
    grounded: false, canonical: true, owner: 'world', sharedMaterialPlacementContract: true
  }
];

const first = buildEnvironmentAssetLodContract({ camera, samples, options: { drawCallBudget: 2000, memoryBudgetMb: 512 } });
const second = buildEnvironmentAssetLodContract({ camera, samples, options: { drawCallBudget: 2000, memoryBudgetMb: 512 } });

assert.equal(first.digest, second.digest, 'contract output must be deterministic');
assert.deepEqual(first.placements.map((item) => item.assetId), ['rock-alpine-01', 'tree-boreal-01', 'tree-invalid-water']);
assert.equal(first.camera.viewport.width, 1536);
assert.equal(first.camera.viewport.height, 1024);
assert.equal(first.acceptance.actualShippedSceneRequired, true);
assert.equal(first.acceptance.modelBearingPlacementMustUseSharedContract, true);
assert.equal(first.summary.targets.missingAsset, 0);
assert.equal(first.summary.targets.placeholder, 0);
assert.equal(first.placements[2].eligible, false, 'underwater vegetation must be excluded');
assert.equal(first.placements[1].eligible, false, 'near-vertical rock must fail closed for placement');
assert.ok(first.placements[0].materialManifest.some((entry) => entry.role === 'bark'));
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.placements), true);
assert.equal(Object.isFrozen(first.placements[0]), true);

const target = { roughness: 0.3, opacity: 1, normalScale: { x: 1, y: 1 }, userData: {} };
applyEnvironmentAssetLodContract(target, {
  roughness: 0.86,
  opacity: 0.74,
  normalEnergy: 0.42,
  lod: 2,
  antiTilingPhase: { u: 0.25, v: 0.75 },
  instancingKey: 'vegetation:bark+leaves:lod2',
  sharedMaterialPlacementContract: true
});
assert.equal(target.roughness, 0.86);
assert.equal(target.opacity, 0.74);
assert.equal(target.normalScale.x, 0.42);
assert.equal(target.normalScale.y, 0.42);
assert.equal(target.userData.environmentAssetLodContract.lod, 2);
assert.equal(target.userData.environmentAssetLodContract.sharedMaterialPlacementContract, true);

const constants = getEnvironmentAssetLodConstants();
assert.equal(constants.version, 33);
assert.ok(constants.assetFamilies.includes('vegetation'));
assert.ok(constants.surfaceRoles.includes('scree'));
assert.ok(constants.maxLodLevel >= 3);

const malformed = buildEnvironmentAssetLodContract({
  camera: { position: { x: NaN, y: Infinity, z: undefined } },
  samples: [{ id: 'bad', position: { x: NaN, y: 'bad', z: null }, slope: NaN, scale: Infinity }]
});
assert.equal(Number.isFinite(malformed.placements[0].position.x), true);
assert.equal(Number.isFinite(malformed.placements[0].distance), true);
assert.equal(Number.isFinite(malformed.summary.pressure), true);

console.log('checkEnvironmentAssetLodContract: PASS');
