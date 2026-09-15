import assert from 'node:assert/strict';
import { TERRAIN_CLIMATE_CANONICAL_INVARIANTS, TERRAIN_CLIMATE_EXPOSURE_POLICY, resolveTerrainClimateExposureState, resolveTerrainClimateMaterialResponse, climateExposurePolicySnapshot } from '../src/3d/world/terrainSurfaceClimateExposure.js';

const invariantKeys = ['canonicalHeightUnchanged','canonicalHydrologyUnchanged','canonicalCoastlineUnchanged','canonicalColliderUnchanged','canonicalVegetationPlacementUnchanged'];
const points = [];
for (let ix = -20; ix <= 20; ix += 1) {
  for (let iz = -9; iz <= 9; iz += 1) points.push({ x: ix * 83.25, z: iz * 117.5 });
}

assert.equal(TERRAIN_CLIMATE_EXPOSURE_POLICY.renderOnly, true);
assert.equal(TERRAIN_CLIMATE_EXPOSURE_POLICY.deterministic, true);
assert.equal(TERRAIN_CLIMATE_EXPOSURE_POLICY.newGeographyIntroduced, false);
for (const key of invariantKeys) assert.equal(TERRAIN_CLIMATE_EXPOSURE_POLICY[key], true);
for (const invariant of TERRAIN_CLIMATE_CANONICAL_INVARIANTS) assert.equal(typeof invariant, 'string');

function finiteBounded(value, name) {
  assert.equal(Number.isFinite(value), true, `${name} must be finite`);
  assert.equal(value >= 0 && value <= 1, true, `${name} must be [0,1]`);
}

let checksum = 0;
for (let i = 0; i < points.length; i += 1) {
  const point = points[i];
  const input = {
    worldX: point.x,
    worldZ: point.z,
    heightMeters: -20 + (i % 170) * 12.5,
    slopeDegrees: (i * 7.25) % 58,
    moisture: ((i * 13) % 101) / 100,
    baseColor: { r: 0.08 + ((i * 17) % 61) / 100, g: 0.12 + ((i * 11) % 55) / 100, b: 0.10 + ((i * 7) % 49) / 100 },
  };
  const a = resolveTerrainClimateExposureState(input);
  const b = resolveTerrainClimateExposureState(input);
  assert.deepEqual(a, b, `non deterministic climate response at ${i}`);
  for (const [key, value] of Object.entries(a)) finiteBounded(value, key);
  const response = resolveTerrainClimateMaterialResponse({ state: a, baseColor: input.baseColor, baseRoughness: 0.86 });
  for (const channel of ['r','g','b']) finiteBounded(response.color[channel], `color.${channel}`);
  finiteBounded(response.roughness, 'roughness');
  finiteBounded(response.normalStrength, 'normalStrength');
  checksum = (checksum + Math.round((a.stress + a.freezeThaw + a.solarDrying) * 1000003) + i * 17) >>> 0;
}

const low = resolveTerrainClimateExposureState({ worldX: 12, worldZ: 31, heightMeters: 20, slopeDegrees: 2, moisture: 0.92 });
const high = resolveTerrainClimateExposureState({ worldX: 12, worldZ: 31, heightMeters: 1800, slopeDegrees: 28, moisture: 0.92 });
assert(high.frostBand >= low.frostBand);
assert(high.freezeThaw >= low.freezeThaw);
assert(high.snowBand >= low.snowBand);

const dry = resolveTerrainClimateExposureState({ worldX: -41, worldZ: 66, heightMeters: 700, slopeDegrees: 12, moisture: 0.08 });
const wet = resolveTerrainClimateExposureState({ worldX: -41, worldZ: 66, heightMeters: 700, slopeDegrees: 12, moisture: 0.92 });
assert(dry.solarDrying > wet.solarDrying);
assert(wet.wetBase > dry.wetBase);

for (const phase of [0, 0.25, 0.5, 0.75, 1]) {
  const sample = resolveTerrainClimateExposureState({ worldX: phase * 1000, worldZ: -phase * 800, heightMeters: phase * 1500, slopeDegrees: phase * 40, moisture: phase });
  for (const value of Object.values(sample)) finiteBounded(value, `phase-${phase}`);
}

const snapshot = climateExposurePolicySnapshot();
assert.equal(snapshot.id, TERRAIN_CLIMATE_EXPOSURE_POLICY.id);
assert.equal(snapshot.renderOnly, true);
assert.equal(snapshot.deterministic, true);
assert.deepEqual(snapshot.invariants, TERRAIN_CLIMATE_CANONICAL_INVARIANTS);

console.log('[checkTerrainSurfaceClimateExposure] PASS', JSON.stringify({ points: points.length, checksum }));
