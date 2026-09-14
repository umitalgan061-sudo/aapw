import assert from 'node:assert/strict';
import {
  GEOGRAPHIC_ASSET_CONTEXT_POLICY,
  GEOGRAPHIC_ASSET_FAMILY_PROFILES,
  GEOGRAPHIC_ASSET_CONTEXT_FAMILY_IDS,
  buildGeographicAssetContext,
  scoreGeographicAssetFamily,
  rankGeographicAssetFamilies,
  selectGeographicAssetFamily,
  deriveGeographicAssetVariant,
  deriveGeographicAssetPlacement,
  geographicAssetContextDigest,
  assertGeographicAssetContextDeterminism,
} from '../src/3d/world/geographicAssetContext.js';
import {
  GEOGRAPHIC_ASSET_CLUSTER_POLICY,
  GEOGRAPHIC_ASSET_CLUSTER_MODES,
  planGeographicAssetCluster,
  planWorldAssetClusterAtWorldXZ,
  checkClusterGeographySafety,
  explainClusterDecision,
  clusterDigest,
  replayCluster,
  planMultiAnchorGeographicAssets,
} from '../src/3d/world/geographicAssetClusterPlanner.js';

const checks = [];
function ok(value, message) {
  assert.ok(value, message);
  checks.push(message);
}
function eq(actual, expected, message) {
  assert.equal(actual, expected, message);
  checks.push(message);
}
function near(value, min, max, message) {
  assert.ok(Number.isFinite(value) && value >= min && value <= max, `${message}: ${value}`);
  checks.push(message);
}
function finite(value, message) {
  assert.ok(Number.isFinite(value), `${message}: ${value}`);
  checks.push(message);
}
function stable(value, message) {
  assert.doesNotThrow(() => JSON.stringify(value), message);
  checks.push(message);
}

ok(GEOGRAPHIC_ASSET_CONTEXT_POLICY.deterministic, 'context policy deterministic');
ok(GEOGRAPHIC_ASSET_CONTEXT_POLICY.canonicalInputsOnly, 'context policy uses canonical inputs only');
ok(GEOGRAPHIC_ASSET_CONTEXT_POLICY.createsNoGeometry, 'context does not create geometry');
ok(GEOGRAPHIC_ASSET_CLUSTER_POLICY.deterministic, 'cluster policy deterministic');
eq(GEOGRAPHIC_ASSET_CLUSTER_POLICY.regularGridDistribution, false, 'cluster planner is not regular grid');
eq(GEOGRAPHIC_ASSET_CLUSTER_POLICY.canonicalSurfaceSampling, true, 'cluster planner canonical surface sampling');

const scenarios = [
  {
    id: 'temperate-woodland', x: 120, z: -80, seed: 'temperate',
    context: {
      biome: 'temperate', moisture: 0.58, slopeDegrees: 10, elevationMeters: 280,
      waterDepth: 0, shorelineDistanceMeters: 640, roadDistanceMeters: 74, settlementDistanceMeters: 260,
      localRelief: 0.46, cryosphere: { tundra: 0.08, permanentIce: 0, snowPersistence: 0.12 },
      season: { spring: 0.4, summer: 0.5, autumn: 0.7, winter: 0.2 },
    },
  },
  {
    id: 'north-treeline', x: -320, z: 1600, seed: 'north',
    context: {
      biome: 'cold-grassland', moisture: 0.48, slopeDegrees: 17, elevationMeters: 980,
      waterDepth: 0, shorelineDistanceMeters: 910, roadDistanceMeters: 180, settlementDistanceMeters: 410,
      localRelief: 0.64, cryosphere: { tundra: 0.74, permanentIce: 0.08, snowPersistence: 0.80 },
      season: { spring: 0.2, summer: 0.2, autumn: 0.4, winter: 0.9 },
    },
  },
  {
    id: 'desert-basin', x: 910, z: -1230, seed: 'south',
    context: {
      biome: 'desert', moisture: 0.10, slopeDegrees: 14, elevationMeters: 330,
      waterDepth: 0, shorelineDistanceMeters: 1800, roadDistanceMeters: 260, settlementDistanceMeters: 580,
      localRelief: 0.50, cryosphere: { tundra: 0, permanentIce: 0, snowPersistence: 0.02 },
      season: { spring: 0.1, summer: 0.9, autumn: 0.3, winter: 0.05 },
    },
  },
  {
    id: 'marsh-edge', x: -740, z: 540, seed: 'wet',
    context: {
      biome: 'marsh', moisture: 0.88, slopeDegrees: 4, elevationMeters: 42,
      waterDepth: 0.01, shorelineDistanceMeters: 90, roadDistanceMeters: 140, settlementDistanceMeters: 330,
      localRelief: 0.28, cryosphere: { tundra: 0.03, permanentIce: 0, snowPersistence: 0.11 },
      season: { spring: 0.8, summer: 0.6, autumn: 0.6, winter: 0.2 },
    },
  },
  {
    id: 'valyria-rock', x: -1900, z: 740, seed: 'valyria',
    context: {
      biome: 'valyria', moisture: 0.18, slopeDegrees: 36, elevationMeters: 1120,
      waterDepth: 0, shorelineDistanceMeters: 820, roadDistanceMeters: 310, settlementDistanceMeters: 710,
      localRelief: 0.85, cryosphere: { tundra: 0, permanentIce: 0, snowPersistence: 0.03 },
      season: { spring: 0.2, summer: 0.8, autumn: 0.4, winter: 0.1 },
    },
  },
];

for (const scenario of scenarios) {
  const context = buildGeographicAssetContext({
    familyIds: GEOGRAPHIC_ASSET_CONTEXT_FAMILY_IDS,
    worldX: scenario.x,
    worldZ: scenario.z,
    seed: scenario.seed,
    context: scenario.context,
  });
  ok(context.ok, `${scenario.id} context builds`);
  eq(context.surface.biome, scenario.context.biome.replace(/[_\s]+/g, '-'), `${scenario.id} biome canonicalized`);
  near(context.surface.moisture, 0, 1, `${scenario.id} moisture bounded`);
  near(context.densityField, 0, 1, `${scenario.id} density bounded`);
  near(context.habitatPressure, 0, 1, `${scenario.id} habitat pressure bounded`);
  stable(context, `${scenario.id} context JSON stable`);
  finite(context.deterministicDigest, `${scenario.id} deterministic digest`);
  finite(geographicAssetContextDigest(context), `${scenario.id} digest helper`);

  const selected = selectGeographicAssetFamily({
    familyIds: GEOGRAPHIC_ASSET_CONTEXT_FAMILY_IDS,
    context: scenario.context,
    worldX: scenario.x,
    worldZ: scenario.z,
    seed: scenario.seed,
  });
  if (selected.ok) {
    ok(Boolean(GEOGRAPHIC_ASSET_FAMILY_PROFILES[selected.familyId]), `${scenario.id} selected family exists`);
    near(selected.score, 0, 1, `${scenario.id} selected score bounded`);
    const variant = deriveGeographicAssetVariant({
      familyId: selected.familyId,
      context: scenario.context,
      worldX: scenario.x,
      worldZ: scenario.z,
      seed: scenario.seed,
    });
    ok(variant.ok, `${scenario.id} selected variant resolves`);
    ok(Boolean(variant.variant.includes(selected.familyId)), `${scenario.id} variant names family`);
  }

  const placementFamily = scenario.id === 'north-treeline' ? 'snowpine'
    : scenario.id === 'desert-basin' ? 'desertgrass'
    : scenario.id === 'marsh-edge' ? 'marshreed'
    : scenario.id === 'valyria-rock' ? 'basalt'
    : 'broadleaf';
  const placement = deriveGeographicAssetPlacement({
    familyId: placementFamily,
    context: scenario.context,
    worldX: scenario.x,
    worldZ: scenario.z,
    seed: scenario.seed,
  });
  ok(placement.ok || placement.suitability === 0, `${scenario.id} placement is bounded`);
  near(placement.suitability, 0, 1, `${scenario.id} suitability bounded`);
  near(placement.density, 0, 1, `${scenario.id} placement density bounded`);
  near(placement.cluster, 0, 1, `${scenario.id} cluster bounded`);
  near(placement.scale, GEOGRAPHIC_ASSET_CONTEXT_POLICY.bounds.scaleMin, GEOGRAPHIC_ASSET_CONTEXT_POLICY.bounds.scaleMax, `${scenario.id} scale bounded`);
  finite(placement.rotationBiasRadians, `${scenario.id} rotation finite`);
}

const determinism = assertGeographicAssetContextDeterminism({ samples: scenarios.map((scenario) => ({
  worldX: scenario.x,
  worldZ: scenario.z,
  seed: scenario.seed,
  context: scenario.context,
})) });
ok(determinism.ok, 'context determinism replay');
eq(determinism.mismatches.length, 0, 'context determinism has zero mismatches');

const genericContext = scenarios[0].context;
const rank = rankGeographicAssetFamilies(['broadleaf', 'pine', 'granite', 'sandstone'], genericContext);
ok(rank.length === 4, 'family ranking preserves requested set');
ok(rank.every((item) => Number.isFinite(item.score)), 'family ranking scores are finite');
near(rank[0].score, 0, 1, 'top family score bounded');

const ambient = planGeographicAssetCluster({
  anchor: { x: scenarios[0].x, z: scenarios[0].z, id: scenarios[0].id },
  context: genericContext,
  familyIds: ['broadleaf', 'birch', 'meadowgrass', 'fern', 'granite'],
  seed: 'cluster-a',
  mode: 'ambient',
  candidateCount: 42,
  acceptedCount: 16,
});
ok(ambient.ok, 'ambient cluster has accepted candidates');
eq(ambient.mode.id, 'ambient', 'ambient mode id stable');
ok(ambient.accepted.length <= 16, 'ambient accepted cap');
ok(ambient.attempted <= 42, 'ambient candidate budget');
ok(ambient.rejected.length + ambient.accepted.length === ambient.attempted, 'ambient attempts fully accounted');
stable(ambient, 'ambient cluster JSON stable');
finite(clusterDigest(ambient), 'ambient cluster digest finite');
const safety = checkClusterGeographySafety(ambient);
ok(safety.ok, 'ambient cluster geography safety');
const explanation = explainClusterDecision(ambient);
ok(explanation.ok, 'ambient cluster explanation available');
ok(Object.keys(explanation.rejectionCounts).length >= 0, 'ambient rejection accounting present');

const ambientReplay = planGeographicAssetCluster({
  anchor: { x: scenarios[0].x, z: scenarios[0].z, id: scenarios[0].id },
  context: genericContext,
  familyIds: ['broadleaf', 'birch', 'meadowgrass', 'fern', 'granite'],
  seed: 'cluster-a',
  mode: 'ambient',
  candidateCount: 42,
  acceptedCount: 16,
});
const replay = replayCluster({ first: ambient, second: ambientReplay });
ok(replay.ok, 'cluster replay deterministic');
eq(replay.firstDigest, replay.secondDigest, 'cluster replay digest identical');

const mobile = planWorldAssetClusterAtWorldXZ(scenarios[1].x, scenarios[1].z, {
  context: scenarios[1].context,
  familyIds: ['snowpine', 'pine', 'granite', 'cairn'],
  seed: 'mobile-north',
  mode: 'geology',
  candidateCount: 28,
  acceptedCount: 12,
  mobile: true,
});
ok(mobile.attempted <= GEOGRAPHIC_ASSET_CLUSTER_POLICY.maxCandidatesMobile, 'mobile candidate cap');
ok(mobile.acceptedCount <= GEOGRAPHIC_ASSET_CLUSTER_POLICY.maxAcceptedMobile, 'mobile accepted cap');
const mobileSafety = checkClusterGeographySafety(mobile);
ok(mobileSafety.ok, 'mobile geography safety');

const shoreline = planGeographicAssetCluster({
  anchor: { x: scenarios[3].x, z: scenarios[3].z, id: scenarios[3].id },
  context: scenarios[3].context,
  familyIds: ['marshreed', 'wetboulder', 'driftwood', 'dock', 'watermill'],
  seed: 'shoreline-a',
  mode: 'shoreline',
  candidateCount: 36,
  acceptedCount: 11,
  contextualize(x, z) {
    const dx = x - scenarios[3].x;
    const dz = z - scenarios[3].z;
    const localDistance = Math.sqrt(dx * dx + dz * dz);
    return {
      ...scenarios[3].context,
      shorelineDistanceMeters: Math.max(4, Math.abs(localDistance - 74)),
      roadDistanceMeters: 90 + localDistance * 0.31,
      settlementDistanceMeters: 240 + localDistance * 0.52,
      slopeDegrees: 3 + Math.min(10, localDistance * 0.02),
      waterDepth: 0.008,
      isWater: false,
    };
  },
});
ok(shoreline.ok, 'shoreline cluster has candidate result');
ok(shoreline.attempted <= 36, 'shoreline candidate budget');
near(shoreline.acceptedCount + shoreline.rejectedCount, shoreline.attempted, shoreline.acceptedCount + shoreline.rejectedCount === shoreline.attempted ? shoreline.attempted : shoreline.attempted);

const multi = planMultiAnchorGeographicAssets({
  anchors: scenarios.map((scenario) => ({ x: scenario.x, z: scenario.z, id: scenario.id, context: scenario.context })),
  familyIds: ['broadleaf', 'pine', 'snowpine', 'marshreed', 'granite', 'basalt', 'desertgrass'],
  seed: 'multi-anchor',
  mode: 'ambient',
  acceptedCount: 8,
});
eq(multi.length, scenarios.length, 'multi-anchor plan count');
ok(multi.every((plan) => Array.isArray(plan.accepted)), 'multi-anchor plans expose accepted arrays');

for (const [familyId, profile] of Object.entries(GEOGRAPHIC_ASSET_FAMILY_PROFILES)) {
  ok(profile.id === familyId, `${familyId} profile id canonical`);
  near(profile.density, 0, 1, `${familyId} density bounded`);
  near(profile.cluster, 0, 1, `${familyId} cluster bounded`);
  near(profile.scaleMean, GEOGRAPHIC_ASSET_CONTEXT_POLICY.bounds.scaleMin, GEOGRAPHIC_ASSET_CONTEXT_POLICY.bounds.scaleMax, `${familyId} scale mean bounded`);
  ok(Array.isArray(profile.preferredBiomes) && profile.preferredBiomes.length > 0, `${familyId} preferred biomes present`);
  ok(Array.isArray(profile.forbiddenBiomes), `${familyId} forbidden biomes present`);
}

const waterRejection = scoreGeographicAssetFamily('broadleaf', { biome: 'ocean', moisture: 1, slopeDegrees: 2, elevationMeters: 0, waterDepth: 4, isWater: true });
eq(waterRejection.score, 0, 'broadleaf rejected on ocean');
ok(waterRejection.hardReject, 'ocean vegetation hard reject');
const stoneCoast = scoreGeographicAssetFamily('dock', { biome: 'coast', moisture: 0.92, slopeDegrees: 2, elevationMeters: 12, waterDepth: 0.02, shorelineDistanceMeters: 16 });
ok(stoneCoast.accepted || stoneCoast.score > 0.25, 'dock coastal suitability remains usable');

console.log(JSON.stringify({
  ok: true,
  checks: checks.length,
  contextPolicy: GEOGRAPHIC_ASSET_CONTEXT_POLICY.id,
  clusterPolicy: GEOGRAPHIC_ASSET_CLUSTER_POLICY.id,
  modes: Object.keys(GEOGRAPHIC_ASSET_CLUSTER_MODES),
  familyCount: Object.keys(GEOGRAPHIC_ASSET_FAMILY_PROFILES).length,
  scenarios: scenarios.length,
  ambientAccepted: ambient.acceptedCount,
  ambientRejected: ambient.rejectedCount,
  shorelineAccepted: shoreline.acceptedCount,
  mobileAccepted: mobile.acceptedCount,
  deterministicDigests: determinism.digests,
}, null, 2));
