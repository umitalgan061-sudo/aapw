import assert from 'node:assert/strict';
import { TERRAIN_ENVIRONMENT_SEASONAL_GEOGRAPHY_POLICY, seasonalGeographyCoverage, seasonalEnvironmentResponse, rankSeasonalAssets } from '../src/3d/world/terrainEnvironmentSeasonalGeography.js';

const coverage = seasonalGeographyCoverage();
assert.equal(coverage.ok, true, `seasonal coverage incomplete: ${coverage.missing.join(',')}`);
assert.deepEqual([...TERRAIN_ENVIRONMENT_SEASONAL_GEOGRAPHY_POLICY.seasons], ['spring', 'summer', 'autumn', 'winter']);

const probes = [];
for (const category of ['tree', 'dead-tree', 'snow-dead-tree', 'rock', 'cliff', 'scree']) {
  for (const season of TERRAIN_ENVIRONMENT_SEASONAL_GEOGRAPHY_POLICY.seasons) {
    const isRock = ['rock', 'cliff', 'scree'].includes(category);
    const sample = {
      biome: isRock ? (season === 'winter' ? 'alpine-bare' : 'highland') : category.includes('dead') ? 'tundra' : 'forest',
      climate: category.includes('dead') ? 'tundra' : 'temperate',
      slopeDegrees: isRock ? 28 : 12,
      moisture: isRock ? 0.42 : 0.58,
      heightAboveSeaMeters: category === 'snow-dead-tree' ? 1080 : isRock ? 420 : 120,
      snowDepthMeters: season === 'winter' ? 0.72 : 0.02,
      windExposure: season === 'winter' ? 0.82 : 0.34,
    };
    const response = seasonalEnvironmentResponse({ category, season, biome: sample.biome, climate: sample.climate, sample });
    assert.equal(response.envelope.densityFactor > 0, true);
    assert.equal(response.materialFamily != null, true);
    const ranked = rankSeasonalAssets({ category, season, biome: sample.biome, climate: sample.climate, sample });
    assert.equal(ranked.length > 0, true);
    assert.equal(response.selectedAsset?.id, ranked[0]?.asset?.id);
    probes.push(`${category}:${season}:${response.selectedAsset?.id ?? 'none'}:${response.envelope.snow.toFixed(3)}`);
  }
}

console.log('[terrain-environment-seasonal-depth] PASS', JSON.stringify({ missing: coverage.missing, probes }));
