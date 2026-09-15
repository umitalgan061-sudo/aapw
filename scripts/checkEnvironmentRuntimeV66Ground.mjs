import assert from 'node:assert/strict';
import { buildGroundMaterialResponseV66, computeGroundRoleWeightsV66, buildGroundBiomePaletteV66, validateGroundResponseV66 } from '../src/3d/world/environmentRuntimeGroundResponseV66.js';

const biomes = ['forest', 'taiga', 'wetland', 'alpine', 'tundra', 'steppe', 'grassland', 'desert', 'coastal'];
const sample = { x: 120, z: 240, elevation: 680, slope: 14, moisture: 0.64, snow: 0.06, wetness: 0.18, rockExposure: 0.16, soilDepth: 0.7, traffic: 0.12, biome: 'forest' };
const weather = { precipitation: 0.34, humidity: 0.74, temperature: 0.34 };

const response = buildGroundMaterialResponseV66(sample, weather, { distance: 780 });
assert.equal(validateGroundResponseV66(response).ok, true);
assert.ok(response.pbr.microNormal > 0);
assert.ok(response.lumaFloor >= 0.08);
assert.ok(response.roles.grass + response.roles.soil + response.roles.mud + response.roles.rock + response.roles.snow + response.roles.wet > 0.99);

const steep = buildGroundMaterialResponseV66({ ...sample, slope: 48, rockExposure: 0.66, snow: 0.5 }, { ...weather, precipitation: 0.12 }, { distance: 120 });
assert.equal(steep.triplanarEquivalent, true);
assert.ok(steep.roles.rock > response.roles.rock);
assert.ok(steep.snowlineBreakup > 0);

const far = buildGroundMaterialResponseV66(sample, { ...weather, humidity: 0.9 }, { distance: 3400 });
assert.ok(far.repeat >= 0.8 && far.repeat <= 18);
assert.ok(far.detailFade < response.detailFade);

for (const biome of biomes) {
  const palette = buildGroundBiomePaletteV66(biome, weather);
  const total = Object.values(palette).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 0.001, biome);
}

const dry = computeGroundRoleWeightsV66({ ...sample, moisture: 0.04, traffic: 0.7, wetness: 0.02 }, { precipitation: 0.02, temperature: 0.82 });
const wet = computeGroundRoleWeightsV66({ ...sample, moisture: 0.92, traffic: 0.02, wetness: 0.88 }, { precipitation: 0.92, humidity: 0.98, temperature: 0.22 });
assert.ok(wet.mud > dry.mud);
assert.ok(dry.soil > sample.traffic * 0.1);
console.log(JSON.stringify({ ok: true, suite: 'v66-ground', biomeCount: biomes.length }));
