import assert from 'node:assert/strict';
import {
  WORLD_REFERENCE_BASE_SURFACE_MASK,
  WORLD_REFERENCE_PINDEXES,
  WORLD_REFERENCE_SURFACE_TYPES,
  classifyReferenceBaseSurface,
  composeReferenceSurface,
  getReferencePindexSummary,
  referencePindexFromNormalizedX,
  referencePindexFromPixelX,
} from '../src/3d/world/worldReferenceSurfacePindexes.js';
import {
  WORLD_REFERENCE_WATER_BODY_STATS,
  classifyReferenceWaterBody,
} from '../src/3d/world/worldReferenceWaterMask.js';

const mask = WORLD_REFERENCE_BASE_SURFACE_MASK;
assert.equal(mask.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(mask.sourcePixelWidth, 1536);
assert.equal(mask.sourcePixelHeight, 1024);
assert.equal(mask.width, 96);
assert.equal(mask.height, 64);
assert.equal(mask.bitsPerCell, 3);
assert.equal(mask.rowsHex.length, mask.height);
assert.ok(mask.rowsHex.every((row) => /^[0-9a-f]{72}$/.test(row)), 'every 96-cell row must encode to 72 lowercase hex chars');
assert.deepEqual(WORLD_REFERENCE_SURFACE_TYPES, ['sea', 'lake', 'soil', 'road', 'rock', 'snow']);

const globalCounts = { sea: 0, lake: 0, soil: 0, rock: 0, snow: 0 };
const pindexCounts = Array.from({ length: 10 }, () => ({ sea: 0, lake: 0, soil: 0, rock: 0, snow: 0 }));
let dryProbe = null;
let waterProbe = null;

for (let y = 0; y < mask.height; y += 1) {
  for (let x = 0; x < mask.width; x += 1) {
    const normalizedX = (x + 0.5) / mask.width;
    const normalizedY = (y + 0.5) / mask.height;
    const surface = classifyReferenceBaseSurface(normalizedX, normalizedY);
    assert.ok(Object.hasOwn(globalCounts, surface), `unsupported base surface ${surface}`);
    globalCounts[surface] += 1;
    const pindex = referencePindexFromNormalizedX(normalizedX);
    pindexCounts[pindex - 1][surface] += 1;

    const waterBody = classifyReferenceWaterBody(normalizedX, normalizedY);
    if (surface === 'sea' || surface === 'lake') {
      assert.equal(waterBody, surface, `hydrology mismatch at cell ${x},${y}`);
      waterProbe ||= { normalizedX, normalizedY, surface };
    } else {
      assert.equal(waterBody, 'land', `dry surface ${surface} overlaps water at cell ${x},${y}`);
      dryProbe ||= { normalizedX, normalizedY, surface };
    }
  }
}

assert.deepEqual(globalCounts, mask.cellCounts);
assert.equal(globalCounts.sea, WORLD_REFERENCE_WATER_BODY_STATS.seaCellCount);
assert.equal(globalCounts.lake, WORLD_REFERENCE_WATER_BODY_STATS.lakeCellCount);
assert.equal(globalCounts.sea + globalCounts.lake, WORLD_REFERENCE_WATER_BODY_STATS.waterCellCount);
assert.equal(Object.values(globalCounts).reduce((sum, value) => sum + value, 0), mask.width * mask.height);

assert.equal(WORLD_REFERENCE_PINDEXES.length, 10);
for (let index = 1; index <= 10; index += 1) {
  const summary = getReferencePindexSummary(index);
  assert.equal(summary.index, index);
  assert.equal(summary.id, `pindex-${String(index).padStart(2, '0')}`);
  assert.equal(summary.normalizedXMin, (index - 1) / 10);
  assert.equal(summary.normalizedXMax, index / 10);
  assert.equal(summary.pixelXMin, ((index - 1) * mask.sourcePixelWidth) / 10);
  assert.equal(summary.pixelXMax, (index * mask.sourcePixelWidth) / 10);
  assert.equal(summary.roadMode, 'canonical-route-overlay');
  assert.deepEqual(pindexCounts[index - 1], summary.baseCellCounts, `pindex ${index} surface counts drifted`);
}

const summedPindexCounts = pindexCounts.reduce((total, counts) => {
  for (const key of Object.keys(total)) total[key] += counts[key];
  return total;
}, { sea: 0, lake: 0, soil: 0, rock: 0, snow: 0 });
assert.deepEqual(summedPindexCounts, globalCounts);

assert.equal(referencePindexFromNormalizedX(0), 1);
assert.equal(referencePindexFromNormalizedX(0.099999), 1);
assert.equal(referencePindexFromNormalizedX(0.1), 2);
assert.equal(referencePindexFromNormalizedX(0.999999), 10);
assert.equal(referencePindexFromNormalizedX(1), 10);
assert.equal(referencePindexFromPixelX(0), 1);
assert.equal(referencePindexFromPixelX(1536), 10);

assert.ok(dryProbe, 'a dry probe is required');
assert.ok(waterProbe, 'a water probe is required');
assert.equal(composeReferenceSurface(dryProbe.normalizedX, dryProbe.normalizedY, { road: true }), 'road');
assert.equal(composeReferenceSurface(waterProbe.normalizedX, waterProbe.normalizedY, { road: true }), waterProbe.surface);
assert.equal(composeReferenceSurface(waterProbe.normalizedX, waterProbe.normalizedY, { road: true, bridgeDeck: true }), 'road');

console.log('[Run273] canonical map surface pindexes PASS', JSON.stringify({
  sourceMapSha256: mask.sourceMapSha256,
  maskSha256: mask.maskSha256,
  globalCounts,
  pindexes: pindexCounts,
}));
