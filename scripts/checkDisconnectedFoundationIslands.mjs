#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolveWorldSurfacePlacement } from '../src/3d/world/WorldAssetPlacementPipeline.js';
import { createTerrainFoundationConformer } from '../src/3d/world/terrainFoundationConformer.js';
import { createHeightSampler } from '../src/3d/world/terrain.js';

function addGroundedBox(root, width, depth, x) {
  const geometry = new THREE.BoxGeometry(width, 8, depth);
  geometry.translate(0, 4, 0);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.position.x = x;
  root.add(mesh);
}

const structure = new THREE.Group();
structure.position.set(80, 0, -45);
structure.rotation.y = Math.PI / 6;
addGroundedBox(structure, 16, 18, -22);
addGroundedBox(structure, 16, 18, 22);
structure.updateMatrixWorld(true);

const baseSampler = createHeightSampler(317, undefined, []);
const flattenPads = [];
const conformedSampler = createHeightSampler(317, undefined, flattenPads);
const conformer = createTerrainFoundationConformer({ flattenPads, innerMarginMeters: 0, featherMeters: 2 });
let payload = null;
const result = resolveWorldSurfacePlacement(structure, {
  metadata: { category: 'building', id: 'two-wing-courtyard' },
  surfaceQuery(x, z) {
    return { height: baseSampler(x, z), slopeDegrees: 3, waterDepth: 0, roadDistance: 5, biome: 'settlement' };
  },
  requireSurfaceContext: true,
  conformTerrain(input) {
    payload = input;
    return conformer.conformTerrain(input);
  },
});
assert.equal(result.ok, true, result.error);
assert.equal(payload?.footprintIslands?.length, 2, 'two disconnected ground-contact wings must publish two foundation islands');
assert.equal(result.footprint?.footprintIslands?.length, 2, 'placement manifest must retain island topology');
assert.equal(flattenPads.length, 8, 'two ordinary islands should receive independent four-pad clusters');
assert(flattenPads.every((pad) => pad.foundationIslandCount === 2), 'all pads must retain the shared island count');
assert.deepEqual([...new Set(flattenPads.map((pad) => pad.foundationIslandIndex))], [0, 1]);

const left = structure.localToWorld(new THREE.Vector3(-22, 0, 0));
const right = structure.localToWorld(new THREE.Vector3(22, 0, 0));
const courtyard = structure.localToWorld(new THREE.Vector3(0, 0, 0));
const target = result.footprint.targetGroundHeight;
assert.equal(conformedSampler(left.x, left.z), target, 'left wing foundation must be fully conformed');
assert.equal(conformedSampler(right.x, right.z), target, 'right wing foundation must be fully conformed');
assert.equal(conformedSampler(courtyard.x, courtyard.z), baseSampler(courtyard.x, courtyard.z), 'open courtyard must preserve canonical terrain');

const regroundHeight = target + 1.25;
const reground = conformer.conformTerrain({ ...payload, targetHeight: regroundHeight });
assert.equal(reground.ok, true, reground.error);
assert.equal(flattenPads.length, 8, 're-grounding must replace the prior island cluster rather than leak pads');
assert.equal(conformedSampler(left.x, left.z), regroundHeight, 'shared sampler must follow the replacement island height');
assert.equal(conformedSampler(right.x, right.z), regroundHeight, 'both islands must share the replacement target plane');
assert.equal(conformedSampler(courtyard.x, courtyard.z), baseSampler(courtyard.x, courtyard.z), 're-grounding must still preserve the courtyard');

const removed = conformer.removeFoundation(structure);
assert.equal(removed.ok, true);
assert.equal(removed.removedCount, 8, 'removing the structure must retire every island pad');
assert.equal(flattenPads.length, 0);
assert.equal(conformedSampler(left.x, left.z), baseSampler(left.x, left.z), 'shared sampler must restore canonical height after island removal');

console.log('[checkDisconnectedFoundationIslands] PASS: disconnected grounded wings preserve the open courtyard, share one target plane/height authority, replace atomically on re-ground, and retire together.');
