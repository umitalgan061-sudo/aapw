import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/build/three.module.js';
import {
  applyTerrainSurfaceAntiTilingMaterial,
  validateTerrainSurfaceAntiTilingMaterialApplication,
} from '../src/3d/world/terrainSurfaceAntiTilingMaterial.js';

const geometry = new THREE.PlaneGeometry(100, 100, 4, 4);
geometry.rotateX(-Math.PI / 2);
const colors = new Float32Array(geometry.attributes.position.count * 3);
for (let i = 0; i < geometry.attributes.position.count; i += 1) {
  colors[i * 3] = 0.38;
  colors[i * 3 + 1] = 0.46;
  colors[i * 3 + 2] = 0.27;
}
geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
geometry.computeVertexNormals();
const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true }));
mesh.position.set(1200, 0, -800);

const first = applyTerrainSurfaceAntiTilingMaterial(mesh, { seed: 20260907, waterLevelMeters: 0 });
assert.equal(validateTerrainSurfaceAntiTilingMaterialApplication(first).ok, true);
assert.equal(first.manifest.seamSafeWorldCoordinates, true);
assert.equal(first.manifest.canonicalHeightUnchanged, true);
assert.ok(first.manifest.changedVertices > 0);
assert.ok(first.manifest.maximumDelta <= 0.11);

const secondGeometry = geometry.clone();
const second = new THREE.Mesh(secondGeometry, new THREE.MeshStandardMaterial({ vertexColors: true }));
second.position.copy(mesh.position);
const secondResult = applyTerrainSurfaceAntiTilingMaterial(second, { seed: 20260907, waterLevelMeters: 0 });
assert.deepEqual(
  Array.from(mesh.geometry.attributes.color.array),
  Array.from(second.geometry.attributes.color.array),
  'same world-space inputs must produce deterministic vertex colour output',
);
assert.equal(secondResult.manifest.changedVertices, first.manifest.changedVertices);
console.log('TERRAIN_SURFACE_ANTI_TILING_MATERIAL_PASS');
