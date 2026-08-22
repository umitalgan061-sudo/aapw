#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createVegetation, disposeVegetation } from '../src/3d/world/vegetation.js';

const options = Object.freeze({
  sampleHeightMeters: (x, z) => 95 + Math.sin(x * 0.001) * 2 + Math.cos(z * 0.0012) * 2,
  seaLevelMeters: 0,
  seed: 0x4e4f5254,
  seats: [],
  roadEdges: [],
  radiusMeters: 6200,
  densityPerKm2: 4,
});

function snapshot(result) {
  const matrix = new THREE.Matrix4();
  const elements = [];
  for (const mesh of result.group.children) {
    const matrices = [];
    for (let i = 0; i < mesh.count; i += 1) {
      mesh.getMatrixAt(i, matrix);
      matrices.push(matrix.elements.map((value) => Number(value.toFixed(7))));
    }
    elements.push({ name: mesh.name, count: mesh.count, matrices });
  }
  return {
    targetCount: result.targetCount,
    placedCount: result.placedCount,
    winterTreeCount: result.winterTreeCount,
    climate: result.group.userData.northClimateVegetation,
    meshes: elements,
  };
}

const first = createVegetation(options);
const second = createVegetation(options);
const firstSnapshot = snapshot(first);
const secondSnapshot = snapshot(second);

assert(first.placedCount > 0, 'determinism fixture must place vegetation');
assert(first.winterTreeCount > 0, 'determinism fixture must exercise northern snow pine');
assert.deepEqual(secondSnapshot, firstSnapshot,
  'same seed/world inputs must reproduce identical climate-aware species and transforms');

const changedSeed = createVegetation({ ...options, seed: options.seed ^ 0x01010101 });
const changedSnapshot = snapshot(changedSeed);
assert.notDeepEqual(changedSnapshot.meshes, firstSnapshot.meshes,
  'different seed must still produce a distinct vegetation realization');
assert.equal(changedSnapshot.climate.policyId, firstSnapshot.climate.policyId,
  'seed changes must never alter the geographic climate policy itself');

const meshNames = first.group.children.map((mesh) => mesh.name);
assert.deepEqual(meshNames, [
  'vegetation-pine-trunks',
  'vegetation-pine-foliage',
  'vegetation-round-trunks',
  'vegetation-round-foliage',
  'vegetation-snow-pine-trunks',
  'vegetation-snow-pine-foliage',
], 'species mesh ordering must stay stable for mobile LOD and teardown wrappers');

disposeVegetation(first.group);
disposeVegetation(second.group);
disposeVegetation(changedSeed.group);
console.log('[checkNorthernVegetationDeterminism] PASS', JSON.stringify({
  placedCount: firstSnapshot.placedCount,
  winterTreeCount: firstSnapshot.winterTreeCount,
  meshCount: firstSnapshot.meshes.length,
  policyId: firstSnapshot.climate.policyId,
}));
