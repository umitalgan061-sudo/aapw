#!/usr/bin/env node
/**
 * Numerical edge-case guard for the production wind/snow response.
 *
 * These cases are intentionally orthogonal to the large relief sweep: they target malformed but
 * representable numeric inputs that can appear at chunk boundaries, from imported terrain heights,
 * or during LOD resampling. The production helper must fail closed into finite bounded values rather
 * than emitting NaN/Infinity or accidental snow authority.
 */

import assert from 'node:assert/strict';
import {
  TERRAIN_WIND_SNOW_POLICY,
  resolveTerrainWindSnowAdjustment,
  terrainWindExposureFromNeighbours,
} from '../src/3d/world/terrainWindSnowExposure.js';

function finiteRecord(record, label) {
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'number') {
      assert(Number.isFinite(value), `${label}.${key} must be finite`);
    }
  }
}

function bounded01(value, label) {
  assert(Number.isFinite(value), `${label} must be finite`);
  assert(value >= -1e-9 && value <= 1 + 1e-9, `${label} outside [0,1]: ${value}`);
}

const stencils = [
  { name: 'all-zero', values: [0, 0, 0, 0, 16] },
  { name: 'huge-positive', values: [1e9 - 500, 1e9 + 500, 1e9 - 250, 1e9 + 250, 500] },
  { name: 'huge-negative', values: [-1e9 + 500, -1e9 - 500, -1e9 + 250, -1e9 - 250, 500] },
  { name: 'mixed-extreme', values: [1e12, -1e12, 1e12 - 300, -1e12 + 300, 32] },
  { name: 'tiny-relief', values: [100, 100.000001, 100, 99.999999, 0.25] },
  { name: 'zero-spacing', values: [10, 20, 30, 40, 0] },
  { name: 'negative-spacing', values: [10, 20, 30, 40, -25] },
  { name: 'nan-safe-finite-source', values: [0, 0, 0, 0, Number.MIN_VALUE] },
  { name: 'large-spacing', values: [0, 10000, -10000, 5000, 1e9] },
];

const signatures = [];
for (const item of stencils) {
  const exposure = terrainWindExposureFromNeighbours(...item.values);
  finiteRecord(exposure, item.name);
  for (const key of [
    'slopeAspectStrength',
    'windwardScourSlope',
    'leeCollection',
    'leeRetention',
    'orographicFoldStrength',
    'leeShelterStrength',
    'channelingWeight',
    'windwardAlignment',
    'leeAlignment',
    'windward',
    'lee',
    'ridgelineExposure',
    'shelterPocket',
    'snowMobility',
    'crustScour',
    'packGain',
  ]) {
    bounded01(exposure[key], `${item.name}.${key}`);
  }
  bounded01((exposure.aspectDot + 1) / 2, `${item.name}.aspectDotNormalized`);
  assert(Math.abs(Math.hypot(exposure.effectiveSourceX, exposure.effectiveSourceZ) - 1) < 1e-8,
    `${item.name}.effective source must be normalized`);

  const neutral = resolveTerrainWindSnowAdjustment({
    windward: exposure.windward,
    lee: exposure.lee,
    permanentIce: 0,
    tundra: 0,
  });
  finiteRecord(neutral, `${item.name}.neutral`);
  assert.equal(neutral.windwardScour, 0, `${item.name} temperate scour must be zero`);
  assert.equal(neutral.leeDeposit, 0, `${item.name} temperate deposit must be zero`);

  const strongest = resolveTerrainWindSnowAdjustment({
    ...exposure,
    permanentIce: 1,
    tundra: 1,
  });
  finiteRecord(strongest, `${item.name}.strongest`);
  bounded01(strongest.windwardScour, `${item.name}.strongest.windwardScour`);
  bounded01(strongest.leeDeposit, `${item.name}.strongest.leeDeposit`);
  assert(strongest.windwardScour <= TERRAIN_WIND_SNOW_POLICY.northWindwardScourMax + 1e-9,
    `${item.name} scour ceiling exceeded`);
  assert(strongest.leeDeposit <= TERRAIN_WIND_SNOW_POLICY.northLeeDepositMax + 1e-9,
    `${item.name} deposit ceiling exceeded`);

  signatures.push({
    name: item.name,
    slope: Number(exposure.slopeDegrees.toFixed(6)),
    fold: Number(exposure.orographicFoldStrength.toFixed(6)),
    windward: Number(exposure.windward.toFixed(6)),
    lee: Number(exposure.lee.toFixed(6)),
    scour: Number(strongest.windwardScour.toFixed(6)),
    deposit: Number(strongest.leeDeposit.toFixed(6)),
  });
}

// Climate values outside the nominal [0,1] range are clamped, not allowed to magnify the response.
const clampedLow = resolveTerrainWindSnowAdjustment({
  windward: 1,
  lee: 1,
  permanentIce: -3,
  tundra: -9,
});
assert.equal(clampedLow.windwardScour, 0, 'negative climate weights must clamp to zero scour');
assert.equal(clampedLow.leeDeposit, 0, 'negative climate weights must clamp to zero deposit');

const clampedHigh = resolveTerrainWindSnowAdjustment({
  windward: 1,
  lee: 1,
  permanentIce: 4,
  tundra: 9,
});
assert(clampedHigh.windwardScour <= TERRAIN_WIND_SNOW_POLICY.northWindwardScourMax + 1e-9,
  'oversized ice weight must not exceed north scour ceiling');
assert(clampedHigh.leeDeposit <= TERRAIN_WIND_SNOW_POLICY.northLeeDepositMax + 1e-9,
  'oversized ice weight must not exceed north deposit ceiling');

// Fully saturated directional inputs remain stable and do not turn helper output into a multiplier
// larger than one. This is a common failure mode after a policy handoff or shader reparameterization.
const saturated = resolveTerrainWindSnowAdjustment({
  windward: 999,
  lee: 999,
  ridgelineExposure: 999,
  shelterPocket: 999,
  snowMobility: 999,
  crustScour: 999,
  packGain: 999,
  permanentIce: 999,
  tundra: 999,
});
bounded01(saturated.windwardScour, 'saturated.windwardScour');
bounded01(saturated.leeDeposit, 'saturated.leeDeposit');
assert(saturated.windwardScour <= TERRAIN_WIND_SNOW_POLICY.northWindwardScourMax + 1e-9,
  'saturated scour must remain climate-bounded');
assert(saturated.leeDeposit <= TERRAIN_WIND_SNOW_POLICY.northLeeDepositMax + 1e-9,
  'saturated deposit must remain climate-bounded');

console.log(JSON.stringify({
  policy: TERRAIN_WIND_SNOW_POLICY.id,
  cases: signatures.length,
  signatures,
  saturation: {
    scour: saturated.windwardScour,
    deposit: saturated.leeDeposit,
  },
}));
console.log('[checkTerrainWindSnowEdgeCases] PASS');
