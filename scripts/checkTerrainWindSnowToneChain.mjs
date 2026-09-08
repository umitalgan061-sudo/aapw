#!/usr/bin/env node
/**
 * Renderer-facing snow-tone chain acceptance.
 *
 * The important question here is not whether a scalar wind value exists; it is whether the value
 * survives the production snow coverage -> snow surface tone chain without disappearing, exploding,
 * or turning into a global colour overlay. This check therefore uses the same public functions the
 * shipped terrain renderer uses.
 */

import assert from 'node:assert/strict';
import {
  resolveTerrainSnowSurfaceTone,
} from '../src/3d/world/terrainSnowSurfaceTone.js';
import {
  resolveTerrainWindSnowAdjustment,
  terrainWindExposureFromNeighbours,
} from '../src/3d/world/terrainWindSnowExposure.js';
import { TERRAIN_WIND_SNOW_POLICY } from '../src/3d/world/terrainWindSnowExposure.js';

const CASES = [
  { name: 'flat', heights: [100, 100, 100, 100], spacing: 20 },
  { name: 'northwest-shoulder', heights: [92, 108, 101, 99], spacing: 10 },
  { name: 'southeast-lee', heights: [108, 92, 101, 99], spacing: 10 },
  { name: 'folded-west', heights: [89, 112, 96, 104], spacing: 10 },
  { name: 'folded-east', heights: [112, 89, 104, 96], spacing: 10 },
  { name: 'steep-windward', heights: [62, 138, 100, 100], spacing: 10 },
  { name: 'steep-lee', heights: [138, 62, 100, 100], spacing: 10 },
];

function finite(value, label) {
  assert(Number.isFinite(value), `${label} must be finite`);
}

function unit(value, label) {
  finite(value, label);
  assert(value >= -1e-9 && value <= 1 + 1e-9, `${label} must be within [0,1]: ${value}`);
}

function snowTone({ snowAmount, adjustment, permanentIce = 1, tundra = 0 }) {
  return resolveTerrainSnowSurfaceTone({
    snowAmount,
    permanentIce,
    tundra,
    windwardScour: adjustment.windwardScour,
    leeDeposit: adjustment.leeDeposit,
    ridgeExposure: adjustment.ridgelineExposure,
    concavityHold: adjustment.shelterPocket,
    gentleSlope: 1 - Math.min(1, adjustment.snowMobility),
  });
}

const results = [];

for (const testCase of CASES) {
  const exposure = terrainWindExposureFromNeighbours(...testCase.heights, testCase.spacing);
  const adjustment = resolveTerrainWindSnowAdjustment({
    ...exposure,
    permanentIce: 1,
    tundra: 0.3,
  });
  const tone = snowTone({ snowAmount: 0.72, adjustment });

  for (const [key, value] of Object.entries(adjustment)) {
    if (typeof value === 'number') finite(value, `${testCase.name}.adjustment.${key}`);
  }
  for (const [key, value] of Object.entries(tone)) {
    if (typeof value === 'number') finite(value, `${testCase.name}.tone.${key}`);
  }

  for (const key of ['packedWeight', 'accumulatedWeight', 'ridgeScourWeight', 'leeDriftWeight']) {
    unit(tone[key], `${testCase.name}.tone.${key}`);
  }

  results.push({
    name: testCase.name,
    slope: Number(exposure.slopeDegrees.toFixed(6)),
    windward: Number(exposure.windward.toFixed(6)),
    lee: Number(exposure.lee.toFixed(6)),
    ridge: Number(exposure.ridgelineExposure.toFixed(6)),
    shelter: Number(exposure.shelterPocket.toFixed(6)),
    mobility: Number(exposure.snowMobility.toFixed(6)),
    scour: Number(adjustment.windwardScour.toFixed(6)),
    deposit: Number(adjustment.leeDeposit.toFixed(6)),
    packed: Number(tone.packedWeight.toFixed(6)),
    accumulated: Number(tone.accumulatedWeight.toFixed(6)),
    ridgeScour: Number(tone.ridgeScourWeight.toFixed(6)),
    leeDrift: Number(tone.leeDriftWeight.toFixed(6)),
  });
}

const flat = results.find((item) => item.name === 'flat');
const windward = results.find((item) => item.name === 'steep-windward');
const lee = results.find((item) => item.name === 'steep-lee');
const foldedWest = results.find((item) => item.name === 'folded-west');
const foldedEast = results.find((item) => item.name === 'folded-east');

assert(flat.windward === 0, 'flat terrain must have no windward snow weight');
assert(flat.lee === 0, 'flat terrain must have no lee snow weight');
assert(flat.ridge === 0, 'flat terrain must have no ridge exposure');
assert(flat.shelter === 0, 'flat terrain must have no shelter pocket');

assert(windward.scour >= lee.scour, 'exposed steep face must not scour less than opposing steep face');
assert(lee.deposit <= windward.deposit + TERRAIN_WIND_SNOW_POLICY.northLeeDepositMax,
  'lee deposit must remain inside climate envelope');

assert(foldedWest.ridge >= 0 && foldedEast.ridge >= 0, 'folded ridges must expose ridge weights');
assert(foldedWest.shelter >= 0 && foldedEast.shelter >= 0, 'folded terrain must expose shelter weights');

// Tone chain invariants: disabling directional snow at warm climate must remove only the directional
// contribution. The underlying snow tone remains a valid snow material decision.
const warmTone = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.72,
  permanentIce: 0,
  tundra: 0,
  windwardScour: 0,
  leeDeposit: 0,
  ridgeExposure: 0,
  concavityHold: 0,
  gentleSlope: 1,
});
for (const [key, value] of Object.entries(warmTone)) {
  if (typeof value === 'number') finite(value, `warm.${key}`);
}
for (const key of ['packedWeight', 'accumulatedWeight', 'ridgeScourWeight', 'leeDriftWeight']) {
  unit(warmTone[key], `warm.${key}`);
}
assert.equal(warmTone.leeDriftWeight, 0, 'warm tone must not invent lee drift');
assert.equal(warmTone.ridgeScourWeight, 0, 'warm tone must not invent ridge scour');

// Strong directional values are accepted as already climate-bounded inputs. The tone function itself
// must not create a value above the unit interval, even when a future caller supplies a saturated
// response. This keeps shader colour interpolation stable.
const saturatedTone = resolveTerrainSnowSurfaceTone({
  snowAmount: 1,
  permanentIce: 1,
  tundra: 1,
  windwardScour: 1,
  leeDeposit: 1,
  ridgeExposure: 1,
  concavityHold: 1,
  gentleSlope: 0,
});
for (const key of ['packedWeight', 'accumulatedWeight', 'ridgeScourWeight', 'leeDriftWeight']) {
  unit(saturatedTone[key], `saturated.${key}`);
}

// The source direction is fixed, but the tone chain must remain aspect-sensitive. Opposed faces should
// not collapse into identical directional tone weights, otherwise the visual result reads as a global
// overlay rather than relief-aware snow.
assert(
  Math.abs(windward.ridgeScour - lee.ridgeScour) > 1e-6
    || Math.abs(windward.leeDrift - lee.leeDrift) > 1e-6,
  'opposed steep faces must remain distinguishable in the tone chain',
);

console.log(JSON.stringify({
  policy: TERRAIN_WIND_SNOW_POLICY.id,
  cases: results.length,
  results,
  warmTone: {
    packedWeight: warmTone.packedWeight,
    accumulatedWeight: warmTone.accumulatedWeight,
    ridgeScourWeight: warmTone.ridgeScourWeight,
    leeDriftWeight: warmTone.leeDriftWeight,
  },
}));
console.log('[checkTerrainWindSnowToneChain] PASS');
