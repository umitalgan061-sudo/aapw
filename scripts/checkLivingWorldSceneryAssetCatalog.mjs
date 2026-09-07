import assert from 'node:assert/strict';
import {
  LIVING_WORLD_SCENERY_ASSET_POLICY,
  authoredSceneryAssetsForRegion,
  authoredSceneryFamiliesForRegion,
  auditSceneryAssetCoverage,
  resolveSceneryAssetCandidates,
  sceneryAssetCoverageDigest,
  summarizeSceneryAssetContext,
} from '../src/3d/gameplay/livingWorldSceneryAssetCatalog.js';

assert.equal(LIVING_WORLD_SCENERY_ASSET_POLICY.deterministic, true);
assert.equal(LIVING_WORLD_SCENERY_ASSET_POLICY.scatterAuthority, 'vegetation.js');
assert.equal(LIVING_WORLD_SCENERY_ASSET_POLICY.placementAuthority, 'WorldAssetPlacementPipeline.js');

const coverage = auditSceneryAssetCoverage();
assert.equal(coverage.ok, true, coverage.errors.join('\n'));
assert.ok(coverage.regionCount >= 10);
assert.ok(coverage.authoredAssetCount >= 6);
assert.ok(Object.values(coverage.byRegion).every((count) => count > 0));
assert.equal(sceneryAssetCoverageDigest(), sceneryAssetCoverageDigest());

const north = authoredSceneryAssetsForRegion('north');
assert.ok(north.some((path) => path.includes('birch_trees')));
const snowFamilies = authoredSceneryFamiliesForRegion('snow');
assert.ok(snowFamilies.some((entry) => entry.tags.includes('snow')));

const field = resolveSceneryAssetCandidates({ region: 'reach', preferredTags: ['field'], seed: 77 });
assert.ok(field.length > 0);
assert.ok(field[0].tags.includes('field'));
const fieldAgain = resolveSceneryAssetCandidates({ region: 'reach', preferredTags: ['field'], seed: 77 });
assert.deepEqual(field, fieldAgain);

const missing = summarizeSceneryAssetContext({ region: 'unknown-region', moisture: 0.9, slopeDegrees: 30 });
assert.equal(missing.authored, false);
assert.equal(missing.fallback, 'procedural-vegetation');

console.log(JSON.stringify({
  ok: true,
  policy: LIVING_WORLD_SCENERY_ASSET_POLICY.id,
  regionCount: coverage.regionCount,
  authoredAssetCount: coverage.authoredAssetCount,
  digest: sceneryAssetCoverageDigest(),
}));
console.log('LIVING_WORLD_SCENERY_ASSET_CATALOG_PASS');
