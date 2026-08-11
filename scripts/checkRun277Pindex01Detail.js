import assert from 'node:assert/strict';
import * as THREE from 'three';
import { normalizedReferenceToMapCanvas } from '../src/3d/world/worldReferenceAlignment.js';
import { mapCanvasToPlannedWorldXZ } from '../src/3d/world/worldReferenceMigrationPlan.js';
import { WORLD_REFERENCE_BASE_SURFACE_MASK, WORLD_REFERENCE_PINDEXES } from '../src/3d/world/worldReferenceSurfacePindexes.js';
import { applyReferenceSurfaceToTerrainMesh } from '../src/3d/world/worldReferenceSurfaceTerrainVisual.js';
import { applyReferencePindex01DetailToTerrainMesh, pindex01DetailFactor, WORLD_REFERENCE_PINDEX01_DETAIL_POLICY } from '../src/3d/world/worldReferencePindex01Detail.js';

const mask = WORLD_REFERENCE_BASE_SURFACE_MASK;
const positions = new Float32Array(mask.width * mask.height * 3);
let cursor = 0;
for (let y = 0; y < mask.height; y += 1) {
  for (let x = 0; x < mask.width; x += 1) {
    const map = normalizedReferenceToMapCanvas((x + 0.5) / mask.width, (y + 0.5) / mask.height);
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
const base = applyReferenceSurfaceToTerrainMesh(mesh);
const before = Float32Array.from(geometry.getAttribute('color').array);
const detail = applyReferencePindex01DetailToTerrainMesh(mesh);
const after = geometry.getAttribute('color').array;
const pindex01 = WORLD_REFERENCE_PINDEXES[0].baseCellCounts;
const expectedDry = pindex01.soil + pindex01.rock + pindex01.snow;
assert.equal(detail.pindex, 1);
assert.equal(detail.detailedVertexCount, expectedDry);
assert.deepEqual(detail.detailedBySurface, { soil: pindex01.soil, rock: pindex01.rock, snow: pindex01.snow });
assert.equal(base.vertexCount, 6144);
assert.equal(base.counts.sea, mask.cellCounts.sea);
assert.equal(base.counts.lake, mask.cellCounts.lake);
assert(detail.factorMin >= 0.945 && detail.factorMax <= 1.055);
assert.equal(pindex01DetailFactor(123, 456, 'sea'), 1);
assert.equal(pindex01DetailFactor(123, 456, 'lake'), 1);
assert.equal(pindex01DetailFactor(123, 456, 'soil'), pindex01DetailFactor(123, 456, 'soil'));
let changedComponents = 0;
for (let i = 0; i < before.length; i += 1) if (Math.abs(before[i] - after[i]) > 1e-8) changedComponents += 1;
assert(changedComponents > 0, 'pindex01 dry detail must change at least one color component');
const second = applyReferencePindex01DetailToTerrainMesh(mesh);
assert.strictEqual(second, detail, 'detail application must be idempotent');
assert.equal(WORLD_REFERENCE_PINDEX01_DETAIL_POLICY.sourceMapSha256, mask.sourceMapSha256);
geometry.dispose();
material.dispose();
console.log('[Run277] pindex01 deterministic detail PASS', JSON.stringify({ expectedDry, changedComponents, detail }));
