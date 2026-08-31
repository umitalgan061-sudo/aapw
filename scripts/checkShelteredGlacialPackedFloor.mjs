#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  TERRAIN_SNOW_SURFACE_TONE_POLICY as P,
  resolveTerrainSnowSurfaceTone,
} from '../src/3d/world/terrainSnowSurfaceTone.js';

const EPSILON = 1e-9;

assert.equal(P.renderOnly, true);
assert.equal(P.heightAuthorityUnchanged, true);
assert.equal(P.snowCoverageAuthorityUnchanged, true);
assert.equal(P.shelteredPackedFloor, true);
assert(P.shelteredPackedFloorGain >= 0.08 && P.shelteredPackedFloorGain <= 0.16,
  'sheltered packed floor must stay visible but bounded');

const deepPermanentShelter = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.94,
  permanentIce: 1,
  tundra: 1,
  leeDeposit: 0.9,
  concavityHold: 0.86,
  gentleSlope: 0.92,
});
const shallowPermanentShelter = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.34,
  permanentIce: 1,
  tundra: 1,
  leeDeposit: 0.75,
  concavityHold: 0.7,
  gentleSlope: 0.85,
});
const tundraShelter = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.94,
  tundra: 1,
  leeDeposit: 0.9,
  concavityHold: 0.86,
  gentleSlope: 0.92,
});
const transitionShelter = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.94,
  permanentIce: 0.5,
  tundra: 1,
  leeDeposit: 0.9,
  concavityHold: 0.86,
  gentleSlope: 0.92,
});
const permanentWindward = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.94,
  permanentIce: 1,
  tundra: 1,
  windwardScour: 0.94,
  ridgeExposure: 0.9,
});

assert(deepPermanentShelter.glacialPackedFloor > 0,
  'deep permanent-ice shelter must retain a direct packed/cold-family floor');
assert(shallowPermanentShelter.glacialPackedFloor > 0,
  'visible shallow permanent-ice shelter must already retain some packed/cold-family floor');
assert(deepPermanentShelter.glacialPackedFloor > shallowPermanentShelter.glacialPackedFloor,
  'packed floor should strengthen with retained snow depth and shelter');
assert.equal(tundraShelter.glacialPackedFloor, 0,
  'pure tundra must not inherit the permanent-ice packed floor');
assert(transitionShelter.glacialPackedFloor > 0
  && transitionShelter.glacialPackedFloor < deepPermanentShelter.glacialPackedFloor,
  'map-aligned transition shelter should interpolate the packed floor between tundra and permanent ice');
assert(deepPermanentShelter.packedWeight + EPSILON >= deepPermanentShelter.glacialPackedFloor,
  'resolved packed weight must never fall below the authored glacial packed floor');
assert(deepPermanentShelter.accumulatedWeight > 0.16,
  'cold-family floor must not erase the soft accumulated-snow reading in a deep lee bowl');
assert(permanentWindward.packedWeight > deepPermanentShelter.packedWeight,
  'windward ridges must remain more strongly packed than sheltered bowls');

for (const sample of [
  deepPermanentShelter,
  shallowPermanentShelter,
  tundraShelter,
  transitionShelter,
  permanentWindward,
]) {
  for (const key of ['glacialPackedFloor', 'packedWeight', 'accumulatedWeight', 'glacialFamilySupport']) {
    assert(Number.isFinite(sample[key]) && sample[key] >= -EPSILON && sample[key] <= 1 + EPSILON,
      `${key} must remain normalized`);
  }
}

console.log(JSON.stringify({
  policy: P.id,
  shelteredPackedFloorGain: P.shelteredPackedFloorGain,
  deepPackedFloor: deepPermanentShelter.glacialPackedFloor,
  shallowPackedFloor: shallowPermanentShelter.glacialPackedFloor,
  transitionPackedFloor: transitionShelter.glacialPackedFloor,
  tundraPackedFloor: tundraShelter.glacialPackedFloor,
  deepPackedWeight: deepPermanentShelter.packedWeight,
  deepAccumulatedWeight: deepPermanentShelter.accumulatedWeight,
  windwardPackedWeight: permanentWindward.packedWeight,
  heightAuthorityUnchanged: true,
  snowCoverageAuthorityUnchanged: true,
}, null, 2));
