#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_SCALE } from '../src/3d/config.js';
import { normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';
import {
  VEGETATION_SPATIAL_PATTERN_POLICY,
  createVegetation,
  disposeVegetation,
} from '../src/3d/world/vegetation.js';
import { northReferenceCryosphereAtWorldXZ } from '../src/3d/world/northReferenceCryosphere.js';

function worldAt(normalizedX, normalizedY) {
  return normalizedReferenceToWorldXZ(
    normalizedX,
    normalizedY,
    WORLD_SCALE.MAP_BOUNDS,
    WORLD_SCALE.METERS_PER_MAP_UNIT,
  );
}

// Size the deterministic scatter disc from the authored 2D winter core so the fixture exercises the
// ice core, transition belt, tundra and temperate south in one production scatter. The ecological
// contract now expects the core itself to stay treeless while snow pine survives around its ecotone.
const winterCore = worldAt(0.145, 0.115);
const requiredRadius = Math.hypot(winterCore.x, winterCore.z) + 900;
const result = createVegetation({
  sampleHeightMeters: () => 120,
  seaLevelMeters: 0,
  seed: 0x57494e54,
  seats: [],
  roadEdges: [],
  radiusMeters: requiredRadius,
  densityPerKm2: 18,
});

assert(result.placedCount > 100, 'runtime fixture must scatter enough trees to exercise climate bands');
assert(result.winterTreeCount > 0, 'runtime scatter must contain winter trees');
assert.equal(result.group.userData.northClimateVegetation?.winterTreeCount, result.winterTreeCount);
assert.equal(result.group.userData.northClimateVegetation?.liveRepresentation, 'instanced-procedural-snow-pine');
assert(result.group.userData.vegetationSpatialPattern?.permanentIceRejectedCount > 0,
  'runtime scatter must prove that permanent-ice candidates are ecologically rejected');

const snowTrunks = result.group.getObjectByName('vegetation-snow-pine-trunks');
const roundTrunks = result.group.getObjectByName('vegetation-round-trunks');
const pineTrunks = result.group.getObjectByName('vegetation-pine-trunks');
assert(snowTrunks?.isInstancedMesh, 'snow-pine InstancedMesh must exist in live vegetation group');
assert(roundTrunks?.isInstancedMesh, 'round-crown InstancedMesh must remain available south of tundra');
assert(pineTrunks?.isInstancedMesh, 'ordinary pine InstancedMesh must remain available');
assert.equal(snowTrunks.count, result.winterTreeCount, 'reported winter count must match rendered instances');

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const iceCutoff = VEGETATION_SPATIAL_PATTERN_POLICY.permanentIceTreeCutoff;
let snowInEcotone = 0;
let snowInPermanentIce = 0;
let greenRoundInFrozenClimate = 0;
let roundInPermanentIce = 0;
let ordinaryPineInPermanentIce = 0;
let temperateRound = 0;

for (let i = 0; i < snowTrunks.count; i += 1) {
  snowTrunks.getMatrixAt(i, matrix);
  matrix.decompose(position, quaternion, scale);
  const climate = northReferenceCryosphereAtWorldXZ(position.x, position.z);
  assert(
    Math.max(climate.permanentIce, climate.tundra) >= 0.20,
    `snow pine ${i} escaped map-aligned northern climate at x=${position.x}, z=${position.z}`,
  );
  if (climate.permanentIce >= iceCutoff) snowInPermanentIce += 1;
  else snowInEcotone += 1;
}

for (let i = 0; i < roundTrunks.count; i += 1) {
  roundTrunks.getMatrixAt(i, matrix);
  matrix.decompose(position, quaternion, scale);
  const climate = northReferenceCryosphereAtWorldXZ(position.x, position.z);
  if (Math.max(climate.permanentIce, climate.tundra) >= 0.20) greenRoundInFrozenClimate += 1;
  if (climate.permanentIce >= iceCutoff) roundInPermanentIce += 1;
  if (climate.permanentIce === 0 && climate.tundra === 0) temperateRound += 1;
}

for (let i = 0; i < pineTrunks.count; i += 1) {
  pineTrunks.getMatrixAt(i, matrix);
  matrix.decompose(position, quaternion, scale);
  const climate = northReferenceCryosphereAtWorldXZ(position.x, position.z);
  if (climate.permanentIce >= iceCutoff) ordinaryPineInPermanentIce += 1;
}

assert(snowInEcotone > 0, 'map-aligned tundra/ice ecotone must retain visible snow-pine instances');
assert.equal(snowInPermanentIce, 0, 'permanent-ice core must not render snow-pine trees');
assert.equal(roundInPermanentIce, 0, 'permanent-ice core must not render broadleaf trees');
assert.equal(greenRoundInFrozenClimate, 0, 'broadleaf green round crowns must be absent from map-aligned tundra/ice');
assert.equal(ordinaryPineInPermanentIce, 0, 'ordinary green pine must be absent from map-aligned permanent ice');
assert(temperateRound > 0, 'temperate map zones must still retain round-crown variety');

disposeVegetation(result.group);
console.log('[checkNorthernVegetationRuntime] PASS', JSON.stringify({
  placedCount: result.placedCount,
  winterTreeCount: result.winterTreeCount,
  snowInEcotone,
  snowInPermanentIce,
  permanentIceRejectedCount: result.group.userData.vegetationSpatialPattern?.permanentIceRejectedCount,
  temperateRound,
  radiusMeters: requiredRadius,
  winterCore,
}));