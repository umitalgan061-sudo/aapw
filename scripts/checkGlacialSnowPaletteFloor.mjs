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
assert.equal(P.glacialPaletteFloor, true);
assert(P.packedGlacialPaletteFloorGain >= 0.16 && P.packedGlacialPaletteFloorGain <= 0.28,
  'glacial palette floor should remain visible but bounded');
assert(P.packedGlacialPaletteDepthGain >= 0.05 && P.packedGlacialPaletteDepthGain <= 0.14,
  'retained snow depth may strengthen the palette bridge only modestly');
assert(P.packedGlacialPaletteShelterRetention >= 0.6 && P.packedGlacialPaletteShelterRetention <= 0.85,
  'deep shelter should soften rather than erase the glacial palette bridge');

const neutralPermanent = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.82,
  permanentIce: 1,
  tundra: 1,
});
const shallowPermanentShelter = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.34,
  permanentIce: 1,
  tundra: 1,
  leeDeposit: 0.7,
  concavityHold: 0.65,
  gentleSlope: 0.8,
});
const deepPermanentShelter = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.94,
  permanentIce: 1,
  tundra: 1,
  leeDeposit: 0.82,
  concavityHold: 0.78,
  gentleSlope: 0.88,
});
const transitionShelter = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.94,
  permanentIce: 0.5,
  tundra: 1,
  leeDeposit: 0.82,
  concavityHold: 0.78,
  gentleSlope: 0.88,
});
const tundraShelter = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.94,
  permanentIce: 0,
  tundra: 1,
  leeDeposit: 0.82,
  concavityHold: 0.78,
  gentleSlope: 0.88,
});
const snowFreePermanent = resolveTerrainSnowSurfaceTone({
  snowAmount: 0.04,
  permanentIce: 1,
  tundra: 1,
});

assert(neutralPermanent.glacialPaletteFloor > 0,
  'retained permanent-ice snow should expose a direct glacial palette floor');
assert(shallowPermanentShelter.glacialPaletteFloor > 0,
  'shallow permanent-ice shelter should already stay connected to the glacial palette');
assert(deepPermanentShelter.glacialPaletteFloor > shallowPermanentShelter.glacialPaletteFloor,
  'deeper retained permanent-ice snow should strengthen the palette bridge overall');
assert(deepPermanentShelter.glacialPaletteFloor > deepPermanentShelter.glacialPackedFloor,
  'broad glacial palette floor should carry more continuity than the legacy shelter-only packed floor');
assert(deepPermanentShelter.packedWeight + EPSILON >= deepPermanentShelter.glacialPaletteFloor,
  'resolved packed tint must never fall below the authored glacial palette floor');
assert(transitionShelter.glacialPaletteFloor > 0
  && transitionShelter.glacialPaletteFloor < deepPermanentShelter.glacialPaletteFloor,
  'map-aligned transition snow should bridge smoothly between tundra and permanent ice');
assert.equal(tundraShelter.glacialPaletteFloor, 0,
  'pure tundra snow must not inherit a permanent-ice palette floor');
assert.equal(snowFreePermanent.glacialPaletteFloor, 0,
  'snow-free permanent ice must not receive a fake snow tint');
assert(deepPermanentShelter.accumulatedWeight > 0.14,
  'stronger cold-family continuity must preserve the soft accumulated-snow reading in lee bowls');
assert(deepPermanentShelter.packedWeight < 0.35,
  'sheltered palette continuity must remain visibly softer than a packed windward slab');

for (const sample of [
  neutralPermanent,
  shallowPermanentShelter,
  deepPermanentShelter,
  transitionShelter,
  tundraShelter,
  snowFreePermanent,
]) {
  for (const key of [
    'glacialPaletteFloor',
    'glacialPackedFloor',
    'glacialFamilySupport',
    'packedWeight',
    'accumulatedWeight',
    'visibleSnow',
  ]) {
    assert(Number.isFinite(sample[key]) && sample[key] >= -EPSILON && sample[key] <= 1 + EPSILON,
      `${key} must remain normalized`);
  }
}

console.log(JSON.stringify({
  policy: P.id,
  neutralPaletteFloor: neutralPermanent.glacialPaletteFloor,
  shallowShelterPaletteFloor: shallowPermanentShelter.glacialPaletteFloor,
  deepShelterPaletteFloor: deepPermanentShelter.glacialPaletteFloor,
  deepShelterLegacyPackedFloor: deepPermanentShelter.glacialPackedFloor,
  deepShelterPackedWeight: deepPermanentShelter.packedWeight,
  deepShelterAccumulatedWeight: deepPermanentShelter.accumulatedWeight,
  transitionPaletteFloor: transitionShelter.glacialPaletteFloor,
  tundraPaletteFloor: tundraShelter.glacialPaletteFloor,
  heightAuthorityUnchanged: P.heightAuthorityUnchanged,
  snowCoverageAuthorityUnchanged: P.snowCoverageAuthorityUnchanged,
}, null, 2));
