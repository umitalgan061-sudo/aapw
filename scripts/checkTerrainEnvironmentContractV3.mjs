import assert from 'node:assert/strict';
import { TERRAIN_ENVIRONMENT_CONTRACT, validateTerrainEnvironmentContract, prepareTerrainEnvironmentAssetContext, buildTerrainEnvironmentProductionPlan } from '../src/3d/world/terrainEnvironmentContract.js';
import { TERRAIN_ENVIRONMENT_ASSET_MANIFEST } from '../src/3d/world/terrainEnvironmentAssetManifest.js';

assert.equal(validateTerrainEnvironmentContract().ok, true);
assert.deepEqual(TERRAIN_ENVIRONMENT_CONTRACT.sequence, [
  'asset-hydrate', 'surface-analysis', 'geography-score', 'material-recipe', 'material-validation',
  'climate-response', 'distribution-decision', 'ground-transform', 'placement-manifest', 'scene-attach',
]);
const asset = TERRAIN_ENVIRONMENT_ASSET_MANIFEST.find((entry) => entry.src.includes('birch_trees'));
assert.ok(asset?.src);
const sample = { worldX: 45, worldZ: -80, heightMeters: 32, heightAboveSeaMeters: 24, slopeDegrees: 6, rockWeight: .04, snowWeight: 0, waterWeight: 0, waterDepth: 0, moisture: .62, biome: 'forest', temperatureC: 11, windExposure: .35, season: 'summer', settlementDistance: 340, roadDistance: 24, distanceFromGroveCenterMeters: 65, groveRadiusMeters: 165 };
const context = prepareTerrainEnvironmentAssetContext(asset, { category: 'tree', worldX: sample.worldX, worldZ: sample.worldZ, seedOrdinal: 4, biome: sample.biome, sample });
assert.equal(context.registry.verified, true);
assert.equal(context.material.validation.ok, true);
assert.equal(context.geography.asset.src, asset.src);
assert.ok(context.spatial);
assert.ok(context.climate);
const plan = buildTerrainEnvironmentProductionPlan(asset, { category: 'tree', worldX: sample.worldX, worldZ: sample.worldZ, sample, seedOrdinal: 4, distanceMeters: 40, visibility: 1 });
assert.equal(plan.contractId, TERRAIN_ENVIRONMENT_CONTRACT.id);
assert.ok(plan.distribution);
assert.ok(plan.materialManifest);
assert.ok(plan.geographyDecision);
assert.equal(plan.context.asset.src, asset.src);
console.log(JSON.stringify({ ok: true, sequence: TERRAIN_ENVIRONMENT_CONTRACT.sequence.length, asset: asset.src, attach: plan.attach.ok, distributionAccepted: plan.distribution.accepted }));
