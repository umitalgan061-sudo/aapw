#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  TERRAIN_SNOW_SURFACE_TONE_POLICY as P,
  resolveTerrainSnowSurfaceTone,
} from '../src/3d/world/terrainSnowSurfaceTone.js';

assert.equal(P.transitionAccumulationHarmony, true);
assert(P.transitionAccumulationCoolingGain > 0 && P.transitionAccumulationCoolingGain <= 0.2,
  'transition accumulation cooling must stay positive and visually bounded');

const sheltered = (permanentIce) => resolveTerrainSnowSurfaceTone({
  snowAmount: 0.86,
  permanentIce,
  tundra: 1,
  leeDeposit: 0.88,
  concavityHold: 0.82,
  gentleSlope: 0.9,
});

const tundra = sheltered(0);
const quarterIce = sheltered(0.25);
const midIce = sheltered(0.5);
const threeQuarterIce = sheltered(0.75);
const permanentIce = sheltered(1);

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

const unshelteredMid = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.86,
  permanentIce: 0.5,
  tundra: 1,
  ridgeExposure: 0.4,
});
assert.equal(unshelteredMid.transitionAccumulationCooling, 0,
  'transition cooling must require genuine lee/concavity shelter');

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

let maxCoolingStep = 0;
let maxAccumulatedStep = 0;
let previous = sheltered(0);
for (let i = 1; i <= 40; i += 1) {
  const current = sheltered(i / 40);
  maxCoolingStep = Math.max(
    maxCoolingStep,
    Math.abs(current.transitionAccumulationCooling - previous.transitionAccumulationCooling),
  );
  maxAccumulatedStep = Math.max(
    maxAccumulatedStep,
    Math.abs(current.accumulatedWeight - previous.accumulatedWeight),
  );
  assert(current.transitionAccumulationCooling >= 0 && current.transitionAccumulationCooling <= 1);
  assert(current.accumulationClimateScale >= 0 && current.accumulationClimateScale <= 1);
  previous = current;
}

assert(maxCoolingStep < 0.012,
  `transition cooling should remain locally smooth; step=${maxCoolingStep}`);
assert(maxAccumulatedStep < 0.03,
  `accumulated-snow tone should remain locally smooth; step=${maxAccumulatedStep}`);

console.log(JSON.stringify({
  policy: P.id,
  tundraAccumulatedWeight: tundra.accumulatedWeight,
  midAccumulatedWeight: midIce.accumulatedWeight,
  permanentIceAccumulatedWeight: permanentIce.accumulatedWeight,
  midTransitionAccumulationCooling: midIce.transitionAccumulationCooling,
  maxCoolingStep,
  maxAccumulatedStep,
  heightAuthorityUnchanged: P.heightAuthorityUnchanged,
  snowCoverageAuthorityUnchanged: P.snowCoverageAuthorityUnchanged,
}, null, 2));
