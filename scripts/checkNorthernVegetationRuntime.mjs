#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_SCALE } from '../src/3d/config.js';
import { WORLD_REFERENCE_ALIGNMENT } from '../src/3d/world/worldReferenceAlignment.js';
import { createVegetation, disposeVegetation } from '../src/3d/world/vegetation.js';
import { northClimateWeightsAtWorldXZ } from '../src/3d/world/terrainBiomeShading.js';

function worldZForNormalizedMapY(normalizedY) {
  const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
  const mapY = normalizedY * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
  return (mapY - centerMapY) * WORLD_SCALE.METERS_PER_MAP_UNIT;
}

const farNorthZ = worldZForNormalizedMapY(0.08);
const requiredRadius = Math.abs(farNorthZ) + 900;
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
let snowInNorth = 0;
let greenRoundInFrozenClimate = 0;
let ordinaryPineInPermanentIce = 0;
let temperateRound = 0;

for (let i = 0; i < snowTrunks.count; i += 1) {
  snowTrunks.getMatrixAt(i, matrix);
  matrix.decompose(position, quaternion, scale);
  const climate = northClimateWeightsAtWorldXZ(position.x, position.z);
  assert(
    Math.max(climate.permanentIce, climate.tundra) >= 0.20,
    `snow pine ${i} escaped map-aligned northern climate at x=${position.x}, z=${position.z}`,
  );
  if (climate.permanentIce >= 0.55) snowInNorth += 1;
}

for (let i = 0; i < roundTrunks.count; i += 1) {
  roundTrunks.getMatrixAt(i, matrix);
  matrix.decompose(position, quaternion, scale);
  const climate = northClimateWeightsAtWorldXZ(position.x, position.z);
  if (Math.max(climate.permanentIce, climate.tundra) >= 0.20) greenRoundInFrozenClimate += 1;
  if (climate.permanentIce === 0 && climate.tundra === 0) temperateRound += 1;
}

for (let i = 0; i < pineTrunks.count; i += 1) {
  pineTrunks.getMatrixAt(i, matrix);
  matrix.decompose(position, quaternion, scale);
  const climate = northClimateWeightsAtWorldXZ(position.x, position.z);
  if (climate.permanentIce >= 0.55) ordinaryPineInPermanentIce += 1;
}

assert(snowInNorth > 0, 'permanent-ice map zone must render snow-pine instances');
assert.equal(greenRoundInFrozenClimate, 0, 'broadleaf green round crowns must be absent from map-aligned tundra/ice');
assert.equal(ordinaryPineInPermanentIce, 0, 'ordinary green pine must be absent from map-aligned permanent ice');
assert(temperateRound > 0, 'temperate map zones must still retain round-crown variety');

disposeVegetation(result.group);
console.log('[checkNorthernVegetationRuntime] PASS', JSON.stringify({
  placedCount: result.placedCount,
  winterTreeCount: result.winterTreeCount,
  snowInPermanentIce: snowInNorth,
  temperateRound,
  radiusMeters: requiredRadius,
}));
