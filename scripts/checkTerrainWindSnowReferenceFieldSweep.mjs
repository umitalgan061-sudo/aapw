#!/usr/bin/env node
/**
 * Reference relief sweep for the terrain wind/snow production response.
 *
 * The fixture fields in this file are synthetic stress fields only. They are deliberately never
 * imported by runtime code. Their job is to expose visual failure modes that single hand-authored
 * points cannot see: broad smooth ridges, broken ridge shoulders, saddles, valleys, escarpments,
 * glacier shelves, lowland transition bands and irregular mountain bowls.
 *
 * Every probe is evaluated through the real production exports. Assertions focus on boundedness,
 * sign, continuity, climate separation and landform sensitivity. This is a visual-envelope contract,
 * not a second geography implementation.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  TERRAIN_WIND_SNOW_POLICY,
  resolveTerrainWindSnowAdjustment,
  terrainWindExposureFromNeighbours,
} from '../src/3d/world/terrainWindSnowExposure.js';

const BASE = 100;
const SPACING = 8;
const EPSILON = 1e-9;
const GRID_RADIUS = 18;
const STEP = 16;

const RELIEF_PROFILES = Object.freeze([
  {
    id: 'smooth-plain',
    height(x, z) {
      return BASE + 0.22 * Math.sin(x * 0.017) + 0.18 * Math.cos(z * 0.013);
    },
    expectedSlopeMax: 8,
    expectedFoldMax: 0.12,
  },
  {
    id: 'broad-shoulder',
    height(x, z) {
      return BASE
        + 42 * Math.exp(-((z * z) / (2 * 300 ** 2)))
        + 1.2 * Math.sin(x * 0.018)
        + 0.45 * Math.cos(z * 0.027);
    },
    expectedSlopeMax: 35,
    expectedFoldMax: 0.36,
  },
  {
    id: 'broken-shoulder',
    height(x, z) {
      return BASE
        + 38 * Math.exp(-((z * z) / (2 * 210 ** 2)))
        + 5.0 * Math.sin(x * 0.024 + z * 0.009)
        + 3.2 * Math.sin(z * 0.037)
        + 1.1 * Math.cos(x * 0.061 - z * 0.023);
    },
    expectedSlopeMax: 55,
    expectedFoldMax: 2.2,
  },
  {
    id: 'saddle',
    height(x, z) {
      return BASE + 0.08 * x * x / 100 + 0.08 * z * z / 100 - 0.0048 * x * z;
    },
    expectedSlopeMax: 75,
    expectedFoldMax: 1.7,
  },
  {
    id: 'valley',
    height(x, z) {
      return BASE
        - 28 * Math.exp(-((z * z) / (2 * 145 ** 2)))
        + 0.8 * Math.sin(x * 0.019)
        + 0.5 * Math.cos(z * 0.031);
    },
    expectedSlopeMax: 40,
    expectedFoldMax: 0.75,
  },
  {
    id: 'escarpment',
    height(x, z) {
      return BASE + 28 * Math.tanh(z / 38) + 3.1 * Math.sin(x * 0.021);
    },
    expectedSlopeMax: 55,
    expectedFoldMax: 1.8,
  },
  {
    id: 'glacier-shelf',
    height(x, z) {
      return BASE
        + 34 * Math.exp(-((z * z) / (2 * 260 ** 2)))
        - 4.5 * Math.exp(-(((z - 120) ** 2) / (2 * 70 ** 2)))
        + 1.4 * Math.sin(x * 0.015);
    },
    expectedSlopeMax: 38,
    expectedFoldMax: 1.4,
  },
  {
    id: 'mountain-bowl',
    height(x, z) {
      const radius = Math.hypot(x, z);
      return BASE
        + 31 * Math.exp(-((radius * radius) / (2 * 260 ** 2)))
        - 8 * Math.exp(-(((radius - 170) ** 2) / (2 * 36 ** 2)))
        + 5.5 * Math.sin(x * 0.029)
        + 2.3 * Math.cos(z * 0.041);
    },
    expectedSlopeMax: 60,
    expectedFoldMax: 2.4,
  },
  {
    id: 'windward-buttress',
    height(x, z) {
      return BASE
        + 26 * Math.exp(-(((x + 180) ** 2) / (2 * 80 ** 2)))
        + 12 * Math.exp(-(((z - 60) ** 2) / (2 * 120 ** 2)))
        + 4 * Math.sin(z * 0.028);
    },
    expectedSlopeMax: 62,
    expectedFoldMax: 2.3,
  },
  {
    id: 'lee-amphitheatre',
    height(x, z) {
      return BASE
        + 23 * Math.exp(-(((x - 120) ** 2 + (z + 90) ** 2) / (2 * 130 ** 2)))
        - 14 * Math.exp(-(((x - 80) ** 2 + (z + 20) ** 2) / (2 * 45 ** 2)))
        + 2.4 * Math.sin(x * 0.022 - z * 0.015);
    },
    expectedSlopeMax: 58,
    expectedFoldMax: 2.0,
  },
]);

function exposureAt(profile, x, z) {
  return terrainWindExposureFromNeighbours(
    profile.height(x - SPACING, z),
    profile.height(x + SPACING, z),
    profile.height(x, z - SPACING),
    profile.height(x, z + SPACING),
    SPACING,
  );
}

function adjustmentAt(profile, x, z, climate = { permanentIce: 1, tundra: 0.35 }) {
  const exposure = exposureAt(profile, x, z);
  return resolveTerrainWindSnowAdjustment({
    ...exposure,
    ...climate,
  });
}

function close(a, b, epsilon = EPSILON) {
  return Math.abs(a - b) <= epsilon;
}

function unit(value, label) {
  assert(Number.isFinite(value), `${label} must be finite`);
  assert(value >= -EPSILON && value <= 1 + EPSILON, `${label} outside [0,1]: ${value}`);
}

function signedUnit(value, label) {
  assert(Number.isFinite(value), `${label} must be finite`);
  assert(value >= -1 - EPSILON && value <= 1 + EPSILON, `${label} outside [-1,1]: ${value}`);
}

function assertExposure(exposure, label) {
  for (const [key, value] of Object.entries(exposure)) {
    if (typeof value === 'number') assert(Number.isFinite(value), `${label}.${key} non-finite`);
  }
  unit(exposure.windward, `${label}.windward`);
  unit(exposure.lee, `${label}.lee`);
  unit(exposure.windwardAlignment, `${label}.windwardAlignment`);
  unit(exposure.leeAlignment, `${label}.leeAlignment`);
  unit(exposure.orographicFoldStrength, `${label}.orographicFoldStrength`);
  unit(exposure.ridgelineExposure, `${label}.ridgelineExposure`);
  unit(exposure.shelterPocket, `${label}.shelterPocket`);
  unit(exposure.snowMobility, `${label}.snowMobility`);
  unit(exposure.crustScour, `${label}.crustScour`);
  unit(exposure.packGain, `${label}.packGain`);
  signedUnit(exposure.aspectDot, `${label}.aspectDot`);
  signedUnit(exposure.effectiveSourceX, `${label}.effectiveSourceX`);
  signedUnit(exposure.effectiveSourceZ, `${label}.effectiveSourceZ`);
  assert(close(Math.hypot(exposure.effectiveSourceX, exposure.effectiveSourceZ), 1, 1e-8),
    `${label}.effectiveSource must stay normalized`);
}

function assertAdjustment(adjustment, label, climate) {
  unit(adjustment.windwardScour, `${label}.windwardScour`);
  unit(adjustment.leeDeposit, `${label}.leeDeposit`);
  unit(adjustment.scourProfile, `${label}.scourProfile`);
  unit(adjustment.depositProfile, `${label}.depositProfile`);
  const ice = Math.max(0, Math.min(1, climate.permanentIce ?? 0));
  const tundraBand = Math.max(0, Math.min(1, climate.tundra ?? 0)) * (1 - ice);
  const scourCeiling = Math.max(
    ice * TERRAIN_WIND_SNOW_POLICY.northWindwardScourMax,
    tundraBand * TERRAIN_WIND_SNOW_POLICY.tundraWindwardScourMax,
  );
  const depositCeiling = Math.max(
    ice * TERRAIN_WIND_SNOW_POLICY.northLeeDepositMax,
    tundraBand * TERRAIN_WIND_SNOW_POLICY.tundraLeeDepositMax,
  );
  assert(adjustment.windwardScour <= scourCeiling + EPSILON,
    `${label}.windwardScour exceeded climate ceiling`);
  assert(adjustment.leeDeposit <= depositCeiling + EPSILON,
    `${label}.leeDeposit exceeded climate ceiling`);
}

const digestRows = [];
const aggregate = {
  exposureSamples: 0,
  adjustments: 0,
  neutralSamples: 0,
  directionalSamples: 0,
  maxContinuityStep: 0,
  maxPerturbation: 0,
  maxFoldStrength: 0,
  maxRidgeExposure: 0,
  maxShelterPocket: 0,
};

// Dense multi-profile scan. The 37x37 grid gives enough spatial support to detect a response that
// looks reasonable at one point but becomes a broad artificial stripe or hard threshold at map scale.
for (const profile of RELIEF_PROFILES) {
  let profileNeutral = 0;
  let profileDirectional = 0;
  let profileMaxStep = 0;
  let profileMaxPerturbation = 0;
  let profileMaxFold = 0;
  let profileMaxRidge = 0;
  let profileMaxShelter = 0;

  const samples = [];
  for (let ix = -GRID_RADIUS; ix <= GRID_RADIUS; ix += 1) {
    for (let iz = -GRID_RADIUS; iz <= GRID_RADIUS; iz += 1) {
      const x = ix * STEP;
      const z = iz * STEP;
      const exposure = exposureAt(profile, x, z);
      const adjustment = adjustmentAt(profile, x, z);
      assertExposure(exposure, `${profile.id}[${x},${z}]`);
      assertAdjustment(adjustment, `${profile.id}[${x},${z}]`, { permanentIce: 1, tundra: 0.35 });

      aggregate.exposureSamples += 1;
      aggregate.adjustments += 1;
      profileMaxFold = Math.max(profileMaxFold, exposure.orographicFoldStrength);
      profileMaxRidge = Math.max(profileMaxRidge, exposure.ridgelineExposure);
      profileMaxShelter = Math.max(profileMaxShelter, exposure.shelterPocket);

      if (exposure.windward < 0.05 && exposure.lee < 0.05) {
        profileNeutral += 1;
        aggregate.neutralSamples += 1;
      } else {
        profileDirectional += 1;
        aggregate.directionalSamples += 1;
      }

      samples.push({
        x,
        z,
        slope: Number(exposure.slopeDegrees.toFixed(6)),
        fold: Number(exposure.orographicFoldStrength.toFixed(6)),
        windward: Number(exposure.windward.toFixed(6)),
        lee: Number(exposure.lee.toFixed(6)),
        ridge: Number(exposure.ridgelineExposure.toFixed(6)),
        shelter: Number(exposure.shelterPocket.toFixed(6)),
        mobility: Number(exposure.snowMobility.toFixed(6)),
        scour: Number(adjustment.windwardScour.toFixed(6)),
        deposit: Number(adjustment.leeDeposit.toFixed(6)),
      });

      if (ix < GRID_RADIUS) {
        const nextX = (ix + 1) * STEP;
        const next = exposureAt(profile, nextX, z);
        profileMaxStep = Math.max(
          profileMaxStep,
          Math.abs(exposure.windward - next.windward),
          Math.abs(exposure.lee - next.lee),
          Math.abs(exposure.snowMobility - next.snowMobility),
        );
      }

      const perturb = 0.015 * Math.sin(ix * 0.83 + iz * 0.47);
      const perturbed = terrainWindExposureFromNeighbours(
        profile.height(x - SPACING, z) + perturb,
        profile.height(x + SPACING, z) - perturb,
        profile.height(x, z - SPACING) + perturb,
        profile.height(x, z + SPACING) - perturb,
        SPACING,
      );
      profileMaxPerturbation = Math.max(
        profileMaxPerturbation,
        Math.abs(exposure.windward - perturbed.windward),
        Math.abs(exposure.lee - perturbed.lee),
      );
    }
  }

  aggregate.maxContinuityStep = Math.max(aggregate.maxContinuityStep, profileMaxStep);
  aggregate.maxPerturbation = Math.max(aggregate.maxPerturbation, profileMaxPerturbation);
  aggregate.maxFoldStrength = Math.max(aggregate.maxFoldStrength, profileMaxFold);
  aggregate.maxRidgeExposure = Math.max(aggregate.maxRidgeExposure, profileMaxRidge);
  aggregate.maxShelterPocket = Math.max(aggregate.maxShelterPocket, profileMaxShelter);

  assert(profileNeutral > 0, `${profile.id} must retain a neutral response sector`);
  assert(profileDirectional > 0, `${profile.id} must exercise directional snow response`);
  assert(profileMaxStep < 0.65, `${profile.id} response changed too abruptly between adjacent samples`);
  assert(profileMaxPerturbation < 0.30, `${profile.id} is too sensitive to small terrain perturbations`);
  assert(profileMaxFold <= 1 + EPSILON, `${profile.id} fold strength must remain bounded`);
  assert(profileMaxRidge <= 1 + EPSILON, `${profile.id} ridge exposure must remain bounded`);
  assert(profileMaxShelter <= 1 + EPSILON, `${profile.id} shelter pocket must remain bounded`);

  digestRows.push({
    id: profile.id,
    count: samples.length,
    expectedSlopeMax: profile.expectedSlopeMax,
    expectedFoldMax: profile.expectedFoldMax,
    neutral: profileNeutral,
    directional: profileDirectional,
    maxContinuityStep: Number(profileMaxStep.toFixed(8)),
    maxPerturbation: Number(profileMaxPerturbation.toFixed(8)),
    maxFold: Number(profileMaxFold.toFixed(8)),
    maxRidge: Number(profileMaxRidge.toFixed(8)),
    maxShelter: Number(profileMaxShelter.toFixed(8)),
    checksum: crypto.createHash('sha256').update(JSON.stringify(samples)).digest('hex'),
  });
}

// ---------------------------------------------------------------------------
// Climate envelope sweep. Directional snow redistribution should be strongest in permanent ice,
// restrained in tundra and absent in temperate/southern climates.
// ---------------------------------------------------------------------------

for (const profile of RELIEF_PROFILES) {
  const climateSteps = [0, 0.1, 0.2, 0.35, 0.5, 0.7, 0.85, 1];
  let previousScour = 0;
  let previousDeposit = 0;
  for (const permanentIce of climateSteps) {
    const climate = { permanentIce, tundra: 1 };
    const adjustment = adjustmentAt(profile, 80, -112, climate);
    assertAdjustment(adjustment, `${profile.id}.climate[${permanentIce}]`, climate);
    assert(adjustment.windwardScour + EPSILON >= previousScour,
      `${profile.id} scour must be monotone with permanent ice`);
    assert(adjustment.leeDeposit + EPSILON >= previousDeposit,
      `${profile.id} deposit must be monotone with permanent ice`);
    previousScour = adjustment.windwardScour;
    previousDeposit = adjustment.leeDeposit;
  }

  const warm = adjustmentAt(profile, 80, -112, { permanentIce: 0, tundra: 0 });
  assert.equal(warm.windwardScour, 0, `${profile.id} warm climate scour must be zero`);
  assert.equal(warm.leeDeposit, 0, `${profile.id} warm climate deposit must be zero`);

  const ice = adjustmentAt(profile, 80, -112, { permanentIce: 1, tundra: 0 });
  const tundra = adjustmentAt(profile, 80, -112, { permanentIce: 0, tundra: 1 });
  assert(ice.windwardScour >= tundra.windwardScour - EPSILON,
    `${profile.id} permanent ice scour must dominate tundra`);
  assert(ice.leeDeposit >= tundra.leeDeposit - EPSILON,
    `${profile.id} permanent ice deposit must dominate tundra`);
}

// ---------------------------------------------------------------------------
// Canonical translation invariants. Adding a global datum to a local terrain stencil must not change
// its snow response; translating X/Z through the same relief profile is expected to preserve the local
// equations when the profile itself is translated by the corresponding inverse amount.
// ---------------------------------------------------------------------------

for (const profile of RELIEF_PROFILES) {
  const fixture = {
    west: profile.height(0 - SPACING, -64),
    east: profile.height(0 + SPACING, -64),
    north: profile.height(0, -64 - SPACING),
    south: profile.height(0, -64 + SPACING),
  };
  const shifted = Object.fromEntries(Object.entries(fixture).map(([key, value]) => [key, value + 911.375]));
  const a = terrainWindExposureFromNeighbours(fixture.west, fixture.east, fixture.north, fixture.south, SPACING);
  const b = terrainWindExposureFromNeighbours(shifted.west, shifted.east, shifted.north, shifted.south, SPACING);
  for (const key of Object.keys(a)) {
    if (typeof a[key] === 'number') {
      assert(close(a[key], b[key], 1e-9), `${profile.id} datum offset changed ${key}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Prevailing-source compass sweep. This specifically guards the world-scale anti-striping property:
// there must be both directional and neutral aspects at a representative mountain slope.
// ---------------------------------------------------------------------------

const compass = [];
for (let i = 0; i < 144; i += 1) {
  const angle = (i / 144) * Math.PI * 2;
  const slopeDegrees = 28;
  const gradient = Math.tan((slopeDegrees * Math.PI) / 180);
  const gx = Math.cos(angle) * gradient;
  const gz = Math.sin(angle) * gradient;
  const exposure = terrainWindExposureFromNeighbours(
    BASE - gx * SPACING,
    BASE + gx * SPACING,
    BASE - gz * SPACING,
    BASE + gz * SPACING,
    SPACING,
  );
  compass.push(exposure);
}

const compassNeutral = compass.filter((item) => item.windward < 0.05 && item.lee < 0.05).length;
const compassWindward = compass.filter((item) => item.windward > 0.15).length;
const compassLee = compass.filter((item) => item.lee > 0.15).length;
assert(compassNeutral >= 8, 'compass must retain a meaningful neutral crosswind sector');
assert(compassWindward >= 8, 'compass must expose a meaningful windward sector');
assert(compassLee >= 8, 'compass must expose a meaningful lee sector');
assert(compassNeutral < compass.length, 'compass must not become globally neutral');

// Opposite aspects must not both become windward under a fixed source. This catches an accidental
// absolute-value fold or normal-dot bug that would produce symmetric striping.
for (let i = 0; i < compass.length / 2; i += 1) {
  const a = compass[i];
  const b = compass[i + compass.length / 2];
  assert(!(a.windward > 0.20 && b.windward > 0.20), `opposite compass aspects both windward at ${i}`);
  assert(!(a.lee > 0.20 && b.lee > 0.20), `opposite compass aspects both lee at ${i}`);
}

// ---------------------------------------------------------------------------
// Explicit cliff/shoulder fixtures. Lee deposition should fade on near-vertical geometry while
// windward scour may remain active. A steep face must not become a giant powder wall.
// ---------------------------------------------------------------------------

const cliffSlopes = [42, 48, 54, 58, 62, 68, 76];
for (const slopeDegrees of cliffSlopes) {
  const gradient = Math.tan((slopeDegrees * Math.PI) / 180);
  const lee = terrainWindExposureFromNeighbours(
    BASE + gradient * SPACING,
    BASE - gradient * SPACING,
    BASE,
    BASE,
    SPACING,
  );
  assert(lee.slopeDegrees > 35, `cliff fixture ${slopeDegrees} must remain steep`);
  assert(lee.leeRetention >= 0, `cliff fixture ${slopeDegrees} retention must be non-negative`);
  if (slopeDegrees >= TERRAIN_WIND_SNOW_POLICY.leeRetentionFadeFullDegrees + 4) {
    assert.equal(lee.lee, 0, `near-cliff ${slopeDegrees} must have zero lee accumulation weight`);
  }
}

// ---------------------------------------------------------------------------
// Serialize stable evidence metadata. The digest is deliberately based only on rounded scalar output,
// so exact JavaScript object ordering remains stable across Node patch releases.
// ---------------------------------------------------------------------------

const report = {
  policy: TERRAIN_WIND_SNOW_POLICY.id,
  profiles: digestRows,
  aggregate,
  compass: {
    total: compass.length,
    neutral: compassNeutral,
    windward: compassWindward,
    lee: compassLee,
  },
  cliffs: cliffSlopes,
};
report.digest = crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex');

console.log(JSON.stringify(report, null, 2));
console.log('[checkTerrainWindSnowReferenceFieldSweep] PASS');
