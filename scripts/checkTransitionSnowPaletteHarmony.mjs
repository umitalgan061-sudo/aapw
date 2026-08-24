#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  TERRAIN_SNOW_SURFACE_TONE_POLICY as P,
  resolveTerrainSnowSurfaceTone,
} from '../src/3d/world/terrainSnowSurfaceTone.js';

assert.equal(P.transitionAccumulationHarmony, true);
assert.equal(P.transitionLowlandHarmony, true);
assert(P.transitionAccumulationCoolingGain > 0 && P.transitionAccumulationCoolingGain <= 0.2,
  'transition accumulation cooling must stay positive and visually bounded');
assert(P.packedTransitionColdGain >= 0.06 && P.packedTransitionColdGain <= 0.09,
  'mixed cryosphere snow should keep a visible but bounded glacial lowland bridge');
assert(P.packedGlacialPaletteFloorGain >= 0.23 && P.packedGlacialPaletteFloorGain <= 0.28,
  'permanent-ice snow palette floor should remain strong enough to harmonise with glacial lowland');

const sheltered = (permanentIce) => resolveTerrainSnowSurfaceTone({
  snowAmount: 0.86,
  permanentIce,
  tundra: 1,
  leeDeposit: 0.88,
  concavityHold: 0.82,
  gentleSlope: 0.9,
});

const exposed = (permanentIce) => resolveTerrainSnowSurfaceTone({
  snowAmount: 0.46,
  permanentIce,
  tundra: 1,
  ridgeExposure: 0.18,
});

const tundra = sheltered(0);
const quarterIce = sheltered(0.25);
const midIce = sheltered(0.5);
const threeQuarterIce = sheltered(0.75);
const permanentIce = sheltered(1);
const exposedTundra = exposed(0);
const exposedQuarter = exposed(0.25);
const exposedMid = exposed(0.5);
const exposedThreeQuarter = exposed(0.75);
const exposedPermanent = exposed(1);

assert.equal(tundra.transitionAccumulationCooling, 0,
  'pure tundra must not receive transition-only cooling');
assert.equal(permanentIce.transitionAccumulationCooling, 0,
  'pure permanent ice must not receive transition-only cooling');
assert(midIce.transitionAccumulationCooling > quarterIce.transitionAccumulationCooling,
  'transition cooling should strengthen toward the mixed cryosphere midpoint');
assert(midIce.transitionAccumulationCooling > threeQuarterIce.transitionAccumulationCooling,
  'transition cooling should peak near the mixed cryosphere midpoint');
assert(midIce.transitionAccumulationCooling <= P.transitionAccumulationCoolingGain + 1e-9,
  'transition cooling must respect the authored maximum gain');
assert(midIce.accumulationClimateScale < tundra.accumulationClimateScale,
  'mixed cryosphere shelter should reduce warm accumulated-snow tint relative to tundra');
assert(midIce.accumulatedWeight < tundra.accumulatedWeight,
  'mixed cryosphere shelter should stay less cream-tinted than equivalent tundra shelter');
assert(midIce.accumulatedWeight > 0,
  'transition shelter must retain a visible accumulated-snow character');

assert.equal(exposedTundra.transitionColdSupport, 0,
  'pure tundra must not receive transition-only packed support');
assert.equal(exposedPermanent.transitionColdSupport, 0,
  'pure permanent ice must not receive transition-only packed support');
assert(exposedMid.transitionColdSupport > exposedQuarter.transitionColdSupport,
  'transition cold support should strengthen toward the mixed cryosphere midpoint');
assert(exposedMid.transitionColdSupport > exposedThreeQuarter.transitionColdSupport,
  'transition cold support should peak near the mixed cryosphere midpoint');
assert(exposedMid.transitionColdSupport <= P.packedTransitionColdGain + 1e-9,
  'transition cold support must respect the authored packed gain');
assert(exposedMid.packedWeight > exposedTundra.packedWeight,
  'ICE EDGE retained snow should read colder than same-depth pure tundra snow');
assert(exposedPermanent.packedWeight > exposedMid.packedWeight,
  'full permanent ice should remain colder than the mixed transition');

const unshelteredMid = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.86,
  permanentIce: 0.5,
  tundra: 1,
  ridgeExposure: 0.4,
});
assert.equal(unshelteredMid.transitionAccumulationCooling, 0,
  'transition cooling must require genuine lee/concavity shelter');
assert(unshelteredMid.transitionColdSupport > 0,
  'unsheltered mixed cryosphere snow should still keep the lowland glacial colour bridge');

const thinMid = resolveTerrainSnowSurfaceTone({
  snowAmount: P.minimumVisibleSnow + 0.08,
  permanentIce: 0.5,
  tundra: 1,
  leeDeposit: 1,
  concavityHold: 1,
});
assert.equal(thinMid.accumulationVisibleSnow, 0,
  'thin snow below the accumulated threshold should not receive deep-drift cooling');
assert.equal(thinMid.transitionAccumulationCooling, 0,
  'thin veneer must not activate transition accumulation cooling');
assert(thinMid.transitionColdSupport > 0,
  'thin visible transition snow should retain a bounded glacial-family colour connection');

let maxCoolingStep = 0;
let maxAccumulatedStep = 0;
let maxColdSupportStep = 0;
let maxPackedStep = 0;
let previous = sheltered(0);
let previousExposed = exposed(0);
for (let i = 1; i <= 40; i += 1) {
  const current = sheltered(i / 40);
  const currentExposed = exposed(i / 40);
  maxCoolingStep = Math.max(
    maxCoolingStep,
    Math.abs(current.transitionAccumulationCooling - previous.transitionAccumulationCooling),
  );
  maxAccumulatedStep = Math.max(
    maxAccumulatedStep,
    Math.abs(current.accumulatedWeight - previous.accumulatedWeight),
  );
  maxColdSupportStep = Math.max(
    maxColdSupportStep,
    Math.abs(currentExposed.transitionColdSupport - previousExposed.transitionColdSupport),
  );
  maxPackedStep = Math.max(
    maxPackedStep,
    Math.abs(currentExposed.packedWeight - previousExposed.packedWeight),
  );
  assert(current.transitionAccumulationCooling >= 0 && current.transitionAccumulationCooling <= 1);
  assert(current.accumulationClimateScale >= 0 && current.accumulationClimateScale <= 1);
  assert(currentExposed.transitionColdSupport >= 0 && currentExposed.transitionColdSupport <= 1);
  assert(currentExposed.packedWeight >= 0 && currentExposed.packedWeight <= 1);
  previous = current;
  previousExposed = currentExposed;
}

assert(maxCoolingStep < 0.012,
  `transition cooling should remain locally smooth; step=${maxCoolingStep}`);
assert(maxAccumulatedStep < 0.03,
  `accumulated-snow tone should remain locally smooth; step=${maxAccumulatedStep}`);
assert(maxColdSupportStep < 0.009,
  `transition glacial support should remain locally smooth; step=${maxColdSupportStep}`);
assert(maxPackedStep < 0.03,
  `transition packed-snow tone should remain locally smooth; step=${maxPackedStep}`);

console.log(JSON.stringify({
  policy: P.id,
  tundraAccumulatedWeight: tundra.accumulatedWeight,
  midAccumulatedWeight: midIce.accumulatedWeight,
  permanentIceAccumulatedWeight: permanentIce.accumulatedWeight,
  midTransitionAccumulationCooling: midIce.transitionAccumulationCooling,
  exposedTundraPackedWeight: exposedTundra.packedWeight,
  exposedMidPackedWeight: exposedMid.packedWeight,
  exposedPermanentPackedWeight: exposedPermanent.packedWeight,
  midTransitionColdSupport: exposedMid.transitionColdSupport,
  maxCoolingStep,
  maxAccumulatedStep,
  maxColdSupportStep,
  maxPackedStep,
  heightAuthorityUnchanged: P.heightAuthorityUnchanged,
  snowCoverageAuthorityUnchanged: P.snowCoverageAuthorityUnchanged,
}, null, 2));
