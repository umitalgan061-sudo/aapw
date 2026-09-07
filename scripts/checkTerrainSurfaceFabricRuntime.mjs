import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyTerrainSurfaceFabricToGeometry, validateTerrainSurfaceFabricRuntime } from '../src/3d/world/terrainSurfaceFabricRuntime.js';

const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute([
  -100, 12, -100,
   100, 28, -100,
  -100, 46,  100,
   100, 160, 100,
], 3));
const original = Array.from(geometry.getAttribute('position').array);
const result = applyTerrainSurfaceFabricToGeometry(geometry, (worldX, worldZ, index) => ({
  heightAboveSeaMeters: 12 + index * 48,
  slopeDegrees: Math.abs(worldX + worldZ) % 55,
  concavityMeters: index * 0.8,
  rockWeight: index === 3 ? 0.82 : 0.2,
  snowWeight: index === 3 ? 0.72 : 0.04,
  waterWeight: index === 0 ? 0.78 : 0.02,
  moisture: index === 0 ? 0.8 : 0.35,
}));
assert.equal(result.ok, true);
assert.deepEqual(Array.from(geometry.getAttribute('position').array), original);
assert.equal(geometry.getAttribute('color').count, 4);
assert.equal(geometry.getAttribute('terrainRoughness').count, 4);
assert.equal(geometry.getAttribute('terrainNormalGain').count, 4);
assert.equal(validateTerrainSurfaceFabricRuntime(result).ok, true);

const repeat = new THREE.BufferGeometry();
repeat.setAttribute('position', new THREE.Float32BufferAttribute(original, 3));
const result2 = applyTerrainSurfaceFabricToGeometry(repeat, (worldX, worldZ, index) => ({
  heightAboveSeaMeters: 12 + index * 48,
  slopeDegrees: Math.abs(worldX + worldZ) % 55,
  concavityMeters: index * 0.8,
  rockWeight: index === 3 ? 0.82 : 0.2,
  snowWeight: index === 3 ? 0.72 : 0.04,
  waterWeight: index === 0 ? 0.78 : 0.02,
  moisture: index === 0 ? 0.8 : 0.35,
}));
assert.deepEqual(Array.from(result.attributes.roughness.array), Array.from(result2.attributes.roughness.array));
assert.deepEqual(Array.from(result.attributes.normalGain.array), Array.from(result2.attributes.normalGain.array));
console.log('TERRAIN_SURFACE_FABRIC_RUNTIME_OK');
