import assert from 'node:assert/strict';
import {
  getGroundQueryV63,
  getWaterQueryV63,
  getPlacementQueryV63,
  getSurfaceQueryV63,
  getAcceptanceQueryV63,
  queryPointEligibilityV63,
  queryVegetationHabitatsV63,
  queryStreamingBudgetV63,
  queryNaturalPlacementTransformV63,
  queryParityV63,
  queryShorelineBandsV63,
  queryWaterOpticsV63,
  createCapabilityManifestV63,
  compareWorldQueriesV63,
  createNeighborhoodQueryV63,
  createTerrainTraversalQueryV63,
  createVisualGroundingContractV63,
} from '../src/3d/world/environmentGroundedWorldQueriesV63.js';

const sample = (id = 'q', patch = {}) => ({
  sampleId: id, seed: 'query-seed',
  terrain: { x: 4500, y: 100, z: 3500, height: 100, canonicalHeight: 100, colliderHeight: 100, slope: 12, moisture: 0.5, elevation01: 0.45, snowWeight: 0.05, roughness: 0.75, normal: { x: 0.1, y: 0.98, z: 0.1 }, biome: 'temperate', surface: 'grass', canonicalSource: 'canonical-owner-map', terrainBackend: 'Terrain3D', regionId: 'query' },
  water: { waterClass: 'land', waterDistance: 100, depth: 0, wetEdgeWeight: 0, foamWeight: 0, cyanRisk: 0, moireRisk: 0, seamRisk: 0, tileLike: false, rectangular: false, repeatedStripe: false },
  material: { role: 'grass', multiSurface: true, placeholder: false, missing: false, roughness: 0.8, normalScale: 0.8, ao: 0.5, macroContrast: 0.7, microDetail: 0.7, textureRepeat: 1 },
  vegetation: [], camera: { profile: 'terrain-near', width: 1536, height: 1024, orthographicDegrees: 90, distance: 420, seed: 'camera' }, renderedY: 100, colliderY: 100,
  ...patch,
});

const ground = getGroundQueryV63(sample());
assert.equal(ground.heightMeters, 100);
assert.equal(ground.slopeDegrees, 12);
assert.equal(ground.biome, 'temperate');
assert.equal(ground.surface, 'grass');
assert.equal(ground.parity.pass, true);
console.log('PASS ground query baseline');

const water = getWaterQueryV63(sample('water', { water: { waterClass: 'lake', waterDistance: 4, depth: 8, wetEdgeWeight: 0.8, foamWeight: 0.3, cyanRisk: 0.1, moireRisk: 0, seamRisk: 0, tileLike: false, rectangular: false, repeatedStripe: false } }));
assert.equal(water.class, 'lake');
assert.equal(water.recognized, true);
assert.ok(water.shoreWeight > 0);
assert.ok(water.wetEdge > 0);
console.log('PASS water query baseline');

const placement = getPlacementQueryV63(sample('placement', {
  vegetation: [
    { assetId: 'tree-a', category: 'tree', x: 10, y: 100, z: 12, scale: 1, slope: 9, moisture: 0.6, height01: 0.45, distanceToWater: 30, roadDistance: 50, settlementDistance: 80, grounded: true, groundConfidence: 0.95, lod: 0, instanceBatch: 'forest' },
    { assetId: 'tree-b', category: 'tree', x: 15, y: 100, z: 17, scale: 0.95, slope: 7, moisture: 0.58, height01: 0.44, distanceToWater: 32, roadDistance: 48, settlementDistance: 78, grounded: true, groundConfidence: 0.96, lod: 0, instanceBatch: 'forest' },
  ],
}));
assert.equal(placement.total, 2);
assert.equal(placement.eligible, 2);
assert.equal(placement.invalid, 0);
assert.equal(placement.results[0].batch, 'forest');
console.log('PASS placement query baseline');

const surface = getSurfaceQueryV63(sample());
assert.ok(surface.weights.grass > 0);
assert.ok(surface.macroContrast > 0);
assert.ok(surface.microDetail > 0);
assert.ok(Number.isFinite(surface.antiTilingPhase));
console.log('PASS surface query baseline');

const acceptance = getAcceptanceQueryV63(sample());
assert.equal(acceptance.profile.width, 1536);
assert.equal(acceptance.profile.height, 1024);
assert.equal(acceptance.profile.orthographicDegrees, 90);
assert.ok(Array.isArray(acceptance.blockers));
console.log('PASS acceptance query baseline');

const pointCases = [
  ['land-flat', { slope: 10, groundConfidence: 0.9 }, { waterClass: 'land', waterDistance: 20 }],
  ['land-steep', { slope: 70, groundConfidence: 0.9 }, { waterClass: 'land', waterDistance: 20 }],
  ['sea', { slope: 3, groundConfidence: 0.9 }, { waterClass: 'sea', waterDistance: 1 }],
  ['unknown-water', { slope: 3, groundConfidence: 0.9 }, { waterClass: 'canal', waterDistance: 50 }],
  ['low-confidence', { slope: 3, groundConfidence: 0.2 }, { waterClass: 'land', waterDistance: 50 }],
];
for (const [name, terrain, waterInput] of pointCases) {
  const result = queryPointEligibilityV63({ terrain, water: waterInput });
  assert.equal(typeof result.eligible, 'boolean');
  assert.ok(Array.isArray(result.reasons));
  console.log(`PASS point ${name}`);
}

const biomes = ['forest', 'temperate', 'taiga', 'wetland', 'grassland', 'alpine', 'tundra', 'steppe', 'desert', 'coastal'];
for (const biome of biomes) {
  const result = queryVegetationHabitatsV63({ biome, slope: 12, moisture: 0.55, elevation01: 0.45, waterDistance: 60, roadDistance: 100, settlementDistance: 100 });
  assert.ok(result.density >= 0 && result.density <= 1);
  assert.ok(result.canopy >= 0 && result.canopy <= 1);
  assert.ok(result.shrub >= 0 && result.shrub <= 1);
  assert.ok(result.groundDetail >= 0 && result.groundDetail <= 1);
}
console.log('PASS biome habitat queries');

for (const mobile of [true, false]) {
  for (const distance of [100, 300, 800, 1500, 3000, 7000]) {
    const result = queryStreamingBudgetV63({ cameraDistance: distance, visibleChunks: 12, residentChunks: 18, vegetationInstances: mobile ? 700 : 1000, textureMemoryMb: mobile ? 550 : 400, mobile });
    assert.equal(result.chunkCulling, true);
    assert.equal(result.frustumCulling, true);
    assert.ok(result.lodBand.length > 0);
  }
}
console.log('PASS streaming query matrix');

const transforms = [];
for (let i = 0; i < 60; i += 1) {
  const t = queryNaturalPlacementTransformV63({ assetId: `asset-${i % 6}`, x: i * 9, z: i * 13, seed: `seed-${i % 5}` });
  transforms.push(t);
  assert.ok(t.scale >= 0.1 && t.scale <= 8);
  assert.ok(t.yawRadians >= 0 && t.yawRadians <= Math.PI * 2);
}
assert.ok(new Set(transforms.map((item) => item.scale)).size > 10);
console.log('PASS natural transform query matrix');

const paritySet = [
  { canonicalHeight: 0, renderedHeight: 0, colliderHeight: 0, canonicalX: 0, canonicalZ: 0, renderedX: 0, renderedZ: 0, colliderX: 0, colliderZ: 0 },
  { canonicalHeight: 100, renderedHeight: 100.1, colliderHeight: 100.1, canonicalX: 10, canonicalZ: 10, renderedX: 10.1, renderedZ: 10.1, colliderX: 10.1, colliderZ: 10.1 },
  { canonicalHeight: 100, renderedHeight: 101, colliderHeight: 99, canonicalX: 10, canonicalZ: 10, renderedX: 12, renderedZ: 12, colliderX: 8, colliderZ: 8 },
];
for (const input of paritySet) assert.equal(typeof queryParityV63(input).sameCoordinate, 'boolean');
console.log('PASS parity query matrix');

for (const waterClass of ['sea', 'lake', 'river', 'canal']) {
  const profile = queryShorelineBandsV63({ waterClass, distance: 4, depth: 4, wetEdge: 0.7, foam: 0.3 });
  assert.equal(typeof profile.recognized, 'boolean');
  const optics = queryWaterOpticsV63({ waterClass, distance: 4, depth: 4, wetEdge: 0.7, foam: 0.3, cyanRisk: 0.2, moireRisk: 0.1 });
  assert.equal(typeof optics.recognized, 'boolean');
}
console.log('PASS hydrology query matrix');

const manifest = createCapabilityManifestV63();
assert.equal(typeof manifest.capabilities.ground, 'function');
assert.equal(typeof manifest.capabilities.water, 'function');
assert.equal(typeof manifest.capabilities.placement, 'function');
assert.equal(manifest.readOnly, true);
assert.equal(manifest.createsGeometry, false);
console.log('PASS capability manifest');

const q1 = sample('same');
const q2 = sample('same');
const comparison = compareWorldQueriesV63(q1, q2);
assert.equal(comparison.samePoint, true);
assert.equal(comparison.sameFingerprint, true);
console.log('PASS query determinism');

const neighbors = [
  sample('n1', { terrain: { ...sample().terrain, x: 4502, z: 3500, canonicalHeight: 101 } }),
  sample('n2', { terrain: { ...sample().terrain, x: 4508, z: 3500, canonicalHeight: 103 } }),
  sample('n3', { terrain: { ...sample().terrain, x: 4514, z: 3504, canonicalHeight: 104 } }),
];
const neighborhood = createNeighborhoodQueryV63(sample('center'), neighbors);
assert.equal(neighborhood.count, 3);
assert.ok(neighborhood.maxHeightDelta >= 0);
console.log('PASS neighborhood query');

const traversal = createTerrainTraversalQueryV63([sample('a'), sample('b', { terrain: { ...sample().terrain, slope: 32 } }), sample('c', { terrain: { ...sample().terrain, slope: 14, canonicalHeight: 100.1, colliderHeight: 100.1 } })]);
assert.equal(traversal.count, 3);
assert.equal(typeof traversal.routeReady, 'boolean');
assert.ok(typeof traversal.digest === 'string');
console.log('PASS traversal query');

const contract = createVisualGroundingContractV63();
assert.equal(contract.acceptance.width, 1536);
assert.equal(contract.acceptance.height, 1024);
assert.equal(contract.sharedPlacement.mergedSuccessor, 590);
assert.equal(contract.queryApi.readOnly, true);
console.log('PASS visual grounding contract');

console.log('V63 world query suite complete');
