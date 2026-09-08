import assert from 'node:assert/strict';
import {
  TERRAIN_ENVIRONMENT_GEOLOGY_RESPONSE_POLICY,
  geologyCoverageReport,
  geologyResponseAtWorld,
  geologyPlacementEnvelope,
  rankGeologyAssetAffinity,
} from '../src/3d/world/terrainEnvironmentGeologyResponse.js';

const coverage = geologyCoverageReport();
assert.equal(coverage.ok, true, 'every geology category must have an authored source');
assert.equal(coverage.assetCount >= TERRAIN_ENVIRONMENT_GEOLOGY_RESPONSE_POLICY.minimumRockAssetCount, true);

const samples = [
  { x: -3400, z: 1200, slopeDegrees: 9, localReliefMeters: 3, curvatureMeters: 0.4, moisture: 0.6, rockExposure: 0.15, talusWeight: 0.08, heightAboveSeaMeters: 70, biome: 'forest', climate: 'temperate' },
  { x: -1100, z: 900, slopeDegrees: 27, localReliefMeters: 16, curvatureMeters: 2.3, moisture: 0.42, rockExposure: 0.72, talusWeight: 0.38, heightAboveSeaMeters: 240, biome: 'forest-edge', climate: 'temperate' },
  { x: 1700, z: -900, slopeDegrees: 49, localReliefMeters: 28, curvatureMeters: 4.7, moisture: 0.22, rockExposure: 0.91, talusWeight: 0.74, heightAboveSeaMeters: 1100, biome: 'alpine-bare', climate: 'temperate' },
  { x: 2900, z: -2200, slopeDegrees: 31, localReliefMeters: 14, curvatureMeters: 3.2, moisture: 0.08, rockExposure: 0.84, talusWeight: 0.88, heightAboveSeaMeters: 310, biome: 'dryland', climate: 'dryland' },
];

const fingerprints = samples.map((sample) => {
  const first = geologyResponseAtWorld({ worldX: sample.x, worldZ: sample.z, sample });
  const second = geologyResponseAtWorld({ worldX: sample.x, worldZ: sample.z, sample });
  assert.deepEqual(first, second, 'geology response must be deterministic');
  assert.equal(first.density >= 0 && first.density <= 1, true);
  assert.equal(first.scale > 0, true);
  for (const category of ['rock', 'cliff', 'scree']) {
    const envelope = geologyPlacementEnvelope({ worldX: sample.x, worldZ: sample.z, sample, category });
    assert.equal(envelope.density >= 0 && envelope.density <= 1, true);
    const ranked = rankGeologyAssetAffinity({ worldX: sample.x, worldZ: sample.z, sample, category });
    assert.equal(ranked.length > 0, true, `${category} requires an authored source`);
  }
  return `${first.geographyClass}:${first.valyriaClass}:${first.density.toFixed(4)}`;
});

assert.equal(new Set(fingerprints).size >= 1, true);
console.log('[terrain-environment-geology-depth] PASS', JSON.stringify({ coverage: coverage.assetCount, probes: fingerprints }));
