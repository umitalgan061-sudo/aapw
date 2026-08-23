#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TERRAIN_SNOW_SURFACE_TONE_POLICY as P, resolveTerrainSnowSurfaceTone } from '../src/3d/world/terrainSnowSurfaceTone.js';

const EPSILON = 1e-9;
assert.equal(P.renderOnly, true);
assert.equal(P.heightAuthorityUnchanged, true);
assert.equal(P.snowCoverageAuthorityUnchanged, true);
assert(P.minimumAccumulatedSnow > P.minimumVisibleSnow);

const bare = resolveTerrainSnowSurfaceTone({ snowAmount: 0.02, permanentIce: 1, windwardScour: 1, ridgeExposure: 1 });
assert.equal(bare.packedWeight, 0);
assert.equal(bare.accumulatedWeight, 0);

const south = resolveTerrainSnowSurfaceTone({ snowAmount: 0.9, windwardScour: 1, ridgeExposure: 1, leeDeposit: 1, concavityHold: 1 });
assert.equal(south.packedWeight, 0);
assert.equal(south.accumulatedWeight, 0);

const neutral = resolveTerrainSnowSurfaceTone({ snowAmount: 0.82, permanentIce: 1, tundra: 1 });
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

assert(windward.packedWeight > neutral.packedWeight);
assert(windward.packedWeight > windward.accumulatedWeight);
assert(windward.coolShift > 0);
assert(windward.brightnessShift < 0);
assert(lee.accumulatedWeight > neutral.accumulatedWeight);
assert(lee.accumulatedWeight > lee.packedWeight);
assert(lee.coolShift < 0);
assert(lee.brightnessShift > 0);
assert(crosswind.packedWeight < windward.packedWeight);
assert(crosswind.accumulatedWeight < lee.accumulatedWeight);
assert.equal(gentleUnsheltered.gentleShelterSupport, 0, 'gentle slope alone must not create a deep-drift tone');
assert.equal(gentleUnsheltered.accumulatedWeight, 0, 'unsheltered gentle snow should remain neutral/packed');
assert(thinSheltered.visibleSnow > 0, 'thin retained snow should still be visibly snowy');
assert.equal(thinSheltered.accumulationVisibleSnow, 0, 'thin snow veneer must not read as deep accumulated snow');
assert.equal(thinSheltered.accumulatedWeight, 0, 'thin sheltered snow must stay out of accumulated palette');

const tundraPacked = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.82, tundra: 1, windwardScour: 0.92, ridgeExposure: 0.88,
});
assert(windward.packedWeight > tundraPacked.packedWeight);

const mixed = resolveTerrainSnowSurfaceTone({
  snowAmount: 1, permanentIce: 1, tundra: 1,
  windwardScour: 1, leeDeposit: 1, ridgeExposure: 1, concavityHold: 1, gentleSlope: 1,
});
assert(mixed.packedWeight <= P.maximumPackedWeight + EPSILON);
assert(mixed.accumulatedWeight <= P.maximumAccumulatedWeight + EPSILON);

for (const sample of [
  bare, south, neutral, windward, lee, crosswind, gentleUnsheltered, thinSheltered, tundraPacked, mixed,
]) {
  for (const key of ['visibleSnow', 'accumulationVisibleSnow', 'climate', 'packedWeight', 'accumulatedWeight', 'neutralWeight']) {
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
assert.match(shadingSource, /snowTone\.packedWeight/);
assert.match(shadingSource, /snowTone\.accumulatedWeight/);
assert.match(shadingSource, /target\.lerp\(scratchSnowTone, snow\.snowAmount\)/);
assert.match(shadingSource, /heightAuthorityUnchanged:\s*true/);
assert.doesNotMatch(shadingSource, /heightAboveSeaMeters\s*[+\-]=/);

console.log(JSON.stringify({
  policy: P.id,
  windwardPackedWeight: windward.packedWeight,
  leeAccumulatedWeight: lee.accumulatedWeight,
  gentleUnshelteredAccumulatedWeight: gentleUnsheltered.accumulatedWeight,
  thinShelteredAccumulatedWeight: thinSheltered.accumulatedWeight,
  tundraPackedWeight: tundraPacked.packedWeight,
  runtimeIntegrated: true,
}, null, 2));
