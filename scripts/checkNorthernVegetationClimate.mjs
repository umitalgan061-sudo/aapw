#!/usr/bin/env node
import assert from 'node:assert/strict';
import { WORLD_SCALE } from '../src/3d/config.js';
import { WORLD_REFERENCE_ALIGNMENT } from '../src/3d/world/worldReferenceAlignment.js';
import {
  VEGETATION_NORTH_CLIMATE_POLICY,
  pickSpeciesIndex,
  pickSpeciesIndexForWorldZ,
  vegetationSpeciesId,
} from '../src/3d/world/vegetation.js';
import { northClimateWeightsAtWorldZ } from '../src/3d/world/terrainBiomeShading.js';

function worldZForNormalizedMapY(normalizedY) {
  const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
  const mapY = normalizedY * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
  return (mapY - centerMapY) * WORLD_SCALE.METERS_PER_MAP_UNIT;
}

const farNorthZ = worldZForNormalizedMapY(0.06);
const iceEdgeZ = worldZForNormalizedMapY(0.17);
const tundraZ = worldZForNormalizedMapY(0.32);
const southZ = worldZForNormalizedMapY(0.62);

const farNorth = northClimateWeightsAtWorldZ(farNorthZ);
const iceEdge = northClimateWeightsAtWorldZ(iceEdgeZ);
const tundra = northClimateWeightsAtWorldZ(tundraZ);
const south = northClimateWeightsAtWorldZ(southZ);

assert(farNorth.permanentIce > VEGETATION_NORTH_CLIMATE_POLICY.permanentIceSnowOnlyThreshold,
  'far-north fixture must be inside permanent-ice snow-only vegetation');
assert(iceEdge.permanentIce > 0 && iceEdge.permanentIce < 1,
  'ice-edge fixture must exercise a partial permanent-ice transition');
assert(tundra.tundra >= VEGETATION_NORTH_CLIMATE_POLICY.tundraClimateThreshold,
  'tundra fixture must exercise climate-biased vegetation');
assert(south.permanentIce === 0 && south.tundra === 0,
  'south fixture must be outside the northern climate override');

for (const roll of [0, 0.1, 0.35, 0.7, 0.999999]) {
  assert.equal(
    vegetationSpeciesId(pickSpeciesIndexForWorldZ(roll, farNorthZ)),
    'snow-pine',
    `permanent ice must never receive green vegetation (roll=${roll})`,
  );
}

for (const roll of [0, 0.15, 0.4, 0.75, 0.999999]) {
  const id = vegetationSpeciesId(pickSpeciesIndexForWorldZ(roll, tundraZ));
  assert(['pine', 'snow-pine'].includes(id), `tundra must suppress broadleaf round crowns, got ${id}`);
}

assert.equal(vegetationSpeciesId(pickSpeciesIndexForWorldZ(0.01, tundraZ)), 'snow-pine',
  'tundra must retain a deterministic snow-pine share');
assert.equal(vegetationSpeciesId(pickSpeciesIndexForWorldZ(0.999, tundraZ)), 'pine',
  'tundra transition must retain some ordinary dark pine before permanent ice');

for (const roll of [0.05, 0.59, 0.61, 0.95]) {
  assert.equal(
    pickSpeciesIndexForWorldZ(roll, southZ),
    pickSpeciesIndex(roll),
    `temperate south must preserve historic species weighting (roll=${roll})`,
  );
}

assert.deepEqual(
  VEGETATION_NORTH_CLIMATE_POLICY.verifiedAssetCandidates,
  [
    'assets/models/vegetation/winter_tree.glb',
    'assets/models/vegetation/dead_trees_with_snow_iEuwXWner0.glb',
  ],
  'verified winter asset candidates should remain explicitly documented',
);
assert.equal(VEGETATION_NORTH_CLIMATE_POLICY.liveRepresentation, 'instanced-procedural-snow-pine');

console.log('[checkNorthernVegetationClimate] PASS', JSON.stringify({
  farNorth,
  iceEdge,
  tundra,
  south,
  liveRepresentation: VEGETATION_NORTH_CLIMATE_POLICY.liveRepresentation,
}));
