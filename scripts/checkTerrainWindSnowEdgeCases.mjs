#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  resolveTerrainWindSnowSurfaceFabric,
  resolveTerrainWindSnowSurfaceFabricSafely,
  sanitizeTerrainWindSnowSurfaceFabricInput,
  resolveTerrainWindSnowContinuity,
  resolveTerrainWindSnowToneHints,
} from '../src/3d/world/terrainWindSnowSurfaceFabric.js';
import {
  terrainWindExposureFromNeighbours,
  resolveTerrainWindSnowAdjustment,
} from '../src/3d/world/terrainWindSnowExposure.js';

const finite = Number.isFinite;
const EPS = 1e-9;
const bounded01 = (value) => finite(value) && value >= -EPS && value <= 1 + EPS;
const gainBounded = (value) => finite(value) && value >= 0.86 - EPS && value <= 1.14 + EPS;

function assertFiniteObject(object, label) {
  for (const [key, value] of Object.entries(object ?? {})) {
    if (typeof value !== 'number') continue;
    assert(finite(value), `${label}.${key} must be finite`);
  }
}

const scalarStress = [
  { slopeDegrees: 0, aspectDot: 0, foldGradient: 0, leeRetention: 1 },
  { slopeDegrees: 0, aspectDot: 1, foldGradient: 0, leeRetention: 1 },
  { slopeDegrees: 90, aspectDot: 1, foldGradient: 1, leeRetention: 0 },
  { slopeDegrees: 180, aspectDot: -1, foldGradient: 5, leeRetention: -5 },
  { slopeDegrees: -10, aspectDot: -2, foldGradient: -1, leeRetention: 2 },
  { slopeDegrees: Number.MAX_VALUE, aspectDot: Number.MAX_VALUE, foldGradient: Number.MAX_VALUE, leeRetention: Number.MAX_VALUE },
  { slopeDegrees: Number.MIN_VALUE, aspectDot: Number.MIN_VALUE, foldGradient: Number.MIN_VALUE, leeRetention: Number.MIN_VALUE },
  { slopeDegrees: NaN, aspectDot: NaN, foldGradient: NaN, leeRetention: NaN },
  { slopeDegrees: Infinity, aspectDot: -Infinity, foldGradient: Infinity, leeRetention: -Infinity },
];

for (let index = 0; index < scalarStress.length; index += 1) {
  const input = scalarStress[index];
  const sanitized = sanitizeTerrainWindSnowSurfaceFabricInput(input);
  assertFiniteObject(sanitized, `sanitized-${index}`);
  const safe = resolveTerrainWindSnowSurfaceFabricSafely(input);
  assertFiniteObject(safe, `safe-${index}`);
  assert(gainBounded(safe.windwardGain), `safe-${index} windward gain out of range`);
  assert(gainBounded(safe.leeGain), `safe-${index} lee gain out of range`);
  for (const key of ['slope', 'steepness', 'cliff', 'directional', 'crosswindNeutrality', 'foldStrength',
    'ridgeShoulder', 'brokenRidge', 'shelteredPocket', 'valleyContinuity', 'slopeTransition',
    'windwardAlignment', 'leeAlignment', 'leeRetention', 'retention', 'ridgeCrust', 'leePowder', 'continuity']) {
    assert(bounded01(safe[key]), `safe-${index}.${key} must be normalized`);
  }
  const continuity = resolveTerrainWindSnowContinuity(input);
  assert(bounded01(continuity), `continuity-${index} must be normalized`);
  const hints = resolveTerrainWindSnowToneHints(input);
  for (const key of ['packedBias', 'accumulatedBias', 'cooling', 'warming', 'continuity']) {
    assert(bounded01(hints[key]), `hints-${index}.${key} out of range`);
  }
  assert(bounded01((hints.brightness + 1) * 0.5), `hints-${index}.brightness must be signed-bounded`);
}

const heightTriples = [
  [100, 100, 100, 100],
  [100.000001, 100, 100, 100],
  [100, 99.999999, 100, 100],
  [0, 1, 0, -1],
  [-50, 75, -20, 60],
  [1e8, -1e8, 1e8, -1e8],
];
const spacings = [1, 2, 10, 100, 1000, 1e-6, -10, Infinity, NaN, 0];

for (const heights of heightTriples) {
  for (const spacing of spacings) {
    const exposure = terrainWindExposureFromNeighbours(...heights, spacing);
    assertFiniteObject(exposure, `exposure-${heights.join('-')}-${spacing}`);
    assert(exposure.windward >= 0 && exposure.windward <= 1);
    assert(exposure.lee >= 0 && exposure.lee <= 1);
    assert(exposure.leeRetention >= 0 && exposure.leeRetention <= 1);
    assert(exposure.surfaceFabric && typeof exposure.surfaceFabric === 'object');
    assert(gainBounded(exposure.surfaceFabric.windwardGain));
    assert(gainBounded(exposure.surfaceFabric.leeGain));
  }
}

const zeroSpacing = terrainWindExposureFromNeighbours(90, 110, 100, 100, 0);
assert(Number.isFinite(zeroSpacing.slopeDegrees));
assert(Number.isFinite(zeroSpacing.aspectDot));
assert(zeroSpacing.windward >= 0 && zeroSpacing.windward <= 1);
assert(zeroSpacing.lee >= 0 && zeroSpacing.lee <= 1);

const negativeSpacing = terrainWindExposureFromNeighbours(90, 110, 100, 100, -10);
const positiveSpacing = terrainWindExposureFromNeighbours(90, 110, 100, 100, 10);
assert(Math.abs(negativeSpacing.slopeDegrees - positiveSpacing.slopeDegrees) < EPS);
assert(Math.abs(negativeSpacing.aspectDot - positiveSpacing.aspectDot) < EPS);

const equalSlopeDifferentFold = terrainWindExposureFromNeighbours(90, 110, 94, 106, 10);
const sameSlopeNoFold = terrainWindExposureFromNeighbours(90, 110, 100, 100, 10);
assert(equalSlopeDifferentFold.slopeDegrees > 0);
assert(equalSlopeDifferentFold.foldGradient > sameSlopeNoFold.foldGradient);
assert(equalSlopeDifferentFold.surfaceFabric.foldStrength >= sameSlopeNoFold.surfaceFabric.foldStrength);

const sourceDirectionCases = [
  { slope: 24, aspect: -0.92, fold: 0.03 },
  { slope: 24, aspect: -0.58, fold: 0.03 },
  { slope: 24, aspect: 0, fold: 0.03 },
  { slope: 24, aspect: 0.58, fold: 0.03 },
  { slope: 24, aspect: 0.92, fold: 0.03 },
];
for (const fixture of sourceDirectionCases) {
  const fabric = resolveTerrainWindSnowSurfaceFabric({
    slopeDegrees: fixture.slope,
    aspectDot: fixture.aspect,
    foldGradient: fixture.fold,
  });
  assertFiniteObject(fabric, `direction-${fixture.aspect}`);
}

const monotonicFolds = [0, 0.01, 0.025, 0.05, 0.10, 0.15, 0.20, 0.30, 0.5, 1];
for (const aspect of [-0.9, 0, 0.9]) {
  let previous = -Infinity;
  for (const fold of monotonicFolds) {
    const current = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 28, aspectDot: aspect, foldGradient: fold }).foldStrength;
    assert(current >= previous, `fold response regressed for aspect ${aspect} at fold ${fold}`);
    previous = current;
  }
}

const monotonicSlopes = [0, 2, 4, 8, 12, 16, 22, 30, 38, 46, 56, 68, 90];
for (const aspect of [-0.9, 0, 0.9]) {
  let previous = -Infinity;
  for (const slope of monotonicSlopes) {
    const current = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: slope, aspectDot: aspect, foldGradient: 0.08 }).slope;
    assert(current >= previous, `slope normalization regressed for aspect ${aspect} at slope ${slope}`);
    previous = current;
  }
}

const cliffSamples = [
  resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 46, aspectDot: -0.9, foldGradient: 0.12 }),
  resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 56, aspectDot: -0.9, foldGradient: 0.12 }),
  resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 68, aspectDot: -0.9, foldGradient: 0.12 }),
  resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 80, aspectDot: -0.9, foldGradient: 0.12 }),
];
for (const [index, fabric] of cliffSamples.entries()) {
  assertFiniteObject(fabric, `cliff-${index}`);
  assert(fabric.cliff >= 0 && fabric.cliff <= 1);
}
for (let index = 1; index < cliffSamples.length; index += 1) {
  assert(cliffSamples[index].cliff >= cliffSamples[index - 1].cliff);
  assert(cliffSamples[index].leeGain <= cliffSamples[index - 1].leeGain + 0.04);
}

const materialExtremes = [
  resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 24, aspectDot: 0.95, foldGradient: 0.20 }),
  resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 24, aspectDot: -0.95, foldGradient: 0.20 }),
  resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 60, aspectDot: 0.95, foldGradient: 0.20 }),
  resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 60, aspectDot: -0.95, foldGradient: 0.20 }),
];
for (const [index, fabric] of materialExtremes.entries()) {
  assert(gainBounded(fabric.windwardGain), `material-extreme-${index} windward gain`);
  assert(gainBounded(fabric.leeGain), `material-extreme-${index} lee gain`);
  assert(bounded01(fabric.ridgeCrust), `material-extreme-${index} ridge crust`);
  assert(bounded01(fabric.leePowder), `material-extreme-${index} lee powder`);
}

const adjustmentCases = [
  { windward: 0, lee: 0, permanentIce: 0, tundra: 0 },
  { windward: 1, lee: 0, permanentIce: 1, tundra: 1 },
  { windward: 0, lee: 1, permanentIce: 1, tundra: 1 },
  { windward: 1, lee: 1, permanentIce: 0, tundra: 1 },
  { windward: 0.5, lee: 0.5, permanentIce: 0.5, tundra: 0.5, ridgelineExposure: 0.9, shelterPocket: 0.9 },
];
for (const [index, input] of adjustmentCases.entries()) {
  const output = resolveTerrainWindSnowAdjustment(input);
  assertFiniteObject(output, `adjustment-${index}`);
  assert(output.windwardScour >= 0 && output.windwardScour <= 1);
  assert(output.leeDeposit >= 0 && output.leeDeposit <= 1);
  assert(output.scourMax >= 0 && output.scourMax <= 1);
  assert(output.depositMax >= 0 && output.depositMax <= 1);
}

const determinismFixtures = [];
for (let slope = 0; slope <= 70; slope += 5) {
  for (const aspect of [-0.9, -0.45, 0, 0.45, 0.9]) {
    for (const fold of [0, 0.03, 0.08, 0.16, 0.24]) {
      const input = { slopeDegrees: slope, aspectDot: aspect, foldGradient: fold, leeRetention: 0.73 };
      const first = resolveTerrainWindSnowSurfaceFabric(input);
      const second = resolveTerrainWindSnowSurfaceFabric(input);
      const keys = ['slope', 'foldStrength', 'ridgeShoulder', 'brokenRidge', 'shelteredPocket', 'valleyContinuity',
        'windwardGain', 'leeGain', 'retention', 'ridgeCrust', 'leePowder', 'continuity',
        'materialTemperatureBias', 'materialBrightnessBias'];
      for (const key of keys) assert.equal(first[key], second[key], `determinism failed for ${key}`);
      determinismFixtures.push(first);
    }
  }
}
assert.equal(determinismFixtures.length, 15 * 5 * 5);

const uniqueDirectional = new Set(determinismFixtures.map((fabric) => [
  fabric.ridgeCrust.toFixed(6),
  fabric.leePowder.toFixed(6),
  fabric.windwardGain.toFixed(6),
  fabric.leeGain.toFixed(6),
].join('|')));
assert(uniqueDirectional.size > determinismFixtures.length * 0.2,
  'stress matrix collapsed into too few directional surface families');

console.log('[checkTerrainWindSnowEdgeCases] PASS', JSON.stringify({
  scalarStress: scalarStress.length,
  terrainStencilCases: heightTriples.length * spacings.length,
  cliffCases: cliffSamples.length,
  adjustmentCases: adjustmentCases.length,
  deterministicCases: determinismFixtures.length,
  uniqueDirectionalFamilies: uniqueDirectional.size,
}));
