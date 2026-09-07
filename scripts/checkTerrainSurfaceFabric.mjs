import assert from 'node:assert/strict';
import {
  TERRAIN_SURFACE_FABRIC_POLICY,
  TERRAIN_SURFACE_FABRIC_CHANNELS,
  terrainSurfaceNoise,
  terrainSurfaceReliefContext,
  terrainSurfaceColorMultiplier,
  terrainSurfaceRoughness,
  terrainSurfaceNormalGain,
  chooseTerrainSubstrate,
  buildTerrainSurfaceManifest,
  validateTerrainSurfaceFabricPolicy,
} from '../src/3d/world/terrainSurfaceFabric.js';

const failures = [];
function check(label, fn) {
  try { fn(); } catch (error) { failures.push(`${label}: ${error.message}`); }
}
function approx(value, min, max, label) {
  assert.ok(Number.isFinite(value), `${label} is not finite`);
  assert.ok(value >= min && value <= max, `${label} ${value} outside [${min}, ${max}]`);
}
function finiteObject(object, label) {
  for (const [key, value] of Object.entries(object)) {
    assert.ok(Number.isFinite(value), `${label}.${key} is not finite`);
  }
}

check('policy is render-only and canonical-neutral', () => {
  const result = validateTerrainSurfaceFabricPolicy();
  assert.equal(result.ok, true, result.errors.join(','));
  assert.equal(TERRAIN_SURFACE_FABRIC_POLICY.renderOnly, true);
  assert.equal(TERRAIN_SURFACE_FABRIC_POLICY.canonicalHeightUnchanged, true);
  assert.equal(TERRAIN_SURFACE_FABRIC_POLICY.canonicalHydrologyUnchanged, true);
  assert.equal(TERRAIN_SURFACE_FABRIC_POLICY.canonicalColliderUnchanged, true);
  assert.equal(TERRAIN_SURFACE_FABRIC_POLICY.canonicalRoadsUnchanged, true);
  assert.equal(TERRAIN_SURFACE_FABRIC_POLICY.canonicalSettlementsUnchanged, true);
  assert.equal(TERRAIN_SURFACE_FABRIC_POLICY.periodicDetailTextureIsSupplemental, true);
});

check('world-space scales span macro to micro without a short repeat loop', () => {
  const scales = TERRAIN_SURFACE_FABRIC_POLICY.worldSpaceScalesMeters;
  assert.equal(scales.length >= 5, true);
  for (let i = 1; i < scales.length; i += 1) assert.ok(scales[i] > scales[i - 1]);
  assert.ok(scales.at(-1) >= 3000);
  assert.ok(scales[0] >= 40);
});

check('all semantic surface channels are represented', () => {
  const expected = ['meadow', 'dampMoss', 'dryHeath', 'ferricEarth', 'granite', 'quartz', 'scree', 'snow', 'shoreline'];
  assert.deepEqual(Object.keys(TERRAIN_SURFACE_FABRIC_CHANNELS).sort(), [...expected].sort());
  for (const key of expected) {
    assert.ok(TERRAIN_SURFACE_FABRIC_CHANNELS[key].hueBias);
    assert.ok(TERRAIN_SURFACE_FABRIC_CHANNELS[key].roughness);
    approx(TERRAIN_SURFACE_FABRIC_CHANNELS[key].macro, 0, 1, `${key}.macro`);
  }
});

const samples = [
  { worldX: 0, worldZ: 0 },
  { worldX: 312.5, worldZ: -487.25 },
  { worldX: 1820, worldZ: 910 },
  { worldX: -3210, worldZ: 2240 },
  { worldX: 8192, worldZ: -7168 },
  { worldX: -14050, worldZ: -6200 },
  { worldX: 25000, worldZ: 14000 },
  { worldX: -28000, worldZ: 12000 },
];

for (const point of samples) {
  check(`noise deterministic ${point.worldX},${point.worldZ}`, () => {
    const first = terrainSurfaceNoise(point.worldX, point.worldZ);
    const second = terrainSurfaceNoise(point.worldX, point.worldZ);
    assert.deepEqual(first, second);
    for (const [key, value] of Object.entries(first)) approx(value, 0, 1, `noise.${key}`);
  });
}

const contexts = [
  {
    label: 'lowland meadow',
    args: { worldX: 240, worldZ: 180, heightAboveSeaMeters: 12, slopeDegrees: 2, concavityMeters: 0.5, rockWeight: 0.02, snowWeight: 0, waterWeight: 0 },
    expected: ['meadow', 'dampMoss', 'dryHeath', 'ferricEarth'],
  },
  {
    label: 'steep granite face',
    args: { worldX: 880, worldZ: -320, heightAboveSeaMeters: 260, slopeDegrees: 58, concavityMeters: 1.2, rockWeight: 0.9, snowWeight: 0.06, waterWeight: 0 },
    expected: ['granite', 'quartz', 'scree'],
  },
  {
    label: 'snow shoulder',
    args: { worldX: -910, worldZ: 1180, heightAboveSeaMeters: 420, slopeDegrees: 17, concavityMeters: 2.8, rockWeight: 0.1, snowWeight: 0.92, waterWeight: 0 },
    expected: ['snow'],
  },
  {
    label: 'wet shore',
    args: { worldX: 1720, worldZ: 80, heightAboveSeaMeters: 3.8, slopeDegrees: 5, concavityMeters: 0.2, rockWeight: 0.06, snowWeight: 0, waterWeight: 0.9 },
    expected: ['shoreline'],
  },
];

const resolvedContexts = [];
for (const fixture of contexts) {
  check(`context ${fixture.label}`, () => {
    const context = terrainSurfaceReliefContext(fixture.args);
    resolvedContexts.push({ fixture, context });
    approx(context.slope01, 0, 1, 'slope01');
    approx(context.elevation01, 0, 1, 'elevation01');
    approx(context.wet01, 0, 1, 'wet01');
    approx(context.exposedRock, 0, 1, 'exposedRock');
    approx(context.substrate, 0, 1, 'substrate');
    assert.equal(context.policyId, TERRAIN_SURFACE_FABRIC_POLICY.id);
    finiteObject(context.antiTilingOffset, 'antiTilingOffset');
    assert.ok(fixture.expected.includes(chooseTerrainSubstrate(context)), `unexpected substrate ${chooseTerrainSubstrate(context)}`);
  });
}

for (const { fixture, context } of resolvedContexts) {
  check(`response ${fixture.label}`, () => {
    const multiplier = terrainSurfaceColorMultiplier(context);
    const roughness = terrainSurfaceRoughness(context);
    const normalGain = terrainSurfaceNormalGain(context);
    approx(multiplier, 0.72, 1.28, 'colorMultiplier');
    approx(roughness, 0.48, 1, 'roughness');
    approx(normalGain, 0.02, 0.18, 'normalGain');
  });
}

check('manifest is immutable and canonical-neutral', () => {
  const manifest = buildTerrainSurfaceManifest({
    sample: {
      worldX: 915,
      worldZ: -205,
      heightAboveSeaMeters: 215,
      slopeDegrees: 42,
      concavityMeters: 1.3,
      rockWeight: 0.74,
      snowWeight: 0.08,
      waterWeight: 0,
    },
    sourceMapPolicyId: 'westeros-full-owner-map-current-terrain-2026-08-27-v2-valyria-geology',
  });
  assert.equal(manifest.canonical.heightUnchanged, true);
  assert.equal(manifest.canonical.hydrologyUnchanged, true);
  assert.equal(manifest.canonical.colliderUnchanged, true);
  assert.equal(manifest.canonical.routeUnchanged, true);
  assert.equal(manifest.canonical.settlementUnchanged, true);
  assert.equal(manifest.antiTiling.worldSpace, true);
  assert.equal(manifest.antiTiling.repeatedTextureIsSupplemental, true);
  assert.ok(manifest.response.colorMultiplier >= 0.72);
  assert.ok(manifest.response.colorMultiplier <= 1.28);
  assert.ok(Object.isFrozen(manifest));
});

check('distinct far-apart locations do not collapse into an identical noise tuple', () => {
  const a = terrainSurfaceNoise(0, 0);
  const b = terrainSurfaceNoise(18000, -15000);
  const same = Object.keys(a).every((key) => a[key] === b[key]);
  assert.equal(same, false);
});

check('no 22m repeat is declared by the new fabric', () => {
  assert.ok(!TERRAIN_SURFACE_FABRIC_POLICY.worldSpaceScalesMeters.includes(22));
  assert.ok(TERRAIN_SURFACE_FABRIC_POLICY.worldSpaceScalesMeters[0] > 22);
});

check('lowland and exposed-rock responses remain materially distinct', () => {
  const low = terrainSurfaceReliefContext({ heightAboveSeaMeters: 14, slopeDegrees: 3, rockWeight: 0.02, snowWeight: 0, waterWeight: 0 });
  const rock = terrainSurfaceReliefContext({ heightAboveSeaMeters: 280, slopeDegrees: 61, rockWeight: 0.91, snowWeight: 0, waterWeight: 0 });
  const lowResponse = terrainSurfaceColorMultiplier(low);
  const rockResponse = terrainSurfaceColorMultiplier(rock);
  assert.ok(Math.abs(lowResponse - rockResponse) > 0.002);
  assert.ok(rock.exposedRock > low.exposedRock);
});

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    policyId: TERRAIN_SURFACE_FABRIC_POLICY.id,
    fixtureCount: samples.length + contexts.length,
    channels: Object.keys(TERRAIN_SURFACE_FABRIC_CHANNELS).length,
    worldSpaceScalesMeters: TERRAIN_SURFACE_FABRIC_POLICY.worldSpaceScalesMeters,
    message: 'terrain surface fabric contract passed',
  }, null, 2));
}
