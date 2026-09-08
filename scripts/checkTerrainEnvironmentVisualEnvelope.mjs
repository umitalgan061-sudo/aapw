import assert from 'node:assert/strict';
import {
  buildVisualSample,
  compareVisualSamples,
  terrainAssetEnvelope,
  validateVisualSample,
  buildVisualSamplingManifest,
  TERRAIN_ENVIRONMENT_VISUAL_SAMPLING_POLICY,
} from '../src/3d/world/terrainEnvironmentVisualSampling.js';

const temperate = buildVisualSample({
  worldX: 220, worldZ: -140, heightMeters: 24, heightAboveSeaMeters: 16,
  slopeDegrees: 8, rockWeight: .06, snowWeight: 0, waterWeight: .08,
  moisture: .68, biome: 'meadow', waterDepth: 0, concavityMeters: .4,
});
const snowyShelf = buildVisualSample({
  worldX: -420, worldZ: 640, heightMeters: 360, heightAboveSeaMeters: 352,
  slopeDegrees: 38, rockWeight: .48, snowWeight: .86, waterWeight: 0,
  moisture: .32, biome: 'tundra', waterDepth: 0, concavityMeters: -.4,
});
const rockySlope = buildVisualSample({
  worldX: -740, worldZ: 380, heightMeters: 220, heightAboveSeaMeters: 212,
  slopeDegrees: 52, rockWeight: .76, snowWeight: .12, waterWeight: 0,
  moisture: .26, biome: 'rocky-hills', waterDepth: 0, concavityMeters: 1.1,
});
const wetland = buildVisualSample({
  worldX: 80, worldZ: 40, heightMeters: 7, heightAboveSeaMeters: -1,
  slopeDegrees: 2, rockWeight: .01, snowWeight: 0, waterWeight: .74,
  moisture: .94, biome: 'wetland', waterDepth: 1, concavityMeters: .8,
});

assert.equal(TERRAIN_ENVIRONMENT_VISUAL_SAMPLING_POLICY.deterministic, true);
assert.equal(TERRAIN_ENVIRONMENT_VISUAL_SAMPLING_POLICY.noGeometryMutation, true);
assert.equal(TERRAIN_ENVIRONMENT_VISUAL_SAMPLING_POLICY.worldSpace, true);
assert.ok(temperate.coastal > snowyShelf.coastal, 'low terrain should carry stronger coastal influence');
assert.ok(snowyShelf.snowEdge > .45, `snow edge should remain visible: ${snowyShelf.snowEdge}`);
assert.ok(snowyShelf.snowShelf > .60, `high elevation should retain a snow shelf signal: ${snowyShelf.snowShelf}`);
assert.ok(rockySlope.exposedRock > temperate.exposedRock, 'rocky slope should carry stronger exposed-rock signal');
assert.ok(wetland.ecologicalMoisture > temperate.ecologicalMoisture, 'wetland should carry stronger ecological moisture');
assert.ok(rockySlope.surfaceContrast > temperate.surfaceContrast, 'rocky terrain should have stronger surface contrast');

const treeProfile = {
  minHeightMeters: 0,
  maxHeightMeters: 120,
  minSlopeDegrees: 0,
  maxSlopeDegrees: 28,
  maxWaterDepthMeters: .02,
  allowedBiomes: ['forest', 'meadow'],
};
assert.equal(terrainAssetEnvelope({
  sample: temperate,
  category: 'tree',
  profile: treeProfile,
  spatial: { densityMultiplier: 1.2, coreWeight: .8, ecotoneWeight: .2, groveOpeningWeight: .1 },
}).allowed, true);
assert.equal(terrainAssetEnvelope({
  sample: snowyShelf,
  category: 'tree',
  profile: treeProfile,
}).allowed, false);
assert.equal(terrainAssetEnvelope({
  sample: wetland,
  category: 'tree',
  profile: treeProfile,
}).allowed, false);

const delta = compareVisualSamples(temperate, snowyShelf).delta;
assert.notEqual(delta.heightMeters, 0);
assert.notEqual(delta.slopeDegrees, 0);
assert.notEqual(delta.snowEdge, 0);
assert.notEqual(delta.surfaceContrast, 0);

const repeated = JSON.stringify(buildVisualSample(snowyShelf));
assert.equal(JSON.stringify(buildVisualSample(snowyShelf)), repeated, 'visual sample construction is deterministic');
assert.equal(validateVisualSample(snowyShelf).ok, true);
assert.equal(validateVisualSample(temperate).ok, true);
assert.equal(validateVisualSample(rockySlope).ok, true);
assert.equal(validateVisualSample(wetland).ok, true);

const manifest = buildVisualSamplingManifest([temperate, snowyShelf, rockySlope, wetland]);
assert.equal(manifest.acceptance.ok, true);
assert.equal(manifest.reports.length, 4);
assert.equal(manifest.version, 2);

console.log(JSON.stringify({
  ok: true,
  policyId: TERRAIN_ENVIRONMENT_VISUAL_SAMPLING_POLICY.id,
  samples: manifest.reports.length,
  signals: {
    snowEdge: Number(snowyShelf.snowEdge.toFixed(4)),
    snowShelf: Number(snowyShelf.snowShelf.toFixed(4)),
    exposedRock: Number(rockySlope.exposedRock.toFixed(4)),
    wetlandMoisture: Number(wetland.ecologicalMoisture.toFixed(4)),
  },
}));
