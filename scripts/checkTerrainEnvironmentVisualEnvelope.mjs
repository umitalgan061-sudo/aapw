import assert from 'node:assert/strict';
import {
  ecotoneComposition,
  forestCoreWeight,
  forestEcotoneWeight,
  groveOpeningWeight,
  moistureDistributionWeight,
  rockExposureWeight,
  talusWeight,
  snowDriftWeight,
  settlementEnvelopeWeight,
  buildSpatialDistributionManifest,
} from '../src/3d/world/terrainEnvironmentSpatialPolicy.js';
import {
  resolveTerrainEnvironmentProfile,
} from '../src/3d/world/terrainEnvironmentProfiles.js';

const failures = [];
const check = (label, fn) => { try { fn(); } catch (error) { failures.push(`${label}: ${error.message}`); } };
const between = (value, min, max, label) => {
  assert.ok(Number.isFinite(value), `${label} is not finite`);
  assert.ok(value >= min && value <= max, `${label} ${value} outside ${min}..${max}`);
};

check('forest has a coherent core-edge-outside gradient', () => {
  const core = forestCoreWeight(30, 180, 48);
  const mid = forestCoreWeight(175, 180, 48);
  const outside = forestCoreWeight(250, 180, 48);
  assert.ok(core > mid && mid >= outside);
  between(core, 0, 1, 'core');
  between(mid, 0, 1, 'mid');
  between(outside, 0, 1, 'outside');
});

check('ecotone peaks at the forest edge rather than the cleared core', () => {
  const inner = forestEcotoneWeight(24, 180, 48);
  const edge = forestEcotoneWeight(154, 180, 48);
  const exterior = forestEcotoneWeight(255, 180, 48);
  assert.ok(edge > inner);
  assert.ok(edge > exterior);
});

check('grove opening field is deterministic and bounded', () => {
  const a = groveOpeningWeight(512, -128, 0x77);
  const b = groveOpeningWeight(512, -128, 0x77);
  assert.equal(a, b);
  between(a, 0, 1, 'opening');
});

check('wet ecological band outweighs a dry upland with equivalent distance', () => {
  const wet = moistureDistributionWeight({ moisture: 0.78, biome: 'wet-meadow', elevationMeters: 22, waterDistanceMeters: 8 });
  const dry = moistureDistributionWeight({ moisture: 0.28, biome: 'dry-upland', elevationMeters: 120, waterDistanceMeters: 80 });
  assert.ok(wet > dry);
});

check('rock exposure respects slope/ridge/substrate context', () => {
  const flat = rockExposureWeight({ slopeDegrees: 5, ridgeWeight: 0.08, substrateRock: 0.04 });
  const ridge = rockExposureWeight({ slopeDegrees: 60, ridgeWeight: 0.86, substrateRock: 0.82 });
  assert.ok(ridge > flat);
});

check('talus visibly decays away from its parent rock face', () => {
  const near = talusWeight({ slopeDegrees: 36, heightMeters: 220, distanceBelowRockFaceMeters: 22, ridgeWeight: 0.82 });
  const far = talusWeight({ slopeDegrees: 36, heightMeters: 220, distanceBelowRockFaceMeters: 250, ridgeWeight: 0.82 });
  assert.ok(near > far);
});

check('snow drifts respond to wind and exposure instead of whitewash', () => {
  const leePocket = snowDriftWeight({ snowWeight: 0.9, windward: 0.12, lee: 0.94, exposedRock: 0.18, slopeDegrees: 18 });
  const windScouredRock = snowDriftWeight({ snowWeight: 0.9, windward: 0.92, lee: 0.12, exposedRock: 0.88, slopeDegrees: 29 });
  assert.ok(leePocket > windScouredRock);
  between(leePocket, 0, 1, 'leePocket');
  between(windScouredRock, 0, 1, 'windScouredRock');
});

check('settlement envelope keeps local props denser than remote countryside', () => {
  const local = settlementEnvelopeWeight({ distanceMeters: 70, roadDistanceMeters: 3 });
  const remote = settlementEnvelopeWeight({ distanceMeters: 500, roadDistanceMeters: 80 });
  assert.ok(local > remote);
});

const biomeFixtures = [
  ['tree', 'meadow', 8, 48, 0.64, 300, 18],
  ['tree', 'forest-edge', 12, 56, 0.70, 220, 12],
  ['shrub', 'wet-meadow', 11, 24, 0.78, 130, 9],
  ['grass', 'meadow', 16, 17, 0.72, 500, 18],
  ['rock', 'highland', 52, 240, 0.32, 700, 120],
  ['scree', 'alpine-bare', 39, 330, 0.29, 900, 190],
];
for (const [category, biome, slopeDegrees, heightMeters, moisture, settlementDistance, roadDistance] of biomeFixtures) {
  check(`composition-${category}-${biome}`, () => {
    const composition = ecotoneComposition(category, {
      worldX: 700 + slopeDegrees * 3,
      worldZ: -500 + heightMeters,
      seed: 0x20260907,
      slopeDegrees,
      heightMeters,
      moisture,
      waterDepth: 0,
      biome,
      settlementDistance,
      roadDistance,
      distanceFromGroveCenterMeters: category === 'tree' ? 80 : 220,
      groveRadiusMeters: 180,
      ridgeWeight: category === 'rock' || category === 'scree' ? 0.7 : 0.2,
      rockWeight: category === 'rock' || category === 'scree' ? 0.8 : 0.1,
      snowWeight: 0.02,
      windward: 0.5,
      lee: 0.5,
      waterDistanceMeters: 30,
    });
    between(composition.densityMultiplier, 0, 2.2, `${category}.density`);
    between(composition.environmentalScore, 0, 1, `${category}.score`);
  });
}

check('profiles agree with the same ecology categories', () => {
  for (const category of ['tree', 'shrub', 'grass', 'rock', 'scree', 'snow-patch', 'house', 'settlement']) {
    const profile = resolveTerrainEnvironmentProfile(category);
    assert.ok(profile);
    assert.ok(profile.requiredSurfaces.length > 0);
    assert.ok(profile.preferredPalettes.length > 0);
  }
});

check('spatial manifest has no hidden geometry authority', () => {
  const manifest = buildSpatialDistributionManifest({
    category: 'tree',
    seed: 20260907,
    worldX: 820,
    worldZ: -1120,
    sample: {
      slopeDegrees: 10,
      heightMeters: 52,
      moisture: 0.64,
      waterDepth: 0,
      biome: 'meadow',
      distanceFromGroveCenterMeters: 76,
      groveRadiusMeters: 180,
      settlementDistance: 420,
      roadDistance: 34,
    },
  });
  assert.equal(manifest.canonical.heightUnchanged, true);
  assert.equal(manifest.canonical.hydrologyUnchanged, true);
  assert.equal(manifest.canonical.colliderUnchanged, true);
  assert.equal(manifest.deterministic, true);
});

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    fixtureCount: biomeFixtures.length + 10,
    message: 'terrain environment visual ecology envelope passed',
  }, null, 2));
}
