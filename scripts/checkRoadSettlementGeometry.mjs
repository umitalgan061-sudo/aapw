#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { WORLD_DEFAULTS, WORLD_SCALE, SETTLEMENT_CONFIG } from '../src/3d/config.js';
import { createHeightSampler } from '../src/3d/world/terrain.js';
import { KINGDOM_SEATS, computeSettlementFlattenPads, mapToWorldXZ } from '../src/3d/world/settlements.js';
import { gradeDegrees } from '../src/3d/world/roadSurfaceProfile.js';

const TAU = Math.PI * 2;
const ANGLE_COUNT = 24;
const RADIAL_STEPS = 28;
const CORE_HEIGHT_TOLERANCE_METERS = 0.015;
const OUTER_RECOVERY_TOLERANCE_METERS = 0.02;
const FLATTEN_FORMULA_TOLERANCE_METERS = 1e-9;

function round(value, digits = 5) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function summarize(values) {
  assert(values.length > 0);
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
  const sum = values.reduce((total, value) => total + value, 0);
  return Object.freeze({
    count: values.length,
    min: round(sorted[0]),
    p50: round(percentile(0.5)),
    p90: round(percentile(0.9)),
    p99: round(percentile(0.99)),
    max: round(sorted.at(-1)),
    mean: round(sum / values.length),
  });
}

function writeJson(path, data) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(data, null, 2)}\n`);
}

function flattenWeight(distanceMeters, innerRadiusMeters, outerRadiusMeters) {
  if (distanceMeters <= innerRadiusMeters) return 1;
  if (distanceMeters >= outerRadiusMeters) return 0;
  const t = 1 - (distanceMeters - innerRadiusMeters) / (outerRadiusMeters - innerRadiusMeters);
  return t * t * (3 - 2 * t);
}

function independentlyExpectedFlattenedHeight(baseHeightMeters, x, z, pads) {
  let strongestWeight = 0;
  let strongestAnchorMeters = baseHeightMeters;
  let strongestPadIndex = -1;
  for (let index = 0; index < pads.length; index += 1) {
    const pad = pads[index];
    const distance = Math.hypot(x - pad.x, z - pad.z);
    const weight = flattenWeight(distance, pad.innerRadiusMeters, pad.outerRadiusMeters);
    if (weight > strongestWeight) {
      strongestWeight = weight;
      strongestAnchorMeters = pad.anchorHeightMeters;
      strongestPadIndex = index;
    }
  }
  return Object.freeze({
    heightMeters: baseHeightMeters + (strongestAnchorMeters - baseHeightMeters) * strongestWeight,
    strongestWeight,
    strongestAnchorMeters,
    strongestPadIndex,
  });
}

const baseSampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
const flattenPads = computeSettlementFlattenPads({
  sampleHeightMeters: baseSampleHeightMeters,
  seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
  minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
  mapBounds: WORLD_SCALE.MAP_BOUNDS,
  metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
});
const sampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);

assert.equal(KINGDOM_SEATS.length, 14, 'canonical kingdom-seat count drifted');
assert.equal(flattenPads.length, KINGDOM_SEATS.length, 'flatten pad count drifted from kingdom seats');

const records = [];
const allCoreErrors = [];
const allOuterErrors = [];
const allTransitionGrades = [];
const allHeightDeltas = [];
const allFormulaErrors = [];
let overlappingPadSampleCount = 0;

for (let seatIndex = 0; seatIndex < KINGDOM_SEATS.length; seatIndex += 1) {
  const seat = KINGDOM_SEATS[seatIndex];
  const pad = flattenPads[seatIndex];
  const world = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
  assert(Math.hypot(world.x - pad.x, world.z - pad.z) < 1e-9, `${seat.id} pad center drifted from canonical seat`);
  assert(pad.innerRadiusMeters >= 30 && pad.innerRadiusMeters <= 60, `${seat.id} inner radius is implausible`);
  assert(pad.outerRadiusMeters > pad.innerRadiusMeters, `${seat.id} outer radius must exceed inner radius`);
  assert(pad.outerRadiusMeters <= 220, `${seat.id} settlement pad expanded beyond audited local support`);

  const centerHeight = sampleHeightMeters(world.x, world.z);
  const centerBase = baseSampleHeightMeters(world.x, world.z);
  const centerExpected = independentlyExpectedFlattenedHeight(centerBase, world.x, world.z, flattenPads);
  assert(Math.abs(centerHeight - centerExpected.heightMeters) <= FLATTEN_FORMULA_TOLERANCE_METERS,
    `${seat.id} center stopped matching strongest-pad flatten formula`);
  assert(centerHeight >= WORLD_DEFAULTS.WATER_LEVEL_METERS + SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS - 1e-9,
    `${seat.id} flattened center fell below minimum ground clearance`);

  let seatMaxCoreError = 0;
  let seatMaxOuterError = 0;
  let seatMaxTransitionGrade = 0;
  let seatMaxHeightDelta = 0;
  let seatMaxFormulaError = 0;
  let sampledPointCount = 0;

  for (let angleIndex = 0; angleIndex < ANGLE_COUNT; angleIndex += 1) {
    const angle = (angleIndex / ANGLE_COUNT) * TAU;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);

    // The pad owning this exact seat must produce a flat castle core when it is the strongest pad.
    // Nearby Tyrell seats deliberately overlap, so the independently reconstructed strongest-pad
    // formula is the authority there rather than pretending each circular pad exists in isolation.
    for (const coreFraction of [0, 0.25, 0.5, 0.75, 0.98]) {
      const radius = pad.innerRadiusMeters * coreFraction;
      const x = pad.x + dx * radius;
      const z = pad.z + dz * radius;
      const height = sampleHeightMeters(x, z);
      const baseHeight = baseSampleHeightMeters(x, z);
      const expected = independentlyExpectedFlattenedHeight(baseHeight, x, z, flattenPads);
      const formulaError = Math.abs(height - expected.heightMeters);
      seatMaxFormulaError = Math.max(seatMaxFormulaError, formulaError);
      allFormulaErrors.push(formulaError);
      assert(formulaError <= FLATTEN_FORMULA_TOLERANCE_METERS,
        `${seat.id} core diverged from strongest-pad formula by ${formulaError}m`);
      if (expected.strongestPadIndex === seatIndex && expected.strongestWeight >= 1 - 1e-12) {
        const error = Math.abs(height - pad.anchorHeightMeters);
        seatMaxCoreError = Math.max(seatMaxCoreError, error);
        allCoreErrors.push(error);
        assert(error <= CORE_HEIGHT_TOLERANCE_METERS,
          `${seat.id} owned core stopped being flat at r=${radius.toFixed(2)}m: error=${error.toFixed(5)}m`);
      } else {
        overlappingPadSampleCount += 1;
      }
    }

    const outerProbeRadius = pad.outerRadiusMeters + 1.0;
    const outerX = pad.x + dx * outerProbeRadius;
    const outerZ = pad.z + dz * outerProbeRadius;
    const flattenedOuter = sampleHeightMeters(outerX, outerZ);
    const baseOuter = baseSampleHeightMeters(outerX, outerZ);
    const outerExpected = independentlyExpectedFlattenedHeight(baseOuter, outerX, outerZ, flattenPads);
    const outerFormulaError = Math.abs(flattenedOuter - outerExpected.heightMeters);
    seatMaxFormulaError = Math.max(seatMaxFormulaError, outerFormulaError);
    allFormulaErrors.push(outerFormulaError);
    assert(outerFormulaError <= FLATTEN_FORMULA_TOLERANCE_METERS,
      `${seat.id} outer probe diverged from strongest-pad formula by ${outerFormulaError}m`);
    // Only demand recovery to raw canonical terrain when no neighbouring settlement pad owns the
    // probe. This prevents the clustered Tyrell seats from being misclassified as an outer leak.
    if (outerExpected.strongestWeight <= 1e-12) {
      const outerError = Math.abs(flattenedOuter - baseOuter);
      seatMaxOuterError = Math.max(seatMaxOuterError, outerError);
      allOuterErrors.push(outerError);
      assert(outerError <= OUTER_RECOVERY_TOLERANCE_METERS,
        `${seat.id} pad fails to recover to canonical terrain outside support: ${outerError.toFixed(5)}m`);
    } else {
      overlappingPadSampleCount += 1;
    }

    let previous = null;
    for (let step = 0; step <= RADIAL_STEPS; step += 1) {
      const t = step / RADIAL_STEPS;
      const radius = pad.innerRadiusMeters + (pad.outerRadiusMeters - pad.innerRadiusMeters) * t;
      const x = pad.x + dx * radius;
      const z = pad.z + dz * radius;
      const height = sampleHeightMeters(x, z);
      const baseHeight = baseSampleHeightMeters(x, z);
      assert(Number.isFinite(height) && Number.isFinite(baseHeight), `${seat.id} produced non-finite pad height`);
      const expected = independentlyExpectedFlattenedHeight(baseHeight, x, z, flattenPads);
      const formulaError = Math.abs(height - expected.heightMeters);
      seatMaxFormulaError = Math.max(seatMaxFormulaError, formulaError);
      allFormulaErrors.push(formulaError);
      assert(formulaError <= FLATTEN_FORMULA_TOLERANCE_METERS,
        `${seat.id} transition diverged from strongest-pad blend by ${formulaError}m at r=${radius.toFixed(2)}m`);
      const low = Math.min(baseHeight, expected.strongestAnchorMeters) - 1e-9;
      const high = Math.max(baseHeight, expected.strongestAnchorMeters) + 1e-9;
      assert(height >= low && height <= high,
        `${seat.id} flattening overshot the canonical/anchor envelope at r=${radius.toFixed(2)}m`);
      const delta = Math.abs(height - baseHeight);
      seatMaxHeightDelta = Math.max(seatMaxHeightDelta, delta);
      allHeightDeltas.push(delta);
      sampledPointCount += 1;
      if (previous) {
        const horizontal = radius - previous.radius;
        const grade = gradeDegrees(height - previous.height, horizontal);
        seatMaxTransitionGrade = Math.max(seatMaxTransitionGrade, grade);
        allTransitionGrades.push(grade);
      }
      previous = { radius, height };
    }
  }

  records.push(Object.freeze({
    id: seat.id,
    x: round(world.x, 3),
    z: round(world.z, 3),
    anchorHeightMeters: round(pad.anchorHeightMeters),
    innerRadiusMeters: pad.innerRadiusMeters,
    outerRadiusMeters: pad.outerRadiusMeters,
    maxCoreErrorMeters: round(seatMaxCoreError, 9),
    maxOuterRecoveryErrorMeters: round(seatMaxOuterError, 9),
    maxFlattenFormulaErrorMeters: round(seatMaxFormulaError, 12),
    recordedNaturalTransitionGradeDegrees: round(seatMaxTransitionGrade, 3),
    maxFlatteningDeltaMeters: round(seatMaxHeightDelta, 3),
    sampledPointCount,
  }));
}

assert(allCoreErrors.length > 0, 'no independently owned settlement-core samples were audited');
assert(allOuterErrors.length > 0, 'no non-overlapping outer recovery samples were audited');

const report = Object.freeze({
  exactHead: process.env.EXPECTED_HEAD_SHA ?? null,
  seatCount: KINGDOM_SEATS.length,
  policy: {
    angleCount: ANGLE_COUNT,
    radialSteps: RADIAL_STEPS,
    coreHeightToleranceMeters: CORE_HEIGHT_TOLERANCE_METERS,
    outerRecoveryToleranceMeters: OUTER_RECOVERY_TOLERANCE_METERS,
    flattenFormulaToleranceMeters: FLATTEN_FORMULA_TOLERANCE_METERS,
    arbitraryNaturalSlopeIsNotARoadGradeGate: true,
    actualRoadGradeAuthority: 'checkRoadRouteCanonicalExactHead.mjs / 19.25 degrees',
  },
  overlap: {
    overlappingPadSampleCount,
  },
  distributions: {
    coreErrorMeters: summarize(allCoreErrors),
    outerRecoveryErrorMeters: summarize(allOuterErrors),
    flattenFormulaErrorMeters: summarize(allFormulaErrors),
    recordedNaturalTransitionGradeDegrees: summarize(allTransitionGrades),
    flatteningDeltaMeters: summarize(allHeightDeltas),
  },
  seats: records,
});

writeJson('artifacts/road-route-exact-head/settlement-geometry.json', report);
console.log('[checkRoadSettlementGeometry] PASS');
console.log(JSON.stringify(report, null, 2));
