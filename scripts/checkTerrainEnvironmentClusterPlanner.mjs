import assert from 'node:assert/strict';
import {
  TERRAIN_ENVIRONMENT_CLUSTER_POLICY,
  auditEnvironmentCluster,
  makeEnvironmentCandidate,
  planEnvironmentCluster,
  planEnvironmentRegions,
  resolveEnvironmentDensity,
} from '../src/3d/world/terrainEnvironmentClusterPlanner.js';

const forestContext = {
  biome: 'temperate-forest',
  moisture: 0.72,
  slopeDegrees: 12,
  rockWeight: 0.08,
  snowWeight: 0.02,
  elevationMeters: 240,
  temperatureC: 11,
  windExposure: 0.2,
  distanceMeters: 180,
};

const first = planEnvironmentCluster({
  category: 'tree', centerX: 1300, centerZ: -850, radiusMeters: 160, count: 64, seed: 'proof-seed', context: forestContext,
});
const second = planEnvironmentCluster({
  category: 'tree', centerX: 1300, centerZ: -850, radiusMeters: 160, count: 64, seed: 'proof-seed', context: forestContext,
});
assert.deepEqual(first, second, 'same seed/context must produce identical world candidates');
assert.equal(first.acceptance.uniformGrid, false, 'cluster must never advertise a uniform grid');
assert.equal(auditEnvironmentCluster(first).ok, true, 'forest cluster must pass fail-closed audit');
assert.ok(first.planned > 0, 'forest context should produce visible candidates');
assert.ok(first.planned <= TERRAIN_ENVIRONMENT_CLUSTER_POLICY.densityCaps.tree, 'tree cap must be enforced');

const waterTree = makeEnvironmentCandidate({ category: 'tree', worldX: 20, worldZ: 30, seed: 1, context: { waterDepthMeters: 2, ...forestContext } });
assert.equal(waterTree.accepted, false, 'trees must be rejected in water');
assert.equal(waterTree.waterSafe, false, 'water rejection must be explicit');
assert.equal(resolveEnvironmentDensity('tree', { waterDepthMeters: 2 }), 0, 'water safety must zero tree density');

const bridge = makeEnvironmentCandidate({ category: 'bridge', worldX: 20, worldZ: 30, seed: 1, context: { waterDepthMeters: 2, slopeDegrees: 8 } });
assert.equal(bridge.accepted, true, 'bridge candidates may cross water');
assert.equal(bridge.waterSafe, true, 'bridge water exception must remain explicit');

const alpine = planEnvironmentRegions({
  category: 'rock', seed: 'regions', regions: [
    { centerX: -900, centerZ: 700, radiusMeters: 90, count: 18, context: { biome: 'alpine', slopeDegrees: 42, rockWeight: 0.86, elevationMeters: 1600 } },
    { centerX: -600, centerZ: 980, radiusMeters: 80, count: 12, context: { biome: 'alpine', slopeDegrees: 55, rockWeight: 0.94, elevationMeters: 1900 } },
  ],
});
assert.equal(alpine.summary.regions, 2, 'regional plan must retain region count');
assert.ok(alpine.summary.planned > 0, 'alpine rock regions should plan candidates');
for (const cluster of alpine.clusters) assert.equal(auditEnvironmentCluster(cluster).ok, true, 'each regional cluster must audit cleanly');

for (const category of ['tree', 'shrub', 'grass', 'rock', 'snowPatch', 'house', 'bridge']) {
  const candidate = makeEnvironmentCandidate({ category, worldX: 0, worldZ: 0, seed: 'finite', context: { slopeDegrees: 20, moisture: 0.5, snowWeight: 0.5 } });
  assert.ok(Number.isFinite(candidate.candidateWorld.x) && Number.isFinite(candidate.candidateWorld.z), `${category} candidate must stay finite`);
  assert.equal(candidate.assetFirst, true, `${category} must remain asset-first`);
  assert.equal(candidate.noPlaceholderGeometry, true, `${category} must reject placeholder geometry`);
}

console.log('terrain environment cluster planner: PASS');
