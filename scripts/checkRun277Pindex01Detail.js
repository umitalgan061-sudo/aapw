import assert from 'node:assert/strict';
import { normalizedReferenceToMapCanvas } from '../src/3d/world/worldReferenceAlignment.js';
import { mapCanvasToPlannedWorldXZ } from '../src/3d/world/worldReferenceMigrationPlan.js';
import { WORLD_REFERENCE_BASE_SURFACE_MASK, WORLD_REFERENCE_PINDEXES } from '../src/3d/world/worldReferenceSurfacePindexes.js';
import { applyRun277Pindex01DetailToTerrainMesh, pindex01DetailFactor, RUN277_PINDEX01_DETAIL_POLICY } from './run277Pindex01Detail.mjs';

class Attribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; this.needsUpdate = false; }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
  setXYZ(i, x, y, z) { this.array[i * this.itemSize] = x; this.array[i * this.itemSize + 1] = y; this.array[i * this.itemSize + 2] = z; }
}

const mask = WORLD_REFERENCE_BASE_SURFACE_MASK;
const positions = new Float32Array(mask.width * mask.height * 3);
const colors = new Float32Array(mask.width * mask.height * 3).fill(0.7);
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
const attrs = { position: new Attribute(positions, 3), color: new Attribute(colors, 3) };
const mesh = { position: { x: 0, z: 0 }, geometry: { getAttribute(name) { return attrs[name]; } }, userData: {} };
const before = Float32Array.from(colors);
const detail = applyRun277Pindex01DetailToTerrainMesh(mesh);
const pindex01 = WORLD_REFERENCE_PINDEXES[0].baseCellCounts;
const expectedDry = pindex01.soil + pindex01.rock + pindex01.snow;
assert.equal(detail.pindex, 1);
assert.equal(detail.detailedVertexCount, expectedDry);
assert.deepEqual(detail.detailedBySurface, { soil: pindex01.soil, rock: pindex01.rock, snow: pindex01.snow });
assert(detail.factorMin >= 0.945 && detail.factorMax <= 1.055);
assert.equal(pindex01DetailFactor(123, 456, 'sea'), 1);
assert.equal(pindex01DetailFactor(123, 456, 'lake'), 1);
assert.equal(pindex01DetailFactor(123, 456, 'soil'), pindex01DetailFactor(123, 456, 'soil'));
let changedComponents = 0;
for (let i = 0; i < before.length; i += 1) if (Math.abs(before[i] - colors[i]) > 1e-8) changedComponents += 1;
assert(changedComponents > 0, 'pindex01 dry detail must change at least one color component');
assert.equal(attrs.color.needsUpdate, true);
assert.strictEqual(applyRun277Pindex01DetailToTerrainMesh(mesh), detail, 'detail application must be idempotent');
assert.equal(RUN277_PINDEX01_DETAIL_POLICY.sourceMapSha256, mask.sourceMapSha256);
console.log('[Run277] pindex01 deterministic detail PASS', JSON.stringify({ expectedDry, changedComponents, detail }));
