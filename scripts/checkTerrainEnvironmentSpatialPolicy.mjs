import assert from 'node:assert/strict';
import {
  TERRAIN_ENVIRONMENT_SPATIAL_POLICY,
  environmentSpatialNoise,
  distanceFalloff,
  ringFalloff,
  clearingsModifier,
  forestCoreWeight,
  forestEcotoneWeight,
  groveOpeningWeight,
  moistureDistributionWeight,
  slopeDistributionWeight,
  rockExposureWeight,
  talusWeight,
  settlementEnvelopeWeight,
  snowDriftWeight,
  ecotoneComposition,
  deterministicSpatialOrdinal,
  sampleClusterPoint,
  validateSpatialPatternSample,
  buildSpatialDistributionManifest,
} from '../src/3d/world/terrainEnvironmentSpatialPolicy.js';
import { resolveTerrainEnvironmentProfile } from '../src/3d/world/terrainEnvironmentProfiles.js';

const failures = [];
function check(label, fn) {
  try { fn(); } catch (error) { failures.push(`${label}: ${error.message}`); }
}
function between(value, min, max, label) {
  assert.ok(Number.isFinite(value), `${label} not finite`);
  assert.ok(value >= min && value <= max, `${label} ${value} outside ${min}..${max}`);
}

check('spatial policy is canonical-neutral and deterministic', () => {
  assert.equal(TERRAIN_ENVIRONMENT_SPATIAL_POLICY.deterministic, true);
  assert.equal(TERRAIN_ENVIRONMENT_SPATIAL_POLICY.canonicalHeightUntouched, true);
  assert.equal(TERRAIN_ENVIRONMENT_SPATIAL_POLICY.canonicalHydrologyUntouched, true);
  assert.equal(TERRAIN_ENVIRONMENT_SPATIAL_POLICY.canonicalColliderUntouched, true);
  assert.equal(TERRAIN_ENVIRONMENT_SPATIAL_POLICY.noGeometryInstantiation, true);
});

check('distance falloff has stable endpoints and monotonic interior', () => {
  assert.equal(distanceFalloff(0, 10, 40), 1);
  assert.equal(distanceFalloff(100, 10, 40), 0);
  const a = distanceFalloff(15, 10, 40);
  const b = distanceFalloff(25, 10, 40);
  const c = distanceFalloff(35, 10, 40);
  assert.ok(a > b && b > c);
  between(a, 0, 1, 'a'); between(b, 0, 1, 'b'); between(c, 0, 1, 'c');
});

check('ring falloff starts outside a core', () => {
  assert.equal(ringFalloff(0, 20, 50), 0);
  assert.equal(ringFalloff(100, 20, 50), 1);
  assert.ok(ringFalloff(45, 20, 50) > 0);
});

check('settlement clearing protects the inner footprint', () => {
  assert.equal(clearingsModifier(0), 0);
  assert.equal(clearingsModifier(22), 0);
  assert.ok(clearingsModifier(86) > 0 && clearingsModifier(86) < 1);
  assert.equal(clearingsModifier(151), 1);
});

check('forest core and ecotone form a useful spatial gradient', () => {
  const core = forestCoreWeight(35, 170, 46);
  const edge = forestCoreWeight(160, 170, 46);
  const out = forestCoreWeight(250, 170, 46);
  assert.ok(core > edge && edge > out);
  const edgeBand = forestEcotoneWeight(145, 170, 46);
  assert.ok(edgeBand > 0);
});

const deterministicPoints = [
  [0, 0, 1],
  [320, -540, 7],
  [1540, 940, 11],
  [-9200, 3300, 31],
  [12500, -8000, 41],
];
for (const [x, z, seed] of deterministicPoints) {
  check(`noise deterministic at ${x},${z}`, () => {
    const a = environmentSpatialNoise(x, z, seed);
    const b = environmentSpatialNoise(x, z, seed);
    assert.deepEqual(a, b);
    for (const [name, value] of Object.entries(a)) between(value, 0, 1, `noise.${name}`);
  });
}

check('different spatial points produce different deterministic seeds', () => {
  const a = deterministicSpatialOrdinal('tree', 100, 200, 1);
  const b = deterministicSpatialOrdinal('tree', 100.5, 200.5, 1);
  assert.notEqual(a, b);
});

check('cluster samples remain inside their annulus', () => {
  const center = { x: 540, z: -220 };
  for (let ordinal = 0; ordinal < 24; ordinal += 1) {
    const p = sampleClusterPoint(77, center.x, center.z, 30, 140, ordinal);
    const distance = Math.hypot(p.x - center.x, p.z - center.z);
    assert.ok(distance >= 30 - 1e-9, `inside inner radius at ${ordinal}`);
    assert.ok(distance <= 140 + 1e-9, `outside outer radius at ${ordinal}`);
    between(p.angle, 0, Math.PI * 2, `angle ${ordinal}`);
  }
});

check('moisture weight responds to wet biome and water proximity', () => {
  const dry = moistureDistributionWeight({ moisture: 0.20, biome: 'dry-upland', elevationMeters: 160, waterDistanceMeters: 200 });
  const wet = moistureDistributionWeight({ moisture: 0.80, biome: 'wet-meadow', elevationMeters: 20, waterDistanceMeters: 5 });
  assert.ok(wet > dry);
  between(dry, 0, 1, 'dry moisture');
  between(wet, 0, 1, 'wet moisture');
});

check('slope weight maps categories to different terrain envelopes', () => {
  const treeFlat = slopeDistributionWeight({ slopeDegrees: 8, category: 'tree' });
  const treeSteep = slopeDistributionWeight({ slopeDegrees: 48, category: 'tree' });
  const rockSteep = slopeDistributionWeight({ slopeDegrees: 48, category: 'rock' });
  assert.ok(treeFlat > treeSteep);
  assert.ok(rockSteep > 0);
  between(treeFlat, 0, 1, 'tree flat');
  between(rockSteep, 0, 1, 'rock steep');
});

check('rock exposure prefers sloped/ridged surfaces', () => {
  const low = rockExposureWeight({ slopeDegrees: 6, ridgeWeight: 0.1, substrateRock: 0.05 });
  const high = rockExposureWeight({ slopeDegrees: 61, ridgeWeight: 0.8, substrateRock: 0.9 });
  assert.ok(high > low);
  between(low, 0, 1, 'low exposure');
  between(high, 0, 1, 'high exposure');
});

check('talus prefers terrain below a rock face', () => {
  const near = talusWeight({ slopeDegrees: 38, heightMeters: 250, distanceBelowRockFaceMeters: 40, ridgeWeight: 0.7 });
  const far = talusWeight({ slopeDegrees: 38, heightMeters: 250, distanceBelowRockFaceMeters: 600, ridgeWeight: 0.7 });
  assert.ok(near > far);
});

check('settlement envelope peaks around roads and local envelopes', () => {
  const local = settlementEnvelopeWeight({ distanceMeters: 110, roadDistanceMeters: 4 });
  const remote = settlementEnvelopeWeight({ distanceMeters: 900, roadDistanceMeters: 300 });
  assert.ok(local > remote);
});

check('snow drifts favour lee and reduce over exposed rock', () => {
  const lee = snowDriftWeight({ snowWeight: 0.8, windward: 0.2, lee: 0.9, exposedRock: 0.1, slopeDegrees: 22 });
  const exposed = snowDriftWeight({ snowWeight: 0.8, windward: 0.7, lee: 0.2, exposedRock: 0.9, slopeDegrees: 22 });
  assert.ok(lee > exposed);
});

const compositions = [
  ['tree', { worldX: 100, worldZ: 100, slopeDegrees: 9, heightMeters: 45, moisture: 0.65, waterDepth: 0, biome: 'meadow', distanceFromGroveCenterMeters: 30, groveRadiusMeters: 170, settlementDistance: 420, roadDistance: 35 }],
  ['shrub', { worldX: -100, worldZ: 80, slopeDegrees: 13, heightMeters: 18, moisture: 0.74, waterDepth: 0, biome: 'forest-edge', distanceFromGroveCenterMeters: 155, groveRadiusMeters: 170, settlementDistance: 280, roadDistance: 20 }],
  ['rock', { worldX: 880, worldZ: -320, slopeDegrees: 52, heightMeters: 220, moisture: 0.32, waterDepth: 0, biome: 'highland', distanceFromGroveCenterMeters: 300, groveRadiusMeters: 170, settlementDistance: 800, roadDistance: 90 }],
  ['scree', { worldX: 920, worldZ: -340, slopeDegrees: 41, heightMeters: 310, moisture: 0.30, waterDepth: 0, biome: 'alpine-bare', distanceFromGroveCenterMeters: 400, groveRadiusMeters: 170, settlementDistance: 1000, roadDistance: 220 }],
];
for (const [category, sample] of compositions) {
  check(`composition ${category}`, () => {
    const composition = ecotoneComposition(category, sample);
    between(composition.densityMultiplier, 0, 2.2, `${category}.densityMultiplier`);
    between(composition.coreWeight, 0, 1, `${category}.coreWeight`);
    between(composition.ecotoneWeight, 0, 1, `${category}.ecotoneWeight`);
    between(composition.moistureWeight, 0, 1, `${category}.moistureWeight`);
    between(composition.slopeWeight, 0, 1, `${category}.slopeWeight`);
    between(composition.openingWeight, 0, 1, `${category}.openingWeight`);
    between(composition.environmentalScore, 0, 1, `${category}.environmentalScore`);
  });
}

check('spatial validation accepts plausible tree and rejects tree in water', () => {
  const good = validateSpatialPatternSample({ category: 'tree', slopeDegrees: 8, heightMeters: 46, moisture: 0.64, waterDepth: 0, biome: 'meadow', settlementDistance: 300, roadDistance: 28 });
  assert.equal(good.ok, true, good.errors.join(','));
  const bad = validateSpatialPatternSample({ category: 'tree', slopeDegrees: 8, heightMeters: 46, moisture: 0.64, waterDepth: 1.0, biome: 'meadow', settlementDistance: 300, roadDistance: 28 });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.includes('water-conflict'));
});

check('manifest remains deterministic and canonical-neutral', () => {
  const a = buildSpatialDistributionManifest({
    category: 'tree', seed: 91, worldX: 450, worldZ: -620,
    sample: { slopeDegrees: 10, heightMeters: 52, moisture: 0.68, waterDepth: 0, biome: 'meadow', distanceFromGroveCenterMeters: 52, groveRadiusMeters: 170, settlementDistance: 400, roadDistance: 31 },
  });
  const b = buildSpatialDistributionManifest({
    category: 'tree', seed: 91, worldX: 450, worldZ: -620,
    sample: { slopeDegrees: 10, heightMeters: 52, moisture: 0.68, waterDepth: 0, biome: 'meadow', distanceFromGroveCenterMeters: 52, groveRadiusMeters: 170, settlementDistance: 400, roadDistance: 31 },
  });
  assert.deepEqual(a, b);
  assert.equal(a.canonical.heightUnchanged, true);
  assert.equal(a.canonical.hydrologyUnchanged, true);
  assert.equal(a.canonical.colliderUnchanged, true);
  assert.ok(Object.isFrozen(a));
});

check('all policy categories have profiles', () => {
  for (const category of TERRAIN_ENVIRONMENT_SPATIAL_POLICY.patternTypes) {
    assert.ok(category);
  }
  for (const key of ['cliff', 'rock', 'scree', 'tree', 'shrub', 'grass', 'snow-patch', 'house', 'settlement']) {
    assert.ok(resolveTerrainEnvironmentProfile(key), `missing profile ${key}`);
  }
});

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    policyId: TERRAIN_ENVIRONMENT_SPATIAL_POLICY.id,
    patternTypes: TERRAIN_ENVIRONMENT_SPATIAL_POLICY.patternTypes,
    fixtureCount: deterministicPoints.length + compositions.length + 14,
    message: 'terrain environment spatial policy passed',
  }, null, 2));
}
