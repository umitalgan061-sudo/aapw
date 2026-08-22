#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_SCALE } from '../src/3d/config.js';
import {
  WORLD_REFERENCE_ALIGNMENT,
  normalizedReferenceToWorldXZ,
} from '../src/3d/world/worldReferenceAlignment.js';
import {
  RUN180_WIND_GRASS_CONFIG,
  grassSegmentDistance,
  isWindGrassSurfaceAllowed,
  windGrassSnowDensityMultiplier,
  createWindGrassGeometry,
  populateWindGrass,
} from '../src/3d/world/windGrass.js';
import { NORTH_GROUND_COVER_POLICY } from '../src/3d/world/northGroundCoverClimate.js';

function worldZForNormalizedMapY(normalizedY) {
  const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
  const mapY = normalizedY * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
  return (mapY - centerMapY) * WORLD_SCALE.METERS_PER_MAP_UNIT;
}

function worldXZ(normalizedX, normalizedY) {
  return normalizedReferenceToWorldXZ(
    normalizedX,
    normalizedY,
    WORLD_SCALE.MAP_BOUNDS,
    WORLD_SCALE.METERS_PER_MAP_UNIT,
  );
}

function cellForWorld(point) {
  return {
    x: Math.round(point.x / RUN180_WIND_GRASS_CONFIG.cellMeters),
    z: Math.round(point.z / RUN180_WIND_GRASS_CONFIG.cellMeters),
  };
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
const surfaceProbe = {};
assert.equal(isWindGrassSurfaceAllowed(500, 500, baseParams, surfaceProbe), true);
assert.equal(surfaceProbe.heightMeters, 20, 'surface probe should reuse the accepted terrain height');
assert.equal(surfaceProbe.slopeDegrees, 0, 'flat surface probe should expose zero slope');

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

// Snow authority remains on the terrain resolver during this staged migration. Keep its legacy
// latitude contract covered independently from map-aligned ground-cover density.
const farNorthZ = worldZForNormalizedMapY(0.05);
const tundraZ = worldZForNormalizedMapY(0.32);
const southZ = worldZForNormalizedMapY(0.62);
const southSnowDensity = windGrassSnowDensityMultiplier({
  heightAboveSeaMeters: 14,
  slopeDegrees: 0,
  worldZ: southZ,
});
const tundraLowSnowDensity = windGrassSnowDensityMultiplier({
  heightAboveSeaMeters: 14,
  slopeDegrees: 0,
  worldZ: tundraZ,
});
const tundraHighSnowDensity = windGrassSnowDensityMultiplier({
  heightAboveSeaMeters: 340,
  slopeDegrees: 4,
  worldZ: tundraZ,
});
const northSnowDensity = windGrassSnowDensityMultiplier({
  heightAboveSeaMeters: 40,
  slopeDegrees: 4,
  worldZ: farNorthZ,
});
assert.equal(southSnowDensity, 1, 'dry temperate lowland must preserve historical full grass density');
assert(tundraLowSnowDensity > tundraHighSnowDensity,
  'snow-covered tundra highland must suppress ordinary grass more than tundra lowland');
assert(tundraHighSnowDensity < 0.5,
  'tundra highland snow should strongly thin ordinary grass before continuous snow');
assert.equal(northSnowDensity, 0,
  'continuous permanent-ice snow cover must reject ordinary grass through snow authority too');

const alwaysWinterWorld = worldXZ(0.145, 0.115);
const sameLatitudeEastWorld = worldXZ(0.82, 0.115);
const canonicalNorthWorld = worldXZ(0.19, 0.235);
const southWorld = worldXZ(0.52, 0.62);
const alwaysWinterCell = cellForWorld(alwaysWinterWorld);
const sameLatitudeEastCell = cellForWorld(sameLatitudeEastWorld);
const canonicalNorthCell = cellForWorld(canonicalNorthWorld);
const southCell = cellForWorld(southWorld);
const shared = {
  sampleHeightMeters: flatSampler,
  seaLevelMeters: 6,
  seed: 424242,
  seats: [],
  roadEdges: [],
  isMobileClass: true,
};

const northMesh = makeMesh();
const sameLatitudeEastMesh = makeMesh();
const tundraMesh = makeMesh();
const southMesh = makeMesh();
const southRepeat = makeMesh();
const snowyTundraMesh = makeMesh();
const northCount = populateWindGrass(northMesh, shared, alwaysWinterCell.x, alwaysWinterCell.z);
const sameLatitudeEastCount = populateWindGrass(sameLatitudeEastMesh, shared, sameLatitudeEastCell.x, sameLatitudeEastCell.z);
const tundraCount = populateWindGrass(tundraMesh, shared, canonicalNorthCell.x, canonicalNorthCell.z);
const southCount = populateWindGrass(southMesh, shared, southCell.x, southCell.z);
const southRepeatCount = populateWindGrass(southRepeat, shared, southCell.x, southCell.z);
const snowyTundraCount = populateWindGrass(snowyTundraMesh, {
  ...shared,
  sampleHeightMeters: () => 346,
}, canonicalNorthCell.x, canonicalNorthCell.z);

assert.equal(northCount, 0, 'canonical permanent ice must reject every physical green-grass patch');
assert((northMesh.userData.northGroundCover?.climateRejected ?? 0) > 0, 'north rejection telemetry must identify climate as the cause');
assert.equal(northMesh.userData.northGroundCover?.mapAlignedClimate, true,
  'runtime telemetry must declare canonical X/Z climate ownership');
assert(sameLatitudeEastCount > northCount,
  'same-latitude far-east ground must recover grass outside Westeros cryosphere');
assert(tundraCount > 0, 'canonical North tundra should keep some hardy ground cover');
assert(tundraCount < southCount, `tundra (${tundraCount}) must be sparser than temperate south (${southCount})`);
assert(snowyTundraCount < tundraCount,
  `snowy tundra highland (${snowyTundraCount}) must be sparser than low tundra (${tundraCount})`);
assert((snowyTundraMesh.userData.northGroundCover?.snowRejected ?? 0) > 0,
  'snow-aware scatter telemetry must record highland snow rejections');
assert.equal(snowyTundraMesh.userData.northGroundCover?.snowAware, true);
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

for (const mesh of [northMesh, sameLatitudeEastMesh, tundraMesh, southMesh, southRepeat, snowyTundraMesh]) {
  mesh.geometry.dispose();
  mesh.material.dispose();
}
geometry.dispose();

console.log('[checkWindGrassClimateModule] PASS', JSON.stringify({
  policy: NORTH_GROUND_COVER_POLICY.id,
  northCount,
  sameLatitudeEastCount,
  tundraCount,
  snowyTundraCount,
  southCount,
  southSnowDensity,
  tundraLowSnowDensity,
  tundraHighSnowDensity,
  northSnowDensity,
  southColor: southColor.getHexString(),
  tundraColor: tundraColor.getHexString(),
}));