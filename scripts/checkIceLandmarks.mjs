#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { WORLD_DEFAULTS } from '../src/3d/config.js';
import { createHeightSampler } from '../src/3d/world/terrain.js';
import {
  ICE_LANDMARK_POLICY,
  createIceLandmarks,
  disposeIceLandmarks,
} from '../src/3d/world/iceLandmarks.js';

const sampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
const result = createIceLandmarks({
  sampleHeightMeters,
  seed: WORLD_DEFAULTS.WORLD_SEED,
});

assert(result?.group?.isGroup, 'ice landmarks must return a THREE.Group');
assert.equal(result.group.name, 'map-aligned-ice-landmarks');
assert.equal(result.stats.policyId, ICE_LANDMARK_POLICY.id);
assert(result.stats.wallLengthMeters >= 2400 && result.stats.wallLengthMeters <= 3200,
  `wall length ${result.stats.wallLengthMeters}m left the audited north-map envelope`);
assert(result.stats.wallSectionCount >= 80,
  `wall needs enough sections for a non-blocky long cliff (${result.stats.wallSectionCount})`);
assert(result.stats.wallMinimumHeightMeters >= 115,
  `wall minimum height ${result.stats.wallMinimumHeightMeters}m is too low`);
assert(result.stats.wallMaximumHeightMeters <= 220,
  `wall maximum height ${result.stats.wallMaximumHeightMeters}m is implausibly tall`);
assert(result.stats.wallTriangleCount > 500,
  `wall mesh needs actual relief topology (${result.stats.wallTriangleCount} triangles)`);

const { cave } = result.stats;
assert(cave.openingWidthMeters >= 14 && cave.openingWidthMeters <= 18,
  `cave opening width ${cave.openingWidthMeters}m is outside gameplay scale`);
assert.equal(cave.tunnelDepthMeters, ICE_LANDMARK_POLICY.cave.tunnelDepthMeters);
assert(cave.ringCount >= 16, `cave shell needs enough depth rings (${cave.ringCount})`);
assert(cave.icicleCount >= 12, `cave ceiling should have visible icicle breakup (${cave.icicleCount})`);
assert(Math.abs(cave.center.y - sampleHeightMeters(cave.center.x, cave.center.z)) <= 3.5,
  'cave portal must stay grounded to the shared terrain height authority');

const wall = result.group.getObjectByName('the-wall-natural-ice-cliff');
assert(wall?.isMesh, 'natural ice wall mesh missing');
assert.equal(wall.userData.iceLandmarkRole, 'natural-ice-wall');
assert.equal(wall.material?.userData?.iceSurface?.mode, 'wall-glacial-cliff');
assert.equal(wall.material?.userData?.iceSurface?.verticalFlowTexture, true);
assert.equal(wall.material?.userData?.iceSurface?.proceduralCracks, true);
assert(Math.abs(wall.material?.ior - 1.31) < 1e-9, 'ice IOR must remain physically plausible');

const portalMesh = result.group.getObjectByName('ice-wall-cave-portal');
assert(portalMesh?.isMesh, 'arched cave portal mesh missing');
portalMesh.geometry.computeBoundingBox();
portalMesh.updateWorldMatrix(true, false);
const portalBounds = portalMesh.geometry.boundingBox;
assert(portalBounds, 'portal geometry must expose finite bounds');
const portalRaycaster = new THREE.Raycaster();
function castThroughPortalLocal(localX, localY) {
  const origin = new THREE.Vector3(localX, localY, portalBounds.min.z - 5).applyMatrix4(portalMesh.matrixWorld);
  const direction = new THREE.Vector3(0, 0, 1).transformDirection(portalMesh.matrixWorld);
  portalRaycaster.set(origin, direction);
  return portalRaycaster.intersectObject(portalMesh, false);
}
const archTopY = ICE_LANDMARK_POLICY.cave.openingSideHeightMeters + ICE_LANDMARK_POLICY.cave.openingArchRiseMeters;
assert(castThroughPortalLocal(0, archTopY + 4).length > 0,
  'ice portal crown must retain a closed front/back face above the walk-through arch');
assert.equal(castThroughPortalLocal(0, 1.5).length, 0,
  'ice portal center must remain open at player walking height');

const caveMesh = result.group.children.find((child) => child.userData?.iceLandmarkRole === 'walkable-ice-cave-shell');
assert(caveMesh?.isMesh, 'walk-through cave shell missing');
assert.equal(caveMesh.material?.userData?.iceSurface?.mode, 'cave-subsurface');
assert(caveMesh.material?.transmission > wall.material?.transmission,
  'cave ice should transmit more light than the exterior wall');

assert(Array.isArray(result.blockers) && result.blockers.length >= 70,
  `wall/cave collision coverage too sparse (${result.blockers?.length ?? 0})`);
const portalClearance = Math.min(...result.blockers.map((blocker) =>
  Math.hypot(blocker.x - cave.center.x, blocker.z - cave.center.z) - blocker.radius));
assert(portalClearance >= 2.0,
  `cave portal is accidentally blocked by collision circles (${portalClearance.toFixed(2)}m clearance)`);

for (const object of result.group.children) {
  if (!object.geometry?.attributes?.position) continue;
  const positions = object.geometry.attributes.position.array;
  for (let index = 0; index < positions.length; index += 1) {
    assert(Number.isFinite(positions[index]), `${object.name || object.type}: non-finite geometry coordinate`);
  }
}

const snapshot = {
  policyId: result.stats.policyId,
  wallLengthMeters: result.stats.wallLengthMeters,
  wallSections: result.stats.wallSectionCount,
  wallHeightRangeMeters: [result.stats.wallMinimumHeightMeters, result.stats.wallMaximumHeightMeters],
  wallTriangles: result.stats.wallTriangleCount,
  blockers: result.blockers.length,
  portalClearanceMeters: Number(portalClearance.toFixed(2)),
  cave,
};
console.log('ICE_LANDMARKS_OK', JSON.stringify(snapshot));

disposeIceLandmarks(result.group);
assert.equal(result.group.children.length, 0, 'ice landmark disposer must clear owned scene objects');
assert.equal(result.group.userData.disposed, true, 'ice landmark disposer must mark the group disposed');
