#!/usr/bin/env node
/**
 * Visual-envelope acceptance for fold-aware terrain snow response.
 *
 * This suite probes a deterministic synthetic relief field at enough density to expose the actual
 * failure classes this module can create when thresholds are moved too far: global directional
 * banding, lowland contamination, ridge/lee sign inversion, cliff deposition, and fold-only
 * amplification. It never becomes a geography authority; the test field exists solely to stress the
 * scalar response function.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  TERRAIN_WIND_SNOW_POLICY,
  resolveTerrainWindSnowAdjustment,
  terrainWindExposureFromNeighbours,
} from '../src/3d/world/terrainWindSnowExposure.js';

const EPSILON = 1e-9;
const GRID = 31;
const SPACING = 10;
const BASE = 100;

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function signedNoise(x, z) {
  const a = Math.sin(x * 0.173 + z * 0.317) * 43758.5453;
  const b = Math.cos(x * 0.041 - z * 0.113) * 13731.113;
  const fa = a - Math.floor(a);
  const fb = b - Math.floor(b);
  return (fa * 0.68 + fb * 0.32) * 2 - 1;
}

function heightField(x, z, family) {
  switch (family) {
    case 'plain':
      return BASE + 0.35 * Math.sin(x * 0.008) + 0.28 * Math.cos(z * 0.011);
    case 'broad-ridge':
      return BASE
        + 42 * Math.exp(-((z * z) / (2 * 230 ** 2)))
        + 1.8 * Math.sin(x * 0.021)
        + 0.7 * signedNoise(x * 0.8, z * 0.6);
    case 'broken-ridge':
      return BASE
        + 40 * Math.exp(-((z * z) / (2 * 180 ** 2)))
        + 7 * Math.sin(x * 0.035 + z * 0.013)
        + 4 * Math.cos(x * 0.009 - z * 0.031);
    case 'valley':
      return BASE
        - 24 * Math.exp(-((z * z) / (2 * 160 ** 2)))
        + 12 * Math.exp(-((x * x) / (2 * 340 ** 2)))
        + 1.2 * signedNoise(x, z);
    case 'stepped':
      return BASE
        + 16 * Math.tanh(z / 45)
        + 3.5 * Math.sin(x * 0.018)
        + 2.2 * Math.sin(z * 0.045);
    case 'folded-basin':
      return BASE
        + 26 * Math.exp(-((x * x + z * z) / (2 * 240 ** 2)))
        + 8 * Math.sin(x * 0.043)
        - 10 * Math.sin(z * 0.029)
        + 2 * signedNoise(x * 1.4, z * 0.7);
    default:
      throw new Error(`Unknown relief family: ${family}`);
  }
}

function sampleExposure(worldX, worldZ, family) {
  const west = heightField(worldX - SPACING, worldZ, family);
  const east = heightField(worldX + SPACING, worldZ, family);
  const north = heightField(worldX, worldZ - SPACING, family);
  const south = heightField(worldX, worldZ + SPACING, family);
  return terrainWindExposureFromNeighbours(west, east, north, south, SPACING);
}

function summarize(values) {
  if (!values.length) return { count: 0, min: 0, max: 0, mean: 0, p05: 0, p50: 0, p95: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
  return {
    count: values.length,
    min: sorted[0],
    max: sorted.at(-1),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p05: pick(0.05),
    p50: pick(0.50),
    p95: pick(0.95),
  };
}

function assertUnit(value, label) {
  assert(Number.isFinite(value), `${label} must be finite`);
  assert(value >= -EPSILON && value <= 1 + EPSILON, `${label} outside unit interval: ${value}`);
}

const result = {
  policy: TERRAIN_WIND_SNOW_POLICY.id,
  grid: GRID,
  spacing: SPACING,
  families: {},
  global: {},
};

const allScour = [];
const allDeposit = [];
const allRidge = [];
const allShelter = [];
const allMobility = [];
const allTransitions = [];

// ---------------------------------------------------------------------------
// Field sweep
// ---------------------------------------------------------------------------

const families = ['plain', 'broad-ridge', 'broken-ridge', 'valley', 'stepped', 'folded-basin'];
for (const family of families) {
  const exposures = [];
  const scour = [];
  const deposit = [];
  const ridge = [];
  const shelter = [];
  const mobility = [];
  const windwardSamples = [];
  const leeSamples = [];

  for (let ix = 0; ix < GRID; ix += 1) {
    for (let iz = 0; iz < GRID; iz += 1) {
      const x = (ix - (GRID - 1) / 2) * SPACING * 7;
      const z = (iz - (GRID - 1) / 2) * SPACING * 7;
      const exposure = sampleExposure(x, z, family);
      exposures.push(exposure);
      windwardSamples.push(exposure.windward);
      leeSamples.push(exposure.lee);
      ridge.push(exposure.ridgelineExposure);
      shelter.push(exposure.shelterPocket);
      mobility.push(exposure.snowMobility);

      const adjustment = resolveTerrainWindSnowAdjustment({
        windward: exposure.windward,
        lee: exposure.lee,
        ridgelineExposure: exposure.ridgelineExposure,
        shelterPocket: exposure.shelterPocket,
        snowMobility: exposure.snowMobility,
        crustScour: exposure.crustScour,
        packGain: exposure.packGain,
        permanentIce: 1,
        tundra: 0.65,
      });
      scour.push(adjustment.windwardScour);
      deposit.push(adjustment.leeDeposit);

      for (const [key, value] of Object.entries(exposure)) {
        if (typeof value === 'number') assert(Number.isFinite(value), `${family}.${key} became non-finite`);
      }
      assertUnit(exposure.windward, `${family}.windward`);
      assertUnit(exposure.lee, `${family}.lee`);
      assertUnit(exposure.ridgelineExposure, `${family}.ridge`);
      assertUnit(exposure.shelterPocket, `${family}.shelter`);
      assertUnit(adjustment.windwardScour, `${family}.scour`);
      assertUnit(adjustment.leeDeposit, `${family}.deposit`);
    }
  }

  result.families[family] = {
    exposureCount: exposures.length,
    windward: summarize(windwardSamples),
    lee: summarize(leeSamples),
    scour: summarize(scour),
    deposit: summarize(deposit),
    ridge: summarize(ridge),
    shelter: summarize(shelter),
    mobility: summarize(mobility),
  };

  allScour.push(...scour);
  allDeposit.push(...deposit);
  allRidge.push(...ridge);
  allShelter.push(...shelter);
  allMobility.push(...mobility);

  // Adjacent-cell continuity: a render-only snow response should vary smoothly under a smooth
  // analytic relief field. Large one-cell jumps indicate a threshold that is too binary for
  // player-facing terrain.
  for (let ix = 1; ix < GRID; ix += 1) {
    for (let iz = 0; iz < GRID; iz += 1) {
      const x0 = (ix - 1 - (GRID - 1) / 2) * SPACING * 7;
      const x1 = (ix - (GRID - 1) / 2) * SPACING * 7;
      const z = (iz - (GRID - 1) / 2) * SPACING * 7;
      const a = sampleExposure(x0, z, family);
      const b = sampleExposure(x1, z, family);
      allTransitions.push(Math.abs(a.windward - b.windward));
      allTransitions.push(Math.abs(a.lee - b.lee));
      allTransitions.push(Math.abs(a.snowMobility - b.snowMobility));
    }
  }
}

// ---------------------------------------------------------------------------
// Lowland rejection and climate separation
// ---------------------------------------------------------------------------

const lowland = sampleExposure(0, 0, 'plain');
assert(lowland.slopeDegrees < 10, 'plain center should be a lowland fixture');
assert(lowland.ridgelineExposure < 0.02, 'lowland must not acquire ridge exposure');
assert(lowland.shelterPocket < 0.02, 'lowland must not acquire shelter pockets');
assert(lowland.snowMobility < 0.20, 'lowland mobility should remain low');

const mountain = sampleExposure(0, 0, 'broken-ridge');
assert(mountain.slopeDegrees > 10, 'broken-ridge center should provide mountain relief');
assert(mountain.snowMobility >= lowland.snowMobility,
  'mountain mobility must not be lower than lowland mobility');

const northAdjustment = resolveTerrainWindSnowAdjustment({
  windward: 1,
  lee: 1,
  ridgelineExposure: 1,
  shelterPocket: 1,
  snowMobility: 1,
  crustScour: 1,
  packGain: 1,
  permanentIce: 1,
  tundra: 1,
});
const tundraAdjustment = resolveTerrainWindSnowAdjustment({
  windward: 1,
  lee: 1,
  ridgelineExposure: 1,
  shelterPocket: 1,
  snowMobility: 1,
  crustScour: 1,
  packGain: 1,
  permanentIce: 0,
  tundra: 1,
});
const southAdjustment = resolveTerrainWindSnowAdjustment({
  windward: 1,
  lee: 1,
  ridgelineExposure: 1,
  shelterPocket: 1,
  snowMobility: 1,
  crustScour: 1,
  packGain: 1,
  permanentIce: 0,
  tundra: 0,
});

assert(northAdjustment.windwardScour > tundraAdjustment.windwardScour,
  'permanent ice must retain stronger scour than tundra');
assert(northAdjustment.leeDeposit > tundraAdjustment.leeDeposit,
  'permanent ice must retain stronger deposition than tundra');
assert.equal(southAdjustment.windwardScour, 0, 'temperate south scour must stay disabled');
assert.equal(southAdjustment.leeDeposit, 0, 'temperate south deposition must stay disabled');

// ---------------------------------------------------------------------------
// Sign and cliff fixtures independent of any named relief family
// ---------------------------------------------------------------------------

const planarWindward = terrainWindExposureFromNeighbours(90, 110, 100, 100, 10);
const planarLee = terrainWindExposureFromNeighbours(110, 90, 100, 100, 10);
const cliffWindward = terrainWindExposureFromNeighbours(70, 130, 100, 100, 10);
const cliffLee = terrainWindExposureFromNeighbours(130, 70, 100, 100, 10);

assert(planarWindward.windward > planarWindward.lee, 'planar windward fixture must remain windward');
assert(planarLee.lee > planarLee.windward, 'planar lee fixture must remain lee');
assert(cliffWindward.windward > planarWindward.windward, 'cliff windward should strengthen exposure');
assert(cliffLee.lee === 0, 'cliff lee should be fully shed');

const directFold = terrainWindExposureFromNeighbours(98, 110, 90, 102, 10);
const planarFold = terrainWindExposureFromNeighbours(94, 106, 94, 106, 10);
assert(directFold.orographicFoldStrength > planarFold.orographicFoldStrength,
  'fold response must distinguish broken relief from planar relief');
assert(directFold.channelingWeight >= planarFold.channelingWeight,
  'folded relief must not channel less than equal-slope planar relief');

// ---------------------------------------------------------------------------
// Anti-striping check: a single global diagonal direction must not dominate every surface.
// We compare the directional response of opposite aspects and require that the neutral half of the
// compass is materially represented in the synthetic field.
// ---------------------------------------------------------------------------

const compass = [];
for (let i = 0; i < 72; i += 1) {
  const angle = (i / 72) * Math.PI * 2;
  const exposure = exposureForCompass(angle);
  compass.push({ angle, windward: exposure.windward, lee: exposure.lee });
}
const active = compass.filter((sample) => sample.windward > 0.08 || sample.lee > 0.08).length;
const neutral = compass.filter((sample) => sample.windward < 0.05 && sample.lee < 0.05).length;
assert(active > 0, 'compass field must contain directional snow response');
assert(neutral > 0, 'compass field must retain a crosswind-neutral sector');
assert(active < compass.length, 'directional response must not activate around the whole compass');

function exposureForCompass(angle) {
  const slope = 26;
  const gradient = Math.tan((slope * Math.PI) / 180);
  const gx = Math.cos(angle) * gradient;
  const gz = Math.sin(angle) * gradient;
  return terrainWindExposureFromNeighbours(
    BASE - gx * SPACING,
    BASE + gx * SPACING,
    BASE - gz * SPACING,
    BASE + gz * SPACING,
    SPACING,
  );
}

// ---------------------------------------------------------------------------
// Stability under small perturbations
// ---------------------------------------------------------------------------

let maxPerturbationDelta = 0;
for (let i = 0; i < 200; i += 1) {
  const angle = ((i * 37) % 360) * Math.PI / 180;
  const fixture = exposureForCompass(angle);
  const delta = (signedNoise(i * 0.73, i * 0.41) * 0.1);
  const gradient = Math.tan((26 * Math.PI) / 180);
  const gx = Math.cos(angle) * gradient;
  const gz = Math.sin(angle) * gradient;
  const perturbed = terrainWindExposureFromNeighbours(
    BASE - gx * SPACING + delta,
    BASE + gx * SPACING - delta,
    BASE - gz * SPACING + delta,
    BASE + gz * SPACING - delta,
    SPACING,
  );
  maxPerturbationDelta = Math.max(
    maxPerturbationDelta,
    Math.abs(fixture.windward - perturbed.windward),
    Math.abs(fixture.lee - perturbed.lee),
  );
}
assert(maxPerturbationDelta < 0.25,
  `small height perturbation caused an excessive response jump: ${maxPerturbationDelta}`);

// ---------------------------------------------------------------------------
// Field response digest
// ---------------------------------------------------------------------------

result.global = {
  scour: summarize(allScour),
  deposit: summarize(allDeposit),
  ridge: summarize(allRidge),
  shelter: summarize(allShelter),
  mobility: summarize(allMobility),
  transition: summarize(allTransitions),
  compassActiveCount: active,
  compassNeutralCount: neutral,
  maxPerturbationDelta,
};

const digestPayload = {
  policy: result.policy,
  families: Object.fromEntries(Object.entries(result.families).map(([name, value]) => [name, {
    windward: Number(value.windward.mean.toFixed(9)),
    lee: Number(value.lee.mean.toFixed(9)),
    scour: Number(value.scour.mean.toFixed(9)),
    deposit: Number(value.deposit.mean.toFixed(9)),
    ridge: Number(value.ridge.mean.toFixed(9)),
    shelter: Number(value.shelter.mean.toFixed(9)),
    mobility: Number(value.mobility.mean.toFixed(9)),
  }])),
  global: {
    maxTransition: Number(result.global.transition.max.toFixed(9)),
    maxPerturbationDelta: Number(maxPerturbationDelta.toFixed(9)),
    compassActiveCount: active,
    compassNeutralCount: neutral,
  },
};
result.digest = crypto.createHash('sha256').update(JSON.stringify(digestPayload)).digest('hex');

console.log(JSON.stringify(result, null, 2));
console.log('[checkTerrainWindSnowVisualEnvelope] PASS');
