import assert from 'node:assert/strict';
import {
  TERRAIN_ENVIRONMENT_VARIANT_POLICY,
  habitatVariantSeed,
  habitatVariantIndex,
  habitatVariantOrder,
  variantEligibility,
  selectHabitatVariant,
  enforceVariantDiversity,
  buildVariantPlacementManifest,
} from '../src/3d/world/terrainEnvironmentVariantPolicy.js';

const failures = [];
function check(label, fn) {
  try { fn(); } catch (error) { failures.push(`${label}: ${error.message}`); }
}

check('policy is deterministic and canonical-neutral', () => {
  assert.equal(TERRAIN_ENVIRONMENT_VARIANT_POLICY.deterministic, true);
  assert.equal(TERRAIN_ENVIRONMENT_VARIANT_POLICY.canonicalGeographyUntouched, true);
  assert.ok(TERRAIN_ENVIRONMENT_VARIANT_POLICY.maxRepeatRadiusMeters >= 100);
});

check('seed is repeatable for the same world location', () => {
  const a = habitatVariantSeed({ assetFamily: 'tree', worldX: 1200, worldZ: -430, ordinal: 4, seed: 77 });
  const b = habitatVariantSeed({ assetFamily: 'tree', worldX: 1200, worldZ: -430, ordinal: 4, seed: 77 });
  assert.equal(a, b);
});

check('nearby grid cells are not forced to use the same variant forever', () => {
  const seeds = new Set();
  for (let i = 0; i < 12; i += 1) seeds.add(habitatVariantSeed({ assetFamily: 'tree', worldX: i * 143, worldZ: i * 91, ordinal: i, seed: 91 }));
  assert.ok(seeds.size >= 8);
});

check('variant index remains in bounds', () => {
  for (let count = 1; count <= 16; count += 1) {
    const index = habitatVariantIndex(count, { assetFamily: 'tree', worldX: 10, worldZ: 20, ordinal: count, seed: 3 });
    assert.ok(index >= 0 && index < count);
  }
});

check('variant order covers every candidate exactly once for every supported count', () => {
  for (let count = 1; count <= 32; count += 1) {
    const order = habitatVariantOrder(count, { assetFamily: 'tree', worldX: 10, worldZ: 20, seed: count * 3 });
    assert.equal(order.length, count);
    assert.equal(new Set(order).size, count);
    assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: count }, (_, index) => index));
  }
});

check('temperate trees are rejected from alpine and barren habitats', () => {
  assert.equal(variantEligibility('tree', { snowWeight: 0.90, heightAboveSeaMeters: 600 }).eligible, false);
  assert.equal(variantEligibility('boulder', { barren: true, slopeDegrees: 52, rockWeight: 0.90 }).family, 'rock');
  assert.equal(variantEligibility('vegetation', { barren: true, moisture: 0.15 }).eligible, false);
});

check('family aliases normalize before eligibility', () => {
  assert.equal(variantEligibility('snow-tree', { snowWeight: 0.05 }).family, 'snowtree');
  assert.equal(variantEligibility('dead-tree', { moisture: 0.90, biome: 'wet marsh' }).family, 'deadtree');
});

check('snow trees require a snow-bearing habitat', () => {
  assert.equal(variantEligibility('snowtree', { snowWeight: 0.05 }).eligible, false);
  assert.equal(variantEligibility('snowtree', { snowWeight: 0.60 }).eligible, true);
});

check('rock and scree follow slope logic', () => {
  assert.equal(variantEligibility('rock', { slopeDegrees: 4, rockWeight: 0.05 }).eligible, false);
  assert.equal(variantEligibility('rock', { slopeDegrees: 52, rockWeight: 0.80 }).eligible, true);
  assert.equal(variantEligibility('scree', { slopeDegrees: 12 }).eligible, false);
});

const candidates = [
  { id: 'tree-a', family: 'tree' },
  { id: 'tree-b', family: 'tree' },
  { id: 'tree-c', family: 'tree' },
];

check('selection is deterministic and returns provenance', () => {
  const a = selectHabitatVariant(candidates, { assetFamily: 'tree', worldX: 320, worldZ: 810, seed: 11, ordinal: 2 });
  const b = selectHabitatVariant(candidates, { assetFamily: 'tree', worldX: 320, worldZ: 810, seed: 11, ordinal: 2 });
  assert.deepEqual(a, b);
  assert.ok(a.selectionSeed >= 0);
  assert.ok(a.candidateCount === 3);
});

check('selection rejects habitat-incompatible family before choosing a model', () => {
  const alpineTrees = selectHabitatVariant(candidates, { assetFamily: 'tree', snowWeight: 0.95, heightAboveSeaMeters: 800, seed: 11 });
  assert.equal(alpineTrees, null);
});

check('diversity gate detects a single-model stencil', () => {
  const weak = enforceVariantDiversity(['tree-a', 'tree-a', 'tree-a', 'tree-a'], 'tree');
  assert.equal(weak.ok, false);
  const healthy = enforceVariantDiversity(['tree-a', 'tree-b', 'tree-a', 'tree-c'], 'tree');
  assert.equal(healthy.ok, true);
  assert.equal(enforceVariantDiversity(['rock-a', 'rock-a', 'rock-b'], 'boulder').family, 'rock');
});

check('manifest is immutable and canonical-neutral', () => {
  const manifest = buildVariantPlacementManifest({
    assetFamily: 'tree',
    candidates,
    selectedIds: ['tree-a', 'tree-b', 'tree-c'],
    context: {
      worldX: 450,
      worldZ: -920,
      seed: 123,
      slopeDegrees: 9,
      moisture: 0.68,
      snowWeight: 0.02,
      rockWeight: 0.05,
      waterDepth: 0,
    },
  });
  assert.equal(manifest.policyId, TERRAIN_ENVIRONMENT_VARIANT_POLICY.id);
  assert.equal(manifest.canonicalGeographyUntouched, true);
  assert.ok(Object.isFrozen(manifest));
  assert.ok(Object.isFrozen(manifest.constraints));
  assert.ok(manifest.selection?.id);
});

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, policyId: TERRAIN_ENVIRONMENT_VARIANT_POLICY.id, checks: 14 }));
}
