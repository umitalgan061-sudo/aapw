#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_SCALE } from '../src/3d/config.js';
import { WORLD_REFERENCE_ALIGNMENT } from '../src/3d/world/worldReferenceAlignment.js';
import {
  RUN180_WIND_GRASS_CONFIG,
  grassSegmentDistance,
  isWindGrassSurfaceAllowed,
  createWindGrassGeometry,
  populateWindGrass,
} from '../src/3d/world/windGrass.js';
import { NORTH_GROUND_COVER_POLICY } from '../src/3d/world/northGroundCoverClimate.js';

function worldZForNormalizedMapY(normalizedY) {
  const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
  const mapY = normalizedY * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
  return (mapY - centerMapY) * WORLD_SCALE.METERS_PER_MAP_UNIT;
}

assert.equal(grassSegmentDistance(5, 3, { x: 0, z: 0 }, { x: 10, z: 0 }), 3);
assert.equal(grassSegmentDistance(0, 5, { x: 0, z: 0 }, { x: 0, z: 0 }), 5);

const flatSampler = () => 20;
const steepSampler = (x) => 20 + x * 2;
const baseParams = {
  sampleHeightMeters: flatSampler,
  seaLevelMeters: 6,
  seats: [],
  roadEdges: [],
};
assert.equal(isWindGrassSurfaceAllowed(500, 500, baseParams), true, 'ordinary dry flat ground should allow grass');
assert.equal(isWindGrassSurfaceAllowed(0, 0, { ...baseParams, seats: [{ x: 0, z: 0 }] }), false, 'seat exclusion must remain active');
assert.equal(isWindGrassSurfaceAllowed(0, 5, {
  ...baseParams,
  roadEdges: [{ points: [{ x: -100, z: 0 }, { x: 100, z: 0 }] }],
}), false, 'road exclusion must remain active');
assert.equal(isWindGrassSurfaceAllowed(0, 0, { ...baseParams, sampleHeightMeters: () => 6 }), false, 'waterline must reject grass');
assert.equal(isWindGrassSurfaceAllowed(0, 0, { ...baseParams, sampleHeightMeters: steepSampler }), false, 'steep local slope must reject grass');

const geometry = createWindGrassGeometry();
assert.equal(geometry.getAttribute('run180Flex').count, RUN180_WIND_GRASS_CONFIG.bladesPerPatch * 4);
assert.equal(geometry.getAttribute('run180Phase').count, RUN180_WIND_GRASS_CONFIG.bladesPerPatch * 4);
assert.equal(geometry.index.count / 3, RUN180_WIND_GRASS_CONFIG.bladesPerPatch * 2);

function makeMesh(maxPatches = RUN180_WIND_GRASS_CONFIG.mobile.maxPatches) {
  const mesh = new THREE.InstancedMesh(
    createWindGrassGeometry(),
    new THREE.MeshStandardMaterial(),
    maxPatches,
  );
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

const farNorthZ = worldZForNormalizedMapY(0.05);
const tundraZ = worldZForNormalizedMapY(0.32);
const southZ = worldZForNormalizedMapY(0.62);
const shared = {
  sampleHeightMeters: flatSampler,
  seaLevelMeters: 6,
  seed: 424242,
  seats: [],
  roadEdges: [],
  isMobileClass: true,
};

const northMesh = makeMesh();
const tundraMesh = makeMesh();
const southMesh = makeMesh();
const southRepeat = makeMesh();
const northCell = Math.round(farNorthZ / RUN180_WIND_GRASS_CONFIG.cellMeters);
const tundraCell = Math.round(tundraZ / RUN180_WIND_GRASS_CONFIG.cellMeters);
const southCell = Math.round(southZ / RUN180_WIND_GRASS_CONFIG.cellMeters);
const northCount = populateWindGrass(northMesh, shared, 0, northCell);
const tundraCount = populateWindGrass(tundraMesh, shared, 0, tundraCell);
const southCount = populateWindGrass(southMesh, shared, 0, southCell);
const southRepeatCount = populateWindGrass(southRepeat, shared, 0, southCell);

assert.equal(northCount, 0, 'permanent ice must reject every physical green-grass patch');
assert((northMesh.userData.northGroundCover?.climateRejected ?? 0) > 0, 'north rejection telemetry must identify climate as the cause');
assert(tundraCount > 0, 'tundra should keep some hardy ground cover');
assert(tundraCount < southCount, `tundra (${tundraCount}) must be sparser than temperate south (${southCount})`);
assert.equal(southCount, southRepeatCount, 'same seed and cell must keep deterministic count');
assert.equal(southMesh.userData.northGroundCover?.policyId, NORTH_GROUND_COVER_POLICY.id);

const southMatrices = Array.from(southMesh.instanceMatrix.array.slice(0, southCount * 16));
const repeatMatrices = Array.from(southRepeat.instanceMatrix.array.slice(0, southRepeatCount * 16));
assert.deepEqual(southMatrices, repeatMatrices, 'same seed/cell transforms must remain bit-identical');
const southColors = Array.from(southMesh.instanceColor.array.slice(0, southCount * 3));
const repeatColors = Array.from(southRepeat.instanceColor.array.slice(0, southRepeatCount * 3));
assert.deepEqual(southColors, repeatColors, 'same seed/cell climate colors must remain bit-identical');

const tundraColor = new THREE.Color();
const southColor = new THREE.Color();
tundraMesh.getColorAt(0, tundraColor);
southMesh.getColorAt(0, southColor);
assert(tundraColor.r > southColor.r, 'tundra grass should shift toward paler lichen red channel');
assert(tundraColor.b > southColor.b, 'tundra grass should shift toward cooler lichen blue channel');

const tundraMatrix = new THREE.Matrix4();
const southMatrix = new THREE.Matrix4();
tundraMesh.getMatrixAt(0, tundraMatrix);
southMesh.getMatrixAt(0, southMatrix);
const tundraScale = new THREE.Vector3();
const southScale = new THREE.Vector3();
tundraScale.setFromMatrixScale(tundraMatrix);
southScale.setFromMatrixScale(southMatrix);
assert(tundraScale.y < 1.25, 'tundra climate should cap wind-grass height below the raw maximum');
assert(southScale.y >= 0.78 && southScale.y <= 1.25, 'temperate south must retain historical raw scale bounds');

for (const mesh of [northMesh, tundraMesh, southMesh, southRepeat]) {
  mesh.geometry.dispose();
  mesh.material.dispose();
}
geometry.dispose();

console.log('[checkWindGrassClimateModule] PASS', JSON.stringify({
  policy: NORTH_GROUND_COVER_POLICY.id,
  northCount,
  tundraCount,
  southCount,
  southColor: southColor.getHexString(),
  tundraColor: tundraColor.getHexString(),
}));
