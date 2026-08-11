import assert from 'node:assert/strict';
import * as THREE from 'three';
import { normalizedReferenceToMapCanvas } from '../src/3d/world/worldReferenceAlignment.js';
import { mapCanvasToPlannedWorldXZ } from '../src/3d/world/worldReferenceMigrationPlan.js';
import {
  WORLD_REFERENCE_BASE_SURFACE_MASK,
  WORLD_REFERENCE_PINDEXES,
} from '../src/3d/world/worldReferenceSurfacePindexes.js';
import {
  WORLD_REFERENCE_SURFACE_VISUAL_POLICY,
  applyReferenceSurfaceToTerrainMesh,
} from '../src/3d/world/worldReferenceSurfaceTerrainVisual.js';

const mask = WORLD_REFERENCE_BASE_SURFACE_MASK;
const positions = new Float32Array(mask.width * mask.height * 3);
let cursor = 0;
for (let y = 0; y < mask.height; y += 1) {
  for (let x = 0; x < mask.width; x += 1) {
    const normalized = { x: (x + 0.5) / mask.width, y: (y + 0.5) / mask.height };
    const map = normalizedReferenceToMapCanvas(normalized.x, normalized.y);
    const world = mapCanvasToPlannedWorldXZ(map.x, map.y);
    positions[cursor++] = world.x;
    positions[cursor++] = 0;
    positions[cursor++] = world.z;
  }
}

const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
const material = new THREE.MeshStandardMaterial({ color: 0x516a49, roughness: 1, metalness: 0 });
const mesh = new THREE.Mesh(geometry, material);
const summary = applyReferenceSurfaceToTerrainMesh(mesh);

assert.equal(summary.vertexCount, mask.width * mask.height);
assert.deepEqual(summary.counts, mask.cellCounts);
assert.equal(summary.pindexVertexCounts.length, 10);
for (let index = 0; index < 10; index += 1) {
  const expected = Object.values(WORLD_REFERENCE_PINDEXES[index].baseCellCounts).reduce((sum, value) => sum + value, 0);
  assert.equal(summary.pindexVertexCounts[index], expected, `pindex ${index + 1} visual vertex coverage drifted`);
}
assert.equal(summary.pindexVertexCounts.reduce((sum, value) => sum + value, 0), summary.vertexCount);
assert.equal(mesh.geometry.getAttribute('color').count, summary.vertexCount);
assert.equal(mesh.material.vertexColors, true);
assert.equal(mesh.material.color.getHex(), 0xffffff);
assert.equal(mesh.material.metalness, 0);
assert.ok(mesh.material.roughness >= 0.88 && mesh.material.roughness <= 0.99);
assert.equal(mesh.userData.run273CanonicalMapSurface, summary);
assert.equal(WORLD_REFERENCE_SURFACE_VISUAL_POLICY.sourceMapSha256, mask.sourceMapSha256);

geometry.dispose();
material.dispose();

console.log('[Run273] canonical map surface terrain visual PASS', JSON.stringify({
  sourceMapSha256: mask.sourceMapSha256,
  vertexCount: summary.vertexCount,
  counts: summary.counts,
  pindexVertexCounts: summary.pindexVertexCounts,
  averageRoughness: summary.averageRoughness,
}));
