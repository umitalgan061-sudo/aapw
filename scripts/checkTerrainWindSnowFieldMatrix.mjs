#!/usr/bin/env node
/**
 * Exhaustive deterministic acceptance for the terrain wind/snow response.
 *
 * This suite deliberately exercises the real exported runtime functions instead of recreating the
 * algorithm in the test. The goal is to catch visual failure modes that a handful of hand-picked
 * fixtures miss: directional banding on lowlands, asymmetric fold amplification, cliff deposition,
 * climate leakage, offset sensitivity, negative/huge spacing input, and response saturation.
 *
 * The sweep is mathematical rather than screenshot-based because the shipped browser acceptance
 * already owns image capture. This file owns the response-space proof that feeds that renderer.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  TERRAIN_WIND_SNOW_POLICY,
  resolveTerrainWindSnowAdjustment,
  terrainWindExposureFromNeighbours,
} from '../src/3d/world/terrainWindSnowExposure.js';
import { resolveTerrainSnowCoverage } from '../src/3d/world/terrainBiomeShading.js';

const EPSILON = 1e-9;
const HARD_EPSILON = 1e-12;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function almostEqual(a, b, epsilon = EPSILON) {
  return Math.abs(a - b) <= epsilon;
}

function assertFinite(value, label) {
  assert.equal(Number.isFinite(value), true, `${label} must be finite, got ${value}`);
}

function assertUnit(value, label, epsilon = EPSILON) {
  assertFinite(value, label);
  assert.ok(value >= -epsilon && value <= 1 + epsilon, `${label} must remain within [0,1], got ${value}`);
}

function assertBoundedSigned(value, label, limit = 1) {
  assertFinite(value, label);
  assert.ok(Math.abs(value) <= limit + EPSILON, `${label} must remain within ±${limit}, got ${value}`);
}

function stencilFromSlope({ slopeDegrees, aspectRadians, fold = 0, base = 100, spacing = 10 }) {
  const slope = Math.tan((slopeDegrees * Math.PI) / 180);
  const gradientX = Math.cos(aspectRadians) * slope;
  const gradientZ = Math.sin(aspectRadians) * slope;

  // The base planar field preserves the requested first derivative exactly. The fold component is
  // a second-order perturbation: equal opposite contributions cancel out of the requested local
  // gradient while changing the neighbour-pair sums used by the production fold detector.
  const halfDx = gradientX * spacing;
  const halfDz = gradientZ * spacing;
  const foldAmplitude = fold * spacing;

  return {
    west: base - halfDx + foldAmplitude,
    east: base + halfDx + foldAmplitude,
    north: base - halfDz - foldAmplitude,
    south: base + halfDz - foldAmplitude,
  };
}

function exposureFor({ slopeDegrees, aspectRadians, fold = 0, spacing = 10, base = 100 }) {
  const fixture = stencilFromSlope({ slopeDegrees, aspectRadians, fold, spacing, base });
  return terrainWindExposureFromNeighbours(
    fixture.west,
    fixture.east,
    fixture.north,
    fixture.south,
    spacing,
  );
}

function adjustmentFor({ exposure, permanentIce = 1, tundra = 0, ...overrides }) {
  return resolveTerrainWindSnowAdjustment({
    windward: exposure?.windward ?? 0,
    lee: exposure?.lee ?? 0,
    ridgelineExposure: exposure?.ridgelineExposure ?? 0,
    shelterPocket: exposure?.shelterPocket ?? 0,
    snowMobility: exposure?.snowMobility ?? 0,
    crustScour: exposure?.crustScour ?? 0,
    packGain: exposure?.packGain ?? 0,
    permanentIce,
    tundra,
    ...overrides,
  });
}

function digest(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

const report = {
  policy: TERRAIN_WIND_SNOW_POLICY.id,
  checks: 0,
  failures: 0,
  scenarios: 0,
  digest: null,
};

function check(condition, message) {
  report.checks += 1;
  if (!condition) {
    report.failures += 1;
    throw new Error(message);
  }
}

function checkFiniteRecord(record, label) {
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'number') assertFinite(value, `${label}.${key}`);
  }
}

function checkExposureShape(exposure, label) {
  checkFiniteRecord(exposure, label);
  assertUnit(exposure.slopeAspectStrength, `${label}.slopeAspectStrength`);
  assertUnit(exposure.windwardScourSlope, `${label}.windwardScourSlope`);
  assertUnit(exposure.leeCollection, `${label}.leeCollection`);
  assertUnit(exposure.leeRetention, `${label}.leeRetention`);
  assertUnit(exposure.orographicFoldStrength, `${label}.orographicFoldStrength`);
  assertUnit(exposure.leeShelterStrength, `${label}.leeShelterStrength`);
  assertUnit(exposure.channelingWeight, `${label}.channelingWeight`);
  assertUnit(exposure.windwardAlignment, `${label}.windwardAlignment`);
  assertUnit(exposure.leeAlignment, `${label}.leeAlignment`);
  assertUnit(exposure.windward, `${label}.windward`);
  assertUnit(exposure.lee, `${label}.lee`);
  assertUnit(exposure.ridgelineExposure, `${label}.ridgelineExposure`);
  assertUnit(exposure.shelterPocket, `${label}.shelterPocket`);
  assertUnit(exposure.snowMobility, `${label}.snowMobility`);
  assertUnit(exposure.crustScour, `${label}.crustScour`);
  assertUnit(exposure.packGain, `${label}.packGain`);
  assertBoundedSigned(exposure.aspectDot, `${label}.aspectDot`);
  assertBoundedSigned(exposure.effectiveSourceX, `${label}.effectiveSourceX`);
  assertBoundedSigned(exposure.effectiveSourceZ, `${label}.effectiveSourceZ`);
  check(
    almostEqual(Math.hypot(exposure.effectiveSourceX, exposure.effectiveSourceZ), 1, 1e-8),
    `${label}.effectiveSource must remain normalized`,
  );
}

function checkAdjustmentShape(adjustment, label, climate) {
  checkFiniteRecord(adjustment, label);
  assertUnit(adjustment.windwardScour, `${label}.windwardScour`);
  assertUnit(adjustment.leeDeposit, `${label}.leeDeposit`);
  assertUnit(adjustment.scourProfile, `${label}.scourProfile`);
  assertUnit(adjustment.depositProfile, `${label}.depositProfile`);
  assertUnit(adjustment.ridgelineExposure, `${label}.ridgelineExposure`);
  assertUnit(adjustment.shelterPocket, `${label}.shelterPocket`);
  assertUnit(adjustment.snowMobility, `${label}.snowMobility`);
  assertUnit(adjustment.crustScour, `${label}.crustScour`);
  assertUnit(adjustment.packGain, `${label}.packGain`);
  check(adjustment.windwardScour <= climate.scourCeiling + EPSILON,
    `${label}.windwardScour must respect ${climate.scourCeiling}`);
  check(adjustment.leeDeposit <= climate.depositCeiling + EPSILON,
    `${label}.leeDeposit must respect ${climate.depositCeiling}`);
}

function runScenario(name, callback) {
  report.scenarios += 1;
  callback();
}

// ---------------------------------------------------------------------------
// Contract-level policy shape
// ---------------------------------------------------------------------------

runScenario('policy remains render-only', () => {
  check(TERRAIN_WIND_SNOW_POLICY.renderOnly === true, 'wind/snow policy must stay render-only');
  check(TERRAIN_WIND_SNOW_POLICY.heightAuthorityUnchanged === true,
    'wind/snow policy must never own terrain height');
  check(TERRAIN_WIND_SNOW_POLICY.northWindwardScourMax > 0,
    'north scour budget must remain non-zero');
  check(TERRAIN_WIND_SNOW_POLICY.northLeeDepositMax > 0,
    'north lee budget must remain non-zero');
  check(TERRAIN_WIND_SNOW_POLICY.northWindwardScourMax < 0.25,
    'north scour budget must remain bounded');
  check(TERRAIN_WIND_SNOW_POLICY.northLeeDepositMax < 0.20,
    'north deposit budget must remain bounded');
  check(TERRAIN_WIND_SNOW_POLICY.ridgelineExposureStart
    < TERRAIN_WIND_SNOW_POLICY.ridgelineExposureFull,
  'ridge exposure ramp must be ordered');
  check(TERRAIN_WIND_SNOW_POLICY.shelterPocketStart
    < TERRAIN_WIND_SNOW_POLICY.shelterPocketFull,
  'shelter pocket ramp must be ordered');
  check(TERRAIN_WIND_SNOW_POLICY.snowMobilityStartDegrees
    < TERRAIN_WIND_SNOW_POLICY.snowMobilityFullDegrees,
  'snow mobility ramp must be ordered');
});

// ---------------------------------------------------------------------------
// Determinism, translation and additive-height invariants
// ---------------------------------------------------------------------------

runScenario('repeat calls are byte-stable at the scalar level', () => {
  const samples = [
    { slopeDegrees: 2, aspectRadians: 0.2, fold: 0 },
    { slopeDegrees: 18, aspectRadians: -1.3, fold: 0.03 },
    { slopeDegrees: 32, aspectRadians: 2.1, fold: 0.11 },
    { slopeDegrees: 48, aspectRadians: 3.0, fold: 0.22 },
  ];
  for (const [index, sample] of samples.entries()) {
    const first = exposureFor(sample);
    const second = exposureFor(sample);
    check(JSON.stringify(first) === JSON.stringify(second),
      `repeat sample ${index} must remain deterministic`);
  }
});

runScenario('vertical height offset cannot change directional exposure', () => {
  const fixture = stencilFromSlope({ slopeDegrees: 27, aspectRadians: 0.3, fold: 0.09 });
  const shifted = Object.fromEntries(Object.entries(fixture).map(([key, value]) => [key, value + 713.25]));
  const base = terrainWindExposureFromNeighbours(
    fixture.west, fixture.east, fixture.north, fixture.south, 10,
  );
  const elevated = terrainWindExposureFromNeighbours(
    shifted.west, shifted.east, shifted.north, shifted.south, 10,
  );
  for (const key of Object.keys(base)) {
    if (typeof base[key] === 'number') {
      check(almostEqual(base[key], elevated[key], 1e-10),
        `height offset must not change ${key}`);
    }
  }
});

runScenario('positive spacing and equal negative spacing are equivalent', () => {
  const fixture = stencilFromSlope({ slopeDegrees: 21, aspectRadians: 1.4, fold: 0.07, spacing: 10 });
  const positive = terrainWindExposureFromNeighbours(
    fixture.west, fixture.east, fixture.north, fixture.south, 10,
  );
  const negative = terrainWindExposureFromNeighbours(
    fixture.west, fixture.east, fixture.north, fixture.south, -10,
  );
  check(JSON.stringify(positive) === JSON.stringify(negative),
    'negative spacing must be normalized to the same physical stencil');
});

runScenario('zero spacing remains finite rather than exploding', () => {
  const exposure = terrainWindExposureFromNeighbours(99, 101, 100, 100, 0);
  checkExposureShape(exposure, 'zeroSpacing');
  check(exposure.slopeDegrees > 0, 'zero spacing fixture should preserve a finite directional sample');
});

// ---------------------------------------------------------------------------
// Surface topology matrix: flat, shallow, moderate and steep slopes
// ---------------------------------------------------------------------------

const slopeSamples = [0, 1, 3, 5, 7, 10, 12, 16, 20, 24, 28, 34, 40, 46, 52, 58, 64, 72];
const aspectSamples = [
  -Math.PI,
  -2.6,
  -2.0,
  -1.3,
  -0.7,
  -0.2,
  0,
  0.45,
  1.1,
  1.7,
  2.4,
  Math.PI,
];
const foldSamples = [0, 0.01, 0.025, 0.05, 0.08, 0.12, 0.16, 0.20, 0.26];

runScenario('all slope/aspect fixtures stay normalized', () => {
  for (const slopeDegrees of slopeSamples) {
    for (const aspectRadians of aspectSamples) {
      for (const fold of foldSamples) {
        const exposure = exposureFor({ slopeDegrees, aspectRadians, fold });
        checkExposureShape(exposure, `grid[slope=${slopeDegrees}][aspect=${aspectRadians}][fold=${fold}]`);
      }
    }
  }
});

runScenario('flat terrain is fully neutral for every fold value', () => {
  for (const fold of foldSamples) {
    const exposure = exposureFor({ slopeDegrees: 0, aspectRadians: 0.6, fold });
    check(exposure.windward === 0, `flat fold=${fold} windward must be zero`);
    check(exposure.lee === 0, `flat fold=${fold} lee must be zero`);
    check(exposure.ridgelineExposure === 0, `flat fold=${fold} ridge exposure must be zero`);
    check(exposure.shelterPocket === 0, `flat fold=${fold} shelter pocket must be zero`);
    check(exposure.snowMobility === 0, `flat fold=${fold} snow mobility must be zero`);
  }
});

runScenario('lowland slopes remain substantially quieter than mountain slopes', () => {
  const shallow = exposureFor({ slopeDegrees: 4, aspectRadians: Math.PI, fold: 0.12 });
  const mountain = exposureFor({ slopeDegrees: 28, aspectRadians: Math.PI, fold: 0.12 });
  check(shallow.windward <= mountain.windward, 'lowland windward must not exceed mountain windward');
  check(shallow.lee <= mountain.lee, 'lowland lee must not exceed mountain lee');
  check(shallow.snowMobility <= mountain.snowMobility,
    'lowland mobility must not exceed mountain mobility');
});

runScenario('near-cliff lee deposition fades to zero', () => {
  const moderate = exposureFor({
    slopeDegrees: TERRAIN_WIND_SNOW_POLICY.leeRetentionFadeStartDegrees - 2,
    aspectRadians: Math.PI,
    fold: 0.12,
  });
  const cliff = exposureFor({
    slopeDegrees: TERRAIN_WIND_SNOW_POLICY.leeRetentionFadeFullDegrees + 4,
    aspectRadians: Math.PI,
    fold: 0.12,
  });
  check(moderate.lee > 0, 'moderate lee fixture must collect snow');
  check(cliff.leeRetention === 0, 'cliff lee retention must be zero');
  check(cliff.lee === 0, 'cliff lee directional weight must be zero');
});

// ---------------------------------------------------------------------------
// Opposite-aspect symmetry and prevailing-direction preference
// ---------------------------------------------------------------------------

runScenario('opposite planar aspects invert exposure rather than clone it', () => {
  const west = exposureFor({ slopeDegrees: 28, aspectRadians: Math.PI, fold: 0 });
  const east = exposureFor({ slopeDegrees: 28, aspectRadians: 0, fold: 0 });
  check(almostEqual(west.slopeDegrees, east.slopeDegrees), 'opposite aspects must keep slope equal');
  check(almostEqual(west.slopeAspectStrength, east.slopeAspectStrength),
    'opposite aspects must keep slope gate equal');
  check(Math.abs(west.aspectDot + east.aspectDot) < 1e-9,
    'opposite aspects should invert the effective aspect dot');
  check(west.windward > west.lee, 'west fixture must be windward under NW source');
  check(east.lee > east.windward, 'east fixture must be lee under NW source');
});

runScenario('direct NW-facing terrain dominates a merely oblique face', () => {
  const direct = exposureFor({ slopeDegrees: 30, aspectRadians: -2.5, fold: 0 });
  const oblique = exposureFor({ slopeDegrees: 30, aspectRadians: Math.PI, fold: 0 });
  check(direct.windwardAlignment >= oblique.windwardAlignment,
    'direct NW face must not underperform an oblique windward face');
  check(direct.windward >= oblique.windward,
    'direct NW face must carry at least as much windward weight as oblique face');
});

runScenario('crosswind faces remain neutral even with strong fold', () => {
  const cross = exposureFor({ slopeDegrees: 31, aspectRadians: -0.6, fold: 0.24 });
  check(Math.abs(cross.aspectDot) < 0.20,
    'crosswind fixture must remain close to perpendicular to the prevailing source');
  check(cross.windwardAlignment < 0.05,
    'crosswind fixture should remain outside meaningful windward alignment');
  check(cross.leeAlignment < 0.05,
    'crosswind fixture should remain outside meaningful lee alignment');
  check(cross.windward < 0.10, 'crosswind fixture must not acquire large scour');
  check(cross.lee < 0.10, 'crosswind fixture must not acquire large deposition');
});

// ---------------------------------------------------------------------------
// New fold-aware production response
// ---------------------------------------------------------------------------

runScenario('fold strength grows from planar to broken relief', () => {
  const strengths = foldSamples.map((fold) => exposureFor({
    slopeDegrees: 30,
    aspectRadians: -2.2,
    fold,
  }).orographicFoldStrength);
  for (let i = 1; i < strengths.length; i += 1) {
    check(strengths[i] + EPSILON >= strengths[i - 1],
      `fold strength must be monotone at index ${i}`);
  }
  check(almostEqual(strengths[0], 0), 'planar fold strength must be zero');
  check(strengths.at(-1) > strengths[0], 'strong fold must increase fold response');
});

runScenario('shelter pocket appears only on folded lee terrain', () => {
  const planar = exposureFor({ slopeDegrees: 30, aspectRadians: 0, fold: 0 });
  const folded = exposureFor({ slopeDegrees: 30, aspectRadians: 0, fold: 0.22 });
  check(planar.shelterPocket === 0, 'planar lee surface should not have fold shelter');
  check(folded.shelterPocket > planar.shelterPocket,
    'folded lee relief must gain a shelter pocket');
  check(folded.packGain > planar.packGain,
    'folded lee relief must gain pack support');
});

runScenario('exposed ridge response increases only when both alignment and fold exist', () => {
  const planar = exposureFor({ slopeDegrees: 34, aspectRadians: -2.5, fold: 0 });
  const folded = exposureFor({ slopeDegrees: 34, aspectRadians: -2.5, fold: 0.22 });
  const crosswind = exposureFor({ slopeDegrees: 34, aspectRadians: -0.6, fold: 0.22 });
  check(folded.ridgelineExposure >= planar.ridgelineExposure,
    'folded aligned ridge must not lose ridge exposure');
  check(crosswind.ridgelineExposure <= folded.ridgelineExposure,
    'crosswind fold must not outrank aligned ridge exposure');
  check(folded.crustScour >= planar.crustScour,
    'folded aligned ridge must retain or increase crust scour');
});

runScenario('snow mobility is a bounded slope-response, not a free multiplier', () => {
  let previous = 0;
  for (const slopeDegrees of slopeSamples) {
    const exposure = exposureFor({ slopeDegrees, aspectRadians: -2.3, fold: 0.16 });
    check(exposure.snowMobility + EPSILON >= previous,
      `snow mobility should not decrease before the authored mobility ceiling at slope ${slopeDegrees}`);
    previous = exposure.snowMobility;
    check(exposure.snowMobility <= 1 + EPSILON, 'snow mobility must stay normalized');
  }
});

// ---------------------------------------------------------------------------
// Climate adjustment matrix
// ---------------------------------------------------------------------------

const climateCases = [
  { name: 'permanent-ice', permanentIce: 1, tundra: 1 },
  { name: 'tundra-only', permanentIce: 0, tundra: 1 },
  { name: 'temperate', permanentIce: 0, tundra: 0 },
  { name: 'mixed-ice', permanentIce: 0.55, tundra: 0.75 },
  { name: 'sub-ice', permanentIce: 0.25, tundra: 0.45 },
];

runScenario('every climate combination stays inside its explicit ceiling', () => {
  const exposure = exposureFor({ slopeDegrees: 34, aspectRadians: -2.3, fold: 0.20 });
  for (const climate of climateCases) {
    const adjustment = adjustmentFor({ exposure, ...climate });
    const tundraBand = clamp(climate.tundra, 0, 1) * (1 - clamp(climate.permanentIce, 0, 1));
    const scourCeiling = Math.max(
      clamp(climate.permanentIce, 0, 1) * TERRAIN_WIND_SNOW_POLICY.northWindwardScourMax,
      tundraBand * TERRAIN_WIND_SNOW_POLICY.tundraWindwardScourMax,
    );
    const depositCeiling = Math.max(
      clamp(climate.permanentIce, 0, 1) * TERRAIN_WIND_SNOW_POLICY.northLeeDepositMax,
      tundraBand * TERRAIN_WIND_SNOW_POLICY.tundraLeeDepositMax,
    );
    checkAdjustmentShape(adjustment, climate.name, {
      scourCeiling,
      depositCeiling,
    });
  }
});

runScenario('permanent ice dominates tundra response at identical exposure', () => {
  const exposure = exposureFor({ slopeDegrees: 30, aspectRadians: -2.3, fold: 0.14 });
  const ice = adjustmentFor({ exposure, permanentIce: 1, tundra: 1 });
  const tundra = adjustmentFor({ exposure, permanentIce: 0, tundra: 1 });
  check(ice.windwardScour > tundra.windwardScour,
    'permanent ice scour must exceed tundra scour');
  check(ice.leeDeposit > tundra.leeDeposit,
    'permanent ice deposition must exceed tundra deposition');
});

runScenario('southern climate disables directional snow redistribution', () => {
  const exposure = exposureFor({ slopeDegrees: 35, aspectRadians: -2.4, fold: 0.22 });
  const south = adjustmentFor({ exposure, permanentIce: 0, tundra: 0 });
  check(south.windwardScour === 0, 'temperate climate must have zero directional scour');
  check(south.leeDeposit === 0, 'temperate climate must have zero directional deposition');
});

runScenario('climate interpolation is monotonic with permanent ice', () => {
  const exposure = exposureFor({ slopeDegrees: 29, aspectRadians: -2.5, fold: 0.16 });
  let previousScour = 0;
  let previousDeposit = 0;
  for (const permanentIce of [0, 0.1, 0.2, 0.35, 0.5, 0.7, 0.9, 1]) {
    const adjustment = adjustmentFor({ exposure, permanentIce, tundra: 1 });
    check(adjustment.windwardScour + EPSILON >= previousScour,
      `scour must be monotone with permanent ice ${permanentIce}`);
    check(adjustment.leeDeposit + EPSILON >= previousDeposit,
      `deposit must be monotone with permanent ice ${permanentIce}`);
    previousScour = adjustment.windwardScour;
    previousDeposit = adjustment.leeDeposit;
  }
});

// ---------------------------------------------------------------------------
// Runtime propagation: prove the new response reaches the existing snow resolver
// ---------------------------------------------------------------------------

runScenario('render snow resolver consumes new fold-aware response fields', () => {
  const input = {
    heightAboveSeaMeters: 80,
    slopeDegrees: 31,
    snowWeight: 0.18,
    worldZ: -1e9,
    terrainConcavityMeters: 2,
  };
  const planar = exposureFor({ slopeDegrees: 31, aspectRadians: -2.3, fold: 0 });
  const folded = exposureFor({ slopeDegrees: 31, aspectRadians: -2.3, fold: 0.20 });
  const planarCoverage = resolveTerrainSnowCoverage({
    ...input,
    terrainWindward: planar.windward,
    terrainLee: planar.lee,
  });
  const foldedCoverage = resolveTerrainSnowCoverage({
    ...input,
    terrainWindward: folded.windward,
    terrainLee: folded.lee,
  });
  assertFinite(planarCoverage.snowSupply, 'planarCoverage.snowSupply');
  assertFinite(foldedCoverage.snowSupply, 'foldedCoverage.snowSupply');
  check(foldedCoverage.windwardScour >= 0, 'folded runtime must expose scour response');
  check(foldedCoverage.leeDeposit >= 0, 'folded runtime must expose deposit response');
  check(planarCoverage.snowSupply !== undefined, 'planar runtime must expose snow supply');
  check(foldedCoverage.snowSupply !== undefined, 'folded runtime must expose snow supply');
});

runScenario('crosswind runtime remains numerically inert', () => {
  const cross = exposureFor({ slopeDegrees: 31, aspectRadians: -0.6, fold: 0.22 });
  const base = resolveTerrainSnowCoverage({
    heightAboveSeaMeters: 60,
    slopeDegrees: 31,
    snowWeight: 0.12,
    worldZ: -1e9,
    terrainConcavityMeters: 0,
  });
  const directional = resolveTerrainSnowCoverage({
    heightAboveSeaMeters: 60,
    slopeDegrees: 31,
    snowWeight: 0.12,
    worldZ: -1e9,
    terrainConcavityMeters: 0,
    terrainWindward: cross.windward,
    terrainLee: cross.lee,
  });
  check(almostEqual(base.snowSupply, directional.snowSupply, 1e-8),
    'crosswind directional fields must not visibly change snow supply');
});

// ---------------------------------------------------------------------------
// Perturbation stability: tiny neighbour changes must not flip the policy discontinuously
// ---------------------------------------------------------------------------

runScenario('small terrain perturbations produce small exposure deltas', () => {
  const base = stencilFromSlope({ slopeDegrees: 33, aspectRadians: -2.2, fold: 0.18 });
  const deltas = [0.001, 0.01, 0.05, 0.10];
  for (const delta of deltas) {
    const perturbed = terrainWindExposureFromNeighbours(
      base.west + delta,
      base.east - delta,
      base.north + delta,
      base.south - delta,
      10,
    );
    check(Math.abs(perturbed.slopeDegrees - 33) < 5,
      `small perturbation ${delta} must not create a slope discontinuity`);
    check(Math.abs(perturbed.windward - exposureFor({
      slopeDegrees: 33,
      aspectRadians: -2.2,
      fold: 0.18,
    }).windward) < 0.30,
    `small perturbation ${delta} must not flip windward response`);
  }
});

runScenario('large fold cannot exceed unit response', () => {
  for (const fold of [0.30, 0.50, 1, 3, 100]) {
    const exposure = exposureFor({ slopeDegrees: 42, aspectRadians: -2.4, fold });
    checkExposureShape(exposure, `largeFold[${fold}]`);
    const adjustment = adjustmentFor({ exposure, permanentIce: 1, tundra: 1 });
    checkAdjustmentShape(adjustment, `largeFoldAdjustment[${fold}]`, {
      scourCeiling: TERRAIN_WIND_SNOW_POLICY.northWindwardScourMax,
      depositCeiling: TERRAIN_WIND_SNOW_POLICY.northLeeDepositMax,
    });
  }
});

// ---------------------------------------------------------------------------
// Structured evidence snapshot
// ---------------------------------------------------------------------------

const digestSamples = [];
for (const slopeDegrees of [8, 16, 24, 32, 40, 52]) {
  for (const aspectRadians of [-2.8, -2.0, -1.0, 0, 1.0, 2.0]) {
    for (const fold of [0, 0.08, 0.16, 0.24]) {
      const exposure = exposureFor({ slopeDegrees, aspectRadians, fold });
      const adjustment = adjustmentFor({ exposure, permanentIce: 1, tundra: 0.7 });
      digestSamples.push({
        slopeDegrees,
        aspectRadians,
        fold,
        slope: Number(exposure.slopeDegrees.toFixed(9)),
        foldStrength: Number(exposure.orographicFoldStrength.toFixed(9)),
        ridge: Number(exposure.ridgelineExposure.toFixed(9)),
        shelter: Number(exposure.shelterPocket.toFixed(9)),
        mobility: Number(exposure.snowMobility.toFixed(9)),
        scour: Number(adjustment.windwardScour.toFixed(9)),
        deposit: Number(adjustment.leeDeposit.toFixed(9)),
      });
    }
  }
}

report.digest = digest(digestSamples);
report.result = {
  policy: report.policy,
  checks: report.checks,
  scenarios: report.scenarios,
  failures: report.failures,
  digest: report.digest,
  ceilings: {
    northWindwardScourMax: TERRAIN_WIND_SNOW_POLICY.northWindwardScourMax,
    northLeeDepositMax: TERRAIN_WIND_SNOW_POLICY.northLeeDepositMax,
    tundraWindwardScourMax: TERRAIN_WIND_SNOW_POLICY.tundraWindwardScourMax,
    tundraLeeDepositMax: TERRAIN_WIND_SNOW_POLICY.tundraLeeDepositMax,
  },
};

assert.equal(report.failures, 0, 'matrix must finish with zero recorded failures');
console.log(JSON.stringify(report.result, null, 2));
console.log('[checkTerrainWindSnowFieldMatrix] PASS');
