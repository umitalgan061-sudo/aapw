#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolveWorldSurfacePlacement } from '../src/3d/world/WorldAssetPlacementPipeline.js';
import { createTerrainFoundationConformer } from '../src/3d/world/terrainFoundationConformer.js';
import { createHeightSampler } from '../src/3d/world/terrain.js';

function makeGroundedWing(width = 16, depth = 18) {
  const geometry = new THREE.BoxGeometry(width, 8, depth);
  geometry.translate(0, 4, 0);
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
}

function almostEqual(actual, expected, message, epsilon = 1e-8) {
  assert(Math.abs(actual - expected) <= epsilon, `${message}: expected ${expected}, got ${actual}`);
}

const seed = 9137;
const flattenPads = [];
const baseSampler = createHeightSampler(seed, undefined, []);
const liveSampler = createHeightSampler(seed, undefined, flattenPads);
const conformer = createTerrainFoundationConformer({
  flattenPads,
  innerMarginMeters: 0,
  featherMeters: 2,
});

const structure = new THREE.Group();
structure.position.set(110, 0, -70);
structure.rotation.y = Math.PI / 7;
structure.userData.assetCategory = 'building';
const leftWing = makeGroundedWing();
const rightWing = makeGroundedWing();
leftWing.position.x = -8.5;
rightWing.position.x = 8.5; // 1 m gap: one connected ground-contact island under the 1.5 m merge policy.
structure.add(leftWing, rightWing);

function place(label) {
  structure.updateMatrixWorld(true);
  let payload = null;
  const result = resolveWorldSurfacePlacement(structure, {
    metadata: { category: 'building', id: 'topology-transition-fixture' },
    surfaceQuery(x, z) {
      return {
        height: baseSampler(x, z),
        slopeDegrees: 2,
        waterDepth: 0,
        roadDistance: 12,
        biome: 'settlement',
      };
    },
    requireSurfaceContext: true,
    conformTerrain(input) {
      payload = input;
      return conformer.conformTerrain(input);
    },
  });
  assert.equal(result.ok, true, `${label}: ${result.error || 'placement failed'}`);
  assert(payload, `${label}: conform payload must be emitted`);
  return { result, payload };
}

const joined = place('joined');
assert.equal(joined.payload.footprintIslands.length, 0, 'connected wings should use one aggregate footprint');
assert.equal(flattenPads.length, 4, 'connected footprint should own one four-pad cluster');
assert(flattenPads.every((pad) => pad.foundationIslandCount === 1));
const foundationKey = structure.userData.terrainFoundationKey;
assert(foundationKey?.startsWith('object:'), 'runtime object identity must remain the foundation key');

const joinedCenter = structure.localToWorld(new THREE.Vector3(0, 0, 0));
const joinedHeight = joined.result.footprint.targetGroundHeight;
almostEqual(liveSampler(joinedCenter.x, joinedCenter.z), joinedHeight, 'joined footprint center must be conformed');

// Editor transform: move one child far enough away that the same runtime object becomes two islands.
rightWing.position.x = 31;
const split = place('split');
assert.equal(structure.userData.terrainFoundationKey, foundationKey, 'topology changes must preserve runtime foundation identity');
assert.equal(split.payload.footprintIslands.length, 2, 'separated wings should publish two islands');
assert.equal(flattenPads.length, 8, 'split topology must atomically replace four pads with two four-pad islands');
assert(flattenPads.every((pad) => pad.foundationClusterSize === 8));
assert(flattenPads.every((pad) => pad.foundationIslandCount === 2));
assert.deepEqual([...new Set(flattenPads.map((pad) => pad.foundationIslandIndex))], [0, 1]);
assert.equal(new Set(flattenPads.map((pad) => pad.foundationKey)).size, 1, 'all replacement pads must retain one object identity');

const splitLeft = structure.localToWorld(new THREE.Vector3(leftWing.position.x, 0, 0));
const splitRight = structure.localToWorld(new THREE.Vector3(rightWing.position.x, 0, 0));
const splitCourtyard = structure.localToWorld(new THREE.Vector3(11.25, 0, 0));
const splitHeight = split.result.footprint.targetGroundHeight;
almostEqual(liveSampler(splitLeft.x, splitLeft.z), splitHeight, 'left island must follow replacement foundation height');
almostEqual(liveSampler(splitRight.x, splitRight.z), splitHeight, 'right island must follow replacement foundation height');
almostEqual(
  liveSampler(splitCourtyard.x, splitCourtyard.z),
  baseSampler(splitCourtyard.x, splitCourtyard.z),
  'newly opened courtyard must stop inheriting the retired joined footprint',
);

// Editor transform back: collapse to one connected footprint and ensure the retired remote island disappears.
const retiredRemote = { x: splitRight.x, z: splitRight.z };
rightWing.position.x = 8.5;
const rejoined = place('rejoined');
assert.equal(structure.userData.terrainFoundationKey, foundationKey);
assert.equal(rejoined.payload.footprintIslands.length, 0, 'rejoined geometry should collapse back to aggregate topology');
assert.equal(flattenPads.length, 4, 'rejoin must retire every split-island pad without leaks');
assert(flattenPads.every((pad) => pad.foundationClusterSize === 4));
assert(flattenPads.every((pad) => pad.foundationIslandCount === 1));
almostEqual(
  liveSampler(retiredRemote.x, retiredRemote.z),
  baseSampler(retiredRemote.x, retiredRemote.z),
  'retired remote island terrain must return to canonical height after topology collapse',
);

const removed = conformer.removeFoundation(structure);
assert.equal(removed.ok, true);
assert.equal(removed.removedCount, 4, 'final removal should retire exactly the currently installed topology');
assert.equal(flattenPads.length, 0);
almostEqual(
  liveSampler(joinedCenter.x, joinedCenter.z),
  baseSampler(joinedCenter.x, joinedCenter.z),
  'removal after topology transitions must restore canonical terrain',
);
assert.equal(structure.userData.terrainFoundationKey, undefined, 'removal must clear remembered runtime foundation identity');

console.log('[checkFoundationTopologyTransition] PASS: one-island -> two-island -> one-island editor transforms replace foundation pads atomically, preserve object identity, reopen canonical terrain, and remove cleanly.');
