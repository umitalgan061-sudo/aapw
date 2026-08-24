#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TERRAIN_SNOW_SURFACE_TONE_POLICY as P, resolveTerrainSnowSurfaceTone } from '../src/3d/world/terrainSnowSurfaceTone.js';

const EPSILON = 1e-9;
assert.equal(P.renderOnly, true);
assert.equal(P.heightAuthorityUnchanged, true);
assert.equal(P.snowCoverageAuthorityUnchanged, true);
assert.equal(P.cryosphereToneUnion, true);
assert.equal(P.glacialFamilyBridge, true, 'far-north mountain snow should bridge into the glacial palette family');
assert(P.glacialVisibilityExponent > 0.5 && P.glacialVisibilityExponent < 1,
  'thin-snow glacial visibility curve should be sub-linear but bounded');
assert(P.minimumAccumulatedSnow > P.minimumVisibleSnow);
assert(P.accumulatedPermanentIceScale < 1, 'permanent ice should temper warm accumulated-snow tint');
assert(P.packedGlacialContinuityGain > 0, 'permanent ice should reinforce the packed/cold snow family');
assert(P.packedGlacialFamilyGain > 0 && P.packedGlacialFamilyGain <= 0.2,
  'glacial-family bridge should stay positive but visually bounded');
assert(P.packedTransitionColdGain > 0, 'ice transition should carry bounded cold-tone support');

const bare = resolveTerrainSnowSurfaceTone({ snowAmount: 0.02, permanentIce: 1, windwardScour: 1, ridgeExposure: 1 });
assert.equal(bare.packedWeight, 0);
assert.equal(bare.accumulatedWeight, 0);

const south = resolveTerrainSnowSurfaceTone({ snowAmount: 0.9, windwardScour: 1, ridgeExposure: 1, leeDeposit: 1, concavityHold: 1 });
assert.equal(south.packedWeight, 0);
assert.equal(south.accumulatedWeight, 0);

const neutral = resolveTerrainSnowSurfaceTone({ snowAmount: 0.82, permanentIce: 1, tundra: 1 });
const neutralTundra = resolveTerrainSnowSurfaceTone({ snowAmount: 0.82, tundra: 1 });
const windward = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.82, permanentIce: 1, tundra: 1,
  windwardScour: 0.92, ridgeExposure: 0.88, gentleSlope: 0.1,
});
const lee = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.82, permanentIce: 1, tundra: 1,
  leeDeposit: 0.9, concavityHold: 0.85, gentleSlope: 0.9,
});
const crosswind = resolveTerrainSnowSurfaceTone({ snowAmount: 0.82, permanentIce: 1, tundra: 1, gentleSlope: 0.15 });
const gentleUnsheltered = resolveTerrainSnowSurfaceTone({ snowAmount: 0.82, permanentIce: 1, gentleSlope: 1 });
const thinSheltered = resolveTerrainSnowSurfaceTone({
  snowAmount: (P.minimumVisibleSnow + P.minimumAccumulatedSnow) * 0.5,
  permanentIce: 1,
  leeDeposit: 1,
  concavityHold: 1,
  gentleSlope: 1,
});
const thinPermanent = resolveTerrainSnowSurfaceTone({
  snowAmount: P.minimumVisibleSnow + 0.18,
  permanentIce: 1,
  ridgeExposure: 0.35,
});
const thinTundra = resolveTerrainSnowSurfaceTone({
  snowAmount: P.minimumVisibleSnow + 0.18,
  tundra: 1,
  ridgeExposure: 0.35,
});

assert(windward.packedWeight > neutral.packedWeight);
assert(windward.packedWeight > windward.accumulatedWeight);
assert(windward.coolShift > 0);
assert(windward.brightnessShift < 0);
assert(lee.accumulatedWeight > neutral.accumulatedWeight);
assert(lee.accumulatedWeight > lee.packedWeight);
assert(lee.coolShift < neutral.coolShift,
  'sheltered glacial snow may retain a cold-family bridge but must stay softer than neutral retained snow');
assert(lee.coolShift < windward.coolShift,
  'lee-side accumulated snow must stay visually softer than windward packed snow');
assert(lee.brightnessShift > 0);
assert(crosswind.packedWeight < windward.packedWeight);
assert(crosswind.accumulatedWeight < lee.accumulatedWeight);
assert.equal(gentleUnsheltered.gentleShelterSupport, 0, 'gentle slope alone must not create a deep-drift tone');
assert.equal(gentleUnsheltered.accumulatedWeight, 0, 'unsheltered gentle snow should remain neutral/packed');
assert(thinSheltered.visibleSnow > 0, 'thin retained snow should still be visibly snowy');
assert.equal(thinSheltered.accumulationVisibleSnow, 0, 'thin snow veneer must not read as deep accumulated snow');
assert.equal(thinSheltered.accumulatedWeight, 0, 'thin sheltered snow must stay out of accumulated palette');
assert(thinPermanent.visibleSnow > 0 && thinPermanent.visibleSnow < 0.5,
  'thin permanent-ice fixture should remain close to the visible-snow threshold');
assert(thinPermanent.glacialVisibility > thinPermanent.visibleSnow,
  'sub-linear glacial visibility should keep thin far-north snow tied to the cold family');
assert(thinPermanent.glacialContinuity > 0,
  'thin permanent-ice snow should retain a non-zero glacial bridge');
assert(thinPermanent.packedWeight > thinTundra.packedWeight,
  'thin permanent-ice snow should stay colder than same-depth tundra snow without adding coverage');
assert(neutral.glacialFamilySupport > 0,
  'neutral permanent-ice mountain snow must receive glacial-family colour support');
assert.equal(neutralTundra.glacialFamilySupport, 0,
  'pure tundra snow must not inherit permanent-ice glacial-family support');
assert(neutral.packedWeight > neutralTundra.packedWeight,
  'neutral permanent-ice snow should stay visually colder than equivalent pure tundra snow');
assert(lee.glacialFamilySupport < neutral.glacialFamilySupport,
  'deep sheltered lee snow must taper the glacial bridge to preserve a softer accumulated-snow character');

const tundraPacked = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.82, tundra: 1, windwardScour: 0.92, ridgeExposure: 0.88,
});
const tundraLee = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.82, tundra: 1, leeDeposit: 0.9, concavityHold: 0.85, gentleSlope: 0.9,
});
assert(windward.packedWeight > tundraPacked.packedWeight);
assert(windward.glacialContinuity > tundraPacked.glacialContinuity);
assert(lee.accumulationClimateScale < tundraLee.accumulationClimateScale);
assert(lee.accumulatedWeight < tundraLee.accumulatedWeight,
  'permanent-ice drifts should stay soft but less cream-tinted than equivalent tundra drifts');
assert(lee.accumulatedWeight > 0, 'permanent-ice lee bowls must retain visible accumulated-snow character');

// The map-aligned north combines authored tundra and permanent-ice fields. Tone influence should
// cross that overlap smoothly rather than producing a max()-selection kink where their weights meet.
const transitionSamples = [];
let maxClimateStep = 0;
let maxPackedStep = 0;
for (let i = 0; i <= 40; i += 1) {
  const permanentIce = i / 40;
  const tundra = 1 - permanentIce * 0.35;
  const sample = resolveTerrainSnowSurfaceTone({
    snowAmount: 0.82,
    permanentIce,
    tundra,
    windwardScour: 0.68,
    ridgeExposure: 0.55,
  });
  transitionSamples.push(sample);
  if (i > 0) {
    const previous = transitionSamples[i - 1];
    maxClimateStep = Math.max(maxClimateStep, Math.abs(sample.climate - previous.climate));
    maxPackedStep = Math.max(maxPackedStep, Math.abs(sample.packedWeight - previous.packedWeight));
  }
}
assert(maxClimateStep < 0.03, `cryosphere tone climate should stay locally smooth; step=${maxClimateStep}`);
assert(maxPackedStep < 0.035, `packed-snow tone should stay locally smooth across ice transition; step=${maxPackedStep}`);
assert.equal(transitionSamples[0].transitionColdSupport, 0, 'pure tundra endpoint needs no transition-only cold support');
assert.equal(transitionSamples.at(-1).transitionColdSupport, 0, 'pure permanent-ice endpoint needs no transition-only cold support');
assert(transitionSamples[20].transitionColdSupport > 0, 'mixed cryosphere should receive bounded transition cold support');
assert(transitionSamples[20].climate > Math.max(0.5, (1 - 0.5 * 0.35) * P.tundraToneScale),
  'bounded union should retain both overlapping climate influences rather than selecting only one');

const mixed = resolveTerrainSnowSurfaceTone({
  snowAmount: 1, permanentIce: 1, tundra: 1,
  windwardScour: 1, leeDeposit: 1, ridgeExposure: 1, concavityHold: 1, gentleSlope: 1,
});
assert(mixed.packedWeight <= P.maximumPackedWeight + EPSILON);
assert(mixed.accumulatedWeight <= P.maximumAccumulatedWeight + EPSILON);

for (const sample of [
  bare, south, neutral, neutralTundra, windward, lee, crosswind, gentleUnsheltered, thinSheltered,
  thinPermanent, thinTundra, tundraPacked, tundraLee, mixed, ...transitionSamples,
]) {
  for (const key of [
    'visibleSnow', 'accumulationVisibleSnow', 'climate', 'tundraToneWeight', 'glacialVisibility',
    'glacialContinuity', 'glacialFamilySupport', 'transitionColdSupport', 'accumulationClimateScale',
    'packedWeight', 'accumulatedWeight', 'neutralWeight',
  ]) {
    assert(Number.isFinite(sample[key]) && sample[key] >= 0 && sample[key] <= 1, `${key} must be normalized`);
  }
  assert(Number.isFinite(sample.coolShift));
  assert(Number.isFinite(sample.brightnessShift));
  if ('shelterSignal' in sample) {
    assert(sample.shelterSignal >= 0 && sample.shelterSignal <= 1);
    assert(sample.gentleShelterSupport >= 0 && sample.gentleShelterSupport <= P.accumulatedGentleSlopeGain + EPSILON);
  }
}

const shadingSource = readFileSync(new URL('../src/3d/world/terrainBiomeShading.js', import.meta.url), 'utf8');
assert.match(shadingSource, /resolveTerrainSnowSurfaceTone/);
assert.match(shadingSource, /PACKED_SNOW/);
assert.match(shadingSource, /ACCUMULATED_SNOW/);
assert.match(shadingSource, /GLACIAL_ICE/);
assert.match(shadingSource, /COASTAL_ICE/);
assert.match(shadingSource, /snowTone\.packedWeight/);
assert.match(shadingSource, /snowTone\.accumulatedWeight/);
assert.match(shadingSource, /target\.lerp\(scratchSnowTone, snow\.snowAmount\)/);
assert.match(shadingSource, /heightAuthorityUnchanged:\s*true/);
assert.doesNotMatch(shadingSource, /heightAboveSeaMeters\s*[+\-]=/);

console.log(JSON.stringify({
  policy: P.id,
  windwardPackedWeight: windward.packedWeight,
  leeAccumulatedWeight: lee.accumulatedWeight,
  tundraLeeAccumulatedWeight: tundraLee.accumulatedWeight,
  glacialContinuity: windward.glacialContinuity,
  neutralGlacialFamilySupport: neutral.glacialFamilySupport,
  shelteredGlacialFamilySupport: lee.glacialFamilySupport,
  thinPermanentVisibleSnow: thinPermanent.visibleSnow,
  thinPermanentGlacialVisibility: thinPermanent.glacialVisibility,
  thinPermanentPackedWeight: thinPermanent.packedWeight,
  thinTundraPackedWeight: thinTundra.packedWeight,
  permanentIceAccumulationScale: lee.accumulationClimateScale,
  transitionMidColdSupport: transitionSamples[20].transitionColdSupport,
  transitionMaxClimateStep: maxClimateStep,
  transitionMaxPackedStep: maxPackedStep,
  gentleUnshelteredAccumulatedWeight: gentleUnsheltered.accumulatedWeight,
  thinShelteredAccumulatedWeight: thinSheltered.accumulatedWeight,
  tundraPackedWeight: tundraPacked.packedWeight,
  runtimeIntegrated: true,
}, null, 2));
