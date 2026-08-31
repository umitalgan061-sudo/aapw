#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  createHeightSampler,
  createTerrainChunk,
  disposeTerrainChunk,
} from '../src/3d/world/terrain.js';
import { createFoundationFlattenPad } from '../src/3d/world/terrainFoundationConformer.js';

const SEED = 1337;
const SIZE = 100;
const SEGMENTS = 10;
const TARGET_HEIGHT = 140;
const angle = 35 * Math.PI / 180;
const axisX = { x: Math.cos(angle), z: Math.sin(angle) };
const axisZ = { x: -Math.sin(angle), z: Math.cos(angle) };
const centerX = 50;
const centerZ = 0;
const halfWidthMeters = 35;
const halfDepthMeters = 6;
const extentX = Math.abs(axisX.x) * halfWidthMeters + Math.abs(axisZ.x) * halfDepthMeters;
const extentZ = Math.abs(axisX.z) * halfWidthMeters + Math.abs(axisZ.z) * halfDepthMeters;

const built = createFoundationFlattenPad({
  metadata: { id: 'render-physics-parity-hall', category: 'building' },
  bounds: {
    minX: centerX - extentX,
    maxX: centerX + extentX,
    minZ: centerZ - extentZ,
    maxZ: centerZ + extentZ,
  },
  orientedFootprint: {
    centerX,
    centerZ,
    axisX,
    axisZ,
    halfWidthMeters,
    halfDepthMeters,
  },
  targetHeight: TARGET_HEIGHT,
}, { innerMarginMeters: 0, featherMeters: 4 });
assert.equal(built.ok, true, built.error);
assert.equal(built.pads.length, 4);
assert(built.pads.every((pad) => pad.shape === 'oriented-rectangle'));

// This array is intentionally shared by a long-lived physics sampler and every terrain chunk bake.
// Mutating it below must therefore change both authorities without constructing a second height model.
const flattenPads = [];
const physicsHeight = createHeightSampler(SEED, undefined, flattenPads);
const canonicalCenterHeight = physicsHeight(centerX, centerZ);
assert.notEqual(canonicalCenterHeight, TARGET_HEIGHT,
  'fixture target must differ from canonical terrain so parity assertions are meaningful');
flattenPads.push(...built.pads);
assert.equal(physicsHeight(centerX, centerZ), TARGET_HEIGHT,
  'long-lived physics sampler must observe a later rectangular foundation mutation');

const westChunk = createTerrainChunk({
  chunkX: 0,
  chunkZ: 0,
  size: SIZE,
  segments: SEGMENTS,
  seed: SEED,
  flattenPads,
});
const eastChunk = createTerrainChunk({
  chunkX: 1,
  chunkZ: 0,
  size: SIZE,
  segments: SEGMENTS,
  seed: SEED,
  flattenPads,
});

function auditChunk(mesh) {
  const position = mesh.geometry.attributes.position;
  let fullyConformedVertexCount = 0;
  for (let index = 0; index < position.count; index += 1) {
    const worldX = mesh.position.x + position.getX(index);
    const worldZ = mesh.position.z + position.getZ(index);
    const renderHeight = position.getY(index);
    const colliderHeight = physicsHeight(worldX, worldZ);
    assert(Math.abs(renderHeight - colliderHeight) < 1e-4,
      `render/physics height drift at ${worldX.toFixed(2)},${worldZ.toFixed(2)}: ${renderHeight} vs ${colliderHeight}`);
    if (Math.abs(renderHeight - TARGET_HEIGHT) < 1e-4) fullyConformedVertexCount += 1;
  }
  assert(fullyConformedVertexCount > 0,
    'each resident chunk crossed by the rotated foundation must contain fully conformed vertices');
}

auditChunk(westChunk);
auditChunk(eastChunk);

function boundaryHeight(mesh) {
  const position = mesh.geometry.attributes.position;
  for (let index = 0; index < position.count; index += 1) {
    const worldX = mesh.position.x + position.getX(index);
    const worldZ = mesh.position.z + position.getZ(index);
    if (Math.abs(worldX - centerX) < 1e-6 && Math.abs(worldZ - centerZ) < 1e-6) return position.getY(index);
  }
  throw new Error('shared chunk-boundary vertex was not found');
}

assert.equal(boundaryHeight(westChunk), TARGET_HEIGHT,
  'west chunk boundary must render the same foundation plateau used by physics');
assert.equal(boundaryHeight(eastChunk), TARGET_HEIGHT,
  'east chunk boundary must render an identical plateau with no seam across chunk ownership');
assert.equal(boundaryHeight(westChunk), boundaryHeight(eastChunk),
  'adjacent rendered chunks must agree exactly at the shared foundation boundary vertex');

disposeTerrainChunk(westChunk);
disposeTerrainChunk(eastChunk);

// Removing the same mutable pads must immediately restore canonical physics. A freshly rebuilt
// render chunk must then converge to that exact same canonical height, proving removal parity too.
flattenPads.length = 0;
assert.equal(physicsHeight(centerX, centerZ), canonicalCenterHeight,
  'removing foundation pads must restore canonical collider height without replacing its sampler');
const rebuiltWestChunk = createTerrainChunk({
  chunkX: 0,
  chunkZ: 0,
  size: SIZE,
  segments: SEGMENTS,
  seed: SEED,
  flattenPads,
});
assert(Math.abs(boundaryHeight(rebuiltWestChunk) - canonicalCenterHeight) < 1e-4,
  'rebuilt render terrain must restore the same canonical height observed by physics');
disposeTerrainChunk(rebuiltWestChunk);

console.log('[checkFoundationRenderPhysicsParity] PASS: rotated rectangular foundations and removals preserve one mutable render/physics height authority across a live chunk boundary.');
